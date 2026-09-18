// Keeps the machine awake (no automatic suspend, no idle blanking / locking)
// through gnome-session's inhibitor API — the same call video players and the
// Caffeine extension use. The inhibitor is tied to gnome-shell's D-Bus
// connection, so it can never outlive the shell; disable() releases it
// explicitly for the lock-screen / re-enable cycle.

import Gio from 'gi://Gio';

import {log, logWarn} from './constants.js';

const INHIBIT_APP_ID = 'neowallpaperlive';
const INHIBIT_REASON = 'Live wallpaper: keep awake';
const INHIBIT_SUSPEND = 4;
const INHIBIT_IDLE = 8;

const SessionManagerIface = `
<node>
  <interface name="org.gnome.SessionManager">
    <method name="Inhibit">
      <arg type="s" direction="in" name="app_id"/>
      <arg type="u" direction="in" name="toplevel_xid"/>
      <arg type="s" direction="in" name="reason"/>
      <arg type="u" direction="in" name="flags"/>
      <arg type="u" direction="out" name="inhibit_cookie"/>
    </method>
    <method name="Uninhibit">
      <arg type="u" direction="in" name="inhibit_cookie"/>
    </method>
  </interface>
</node>`;
const SessionManagerProxy = Gio.DBusProxy.makeProxyWrapper(SessionManagerIface);

export class KeepAwake {
    constructor() {
        this._proxy = null;
        this._cancellable = null;
        this._wanted = false;
        this._cookie = null;
        this._busy = false;
        this._error = null;
    }

    get active() {
        return this._cookie !== null;
    }

    get error() {
        return this._error;
    }

    enable() {
        this._cancellable = new Gio.Cancellable();
        new SessionManagerProxy(Gio.DBus.session,
            'org.gnome.SessionManager', '/org/gnome/SessionManager',
            (proxy, error) => {
                if (error) {
                    this._error = error.message;
                    logWarn(`keep-awake unavailable: ${error.message}`);
                    return;
                }
                this._proxy = proxy;
                this._reconcile();
            },
            this._cancellable,
            Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES | Gio.DBusProxyFlags.DO_NOT_CONNECT_SIGNALS);
    }

    disable() {
        this._wanted = false;
        this._cancellable?.cancel();
        this._cancellable = null;
        if (this._cookie !== null && this._proxy) {
            const proxy = this._proxy, cookie = this._cookie;
            this._cookie = null;
            proxy.UninhibitRemote(cookie, (_r, error) => {
                if (error)
                    logWarn(`keep-awake release on disable failed: ${error.message}`);
                else
                    log('keep-awake released');
            });
        }
        this._proxy = null;
        this._busy = false;
    }

    /** @param {boolean} wanted whether an inhibitor should be held right now */
    setWanted(wanted) {
        if (this._wanted === wanted)
            return;
        this._wanted = wanted;
        this._reconcile();
    }

    // Requests are asynchronous; the desired state can flip while one is in
    // flight, so every completion re-checks and issues the next step.
    _reconcile() {
        if (!this._proxy || this._busy)
            return;
        if (this._wanted && this._cookie === null)
            this._acquire();
        else if (!this._wanted && this._cookie !== null)
            this._release();
    }

    _acquire() {
        this._busy = true;
        this._proxy.InhibitRemote(INHIBIT_APP_ID, 0, INHIBIT_REASON,
            INHIBIT_SUSPEND | INHIBIT_IDLE, (result, error) => {
                this._busy = false;
                if (error) {
                    this._error = error.message;
                    logWarn(`keep-awake failed: ${error.message}`);
                    return;
                }
                this._cookie = result[0];
                this._error = null;
                log('keep-awake active: suspend and idle blanking inhibited');
                this._reconcile();
            });
    }

    _release() {
        const cookie = this._cookie;
        this._cookie = null;
        this._busy = true;
        this._proxy.UninhibitRemote(cookie, (_result, error) => {
            this._busy = false;
            if (error)
                logWarn(`keep-awake release failed: ${error.message}`);
            else
                log('keep-awake released');
            this._reconcile();
        });
    }
}
