// NeoWallpaperLive: live video wallpaper on every monitor for GNOME 50 / Wayland.
//
// One mpv process decodes the video (hardware accelerated when possible);
// its window is hidden and a Clutter.Clone of it is placed in each monitor's
// background layer with cover scaling. Everything is driven by GSettings,
// which the `neowallpaperlive` CLI writes.

import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {log, logWarn} from './modules/constants.js';
import {Renderer} from './modules/renderer.js';
import {WallpaperLayer} from './modules/wallpaper.js';
import {Stealth} from './modules/stealth.js';
import {Control} from './modules/control.js';
import {KeepAwake} from './modules/keepawake.js';
import {AutoPause} from './modules/autopause.js';
import {SleepWatch} from './modules/sleepwatch.js';
import {sleep, withTimeout} from './modules/mpvipc.js';

// Properties reported by `neowallpaperlive status`; hwdec-current answers
// "is hardware decoding actually in use?" without any other tooling.
const MPV_STATUS_PROPS = [
    'hwdec-current', 'video-codec', 'width', 'height', 'container-fps',
    'estimated-vf-fps', 'time-pos', 'frame-drop-count', 'pause',
];
const MPV_STATUS_TIMEOUT_MS = 500;

// After a resume, give the driver a moment, then confirm the renderer is
// really still decoding before trusting it.
const RESUME_GRACE_MS = 2000;
const RESUME_PROBE_GAP_MS = 1500;
const RESUME_PROBE_TIMEOUT_MS = 1000;

export default class NeoWallpaperLiveExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._stealth = new Stealth();
        this._layer = new WallpaperLayer(() => this._settings.get_string('fill-mode'));
        this._keepAwake = new KeepAwake();
        this._autoPause = new AutoPause(() => ({
            covered: this._settings.get_boolean('pause-when-covered'),
            fullscreen: this._settings.get_boolean('pause-on-fullscreen'),
            battery: this._settings.get_boolean('pause-on-battery'),
        }));
        this._renderer = new Renderer({
            onReady: (actor, win) => {
                this._layer.setSource(actor, win);
                this._syncAwake();
            },
            onLost: () => {
                this._layer.clearSource();
                this._syncAwake();
            },
            onIpc: ipc => this._autoPause.setIpc(ipc),
            onNeedsRestart: () => this._restart(),
            getExtraArgs: () => this._settings.get_strv('mpv-extra-args'),
        });
        this._control = new Control(() => this._status());
        this._sleepWatch = new SleepWatch({
            onSleep: () => this._onSleep(),
            onResume: () => this._onResume(),
        });

        this._stealth.enable();
        this._layer.enable();
        this._keepAwake.enable();
        this._autoPause.enable(); // after stealth: relies on the patched get_window_actors
        this._sleepWatch.enable();
        this._control.enable();

        this._settingsIds = [
            this._settings.connect('changed::video-path', () => this._sync()),
            this._settings.connect('changed::enabled', () => this._sync()),
            this._settings.connect('changed::fill-mode', () => this._layer.relayout()),
            this._settings.connect('changed::mpv-extra-args', () => this._restart()),
            this._settings.connect('changed::keep-awake', () => this._syncAwake()),
            this._settings.connect('changed::pause-when-covered', () => this._autoPause.refresh()),
            this._settings.connect('changed::pause-on-fullscreen', () => this._autoPause.refresh()),
            this._settings.connect('changed::pause-on-battery', () => this._autoPause.refresh()),
        ];
        this._sync();
    }

    disable() {
        for (const id of this._settingsIds ?? [])
            this._settings.disconnect(id);
        this._settingsIds = [];

        this._resumeGeneration = (this._resumeGeneration ?? 0) + 1; // drop pending probes
        this._renderer?.stop();
        this._sleepWatch?.disable();
        this._autoPause?.disable();
        this._keepAwake?.disable();
        this._control?.disable();
        this._layer?.disable();
        this._stealth?.disable();

        this._renderer = null;
        this._sleepWatch = null;
        this._autoPause = null;
        this._keepAwake = null;
        this._control = null;
        this._layer = null;
        this._stealth = null;
        this._settings = null;
    }

    _wantedVideo() {
        if (!this._settings.get_boolean('enabled'))
            return null;
        const path = this._settings.get_string('video-path');
        if (!path)
            return null;
        if (!GLib.file_test(path, GLib.FileTest.IS_REGULAR)) {
            logWarn(`video not found: ${path}`);
            return null;
        }
        return path;
    }

    _sync() {
        const path = this._wantedVideo();
        if (!path) {
            if (this._renderer.videoPath)
                log('stopping');
            this._switchTarget = null;
            this._switchGeneration = (this._switchGeneration ?? 0) + 1;
            this._renderer.stop();
            this._layer.clearSource();
            this._syncAwake();
            return;
        }
        if (this._renderer.videoPath === path || this._switchTarget === path)
            return;

        // Swapping the file inside the running mpv keeps the window, its clones
        // and playback alive; only fall back to a restart if that fails.
        this._switchTarget = path;
        const generation = (this._switchGeneration ?? 0) + 1;
        this._switchGeneration = generation;
        this._renderer.switchTo(path).then(ok => {
            if (this._switchGeneration !== generation)
                return; // a newer request took over
            this._switchTarget = null;
            if (ok)
                return;
            log(`playing ${path}`);
            this._layer.clearSource();
            this._renderer.start(path);
        });
    }

    // The inhibitor is only held while a video is actually on screen.
    _syncAwake() {
        this._keepAwake.setWanted(
            this._settings.get_boolean('keep-awake') && this._renderer.hasWindow);
    }

    _onSleep() {
        if (!this._renderer.hasWindow)
            return;
        log('system is suspending, pausing renderer');
        this._renderer.ipc?.setProperty('pause', true).catch(() => {});
    }

    async _onResume() {
        log('system resumed');
        // _onSleep paused mpv behind auto-pause's back, so push the real
        // decision back down rather than waiting for one to change.
        this._autoPause.resync();

        const generation = (this._resumeGeneration ?? 0) + 1;
        this._resumeGeneration = generation;
        await sleep(RESUME_GRACE_MS);
        if (this._resumeGeneration !== generation || !this._renderer?.hasWindow)
            return;
        if (await this._rendererStalled()) {
            logWarn('renderer did not survive the resume, restarting it');
            this._restart();
        }
    }

    /** True if mpv should be decoding but its playback position is not moving. */
    async _rendererStalled() {
        if (this._autoPause.paused)
            return false; // legitimately paused, nothing to judge
        const ipc = this._renderer.ipc;
        if (!ipc)
            return true;
        const probe = () => withTimeout(ipc.getProperty('time-pos'), RESUME_PROBE_TIMEOUT_MS);
        try {
            const before = await probe();
            await sleep(RESUME_PROBE_GAP_MS);
            const after = await probe();
            if (typeof before !== 'number' || typeof after !== 'number')
                return true;
            return Math.abs(after - before) < 0.05;
        } catch (e) {
            logWarn(`renderer is not answering after resume: ${e.message}`);
            return true;
        }
    }

    _restart() {
        this._switchTarget = null;
        this._switchGeneration = (this._switchGeneration ?? 0) + 1;
        this._renderer.stop();
        this._layer.clearSource();
        this._sync();
    }

    async _mpvInfo() {
        const ipc = this._renderer.ipc;
        if (!ipc)
            return null;
        try {
            const values = await withTimeout(Promise.all(
                MPV_STATUS_PROPS.map(p => ipc.getProperty(p).catch(() => null))),
            MPV_STATUS_TIMEOUT_MS);
            return Object.fromEntries(MPV_STATUS_PROPS.map((p, i) => [p, values[i]]));
        } catch (e) {
            return {error: e.message};
        }
    }

    async _status() {
        return {
            enabled: this._settings.get_boolean('enabled'),
            videoPath: this._settings.get_string('video-path'),
            fillMode: this._settings.get_string('fill-mode'),
            playing: this._renderer.hasWindow,
            mpvPid: this._renderer.pid,
            rendererMinimized: this._renderer.window?.minimized ?? null,
            rendererMonitor: this._renderer.monitor,
            rendererBuffer: this._renderer.bufferSize,
            rendererRects: this._renderer.rects,
            layers: this._layer.layerCount,
            layerBoxes: this._layer.describe(),
            keepAwake: {
                requested: this._settings.get_boolean('keep-awake'),
                active: this._keepAwake.active,
                error: this._keepAwake.error,
            },
            autoPause: {
                paused: this._autoPause.paused,
                reasons: this._autoPause.reasons,
                onBattery: this._autoPause.onBattery,
                rules: {
                    covered: this._settings.get_boolean('pause-when-covered'),
                    fullscreen: this._settings.get_boolean('pause-on-fullscreen'),
                    battery: this._settings.get_boolean('pause-on-battery'),
                },
            },
            monitors: Main.layoutManager.monitors.map(m => ({
                index: m.index, x: m.x, y: m.y,
                width: m.width, height: m.height, scale: m.geometry_scale,
                workArea: (() => {
                    const a = global.workspace_manager.get_active_workspace()
                        .get_work_area_for_monitor(m.index);
                    return [a.x, a.y, a.width, a.height];
                })(),
            })),
            mpv: await this._mpvInfo(),
        };
    }
}
