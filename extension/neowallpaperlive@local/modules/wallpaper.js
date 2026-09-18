// Puts a Clutter.Clone of the renderer's window actor inside every
// Meta.BackgroundActor the shell creates for the desktop background: the
// main layer for each monitor, the sliding copies used by the workspace
// switch animation, and the scaled copies in the overview. Because the
// video lives in the background layer, "show desktop", workspace changes,
// Alt+Tab and desktop clicks are all unaffected by construction.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';

import {BACKGROUND_SCHEMA, log} from './constants.js';
import {fitClone} from './fit.js';

/**
 * Container that follows its parent's size and lays out the clone with the
 * chosen fill mode. Doing this in allocate() (instead of set_position on
 * signals) keeps it correct wherever the shell scales the background.
 */
const Layer = GObject.registerClass(
class NeoWallpaperLayer extends Clutter.Actor {
    _init(getFillMode, getSource) {
        super._init({
            name: 'neowallpaperlive-layer',
            clip_to_allocation: true,
            reactive: false,
        });
        this._getFillMode = getFillMode;
        this._getSource = getSource;
    }

    vfunc_allocate(box) {
        this.set_allocation(box);
        const clone = this.get_first_child();
        if (!clone)
            return;

        // A Clutter.Clone scales its source to whatever box it is allocated,
        // so fitting is purely a matter of choosing the box.
        const source = this._getSource();
        const w = box.get_width(), h = box.get_height();
        const [, , natW, natH] = clone.get_preferred_size();
        if (!source || natW <= 0 || natH <= 0 || w <= 0 || h <= 0) {
            clone.allocate(new Clutter.ActorBox({x1: 0, y1: 0, x2: natW, y2: natH}));
            return;
        }

        const fit = fitClone({width: w, height: h}, {
            width: natW, height: natH,
            frame: source.win.get_frame_rect(),
            buffer: source.win.get_buffer_rect(),
        }, this._getFillMode());
        clone.allocate(new Clutter.ActorBox({
            x1: fit.x, y1: fit.y, x2: fit.x + fit.width, y2: fit.y + fit.height,
        }));
    }
});

export class WallpaperLayer {
    /** @param {() => string} getFillMode */
    constructor(getFillMode) {
        this._getFillMode = getFillMode;
        this._entries = new Set(); // {bgActor, monitorIndex, layer}
        this._source = null;       // {actor, win}
        this._sourceSignals = [];
        this._origCreate = null;
        this._monitorsChangedId = 0;
    }

    get layerCount() {
        return this._entries.size;
    }

    enable() {
        const self = this;
        const proto = Background.BackgroundManager.prototype;
        this._origCreate = proto._createBackgroundActor;
        proto._createBackgroundActor = function () {
            const bgActor = self._origCreate.call(this);
            if (this._settingsSchema === BACKGROUND_SCHEMA)
                self._attach(bgActor, this._monitorIndex);
            return bgActor;
        };

        // Backgrounds that already exist were created before the patch.
        for (const mgr of Main.layoutManager._bgManagers ?? []) {
            if (mgr.backgroundActor)
                this._attach(mgr.backgroundActor, mgr._monitorIndex);
        }
        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed',
            () => this.relayout());
    }

    disable() {
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }
        if (this._origCreate) {
            Background.BackgroundManager.prototype._createBackgroundActor = this._origCreate;
            this._origCreate = null;
        }
        this.clearSource();
        for (const entry of [...this._entries])
            entry.layer.destroy(); // 'destroy' handler removes it from the set
        this._entries.clear();
    }

    setSource(actor, win) {
        this.clearSource();
        this._source = {actor, win};
        this._sourceSignals.push([win, win.connect('size-changed', () => this.relayout())]);
        this._sourceSignals.push([actor, actor.connect('destroy', () => this.clearSource())]);
        for (const entry of this._entries)
            this._ensureClone(entry);
        log(`video attached to ${this._entries.size} background layer(s)`);
    }

    clearSource() {
        for (const [obj, id] of this._sourceSignals)
            obj.disconnect(id);
        this._sourceSignals = [];
        this._source = null;
        for (const entry of this._entries)
            entry.layer.remove_all_children();
    }

    relayout() {
        for (const entry of this._entries)
            entry.layer.queue_relayout();
    }

    /**
     * What Clutter actually allocated, per layer: the box the layer got from
     * its background actor, the box the clone was fitted into, and the size the
     * clone reports for its source. A fill-mode bug shows up as a clone box
     * that does not cover the layer box, so `status` reports all three.
     */
    describe() {
        const box = a => {
            const b = a.get_allocation_box();
            return [Math.round(b.x1), Math.round(b.y1),
                Math.round(b.x2 - b.x1), Math.round(b.y2 - b.y1)];
        };
        return [...this._entries].map(({monitorIndex, layer}) => {
            const clone = layer.get_first_child();
            const [, , natW, natH] = clone?.get_preferred_size() ?? [0, 0, 0, 0];
            return {
                monitor: monitorIndex,
                layer: box(layer),
                clone: clone ? box(clone) : null,
                source: clone?.source ? box(clone.source) : null,
                natural: [Math.round(natW), Math.round(natH)],
            };
        }).sort((a, b) => a.monitor - b.monitor);
    }

    _attach(bgActor, monitorIndex) {
        const layer = new Layer(this._getFillMode, () => this._source);
        layer.add_constraint(new Clutter.BindConstraint({
            source: bgActor,
            coordinate: Clutter.BindCoordinate.SIZE,
        }));
        bgActor.add_child(layer);

        const entry = {bgActor, monitorIndex, layer};
        // The shell destroys background actors freely (monitor changes,
        // wallpaper changes, overview close); follow them out.
        layer.connect('destroy', () => this._entries.delete(entry));
        this._entries.add(entry);
        this._ensureClone(entry);
    }

    _ensureClone(entry) {
        if (!this._source || entry.layer.get_n_children() > 0)
            return;
        entry.layer.add_child(new Clutter.Clone({source: this._source.actor}));
        entry.layer.queue_relayout();
    }
}
