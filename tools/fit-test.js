#!/usr/bin/env gjs
// Unit tests for the fill-mode geometry. Runs without a compositor:
//
//   gjs tools/fit-test.js
//
// The headless harness cannot produce every input this has to survive -- a
// virtual monitor never runs at a fractional scale, and mpv never draws its
// own shadows -- so the awkward cases are constructed here instead.

import {fitClone} from '../extension/neowallpaperlive@local/modules/fit.js';

let failed = 0;
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

function check(name, ok, detail = '') {
    failed += !ok;
    print(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${detail ? `  ${detail}` : ''}`);
}

/** In cover and stretch the clone must reach all four layer edges. */
function covers(name, layer, source, mode = 'cover') {
    const f = fitClone(layer, source, mode);
    const slack = [-f.x, -f.y, f.x + f.width - layer.width, f.y + f.height - layer.height];
    check(name, slack.every(s => s >= -1),
        `box ${[f.x, f.y, f.width, f.height].map(Math.round)} slack ${slack.map(Math.round)}`);
}

/** Geometry with no shadows: buffer and frame are the same rectangle. */
const plain = (x, y, w, h) => ({
    width: w, height: h,
    frame: {x, y, width: w, height: h},
    buffer: {x, y, width: w, height: h},
});

print('\x1b[1mfill maths\x1b[0m');

// Baseline: renderer covering its whole monitor.
covers('cover fills a layer of the same aspect', {width: 2560, height: 1440},
    plain(0, 0, 2560, 1440));
covers('cover fills a narrower layer', {width: 1280, height: 1024},
    plain(0, 0, 1920, 1080));
covers('cover fills a wider layer', {width: 3440, height: 1440},
    plain(0, 0, 1920, 1080));

// Mutter caps a normal window at its monitor's work area, so the renderer is
// routinely smaller than the layer it has to fill, and offset by the top bar
// and the dock.
covers('cover fills the layer when the top bar shrinks the renderer',
    {width: 1920, height: 1080}, plain(0, 32, 1920, 1048));
covers('cover fills the layer when a dock shrinks it too',
    {width: 1920, height: 1080}, plain(51, 32, 1869, 1048));
covers('cover fills the layer at 1.5x scale, top bar and dock',
    {width: 2560, height: 1440}, plain(51, 32, 2509, 1408));

// The bug this module was extracted for: frame and buffer are the same size,
// so there is no shadow inset to honour, but their origins disagree. Read
// naively that difference is the window's position on screen, and the video
// gets shifted up and left by it -- baring the right and bottom edges by
// exactly the dock width and the top bar height.
const mismatched = {
    width: 2509, height: 1408,
    frame: {x: 51, y: 32, width: 2509, height: 1408},
    buffer: {x: 0, y: 0, width: 2509, height: 1408},
};
covers('a frame/buffer origin mismatch does not shift the video',
    {width: 2560, height: 1440}, mismatched);
covers('...nor in stretch', {width: 2560, height: 1440}, mismatched, 'stretch');

// Real client-side shadows: the buffer is genuinely bigger and the frame
// genuinely sits inside it, so the inset must still be honoured.
const shadowed = {
    width: 1000, height: 800,
    frame: {x: 120, y: 140, width: 900, height: 700},
    buffer: {x: 100, y: 100, width: 1000, height: 800},
};
const s = fitClone({width: 1800, height: 1400}, shadowed, 'cover');
check('client-side shadows keep the frame centred',
    near(s.x + 20 * 2 + 900 * 2 / 2, 900) && near(s.y + 40 * 2 + 700 * 2 / 2, 700),
    `frame centre ${Math.round(s.x + 20 * 2 + 900)} ${Math.round(s.y + 40 * 2 + 350 * 2)}`);
covers('cover still fills the layer with shadows', {width: 1800, height: 1400}, shadowed);

// contain letterboxes inside the layer; stretch matches it exactly.
const c = fitClone({width: 1920, height: 1080}, plain(0, 0, 1000, 1000), 'contain');
check('contain letterboxes and centres',
    near(c.width, 1080) && near(c.height, 1080) && near(c.x, 420) && near(c.y, 0),
    `box ${[c.x, c.y, c.width, c.height].map(Math.round)}`);
const st = fitClone({width: 1920, height: 1080}, plain(0, 0, 1000, 1000), 'stretch');
check('stretch matches the layer exactly',
    near(st.x, 0) && near(st.y, 0) && near(st.width, 1920) && near(st.height, 1080),
    `box ${[st.x, st.y, st.width, st.height].map(Math.round)}`);

// A resize is seen by get_frame_rect() one layout pass before the source
// actor's allocation catches up, so the caller passes the clone's preferred
// size; feeding the lagging allocation in here halved the video on every other
// monitor whenever the file or the renderer's monitor changed.
covers('a freshly resized source still fills the layer', {width: 1280, height: 1024},
    plain(320, 32, 2560, 1440));
covers('a freshly moved source still fills the layer', {width: 1280, height: 1024},
    plain(0, 32, 1920, 1048));

// Degenerate input must not produce NaN boxes.
const d = fitClone({width: 1920, height: 1080}, {
    width: 0, height: 0,
    frame: {x: 0, y: 0, width: 0, height: 0},
    buffer: {x: 0, y: 0, width: 640, height: 360},
}, 'cover');
check('a zero-sized frame falls back to the buffer',
    Number.isFinite(d.x) && Number.isFinite(d.width) && d.width > 0,
    `box ${[d.x, d.y, d.width, d.height].map(Math.round)}`);

print(`\n${failed ? `\x1b[31m${failed} failed\x1b[0m` : '\x1b[32mall passed\x1b[0m'}`);
imports.system.exit(failed ? 1 : 0);
