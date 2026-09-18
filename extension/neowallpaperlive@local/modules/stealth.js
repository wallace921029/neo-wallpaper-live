// Hides the (minimized, transparent) renderer window from every place the
// shell lists windows: Alt+Tab, overview, workspace thumbnails, the dash /
// Ubuntu Dock, workspace-switch animations, and map/minimize animations.
// Each patch is a thin wrapper around the original and is undone on disable.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Workspace from 'resource:///org/gnome/shell/ui/workspace.js';
import * as WorkspaceThumbnail from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';
import * as WindowManager from 'resource:///org/gnome/shell/ui/windowManager.js';

import {DESKTOP_ID, isRendererActor, isRendererWindow} from './constants.js';

export class Stealth {
    constructor() {
        this._patches = [];
    }

    enable() {
        // Alt+Tab / Super+Tab window lists.
        this._patch(Meta.Display.prototype, 'get_tab_list', orig => function (...args) {
            return orig.apply(this, args).filter(w => !isRendererWindow(w));
        });

        // Any JS code that enumerates window actors (workspace switch animation,
        // thumbnails, extensions).
        this._patch(Shell.Global.prototype, 'get_window_actors', orig => function (...args) {
            return orig.apply(this, args).filter(a => !isRendererActor(a));
        });

        // Overview window previews and workspace thumbnails.
        this._patch(Workspace.Workspace.prototype, '_isOverviewWindow', orig => function (win, ...rest) {
            return !isRendererWindow(win) && orig.call(this, win, ...rest);
        });
        this._patch(WorkspaceThumbnail.WorkspaceThumbnail.prototype, '_isOverviewWindow', orig => function (actor, ...rest) {
            return !isRendererActor(actor) && orig.call(this, actor, ...rest);
        });

        // No map / minimize / destroy animations for the renderer.
        this._patch(WindowManager.WindowManager.prototype, '_shouldAnimateActor', orig => function (actor, ...rest) {
            return !isRendererActor(actor) && orig.call(this, actor, ...rest);
        });

        // App tracking: the dash and Ubuntu Dock build their "running" list from
        // these. Pretend the renderer has no app and its app has no windows.
        this._patch(Shell.WindowTracker.prototype, 'get_window_app', orig => function (win, ...rest) {
            return isRendererWindow(win) ? null : orig.call(this, win, ...rest);
        });
        this._patch(Shell.App.prototype, 'get_windows', orig => function (...args) {
            return orig.apply(this, args).filter(w => !isRendererWindow(w));
        });
        this._patch(Shell.App.prototype, 'get_n_windows', () => function () {
            return this.get_windows().length;
        });
        this._patch(Shell.AppSystem.prototype, 'get_running', orig => function (...args) {
            return orig.apply(this, args).filter(app =>
                app.get_id() !== DESKTOP_ID && app.get_n_windows() > 0);
        });
    }

    disable() {
        for (const {obj, name, orig} of this._patches.reverse())
            obj[name] = orig;
        this._patches = [];
    }

    _patch(obj, name, wrap) {
        const orig = obj[name];
        this._patches.push({obj, name, orig});
        obj[name] = wrap(orig);
    }
}
