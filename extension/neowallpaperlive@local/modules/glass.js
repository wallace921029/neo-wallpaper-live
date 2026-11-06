// Frosted-glass top bar and Ubuntu Dock.
//
// GNOME has no switch for "blur what is behind the panel", but the shell ships
// Shell.BlurEffect (its own lock screen uses it). In BACKGROUND mode the effect
// blurs whatever was already painted underneath the actor -- the wallpaper
// (including our live video clones) and any window passing behind -- and then
// paints the actor on top, so a translucent panel turns into frosted glass.
//
// Nothing here touches layout: it only attaches an effect and tints the
// background. The top bar is tinted with a small generated stylesheet (the
// overview rewrites Main.panel's inline style on every open and close, so an
// inline style would not survive it). The dock owns its own background style
// -- its theme manager rewrites it whenever anything changes -- so the dock is
// tinted through its own GSettings instead, with the previous values saved
// and restored.
//
// Blurring "what is behind" reads pixels that were already painted. Mutter
// normally repaints only the small rectangle that changed (a hovered icon, say);
// outside that rectangle the frame buffer still holds the *previous* frame,
// which for the bar and the dock is already blurred and tinted. The blur then
// reads its own old output, and a darker square flickers around whatever was
// hovered. So while glass is on, clipped redraws are switched off and every
// change repaints the whole screen (the video wallpaper already does that on
// every frame while it plays). `glass redraw clipped` opts out, at the price of
// those squares coming back.
//
// Everything is undone by revert(), which disable() calls.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {log, logWarn} from './constants.js';

const EFFECT = 'nwl-glass';
const NO_CLIPPED_REDRAWS = Clutter.DrawDebugFlag.DISABLE_CLIPPED_REDRAWS;
// The effect goes on the box that holds the top bar, not on the bar itself:
// measured on GNOME 50, a BACKGROUND-mode blur attached to Main.panel does
// nothing, while the same effect on its container blurs as expected.
const panelHolder = () => Main.layoutManager.panelBox;
const DOCK_SCHEMA = 'org.gnome.shell.extensions.dash-to-dock';
const DOCK_CONTAINER = 'dashtodockContainer';
// Same story as the top bar: measured on GNOME 50, a BACKGROUND-mode blur on
// the dock's visible background (or on its dash) does nothing, but on the
// box around the dash it blurs the whole dock strip, and that box slides in
// and out with the dock.
const DOCK_BOX = 'dashtodockBox';
const PANEL_CLASS = 'nwl-glass';
// The dock's own dark theme colour; the bar is tinted the same so the two
// read as one material.
const TINT = '56, 56, 59';

function findDockBox(root) {
    const stack = [root];
    while (stack.length > 0) {
        const actor = stack.pop();
        if (actor.name === DOCK_BOX)
            return actor;
        stack.push(...actor.get_children());
    }
    return null;
}

export class Glass {
    /** @param {Gio.Settings} settings the extension's own settings */
    constructor(settings) {
        this._settings = settings;
        this._active = false;
        this._targets = new Map();   // actor -> {effect, destroyId}
        this._signals = [];          // [object, id]
        this._idleIds = new Set();
        this._styleFile = null;      // the generated stylesheet currently loaded
        this._styleSerial = 0;
        this._dockSettings = null;
        this._ownsRedrawFlag = false;
    }

    enable() {
        this.refresh();
    }

    disable() {
        this.revert();
    }

    /** Apply the current settings: on, off, or re-tuned. */
    refresh() {
        if (this._settings.get_boolean('glass'))
            this._apply();
        else
            this.revert();
    }

    get active() {
        return this._active;
    }

    describe() {
        let docks = 0;
        for (const actor of this._targets.keys()) {
            if (actor !== panelHolder())
                docks++;
        }
        return {
            active: this._active,
            panel: this._targets.has(panelHolder()),
            docks,
            dockTint: this._dockSettings !== null,
            fullRedraw: this._ownsRedrawFlag,
        };
    }

    // ---- apply -----------------------------------------------------------

    _config() {
        return {
            radius: this._settings.get_int('glass-radius'),
            opacity: this._settings.get_double('glass-opacity'),
            brightness: this._settings.get_double('glass-brightness'),
        };
    }

    _apply() {
        const cfg = this._config();
        if (!this._active) {
            this._active = true;
            this._connect(Main.layoutManager.uiGroup, 'child-added',
                (_g, actor) => this._onChrome(actor));
            this._connect(Main.overview, 'showing', () => this._setPanelBlur(false));
            this._connect(Main.overview, 'hiding', () => this._setPanelBlur(true));
            log('glass on');
        }

        for (const {effect} of this._targets.values())
            this._configure(effect, cfg);

        this._attach(panelHolder());
        this._setPanelBlur(!Main.overview.visible);
        this._tintPanel(cfg);

        for (const actor of Main.layoutManager.uiGroup.get_children())
            this._onChrome(actor);

        this._tintDock(cfg);
        this._syncRedraw();
    }

    // ---- redraw ----------------------------------------------------------

    // Switch clipped redraws off while glass wants it, and only touch the flag
    // if it was not already set by someone else (a developer's own debugging).
    _syncRedraw() {
        const want = this._settings.get_boolean('glass-full-redraw');
        if (want && !this._ownsRedrawFlag) {
            const [, draw] = Clutter.get_debug_flags();
            if (draw & NO_CLIPPED_REDRAWS)
                return;
            Clutter.add_debug_flags(0, NO_CLIPPED_REDRAWS, 0);
            this._ownsRedrawFlag = true;
        } else if (!want) {
            this._releaseRedraw();
        }
    }

    _releaseRedraw() {
        if (!this._ownsRedrawFlag)
            return;
        Clutter.remove_debug_flags(0, NO_CLIPPED_REDRAWS, 0);
        this._ownsRedrawFlag = false;
    }

    _configure(effect, cfg) {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        effect.set({
            mode: Shell.BlurMode.BACKGROUND,
            radius: Math.round(cfg.radius * scale),
            brightness: cfg.brightness,
        });
    }

    _attach(actor) {
        if (this._targets.has(actor))
            return;
        const effect = new Shell.BlurEffect({name: EFFECT});
        this._configure(effect, this._config());
        actor.add_effect_with_name(EFFECT, effect);
        const destroyId = actor.connect('destroy', () => this._targets.delete(actor));
        this._targets.set(actor, {effect, destroyId});
    }

    _detach(actor) {
        const target = this._targets.get(actor);
        if (!target)
            return;
        this._targets.delete(actor);
        actor.disconnect(target.destroyId);
        actor.remove_effect_by_name(EFFECT);
    }

    // The overview wants a see-through bar with nothing blurred behind it. The
    // stylesheet drops the tint there by itself; only the effect needs a nudge.
    _setPanelBlur(on) {
        const target = this._targets.get(panelHolder());
        if (target)
            target.effect.enabled = on;
    }

    // Load a stylesheet that makes the bar a translucent tint instead of the
    // theme's solid black. The tint strength is the only moving part, so each
    // change writes a new file and swaps it in.
    _tintPanel(cfg) {
        const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'neowallpaperlive']);
        GLib.mkdir_with_parents(dir, 0o755);
        const path = GLib.build_filenamev([dir, `glass-${++this._styleSerial}.css`]);
        GLib.file_set_contents(path, [
            `#panel.${PANEL_CLASS} { background-color: rgba(${TINT}, ${cfg.opacity}); }`,
            `#panel.${PANEL_CLASS}:overview, #panel.${PANEL_CLASS}.unlock-screen, #panel.${PANEL_CLASS}.login-screen {`,
            '  background-color: transparent; }',
            '',
        ].join('\n'));

        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        const previous = this._styleFile;
        this._styleFile = Gio.File.new_for_path(path);
        theme.load_stylesheet(this._styleFile);
        Main.panel.add_style_class_name(PANEL_CLASS);
        if (previous) {
            theme.unload_stylesheet(previous);
            try {
                previous.delete(null);
            } catch (_e) { /* a stale file in the cache dir is harmless */ }
        }
    }

    _untintPanel() {
        Main.panel.remove_style_class_name(PANEL_CLASS);
        if (!this._styleFile)
            return;
        St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(this._styleFile);
        try {
            this._styleFile.delete(null);
        } catch (_e) { /* ignore */ }
        this._styleFile = null;
    }

    // ---- dock ------------------------------------------------------------

    _onChrome(actor) {
        if (actor.name !== DOCK_CONTAINER || !this._active)
            return;
        const box = findDockBox(actor);
        if (box) {
            this._attach(box);
            return;
        }
        // Not there yet: the dash may still be assembling itself, or this is one
        // of the empty bins the dock's theme manager adds under the same name
        // for a moment to read its colours (they are gone again by the time we
        // are idle). Look once more when idle, and only complain about a dock
        // that is still on screen.
        const id = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idleIds.delete(id);
            if (!this._active || !actor.get_parent())
                return GLib.SOURCE_REMOVE;
            const late = findDockBox(actor);
            if (late)
                this._attach(late);
            else
                logWarn('glass: dock has no box to blur');
            return GLib.SOURCE_REMOVE;
        });
        this._idleIds.add(id);
    }

    _getDockSettings() {
        if (this._dockSettings)
            return this._dockSettings;
        const source = Gio.SettingsSchemaSource.get_default();
        if (!source?.lookup(DOCK_SCHEMA, true))
            return null;
        this._dockSettings = new Gio.Settings({schema_id: DOCK_SCHEMA});
        return this._dockSettings;
    }

    // Fixed translucency for the dock, remembering what it was. A backup that
    // is already stored (the shell died while glass was on) is kept, so the
    // user's real values are never overwritten with our own.
    _tintDock(cfg) {
        const dock = this._getDockSettings();
        if (!dock)
            return;
        if (!this._settings.get_string('glass-dock-backup')) {
            this._settings.set_string('glass-dock-backup', JSON.stringify({
                mode: dock.get_string('transparency-mode'),
                opacity: dock.get_double('background-opacity'),
            }));
        }
        dock.set_string('transparency-mode', 'FIXED');
        dock.set_double('background-opacity', cfg.opacity);
    }

    _restoreDock() {
        const raw = this._settings.get_string('glass-dock-backup');
        if (!raw)
            return;
        const dock = this._getDockSettings();
        try {
            const saved = JSON.parse(raw);
            if (dock) {
                dock.set_string('transparency-mode', saved.mode);
                dock.set_double('background-opacity', saved.opacity);
            }
        } catch (e) {
            logWarn(`glass: could not restore the dock settings: ${e.message}`);
        }
        this._settings.set_string('glass-dock-backup', '');
    }

    // ---- teardown --------------------------------------------------------

    _connect(obj, name, handler) {
        this._signals.push([obj, obj.connect(name, handler)]);
    }

    revert() {
        for (const id of this._idleIds)
            GLib.source_remove(id);
        this._idleIds.clear();

        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];

        for (const actor of [...this._targets.keys()])
            this._detach(actor);

        this._releaseRedraw();
        this._untintPanel();
        this._restoreDock();
        this._dockSettings = null;

        if (this._active)
            log('glass off');
        this._active = false;
    }
}
