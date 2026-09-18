// Shared identifiers. The renderer window is recognised by its Wayland app-id
// (which Mutter exposes as wm_class), so every module agrees on APP_ID.

export const APP_ID = 'neowallpaperlive-renderer';
export const DESKTOP_ID = `${APP_ID}.desktop`;
export const TITLE_PREFIX = 'neowallpaperlive:';
export const LOG_TAG = '[NeoWallpaperLive]';

export const BUS_NAME = 'org.neowallpaperlive.Control';
export const OBJ_PATH = '/org/neowallpaperlive/Control';

// Only backgrounds driven by this schema get a video layer; the lock screen
// (org.gnome.desktop.screensaver) is deliberately left alone.
export const BACKGROUND_SCHEMA = 'org.gnome.desktop.background';

export function isRendererWindow(win) {
    return !!win && win.get_wm_class?.() === APP_ID;
}

export function isRendererActor(actor) {
    return isRendererWindow(actor?.meta_window ?? null);
}

export function log(...args) {
    console.log(LOG_TAG, ...args);
}

export function logWarn(...args) {
    console.warn(LOG_TAG, ...args);
}
