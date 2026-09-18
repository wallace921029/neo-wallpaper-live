// Session-bus interface used by the CLI for `status`. When the shell runs
// with NWL_TEST=1 (headless test harness only) it also exposes Eval and
// Screenshot so tests can drive and observe the shell.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {BUS_NAME, OBJ_PATH, logWarn} from './constants.js';

const STATUS_IFACE = `
<node>
  <interface name="${BUS_NAME}">
    <method name="Status">
      <arg type="s" direction="out" name="json"/>
    </method>
  </interface>
</node>`;

const TEST_IFACE = `
<node>
  <interface name="${BUS_NAME}">
    <method name="Status">
      <arg type="s" direction="out" name="json"/>
    </method>
    <method name="Eval">
      <arg type="s" direction="in" name="code"/>
      <arg type="s" direction="out" name="result"/>
    </method>
    <method name="Screenshot">
      <arg type="s" direction="in" name="path"/>
      <arg type="b" direction="out" name="ok"/>
    </method>
  </interface>
</node>`;

export class Control {
    /** @param {() => object} getStatus */
    constructor(getStatus) {
        this._getStatus = getStatus;
        this._test = GLib.getenv('NWL_TEST') === '1';
        this._dbus = null;
        this._nameId = 0;
    }

    enable() {
        if (this._test)
            Gio._promisify(Shell.Screenshot.prototype, 'screenshot');
        this._dbus = Gio.DBusExportedObject.wrapJSObject(this._test ? TEST_IFACE : STATUS_IFACE, this);
        this._dbus.export(Gio.DBus.session, OBJ_PATH);
        this._nameId = Gio.bus_own_name(Gio.BusType.SESSION, BUS_NAME,
            Gio.BusNameOwnerFlags.REPLACE, null, null, null);
    }

    disable() {
        if (this._nameId) {
            Gio.bus_unown_name(this._nameId);
            this._nameId = 0;
        }
        this._dbus?.unexport();
        this._dbus = null;
    }

    Status() {
        return JSON.stringify(this._getStatus());
    }

    Eval(code) {
        try {
            // eslint-disable-next-line no-eval
            const r = eval(code);
            return typeof r === 'string' ? r : JSON.stringify(r) ?? String(r);
        } catch (e) {
            return `ERROR: ${e.message}\n${e.stack}`;
        }
    }

    async ScreenshotAsync(params, invocation) {
        const [path] = params;
        try {
            const file = Gio.File.new_for_path(path);
            const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
            await new Shell.Screenshot().screenshot(false, stream);
            stream.close(null);
            invocation.return_value(new GLib.Variant('(b)', [true]));
        } catch (e) {
            logWarn(`screenshot failed: ${e.message}`);
            invocation.return_value(new GLib.Variant('(b)', [false]));
        }
    }

    // Keep these referenced so Eval'd test code can use them without importing.
    get _scope() {
        return {Main, Meta, Shell};
    }
}
