#!/usr/bin/env bash
# Runs the extension inside a throwaway headless GNOME Shell with two virtual
# monitors of different aspect ratios, completely isolated from your session
# (own D-Bus, own XDG dirs, keyfile GSettings). Drives it through the real CLI
# and a test-only D-Bus interface, and samples mpv position + screenshots.
#
#   tools/headless-test.sh [scenario]      scenarios: smoke (default) | soak | all
#
# Needs: gnome-shell 50, mpv, ffmpeg (for the test video), gjs, python3.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$REPO/tools"
UUID="neowallpaperlive@local"
SCHEMA="org.gnome.shell.extensions.neowallpaperlive"
SCENARIO=${1:-smoke}
RUN="$SCENARIO-$(date +%H%M%S)"

export XDG_CONFIG_HOME="$T/xdg/config"
export XDG_DATA_HOME="$T/xdg/data"
export XDG_CACHE_HOME="$T/xdg/cache"
export GSETTINGS_BACKEND=keyfile
export OUT="$T/out/$RUN"
export NWL_TEST=1
export NWL_IPC="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/nwl-test.sock"
export SAMPLE=${SAMPLE:-3}
unset DISPLAY
mkdir -p "$OUT" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"

[[ -f "$T/test.mp4" ]] || bash "$T/gen-test-video.sh" >/dev/null

EXT_DIR="$XDG_DATA_HOME/gnome-shell/extensions/$UUID"
rm -rf "$EXT_DIR"; mkdir -p "$(dirname "$EXT_DIR")"
cp -r "$REPO/extension/$UUID" "$EXT_DIR"
glib-compile-schemas "$EXT_DIR/schemas"
mkdir -p "$XDG_DATA_HOME/applications"; cp "$REPO/data/neowallpaperlive-renderer.desktop" "$XDG_DATA_HOME/applications/"

gsettings set org.gnome.shell enabled-extensions "['$UUID']"
gsettings set org.gnome.shell disabled-extensions "[]"
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.desktop.session idle-delay 0
gsettings --schemadir "$EXT_DIR/schemas" reset-recursively "$SCHEMA"
# Configure through the real CLI, exactly as a user would.
"$REPO/bin/neowallpaperlive" set "$T/test.mp4" >/dev/null

WS1="global.workspace_manager.get_workspace_by_index(1).activate(global.get_current_time()); 'ok'"
WS0="global.workspace_manager.get_workspace_by_index(0).activate(global.get_current_time()); 'ok'"
STEALTH="JSON.stringify({actors: global.get_window_actors().length, tab: global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null).length, running: Shell.AppSystem.get_default().get_running().map(a => a.get_id())})"
case "$SCENARIO" in
    smoke) STEPS=(s1 "stealth:$STEALTH" "ws1:$WS1" "ws0:$WS0" "rebuild:Main.layoutManager._monitorsChanged(); 'ok'" "ov-show:Main.overview.show(); 'ok'" "ov-hide:Main.overview.hide(); 'ok'" s2 "fill-contain!neowallpaperlive fill contain" "fill-cover!neowallpaperlive fill cover" "exit!neowallpaperlive exit" "start!neowallpaperlive start" s3) ;;
    soak)  STEPS=(s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13 s14 s15) ;;
    all)   STEPS=(s1 "stealth:$STEALTH" "ws1:$WS1" w1 "ws0:$WS0" w2 "rebuild:Main.layoutManager._monitorsChanged(); 'ok'" r1 "ov-show:Main.overview.show(); 'ok'" "ov-hide:Main.overview.hide(); 'ok'" o1 o2 "exit!neowallpaperlive exit" "start!neowallpaperlive start" x1 x2 x3) ;;
    *) echo "unknown scenario: $SCENARIO"; exit 2 ;;
esac
printf '%s\n' "${STEPS[@]}" > "$T/steps.txt"
export PATH="$REPO/bin:$PATH"
echo "run=$RUN scenario=$SCENARIO out=$OUT"
exec dbus-run-session -- bash "$T/headless-inner.sh" 2>&1 |
    grep -v "dbus-daemon\|fusermount\|SpiRegistry\|goa-daemon\|discover_other\|xdg-desktop-portal\|Gdk-Message\|calendar-server\|evolution\|connection to the bus\|^$"
