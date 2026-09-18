// Watches logind's PrepareForSleep signal so the renderer can be paused
// before the machine suspends and checked for life after it wakes up:
// a GPU reset across suspend regularly leaves a hardware-decoding client
// frozen or rendering garbage.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {logWarn} from './constants.js';

const LOGIN1_NAME = 'org.freedesktop.login1';
const LOGIN1_PATH = '/org/freedesktop/login1';
const LOGIN1_IFACE = 'org.freedesktop.login1.Manager';

export class SleepWatch {
    /**
     * @param {object} callbacks
     * @param {() => void} callbacks.onSleep about to suspend
     * @param {() => void} callbacks.onResume woken up
     */
    constructor({onSleep, onResume}) {
        this._onSleep = onSleep;
        this._onResume = onResume;
        this._bus = null;
        this._signalId = 0;
    }

    enable() {
        // The test harness has no system bus, so it emits the same signal on
        // the session bus instead (and then any sender is acceptable).
        const test = GLib.getenv('NWL_TEST') === '1';
        this._bus = test ? Gio.DBus.session : Gio.DBus.system;
        try {
            this._signalId = this._bus.signal_subscribe(
                test ? null : LOGIN1_NAME,
                LOGIN1_IFACE, 'PrepareForSleep', LOGIN1_PATH, null,
                Gio.DBusSignalFlags.NONE,
                (_conn, _sender, _path, _iface, _signal, params) => {
                    const [start] = params.deepUnpack();
                    if (start)
                        this._onSleep();
                    else
                        this._onResume();
                });
        } catch (e) {
            logWarn(`sleep watch unavailable: ${e.message}`);
        }
    }

    disable() {
        if (this._signalId) {
            this._bus.signal_unsubscribe(this._signalId);
            this._signalId = 0;
        }
        this._bus = null;
    }
}
