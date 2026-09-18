// Minimal asynchronous client for mpv's JSON IPC protocol over a Unix socket
// (`--input-ipc-server`). One JSON object per line in each direction;
// replies are matched to requests by request_id. Events are ignored.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {log, logWarn} from './constants.js';

const CONNECT_RETRIES = 40;        // mpv creates the socket shortly after start
const CONNECT_INTERVAL_MS = 250;

export function sleep(ms) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

/** Rejects if `promise` has not settled within `ms`. */
export function withTimeout(promise, ms) {
    let source = 0;
    const timeout = new Promise((_resolve, reject) => {
        source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            source = 0;
            reject(new Error(`timeout after ${ms}ms`));
            return GLib.SOURCE_REMOVE;
        });
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (source)
            GLib.source_remove(source);
    });
}

export class MpvIpc {
    constructor(path) {
        this._path = path;
        this._conn = null;
        this._in = null;
        this._out = null;
        this._cancellable = new Gio.Cancellable();
        this._nextId = 1;
        this._pending = new Map();
        this._writeChain = Promise.resolve();
        this._closed = false;
    }

    get path() {
        return this._path;
    }

    get connected() {
        return this._conn !== null;
    }

    /** Resolves true once connected, false if mpv never opened the socket. */
    async connect() {
        for (let i = 0; i < CONNECT_RETRIES && !this._closed; i++) {
            try {
                await this._connectOnce();
                log('mpv ipc connected');
                return true;
            } catch {
                await sleep(CONNECT_INTERVAL_MS);
            }
        }
        if (!this._closed)
            logWarn(`mpv ipc: could not connect to ${this._path}`);
        return false;
    }

    close() {
        this._closed = true;
        this._cancellable.cancel();
        try {
            this._conn?.close(null);
        } catch {}
        this._disconnected();
    }

    /** Sends a raw mpv command, e.g. command('set_property', 'pause', true). */
    command(...args) {
        return new Promise((resolve, reject) => {
            if (!this._out) {
                reject(new Error('mpv ipc not connected'));
                return;
            }
            const id = this._nextId++;
            this._pending.set(id, {resolve, reject});
            const line = `${JSON.stringify({command: args, request_id: id})}\n`;
            this._enqueueWrite(line).catch(e => {
                this._pending.delete(id);
                reject(e);
            });
        });
    }

    getProperty(name) {
        return this.command('get_property', name);
    }

    setProperty(name, value) {
        return this.command('set_property', name, value);
    }

    // GIO does not allow a second write_all_async while one is still pending on
    // the same stream, and several properties are usually requested at once, so
    // writes are chained instead of started concurrently.
    _enqueueWrite(line) {
        const write = this._writeChain.then(() => new Promise((resolve, reject) => {
            if (!this._out) {
                reject(new Error('mpv ipc not connected'));
                return;
            }
            this._out.write_all_async(new TextEncoder().encode(line),
                GLib.PRIORITY_DEFAULT, this._cancellable, (stream, res) => {
                    try {
                        stream.write_all_finish(res);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
        }));
        // Keep the chain usable after a failed write.
        this._writeChain = write.catch(() => {});
        return write;
    }

    _connectOnce() {
        return new Promise((resolve, reject) => {
            const client = new Gio.SocketClient();
            client.connect_async(Gio.UnixSocketAddress.new(this._path), this._cancellable,
                (c, res) => {
                    let conn;
                    try {
                        conn = c.connect_finish(res);
                    } catch (e) {
                        reject(e);
                        return;
                    }
                    this._conn = conn;
                    this._out = conn.get_output_stream();
                    this._in = new Gio.DataInputStream({base_stream: conn.get_input_stream()});
                    this._readLoop();
                    resolve();
                });
        });
    }

    _readLoop() {
        const stream = this._in;
        if (!stream)
            return;
        stream.read_line_async(GLib.PRIORITY_DEFAULT, this._cancellable, (s, res) => {
            let line = null;
            try {
                [line] = s.read_line_finish_utf8(res);
            } catch {
                this._disconnected();
                return;
            }
            if (line === null) {
                this._disconnected();
                return;
            }
            let msg = null;
            try {
                msg = JSON.parse(line);
            } catch {}
            if (msg && msg.request_id !== undefined && this._pending.has(msg.request_id)) {
                const {resolve, reject} = this._pending.get(msg.request_id);
                this._pending.delete(msg.request_id);
                if (msg.error === 'success')
                    resolve(msg.data);
                else
                    reject(new Error(msg.error ?? 'unknown mpv error'));
            }
            this._readLoop();
        });
    }

    _disconnected() {
        this._conn = null;
        this._in = null;
        this._out = null;
        for (const {reject} of this._pending.values())
            reject(new Error('mpv ipc disconnected'));
        this._pending.clear();
    }
}
