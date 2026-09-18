#!/usr/bin/env bash
# Inner part of headless-test.sh; runs inside the private D-Bus session.
# Steps come from tools/steps.txt as  label | label:<js> | label!<shell cmd>.
set -uo pipefail
T="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUS="org.neowallpaperlive.Control"; OBJ="/org/neowallpaperlive/Control"
D="--session --dest $BUS --object-path $OBJ"
ev() { gdbus call $D --method "$BUS.Eval" "$1" 2>&1 | sed "s/^('//; s/',)\$//" | sed 's/\\"/"/g'; }
mapfile -t STEPS < "$T/steps.txt"

gnome-shell --headless --wayland --no-x11 --wayland-display nwl-test \
    ${NWL_MONITORS:---virtual-monitor 1920x1080 --virtual-monitor 1280x1024} \
    > "$OUT/shell.log" 2>&1 &
SHELL_PID=$!

for _ in $(seq 1 80); do
    gdbus introspect $D >/dev/null 2>&1 && break
    kill -0 $SHELL_PID 2>/dev/null || { echo "shell died early"; tail -40 "$OUT/shell.log"; exit 1; }
    sleep 0.5
done
gdbus introspect $D >/dev/null 2>&1 || { echo "extension never appeared on D-Bus"; grep -i "neowallpaperlive\|JS ERROR" "$OUT/shell.log" | head; kill $SHELL_PID; exit 1; }
T0=$(date +%s.%N)
elapsed() { printf "%5.1f" "$(echo "$(date +%s.%N) - $T0" | bc)"; }

printf "%-6s %-12s %-8s %-5s %-7s %-6s %-8s %-14s %-20s %-8s %-8s  %s\n" t step mpv-pos drop playing layers pid win ipc diff0 diff1 note
prev=""; n=0; fail=0
for step in "${STEPS[@]}"; do
    label=$step; note=""
    if [[ "$step" == *:* ]]; then label=${step%%:*}; note=$(ev "${step#*:}" | tr -d '\n' | cut -c1-70)
    elif [[ "$step" == *!* ]]; then label=${step%%!*}; note=$(bash -c "${step#*!}" 2>&1 | tr '\n' ' ' | cut -c1-70); fi
    sleep "$SAMPLE"
    n=$((n+1)); tag=$(printf "%02d-%s" $n "$label")
    gdbus call $D --method "$BUS.Screenshot" "$OUT/$tag.png" >/dev/null 2>&1
    st=$(gdbus call $D --method "$BUS.Status" 2>/dev/null | sed "s/^('//; s/',)\$//" | sed 's/\\"/"/g')
    # Kept per sample so regression.sh can check invariants the table has no
    # column for, such as every clone still covering its background layer.
    printf '%s' "$st" > "$OUT/$tag.json"
    # "ipc" = hwdec-current as reported by the extension over its own mpv IPC link,
    # plus "+P(reasons)" while auto-pause holds the renderer paused.
    read -r playing layers pid win ipc <<<"$(python3 -c 'import json,sys; s=json.loads(sys.argv[1]); m=s.get("mpv") or {}; ap=s.get("autoPause") or {}
hw=m.get("hwdec-current") or ("err" if m.get("error") else "-")
hw += "/" + ("P" if m.get("pause") else ".") + (("(" + ",".join(ap.get("reasons")) + ")") if ap.get("reasons") else "")
b=s.get("rendererBuffer") or {}
win = "m%s/%sx%s" % (s.get("rendererMonitor"), b.get("width"), b.get("height")) if b else "-"
print(s["playing"], s["layers"], s.get("mpvPid") or "-", win, hw)' "$st" 2>/dev/null)"
    read -r pos drop dpause <<<"$(python3 "$T/mpvq.py" "$NWL_IPC" time-pos frame-drop-count pause 2>/dev/null | python3 -c 'import json,sys; m=json.load(sys.stdin); print(m.get("time-pos","-"), m.get("frame-drop-count","-"), "P" if m.get("pause") else ".")')"
    ipc="$ipc/$dpause"
    d0="-"; d1="-"
    if [[ -n "$prev" && -f "$OUT/$prev.png" && -f "$OUT/$tag.png" ]]; then
        d0=$(gjs "$T/imgdiff.js" "$OUT/$prev.png" "$OUT/$tag.png" 0 0 1920 1080 2>/dev/null)
        d1=$(gjs "$T/imgdiff.js" "$OUT/$prev.png" "$OUT/$tag.png" 1920 0 1280 1024 2>/dev/null)
    fi
    printf "%-6s %-12s %-8s %-5s %-7s %-6s %-8s %-14s %-20s %-8s %-8s  %s\n" "$(elapsed)" "$label" "${pos:0:7}" "$drop" "$playing" "$layers" "$pid" "$win" "$ipc" "$d0" "$d1" "$note"
    prev=$tag
done

kill $SHELL_PID; wait $SHELL_PID 2>/dev/null
echo "=== extension log ==="
grep "NeoWallpaperLive" "$OUT/shell.log" | sed 's/^GNOME Shell-Message: //; s/^GNOME Shell-Warning: //'
echo "=== JS errors / criticals ==="
grep -E "JS ERROR|CRITICAL|Gjs-WARNING" "$OUT/shell.log" | head -20 || true
echo "screenshots: $OUT"
