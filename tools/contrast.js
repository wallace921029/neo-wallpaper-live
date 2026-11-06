// Standard deviation of the green channel in a rectangle: how much detail survives.  args: png x y w h
imports.gi.versions.GdkPixbuf = '2.0';
const {GdkPixbuf} = imports.gi;
const [f, x, y, w, h] = ARGV;
const pb = GdkPixbuf.Pixbuf.new_from_file(f), n = pb.get_n_channels(), rs = pb.get_rowstride(), px = pb.get_pixels();
let sum = 0, sq = 0, c = 0;
for (let j = +y; j < +y + +h; j++) for (let i = +x; i < +x + +w; i++) { const v = px[j * rs + i * n + 1]; sum += v; sq += v * v; c++; }
const m = sum / c; print(Math.sqrt(sq / c - m * m).toFixed(1));
