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

export default class NeoWallpaperLiveExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._stealth = new Stealth();
        this._layer = new WallpaperLayer(() => this._settings.get_string('fill-mode'));
        this._keepAwake = new KeepAwake();
        this._renderer = new Renderer({
            onReady: (actor, win) => {
                this._layer.setSource(actor, win);
                this._syncAwake();
            },
            onLost: () => {
                this._layer.clearSource();
                this._syncAwake();
            },
            getExtraArgs: () => this._settings.get_strv('mpv-extra-args'),
        });
        this._control = new Control(() => this._status());

        this._stealth.enable();
        this._layer.enable();
        this._keepAwake.enable();
        this._control.enable();

        this._settingsIds = [
            this._settings.connect('changed::video-path', () => this._sync()),
            this._settings.connect('changed::enabled', () => this._sync()),
            this._settings.connect('changed::fill-mode', () => this._layer.relayout()),
            this._settings.connect('changed::mpv-extra-args', () => this._restart()),
            this._settings.connect('changed::keep-awake', () => this._syncAwake()),
        ];
        this._sync();
    }

    disable() {
        for (const id of this._settingsIds ?? [])
            this._settings.disconnect(id);
        this._settingsIds = [];

        this._renderer?.stop();
        this._keepAwake?.disable();
        this._control?.disable();
        this._layer?.disable();
        this._stealth?.disable();

        this._renderer = null;
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
            this._renderer.stop();
            this._layer.clearSource();
            this._syncAwake();
            return;
        }
        if (this._renderer.videoPath !== path) {
            log(`playing ${path}`);
            this._layer.clearSource();
            this._renderer.start(path);
        }
    }

    // The inhibitor is only held while a video is actually on screen.
    _syncAwake() {
        this._keepAwake.setWanted(
            this._settings.get_boolean('keep-awake') && this._renderer.hasWindow);
    }

    _restart() {
        this._renderer.stop();
        this._layer.clearSource();
        this._sync();
    }

    _status() {
        return {
            enabled: this._settings.get_boolean('enabled'),
            videoPath: this._settings.get_string('video-path'),
            fillMode: this._settings.get_string('fill-mode'),
            playing: this._renderer.hasWindow,
            mpvPid: this._renderer.pid,
            rendererMinimized: this._renderer.window?.minimized ?? null,
            layers: this._layer.layerCount,
            keepAwake: {
                requested: this._settings.get_boolean('keep-awake'),
                active: this._keepAwake.active,
                error: this._keepAwake.error,
            },
            monitors: Main.layoutManager.monitors.map(m => ({
                index: m.index, width: m.width, height: m.height, scale: m.geometry_scale,
            })),
        };
    }
}
