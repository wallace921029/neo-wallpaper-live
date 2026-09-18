#!/usr/bin/env bash
# Generates tools/test.mp4: 33 s of moving test pattern with a burnt-in
# timestamp, 1280x720 H.264. Used by headless-test.sh.
set -euo pipefail
OUT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/test.mp4"
ffmpeg -y -loglevel error \
    -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=33" \
    -vf "drawtext=text='%{pts\:hms}':fontsize=110:fontcolor=white:box=1:boxcolor=black@0.7:x=(w-tw)/2:y=(h-th)/2" \
    -c:v libx264 -pix_fmt yuv420p -preset veryfast "$OUT"
echo "$OUT"
