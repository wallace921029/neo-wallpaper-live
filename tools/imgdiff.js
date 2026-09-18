// gjs imgdiff.js A.png B.png [x y w h]
// Prints the mean absolute RGB difference (0..255) over the region.
const {GdkPixbuf} = imports.gi;
const [pa, pb, rx, ry, rw, rh] = ARGV;
const A = GdkPixbuf.Pixbuf.new_from_file(pa);
const B = GdkPixbuf.Pixbuf.new_from_file(pb);
if (A.get_width() !== B.get_width() || A.get_height() !== B.get_height())
    throw new Error(`size mismatch ${A.get_width()}x${A.get_height()} vs ${B.get_width()}x${B.get_height()}`);
const x0 = rx ? +rx : 0, y0 = ry ? +ry : 0;
const w = rw ? +rw : A.get_width(), h = rh ? +rh : A.get_height();
const a = A.get_pixels(), b = B.get_pixels();
const rs = A.get_rowstride(), nc = A.get_n_channels();
let sum = 0, n = 0;
for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
        const o = y * rs + x * nc;
        for (let c = 0; c < 3; c++) {
            sum += Math.abs(a[o + c] - b[o + c]);
            n++;
        }
    }
}
print((sum / n).toFixed(3));
