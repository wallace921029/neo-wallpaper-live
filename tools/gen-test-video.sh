#!/usr/bin/env bash
# Generates a test clip: 33 s of moving test pattern with a burnt-in timestamp,
# H.264. Used by headless-test.sh.
#   gen-test-video.sh [WIDTHxHEIGHT] [OUTPUT]     default: 1280x720 -> tools/test.mp4
set -euo pipefail
SIZE=${1:-1280x720}
OUT=${2:-"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/test.mp4"}
ffmpeg -y -loglevel error \
    -f lavfi -i "testsrc2=size=$SIZE:rate=30:duration=33" \
    -vf "drawtext=text='%{pts\:hms}':fontsize=110:fontcolor=white:box=1:boxcolor=black@0.7:x=(w-tw)/2:y=(h-th)/2" \
    -c:v libx264 -pix_fmt yuv420p -preset veryfast "$OUT"
echo "$OUT"
