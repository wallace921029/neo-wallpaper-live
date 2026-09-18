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

import {APP_ID, TITLE_PREFIX, isRendererWindow, log, logWarn} from './constants.js';

const RESPAWN_DELAY_MS = 2000;
const RESPAWN_MAX = 5;          // within RESPAWN_WINDOW_MS
const RESPAWN_WINDOW_MS = 60000;

export class Renderer {
    /**
     * @param {object} callbacks
     * @param {(actor: Meta.WindowActor, win: Meta.Window) => void} callbacks.onReady
     * @param {() => void} callbacks.onLost
     * @param {() => string[]} callbacks.getExtraArgs
     */
    constructor({onReady, onLost, getExtraArgs}) {
        this._onReady = onReady;
        this._onLost = onLost;
        this._getExtraArgs = getExtraArgs;

        this._videoPath = null;
        this._proc = null;
        this._title = null;
        this._win = null;
        this._actor = null;
        this._winSignals = [];
        this._actorSignals = [];
        this._pendingWindows = new Map(); // Meta.Window -> signal ids
        this._windowCreatedId = 0;
        this._respawnSource = 0;
        this._respawnTimes = [];
        this._stopping = false;
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

    start(videoPath) {
        if (this._proc && this._videoPath === videoPath)
            return;
        this.stop();
        this._stopping = false;
        this._videoPath = videoPath;
        this._respawnTimes = [];

        if (!this._windowCreatedId) {
            this._windowCreatedId = global.display.connect('window-created',
                (_display, win) => this._onWindowCreated(win));
        }
        this._spawn();
    }

    stop() {
        this._stopping = true;
        if (this._respawnSource) {
            GLib.source_remove(this._respawnSource);
            this._respawnSource = 0;
        }
        if (this._windowCreatedId) {
            global.display.disconnect(this._windowCreatedId);
            this._windowCreatedId = 0;
        }
        for (const [win, ids] of this._pendingWindows)
            ids.forEach(id => win.disconnect(id));
        this._pendingWindows.clear();

        this._releaseWindow();

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
        const ipc = GLib.getenv('NWL_IPC'); // test harness only
        if (ipc)
            argv.push(`--input-ipc-server=${ipc}`);
        argv.push(...this._getExtraArgs());
        argv.push('--', this._videoPath);
        return argv;
    }

    _spawn() {
        const argv = this._buildArgv();
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
            log(`renderer first frame (${width}x${height}), hiding window`);
            if (!win.minimized)
                win.minimize();
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
