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

ENABLED="['$UUID']"
# The glass scenario needs the real Ubuntu Dock next to us.
[[ "$SCENARIO" == "glass" ]] && ENABLED="['$UUID', 'ubuntu-dock@ubuntu.com']"
gsettings set org.gnome.shell enabled-extensions "$ENABLED"
gsettings set org.gnome.shell disabled-extensions "[]"
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.desktop.session idle-delay 0
gsettings --schemadir "$EXT_DIR/schemas" reset-recursively "$SCHEMA"
# The dock's settings live in the harness's keyfile between runs; glass changes
# and restores them, so every glass run must start from the dock's defaults.
[[ "$SCENARIO" == "glass" ]] && gsettings reset-recursively org.gnome.shell.extensions.dash-to-dock
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
    # Frosted glass: the top bar and the Ubuntu Dock get a Shell.BlurEffect and
    # a translucent tint. "g" reports, per target, whether the effect is
    # attached and enabled; "dock" shows the dock's own transparency settings,
    # which glass must set while on and restore exactly when off.
    glass) GINFO="const bg=a=>{const s=[a];while(s.length){const x=s.pop(); if(x.name==='dashtodockBox') return x; s.push(...x.get_children());} return null;}; JSON.stringify([Main.layoutManager.panelBox, ...Main.layoutManager.uiGroup.get_children().filter(a=>a.name==='dashtodockContainer').map(bg)].filter(Boolean).map(a=>{const e=a.get_effect('nwl-glass'); return [a.name||a.style_class, e?e.enabled:null, e?e.radius:null, e?e.brightness:null, a===Main.layoutManager.panelBox ? 'cls='+Main.panel.has_style_class_name('nwl-glass')+' alpha='+Main.panel.get_theme_node().get_background_color().alpha : (a.get_style()||'').slice(0,34)]})).concat(' docks='+Main.layoutManager.uiGroup.get_children().filter(a=>a.name==='dashtodockContainer').length)"
           DOCKS="const g=new Gio.Settings({schema_id:'org.gnome.shell.extensions.dash-to-dock'}); g.get_string('transparency-mode')+' '+g.get_double('background-opacity').toFixed(2)"
           GRID="Main.overview._overview._controls._stateAdjustment.value = 2; 'app grid'"
           # White bars with gaps, laid under the top bar (x 0-480) and under the
           # dock (y 320-930). A real blur flattens them; a bar that merely
           # became translucent keeps them sharp, which is how "tinted but not
           # blurred" gets caught.
           STRIPES="const G=Main.layoutManager.uiGroup; const St=G.constructor; const dock=G.get_children().find(a=>a.name==='dashtodockContainer' && a.get_n_children()>0); const pb=Main.layoutManager.panelBox; const mk=(x,y,w,h,below)=>{const a=new St({x,y,width:w,height:h,style:'background-color:#ffffff;'}); G.add_child(a); G.set_child_below_sibling(a, below); return a;}; for(let i=0;i<30;i++) mk(i*16,0,8,40,pb); for(let i=0;i<38;i++) mk(0,320+i*16,70,8,dock); 'stripes under bar and dock'"
           DOCKS="const g=new Gio.Settings({schema_id:'org.gnome.shell.extensions.dash-to-dock'}); g.get_string('transparency-mode')+' '+g.get_double('background-opacity').toFixed(2)"
           GRID="Main.overview._overview._controls._stateAdjustment.value = 2; 'app grid'"
           # White bars with gaps, laid under the top bar (x 0-480) and under the
           # dock (y 320-930). A real blur flattens them; a bar that merely
           # became translucent keeps them sharp, which is how "tinted but not
           # blurred" gets caught.
           STRIPES="const G=Main.layoutManager.uiGroup; const St=G.constructor; const dock=G.get_children().find(a=>a.name==='dashtodockContainer' && a.get_n_children()>0); const pb=Main.layoutManager.panelBox; const mk=(x,y,w,h,below)=>{const a=new St({x,y,width:w,height:h,style:'background-color:#ffffff;'}); G.add_child(a); G.set_child_below_sibling(a, below); return a;}; for(let i=0;i<30;i++) mk(i*16,0,8,40,pb); for(let i=0;i<38;i++) mk(0,320+i*16,70,8,dock); 'stripes under bar and dock'"
           TREE="const out=[]; const walk=(a,d)=>{ out.push('  '.repeat(d)+a.constructor.name+' name='+a.name+' cls='+(a.style_class??'')+' '+Math.round(a.width)+'x'+Math.round(a.height)+' hasfn='+(typeof a.has_style_class_name)); a.get_children().forEach(c=>walk(c,d+1)); }; Main.layoutManager.uiGroup.get_children().filter(a=>a.name==='dashtodockContainer').forEach(a=>walk(a,0)); GLib.file_set_contents('/tmp/claude-1000/-home-uzhi-gh-repositories-neo-wallpaper-live/375efdb6-2fc2-4e67-af16-8880db5cff34/scratchpad/tree.txt', out.join(' ## ')); 'tree '+out.length"
           # Detail left in the stripes (std-dev of the green channel) inside the
           # top bar and inside the dock, measured on the latest screenshot.
           MEASURE="echo panel=\$(gjs -m $T/contrast.js \$(ls -t $OUT/*.png | head -1) 100 6 280 20) dock=\$(gjs -m $T/contrast.js \$(ls -t $OUT/*.png | head -1) 6 400 54 460)"
           # Is Mutter still clipping its redraws? (Clutter draw flag 2 = off.)
           FLAGS="const [,w]=imports.gi.Clutter.get_debug_flags(); 'draw='+w"
           STEPS=(base "f-base:$FLAGS" "stripes:$STRIPES" "dock:$DOCKS" "g0:$GINFO" off0 "m-off!$MEASURE"
                  "glass-on!neowallpaperlive glass on" on1 "g1:$GINFO" "dock-on:$DOCKS" "m-on!$MEASURE" "f-on:$FLAGS"
                  "redraw-clipped!neowallpaperlive glass redraw clipped" "f-clipped:$FLAGS"
                  "redraw-full!neowallpaperlive glass redraw full" "f-full:$FLAGS"
                  "blur0!neowallpaperlive glass blur 0" blur0 "m-b0!$MEASURE"
                  "blur40!neowallpaperlive glass blur 40" blur40 "m-b40!$MEASURE"
                  "tune!neowallpaperlive glass opacity 0.15" tuned "g2:$GINFO"
                  "ov-show:Main.overview.show(); 'ok'" ov "g3:$GINFO"
                  "to-grid:$GRID" grid
                  "ov-hide:Main.overview.hide(); 'ok'" back "g4:$GINFO"
                  "ext-off!gnome-extensions disable $UUID" "dock-ext-off!gsettings get org.gnome.shell.extensions.dash-to-dock transparency-mode"
                  "ext-on!gnome-extensions enable $UUID" w1 w2 "g6:$GINFO" "dock-ext-on:$DOCKS" "f-ext:$FLAGS"
                  "glass-off!neowallpaperlive glass off" off "g5:$GINFO" "dock-off:$DOCKS" "f-off:$FLAGS") ;;
    *) echo "unknown scenario: $SCENARIO"; exit 2 ;;
esac
printf '%s\n' "${STEPS[@]}" > "$T/steps.txt"
export PATH="$REPO/bin:$PATH"
echo "run=$RUN scenario=$SCENARIO out=$OUT"
exec dbus-run-session -- bash "$T/headless-inner.sh" 2>&1 |
    grep -v "dbus-daemon\|fusermount\|SpiRegistry\|goa-daemon\|discover_other\|xdg-desktop-portal\|Gdk-Message\|calendar-server\|evolution\|connection to the bus\|^$"
