// Pure geometry for the fill modes. Kept free of imports so it can be tested
// with plain gjs, without a compositor to host it (tools/fit-test.js).

/**
 * Where to put the clone of a window inside a background layer.
 *
 * The returned box covers the whole source, shadows included, because that is
 * what a Clutter.Clone paints; the frame is then placed inside it.
 *
 * @param {{width: number, height: number}} layer - the box to fill.
 * @param {object} source - the renderer window.
 * @param {number} source.width - the clone's preferred width. Not the source
 *   actor's allocation: that still holds the previous size during the layout
 *   pass in which the window is resized or moved to another monitor, which
 *   would size the video from the video or monitor it had before.
 * @param {number} source.height - the clone's preferred height.
 * @param {{x: number, y: number, width: number, height: number}} source.frame
 *   - visible window rectangle, what the user should see filling the layer.
 * @param {{x: number, y: number, width: number, height: number}} source.buffer
 *   - what the client actually drew; larger than the frame when it draws its
 *   own shadows.
 * @param {string} mode - 'cover' (default), 'contain' or 'stretch'.
 * @returns {{x: number, y: number, width: number, height: number}} box.
 */
export function fitClone(layer, source, mode) {
    const {width: w, height: h} = layer;
    const sw = source.width > 0 ? source.width : source.buffer.width;
    const sh = source.height > 0 ? source.height : source.buffer.height;
    const fw = source.frame.width > 0 ? source.frame.width : sw;
    const fh = source.frame.height > 0 ? source.frame.height : sh;

    // How far the frame sits inside the buffer. A frame can never be inset by
    // more than the two rects differ in size, so clamp it: the origins are
    // computed separately (and rounded separately under fractional scaling),
    // and any disagreement between them would otherwise be read as a huge
    // inset and translate the video by the window's position on screen,
    // baring the right-hand and bottom edges of every monitor.
    const inset = (near, far, slack) => Math.min(Math.max(near - far, 0), Math.max(slack, 0));
    const offX = inset(source.frame.x, source.buffer.x, sw - fw);
    const offY = inset(source.frame.y, source.buffer.y, sh - fh);

    let sx, sy;
    switch (mode) {
    case 'stretch':
        sx = w / fw;
        sy = h / fh;
        break;
    case 'contain':
        sx = sy = Math.min(w / fw, h / fh);
        break;
    default: // cover
        sx = sy = Math.max(w / fw, h / fh);
    }
    return {
        x: (w - fw * sx) / 2 - offX * sx,
        y: (h - fh * sy) / 2 - offY * sy,
        width: sw * sx,
        height: sh * sy,
    };
}
