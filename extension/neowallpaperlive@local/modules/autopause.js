// Pauses the renderer when nobody can see it or when the machine should
// save power, and resumes it otherwise. Three independent rules, each
// switchable from settings:
//   covered    — every monitor's work area is hidden behind a window on the
//                current workspace (maximized, fullscreen, or simply that big)
//   fullscreen — some monitor has a fullscreen window on top (game, video):
//                give it the GPU even if other monitors still show the video
//   battery    — UPower reports the machine is on battery
// Pausing keeps the last frame on screen; only decoding stops.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {isRendererWindow, log, logWarn} from './constants.js';

const DEBOUNCE_MS = 300;

const UPowerIface = `
<node>
  <interface name="org.freedesktop.UPower">
    <property name="OnBattery" type="b" access="read"/>
  </interface>
</node>`;
const UPowerProxy = Gio.DBusProxy.makeProxyWrapper(UPowerIface);

const WINDOW_SIGNALS = ['size-changed', 'position-changed', 'notify::minimized', 'workspace-changed'];

export class AutoPause {
    /**
     * @param {() => {covered: boolean, fullscreen: boolean, battery: boolean}} getRules
     */
    constructor(getRules) {
        this._getRules = getRules;
        this._ipc = null;
        this._reasons = [];
        this._paused = false;
        this._onBattery = null;       // null until UPower answers
        this._upower = null;
        this._cancellable = null;
        this._signals = [];           // [object, id]
        this._windows = new Map();    // Meta.Window -> [ids]
        this._debounce = 0;
    }

    get paused() {
        return this._paused;
    }

    get reasons() {
        return [...this._reasons];
    }

    get onBattery() {
        return this._onBattery;
    }

    enable() {
        this._cancellable = new Gio.Cancellable();
        const connect = (obj, name, cb) => this._signals.push([obj, obj.connect(name, cb)]);

        connect(global.display, 'window-created', (_d, win) => {
            this._track(win);
            this._schedule();
        });
        connect(global.display, 'restacked', () => this._schedule());
        connect(global.display, 'in-fullscreen-changed', () => this._schedule());
        connect(global.window_manager, 'switch-workspace', () => this._schedule());
        connect(Main.overview, 'showing', () => this._schedule());
        connect(Main.overview, 'hidden', () => this._schedule());
        connect(Main.layoutManager, 'monitors-changed', () => this._schedule());
        for (const actor of global.get_window_actors())
            this._track(actor.meta_window);

        new UPowerProxy(Gio.DBus.system, 'org.freedesktop.UPower', '/org/freedesktop/UPower',
            (proxy, error) => {
                if (error) {
                    logWarn(`auto-pause: UPower unavailable, battery rule inactive (${error.message})`);
                    return;
                }
                this._upower = proxy;
                this._onBattery = proxy.OnBattery === true;
                this._signals.push([proxy, proxy.connect('g-properties-changed', () => {
                    const now = proxy.OnBattery === true;
                    if (now !== this._onBattery) {
                        this._onBattery = now;
                        this._schedule();
                    }
                })]);
                this._schedule();
            }, this._cancellable);

        this._schedule();
    }

    disable() {
        if (this._debounce) {
            GLib.source_remove(this._debounce);
            this._debounce = 0;
        }
        this._cancellable?.cancel();
        this._cancellable = null;
        for (const [obj, id] of this._signals) {
            try {
                obj.disconnect(id);
            } catch {}
        }
        this._signals = [];
        for (const win of [...this._windows.keys()])
            this._untrack(win);
        this._upower = null;
        this._setIpcPaused(false);
        this._ipc = null;
        this._reasons = [];
        this._paused = false;
    }

    /** @param {import('./mpvipc.js').MpvIpc | null} ipc connected renderer link, or null */
    setIpc(ipc) {
        this._ipc = ipc;
        if (ipc)
            this._setIpcPaused(this._paused);
    }

    /** Re-evaluate now (settings changed). */
    refresh() {
        this._schedule();
    }

    /**
     * Re-evaluate immediately and push the result to mpv even if the decision
     * did not change. Used after a resume, where something else (the suspend
     * handler) has paused mpv behind our back.
     */
    resync() {
        this._evaluate();
        this._setIpcPaused(this._paused);
    }

    // ---- window tracking --------------------------------------------------

    _track(win) {
        if (!win || this._windows.has(win))
            return;
        const ids = WINDOW_SIGNALS.map(name => win.connect(name, () => this._schedule()));
        ids.push(win.connect('unmanaged', () => {
            this._untrack(win);
            this._schedule();
        }));
        this._windows.set(win, ids);
    }

    _untrack(win) {
        const ids = this._windows.get(win);
        if (!ids)
            return;
        for (const id of ids) {
            try {
                win.disconnect(id);
            } catch {}
        }
        this._windows.delete(win);
    }

    // ---- evaluation -------------------------------------------------------

    _schedule() {
        if (this._debounce)
            return;
        this._debounce = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
            this._debounce = 0;
            this._evaluate();
            return GLib.SOURCE_REMOVE;
        });
    }

    _evaluate() {
        const rules = this._getRules();
        const reasons = [];
        if (rules.fullscreen && this._fullscreenAnywhere())
            reasons.push('fullscreen');
        if (rules.covered && this._allCovered())
            reasons.push('covered');
        if (rules.battery && this._onBattery)
            reasons.push('battery');

        const paused = reasons.length > 0;
        const changed = paused !== this._paused ||
            reasons.join() !== this._reasons.join();
        this._reasons = reasons;
        if (!changed)
            return;
        this._paused = paused;
        log(paused ? `auto-pause: paused (${reasons.join(', ')})` : 'auto-pause: resumed');
        this._setIpcPaused(paused);
    }

    _setIpcPaused(paused) {
        if (!this._ipc)
            return;
        const ipc = this._ipc;
        ipc.setProperty('pause', paused).catch(e => {
            // A renderer restart tears the link down mid-write; the restart is
            // already reported, so do not raise a second alarm for it.
            if (this._ipc === ipc && ipc.connected)
                logWarn(`auto-pause: could not ${paused ? 'pause' : 'resume'} mpv: ${e.message}`);
        });
    }

    _fullscreenAnywhere() {
        return Main.layoutManager.monitors.some(m => m.inFullscreen);
    }

    _visibleWindows() {
        const ws = global.workspace_manager.get_active_workspace();
        // get_window_actors() is patched by stealth.js to exclude the renderer.
        return global.get_window_actors()
            .map(a => a.meta_window)
            .filter(w => w && !isRendererWindow(w) &&
                w.get_window_type() === Meta.WindowType.NORMAL &&
                w.showing_on_its_workspace() &&
                w.located_on_workspace(ws));
    }

    _allCovered() {
        if (Main.overview.visible)
            return false; // the overview shows the video in every workspace preview
        const monitors = Main.layoutManager.monitors;
        if (monitors.length === 0)
            return false;
        const ws = global.workspace_manager.get_active_workspace();
        const windows = this._visibleWindows();
        return monitors.every(m => {
            const area = ws.get_work_area_for_monitor(m.index);
            return windows.some(w => {
                if (w.get_monitor() !== m.index)
                    return false;
                if (w.is_fullscreen())
                    return true;
                const f = w.get_frame_rect();
                return f.x <= area.x && f.y <= area.y &&
                    f.x + f.width >= area.x + area.width &&
                    f.y + f.height >= area.y + area.height;
            });
        });
    }
}
