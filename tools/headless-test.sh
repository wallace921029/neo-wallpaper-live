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
# The extension names its mpv IPC socket after WAYLAND_DISPLAY; the inner
# script starts the shell with --wayland-display nwl-test.
export NWL_IPC="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/neowallpaperlive-nwl-test.sock"
export SAMPLE=${SAMPLE:-3}
unset DISPLAY
mkdir -p "$OUT" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"

[[ -f "$T/test.mp4" ]] || bash "$T/gen-test-video.sh" >/dev/null
# The pin scenario needs a clip LARGER than every virtual monitor, so that the
# compositor's per-monitor size cap on mpv's surface is actually observable.
VIDEO="$T/test.mp4"
if [[ "$SCENARIO" == "pin" || "$SCENARIO" == "switch" || "$SCENARIO" == "geom" ]]; then
    [[ -f "$T/test-big.mp4" ]] || bash "$T/gen-test-video.sh" 2560x1440 "$T/test-big.mp4" >/dev/null
    [[ "$SCENARIO" == "pin" || "$SCENARIO" == "geom" ]] && VIDEO="$T/test-big.mp4"
fi

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
"$REPO/bin/neowallpaperlive" set "$VIDEO" >/dev/null

WS1="global.workspace_manager.get_workspace_by_index(1).activate(global.get_current_time()); 'ok'"
WS0="global.workspace_manager.get_workspace_by_index(0).activate(global.get_current_time()); 'ok'"
STEALTH="JSON.stringify({actors: global.get_window_actors().length, tab: global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null).length, running: Shell.AppSystem.get_default().get_running().map(a => a.get_id())})"
# Helpers for the autopause scenario: plain mpv windows (app-id nwl-cover, so
# the extension does not treat them as its renderer) that we maximize /
# fullscreen on chosen monitors through the test D-Bus Eval hook.
SPAWN() { echo "Gio.Subprocess.new(['mpv','--no-config','--no-terminal','--loop-file=inf','--no-audio','--osd-level=0','--input-default-bindings=no','--wayland-app-id=nwl-cover','--title=$1','--geometry=640x360','$T/test.mp4'], Gio.SubprocessFlags.NONE); 'spawned $1'"; }
FIND="global.get_window_actors().map(a => a.meta_window).find(w => w.get_title() === '%s')"
MAXON() { printf "const w = $FIND; w.move_to_monitor(%s); try { w.maximize(); } catch (e) { w.maximize(Meta.MaximizeFlags.BOTH); } 'maximized on ' + w.get_monitor()" "$1" "$2"; }
KILL()  { printf "($FIND)?.delete(global.get_current_time()); 'closed %s'" "$1" "$1"; }
FS()    { printf "($FIND).make_fullscreen(); 'fullscreen'" "$1"; }
UNFS()  { printf "($FIND).unmake_fullscreen(); 'windowed'" "$1"; }
case "$SCENARIO" in
    smoke) STEPS=(s1 "stealth:$STEALTH" "ws1:$WS1" "ws0:$WS0" "rebuild:Main.layoutManager._monitorsChanged(); 'ok'" "ov-show:Main.overview.show(); 'ok'" "ov-hide:Main.overview.hide(); 'ok'" s2 "fill-contain!neowallpaperlive fill contain" "fill-cover!neowallpaperlive fill cover" "awake-on!neowallpaperlive awake on" "awake-off!neowallpaperlive awake off" "exit!neowallpaperlive exit" "start!neowallpaperlive start" s3) ;;
    soak)  STEPS=(s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13 s14 s15) ;;
    autopause) STEPS=(s1 "a-spawn:$(SPAWN cover-a)" "a-max0:$(MAXON cover-a 0)" "b-spawn:$(SPAWN cover-b)" "b-max1:$(MAXON cover-b 1)" p1 "cov-off!neowallpaperlive autopause covered off" "cov-on!neowallpaperlive autopause covered on" "b-kill:$(KILL cover-b)" "a-fs:$(FS cover-a)" "a-unfs:$(UNFS cover-a)" "a-kill:$(KILL cover-a)" s2 "rules!neowallpaperlive autopause") ;;
    all)   STEPS=(s1 "stealth:$STEALTH" "ws1:$WS1" w1 "ws0:$WS0" w2 "rebuild:Main.layoutManager._monitorsChanged(); 'ok'" r1 "ov-show:Main.overview.show(); 'ok'" "ov-hide:Main.overview.hide(); 'ok'" o1 o2 "exit!neowallpaperlive exit" "start!neowallpaperlive start" x1 x2 x3) ;;
    # Renderer must sit on the monitor with the most pixels (0: 1920x1080 >
    # 1: 1280x1024). Force it onto the small one and check it snaps back.
    pin) FORCE1="const w = global.display.list_all_windows().find(w => w.get_wm_class() === 'neowallpaperlive-renderer'); w.move_to_monitor(1); 'moved to ' + w.get_monitor()"
         STEPS=(s1 "force-mon1:$FORCE1" "repin:Main.layoutManager._monitorsChanged(); 'ok'" p1 "force-again:$FORCE1" "repin2:Main.layoutManager._monitorsChanged(); 'ok'" p2) ;;
    # Suspend/resume: logind is on the system bus, which the harness does not
    # have, so the extension listens on the session bus under NWL_TEST and we
    # emit the very same signal here.
    sleep) EMIT="gdbus emit --session --object-path /org/freedesktop/login1 --signal org.freedesktop.login1.Manager.PrepareForSleep"
           HANG="const w = global.display.list_all_windows().find(w => w.get_wm_class() === 'neowallpaperlive-renderer'); const pid = w.get_pid(); GLib.spawn_command_line_sync('kill -STOP ' + pid); 'SIGSTOPped ' + pid"
           CONT="GLib.spawn_command_line_sync('pkill -CONT -f neowallpaperlive-renderer'); 'continued'"
           STEPS=(s1 "suspend!$EMIT true" "resume!$EMIT false" w1
                  "hang:$HANG" "resume2!$EMIT false" h1 h2 "cleanup:$CONT") ;;
    # Changing the file must keep the same mpv process (same pid) while the
    # buffer follows the new video size.
    switch) STEPS=(s1 "to-big!neowallpaperlive set $T/test-big.mp4" b1
                   "to-small!neowallpaperlive set $T/test.mp4" s2
                   "to-big2!neowallpaperlive set $T/test-big.mp4" b2) ;;
    # Dumps the real allocation of every video layer, its clone and the clone's
    # source, next to the renderer window's frame/buffer rects and the monitor
    # geometry, so fill-mode maths can be checked against what Clutter did.
    # Work-area clamp on both axes: the renderer's monitor carries the top bar
    # and, from the "dock" step on, a dock-sized strut down its left edge, so
    # the renderer window is inset from the monitor horizontally and vertically
    # — the shape that made the fill maths shift the video off the screen edge.
    # Work-area clamp on both axes: the renderer's monitor carries the top bar
    # and, from the "dock" step on, a dock-sized strut down its left edge, so
    # the renderer window ends up inset from the monitor horizontally as well as
    # vertically -- the shape that made the fill maths shift the video off the
    # right-hand and bottom edges. The clone-covers-layer check in
    # regression.sh reads the per-sample status this leaves behind.
    geom) DOCK="const St = Main.layoutManager.uiGroup.constructor; const d = new St({x: 0, y: 0, width: 51, height: 2160}); Main.layoutManager.addChrome(d, {affectsStruts: true, trackFullscreen: false}); 'dock ' + d.width"
         STEPS=(s1 "dock:$DOCK" d1 "rebuild:Main.layoutManager._monitorsChanged(); 'ok'" d2
                "fill-contain!neowallpaperlive fill contain" c1
                "fill-stretch!neowallpaperlive fill stretch" c2
                "fill-cover!neowallpaperlive fill cover" d3) ;;
    # App grid: the overview squeezes the workspace previews into a short
    # strip, sized from the work area's aspect ratio. Nothing under the
    # background may ask for a size of its own, or the previews balloon to the
    # video's width; so the previews must be exactly as wide with the video on
    # as with it off. "w" = each preview's width, "bg" = what its background
    # asks for at that height (0 when it stays out of the way).
    appgrid) WSW="const r=[];const walk=a=>{if(a.constructor.name==='Workspace'){const b=a.get_allocation_box();const [,bw]=a.get_first_child().get_preferred_width(b.y2-b.y1);r.push([Math.round(b.x2-b.x1),Math.round(bw)]);}a.get_children().forEach(walk);};walk(global.stage);r.sort((x,y)=>x[0]-y[0]);'w='+r.map(x=>x[0]).join(',')+' bg='+r.map(x=>x[1]).join(',')"
             AG="Main.overview._overview._controls._stateAdjustment.value = 2; 'app grid'"
             STEPS=(s1 "ov-show:Main.overview.show(); 'ok'" "to-grid:$AG" "ag-on:$WSW"
                    "video-off!neowallpaperlive exit" "ag-off:$WSW"
                    "video-on!neowallpaperlive start" "ag-on2:$WSW" "ov-hide:Main.overview.hide(); 'ok'") ;;
    *) echo "unknown scenario: $SCENARIO"; exit 2 ;;
esac
printf '%s\n' "${STEPS[@]}" > "$T/steps.txt"
export PATH="$REPO/bin:$PATH"
echo "run=$RUN scenario=$SCENARIO out=$OUT"
exec dbus-run-session -- bash "$T/headless-inner.sh" 2>&1 |
    grep -v "dbus-daemon\|fusermount\|SpiRegistry\|goa-daemon\|discover_other\|xdg-desktop-portal\|Gdk-Message\|calendar-server\|evolution\|connection to the bus\|^$"
