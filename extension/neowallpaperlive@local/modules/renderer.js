// Owns the single mpv renderer process and the Mutter window it creates.
//
// Lifecycle: spawn mpv with a unique title -> Mutter emits window-created ->
// once wm_class/title match we adopt the window: make its actor fully
// transparent (clones paint at their own opacity, so this hides only the
// real window), and after the first frame minimize it so it leaves the
// window stack. Clutter keeps an actor mapped while it has mapped clones,
// so Mutter keeps sending frame callbacks and mpv keeps rendering.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {APP_ID, TITLE_PREFIX, isRendererWindow, log, logWarn} from './constants.js';
import {MpvIpc, sleep, withTimeout} from './mpvipc.js';

const SETTLE_DELAY_MS = 500;
// After a monitor change, let the new layout settle, pin, then confirm the
// move actually happened before falling back to a restart.
const PIN_SETTLE_MS = 800;
const PIN_VERIFY_MS = 800;
const PIN_RESTART_MAX = 2;
const SETTLE_FALLBACK_MS = 3000;

const SWITCH_TIMEOUT_MS = 1000;
const SWITCH_CONFIRM_TRIES = 20;   // x SWITCH_CONFIRM_INTERVAL_MS
const SWITCH_CONFIRM_INTERVAL_MS = 100;

const RESPAWN_DELAY_MS = 2000;
const RESPAWN_MAX = 5;          // within RESPAWN_WINDOW_MS
const RESPAWN_WINDOW_MS = 60000;

export class Renderer {
    /**
     * @param {object} callbacks
     * @param {(actor: Meta.WindowActor, win: Meta.Window) => void} callbacks.onReady
     * @param {() => void} callbacks.onLost
     * @param {(ipc: MpvIpc | null) => void} callbacks.onIpc
     * @param {() => void} callbacks.onNeedsRestart
     * @param {() => string[]} callbacks.getExtraArgs
     */
    constructor({onReady, onLost, onIpc, onNeedsRestart, getExtraArgs}) {
        this._onReady = onReady;
        this._onLost = onLost;
        this._onIpc = onIpc;
        this._onNeedsRestart = onNeedsRestart;
        this._getExtraArgs = getExtraArgs;

        this._videoPath = null;
        this._proc = null;
        this._ipc = null;
        this._title = null;
        this._win = null;
        this._actor = null;
        this._winSignals = [];
        this._actorSignals = [];
        this._pendingWindows = new Map(); // Meta.Window -> signal ids
        this._windowCreatedId = 0;
        this._monitorsChangedId = 0;
        this._respawnSource = 0;
        this._respawnTimes = [];
        this._stopping = false;
        this._firstFrame = false;
        this._settled = false;
        this._settleFallback = 0;
        this._pinSource = 0;
        this._pinVerifySource = 0;
        this._pinRestarts = 0;
    }

    get videoPath() {
        return this._videoPath;
    }

    get pid() {
        return this._proc?.get_identifier() ?? null;
    }

    get hasWindow() {
        return !!this._win;
    }

    get window() {
        return this._win;
    }

    /** Monitor the renderer window currently sits on, or null. */
    get monitor() {
        return this._win?.get_monitor() ?? null;
    }

    /**
     * Size of the buffer mpv is actually rendering into. The compositor caps a
     * window at the size of its monitor, so this is what limits sharpness on
     * every other monitor.
     */
    get bufferSize() {
        if (!this._win)
            return null;
        const {width, height} = this._win.get_buffer_rect();
        return {width, height};
    }

    /** Connected MpvIpc for the running renderer, or null. */
    get ipc() {
        return this._ipc?.connected ? this._ipc : null;
    }

    // One socket per Wayland display so a headless test shell never talks
    // to the real session's renderer (or vice versa).
    _ipcPath() {
        const display = GLib.path_get_basename(GLib.getenv('WAYLAND_DISPLAY') ?? 'default');
        return GLib.build_filenamev([GLib.get_user_runtime_dir(), `neowallpaperlive-${display}.sock`]);
    }

    start(videoPath) {
        if (this._proc && this._videoPath === videoPath)
            return;
        this.stop();
        this._stopping = false;
        this._videoPath = videoPath;
        this._respawnTimes = [];
        this._firstFrame = false;
        this._settled = false;

        if (!this._windowCreatedId) {
            this._windowCreatedId = global.display.connect('window-created',
                (_display, win) => this._onWindowCreated(win));
        }
        if (!this._monitorsChangedId) {
            this._monitorsChangedId = Main.layoutManager.connect('monitors-changed',
                () => this._schedulePinCheck());
        }
        this._spawn();
    }

    /**
     * Point the running mpv at another file instead of restarting it, so the
     * video on screen is never replaced by the static wallpaper. Resolves
     * false when that is not possible and the caller should restart instead.
     */
    async switchTo(videoPath) {
        const ipc = this.ipc;
        if (!ipc || !this._win)
            return false;
        try {
            await withTimeout(ipc.command('loadfile', videoPath, 'replace'), SWITCH_TIMEOUT_MS);
        } catch (e) {
            logWarn(`in-place switch rejected by mpv: ${e.message}`);
            return false;
        }
        // loadfile only queues the request; make sure mpv really took the file
        // before reporting success, otherwise the caller must fall back.
        for (let i = 0; i < SWITCH_CONFIRM_TRIES; i++) {
            await sleep(SWITCH_CONFIRM_INTERVAL_MS);
            if (this._ipc !== ipc || !this._win)
                return false;
            let current;
            try {
                current = await withTimeout(ipc.getProperty('path'), SWITCH_TIMEOUT_MS);
            } catch {
                return false;
            }
            if (current === videoPath) {
                this._videoPath = videoPath;
                log(`switched to ${videoPath} in place`);
                return true;
            }
        }
        logWarn('mpv did not pick up the new file in time');
        return false;
    }

    stop() {
        this._stopping = true;
        if (this._respawnSource) {
            GLib.source_remove(this._respawnSource);
            this._respawnSource = 0;
        }
        if (this._settleFallback) {
            GLib.source_remove(this._settleFallback);
            this._settleFallback = 0;
        }
        for (const name of ['_pinSource', '_pinVerifySource']) {
            if (this[name]) {
                GLib.source_remove(this[name]);
                this[name] = 0;
            }
        }
        if (this._windowCreatedId) {
            global.display.disconnect(this._windowCreatedId);
            this._windowCreatedId = 0;
        }
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }
        for (const [win, ids] of this._pendingWindows)
            ids.forEach(id => win.disconnect(id));
        this._pendingWindows.clear();

        this._releaseWindow();
        this._dropIpc();

        if (this._proc) {
            const proc = this._proc;
            this._proc = null;
            try {
                proc.send_signal(15); // SIGTERM; mpv exits promptly
            } catch (e) {
                logWarn('failed to terminate mpv:', e.message);
            }
        }
        this._videoPath = null;
        this._title = null;
    }

    // ---- process ----------------------------------------------------------

    _buildArgv() {
        this._title = `${TITLE_PREFIX}${GLib.uuid_string_random()}`;
        const argv = [
            'mpv', '--no-config', '--no-terminal', '--msg-level=all=warn',
            '--loop-file=inf', '--no-audio', '--ytdl=no',
            '--force-window=yes', '--idle=no',
            // No UI, no input, no idle-inhibit (a wallpaper must not block screen blanking).
            '--no-osc', '--no-osd-bar', '--osd-level=0',
            '--input-default-bindings=no', '--input-vo-keyboard=no',
            '--input-cursor=no', '--cursor-autohide=no', '--stop-screensaver=no',
            '--no-border',
            // GPU path on Wayland with hardware decoding when available.
            '--vo=gpu', '--gpu-context=wayland', '--hwdec=auto-safe',
            // Render at the video's native size regardless of monitor bounds;
            // if the compositor ever forces another size, crop rather than letterbox.
            '--wayland-configure-bounds=no', '--panscan=1.0',
            `--wayland-app-id=${APP_ID}`,
            `--title=${this._title}`,
        ];
        argv.push(`--input-ipc-server=${this._ipcPath()}`);
        argv.push(...this._getExtraArgs());
        argv.push('--', this._videoPath);
        return argv;
    }

    _spawn() {
        const argv = this._buildArgv();
        GLib.unlink(this._ipcPath()); // a crashed mpv can leave a stale socket
        try {
            const launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE,
            });
            this._proc = launcher.spawnv(argv);
        } catch (e) {
            logWarn(`failed to spawn mpv: ${e.message}`);
            this._proc = null;
            return;
        }
        log(`mpv started, pid ${this._proc.get_identifier()}`);

        this._dropIpc();
        const ipc = new MpvIpc(this._ipcPath());
        this._ipc = ipc;
        ipc.connect().then(ok => {
            if (!ok || this._ipc !== ipc)
                return;
            this._onIpc(ipc);
        }).catch(e => logWarn(`mpv ipc: ${e.message}`));

        const proc = this._proc;
        const stream = new Gio.DataInputStream({base_stream: proc.get_stdout_pipe()});
        const readLine = () => stream.read_line_async(GLib.PRIORITY_DEFAULT, null, (s, res) => {
            let line = null;
            try {
                [line] = s.read_line_finish_utf8(res);
            } catch {
                return;
            }
            if (line === null)
                return;
            // ffmpeg probes CUDA on every start; not an error on non-NVIDIA machines.
            if (!line.includes('libcuda'))
                logWarn('mpv:', line);
            readLine();
        });
        readLine();

        proc.wait_async(null, (p, res) => {
            try {
                p.wait_finish(res);
            } catch {}
            const status = p.get_if_exited()
                ? `status ${p.get_exit_status()}` : `signal ${p.get_term_sig()}`;
            if (this._proc !== p)
                return; // superseded or stopped on purpose
            this._proc = null;
            this._dropIpc();
            this._releaseWindow();
            if (this._stopping)
                return;
            logWarn(`mpv exited (${status})`);
            this._scheduleRespawn();
        });
    }

    _scheduleRespawn() {
        const now = GLib.get_monotonic_time() / 1000;
        this._respawnTimes = this._respawnTimes.filter(t => now - t < RESPAWN_WINDOW_MS);
        if (this._respawnTimes.length >= RESPAWN_MAX) {
            logWarn(`mpv keeps exiting (${RESPAWN_MAX} times in ${RESPAWN_WINDOW_MS / 1000}s); giving up. Check the video with: mpv "${this._videoPath}"`);
            return;
        }
        this._respawnTimes.push(now);
        this._respawnSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RESPAWN_DELAY_MS, () => {
            this._respawnSource = 0;
            if (!this._stopping && this._videoPath)
                this._spawn();
            return GLib.SOURCE_REMOVE;
        });
    }

    // mpv's surface is capped at the size of the monitor it sits on, so the
    // monitor with the most physical pixels decides how sharp the video can be
    // on every monitor. Keep the window there.
    _bestMonitorIndex() {
        let best = null;
        let bestPixels = -1;
        for (const m of Main.layoutManager.monitors) {
            const scale = m.geometry_scale || 1;
            const pixels = m.width * scale * m.height * scale;
            if (pixels > bestPixels) {
                bestPixels = pixels;
                best = m.index;
            }
        }
        return best;
    }

    /**
     * Pin once the monitor layout has settled, then make sure it took:
     * move_to_monitor() on the hidden renderer window is not always honoured
     * (seen after a hot-plug, leaving a 4K screen fed from a smaller buffer),
     * and a restart always lands correctly.
     */
    _schedulePinCheck() {
        if (this._pinSource)
            GLib.source_remove(this._pinSource);
        this._pinSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PIN_SETTLE_MS, () => {
            this._pinSource = 0;
            this._pinToBestMonitor();

            if (this._pinVerifySource)
                GLib.source_remove(this._pinVerifySource);
            this._pinVerifySource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PIN_VERIFY_MS, () => {
                this._pinVerifySource = 0;
                this._verifyPin();
                return GLib.SOURCE_REMOVE;
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _verifyPin() {
        const win = this._win;
        const target = this._bestMonitorIndex();
        if (!win || target === null || win.get_monitor() === target) {
            this._pinRestarts = 0;
            return;
        }
        if (this._pinRestarts >= PIN_RESTART_MAX) {
            logWarn(`renderer will not move to monitor ${target}; leaving it on ${win.get_monitor()}`);
            return;
        }
        this._pinRestarts++;
        logWarn(`renderer is still on monitor ${win.get_monitor()} instead of ${target}, restarting it`);
        this._onNeedsRestart();
    }

    _pinToBestMonitor() {
        const win = this._win;
        if (!win)
            return;
        const target = this._bestMonitorIndex();
        if (target === null || win.get_monitor() === target)
            return;
        log(`pinning renderer to monitor ${target} (most pixels)`);
        win.move_to_monitor(target);
    }

    /**
     * Mutter places the window itself around the first frame, overriding
     * anything done at adoption time, so the monitor is only pinned once that
     * has settled. Mutter also caps the window at its monitor's work area and
     * neither move_resize_frame() nor mpv's window-scale gets past that, so the
     * video is rendered a few percent below its native size and scaled back up.
     */
    _settle() {
        if (this._settled || !this._firstFrame || !this._win)
            return;
        this._settled = true;
        this._pinToBestMonitor();
        this._hideWindow();
        this._schedulePinCheck();
    }

    _hideWindow() {
        const win = this._win;
        if (!win || win.minimized)
            return;
        log('hiding renderer window');
        win.minimize();
    }

    _dropIpc() {
        if (!this._ipc)
            return;
        const wasConnected = this._ipc.connected;
        this._ipc.close();
        this._ipc = null;
        if (wasConnected)
            this._onIpc(null);
    }

    // ---- window adoption --------------------------------------------------

    _onWindowCreated(win) {
        if (this._tryAdopt(win))
            return;
        // wm_class and title arrive shortly after creation on Wayland.
        const ids = [];
        const check = () => {
            if (this._tryAdopt(win) || !this._pendingWindows.has(win))
                this._forgetPending(win);
        };
        ids.push(win.connect('notify::wm-class', check));
        ids.push(win.connect('notify::title', check));
        ids.push(win.connect('unmanaged', () => this._forgetPending(win)));
        this._pendingWindows.set(win, ids);
    }

    _forgetPending(win) {
        const ids = this._pendingWindows.get(win);
        if (!ids)
            return;
        ids.forEach(id => win.disconnect(id));
        this._pendingWindows.delete(win);
    }

    _tryAdopt(win) {
        if (!isRendererWindow(win) || win.get_title() !== this._title)
            return false;
        if (this._win)
            return true; // already adopted (duplicate signal)
        this._forgetPending(win);
        this._adopt(win);
        return true;
    }

    _adopt(win) {
        const actor = win.get_compositor_private();
        if (!actor) {
            logWarn('renderer window has no actor yet; ignoring');
            return;
        }
        this._win = win;
        this._actor = actor;

        // Never show the real window: clones override the source opacity when painting.
        actor.opacity = 0;

        // Mutter may auto-maximize monitor-sized windows; we want the native video size.
        try {
            if (win.is_maximized())
                win.unmaximize();
            if (win.is_fullscreen())
                win.unmake_fullscreen();
        } catch (e) {
            logWarn(`could not unmaximize renderer: ${e.message}`);
        }

        this._winSignals.push(win.connect('notify::minimized', () => {
            if (!win.minimized && this._win === win)
                win.minimize(); // something raised it (dock click, activation): put it back
        }));
        this._winSignals.push(win.connect('unmanaged', () => {
            log('renderer window closed');
            this._releaseWindow();
            if (!this._stopping)
                this._onLost();
        }));
        this._actorSignals.push(actor.connect('first-frame', () => {
            if (this._win !== win)
                return;
            const {width, height} = win.get_buffer_rect();
            log(`renderer first frame (${width}x${height})`);
            // Mutter applies its size constraints after the first frame, so
            // give it a moment before reading and correcting the geometry.
            this._firstFrame = true;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_DELAY_MS, () => {
                this._settle();
                return GLib.SOURCE_REMOVE;
            });
            // Hide it even if the geometry pass never completes.
            if (!this._settleFallback) {
                this._settleFallback = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_FALLBACK_MS, () => {
                    this._settleFallback = 0;
                    this._hideWindow();
                    return GLib.SOURCE_REMOVE;
                });
            }
        }));

        log('renderer window adopted');
        this._onReady(actor, win);
    }

    _releaseWindow() {
        if (this._win) {
            for (const id of this._winSignals)
                this._win.disconnect(id);
        }
        if (this._actor) {
            for (const id of this._actorSignals)
                this._actor.disconnect(id);
        }
        this._winSignals = [];
        this._actorSignals = [];
        this._win = null;
        this._actor = null;
    }
}
