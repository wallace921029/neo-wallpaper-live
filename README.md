# NeoWallpaperLive

**Live video wallpaper on every monitor for GNOME 50 on Wayland (Ubuntu 26.04).**

[中文说明 / Chinese README](README.zh-CN.md)

One video, decoded once in hardware, fills every connected display edge to edge — laptop panel, 2K, 4K, any mix. Controlled from the command line; no GUI.

```bash
neowallpaperlive set ~/Videos/ocean.mp4   # play on every monitor
neowallpaperlive exit                     # back to the static wallpaper
```

**Demo** (click to watch on bilibili):

[![Demo video](http://i1.hdslb.com/bfs/archive/2dd27bb2b3679eea0e578bfd7d359d4381a2e77e.jpg)](https://www.bilibili.com/video/BV1Bee16jEHN/)

## Features

| Feature | Notes |
|---|---|
| Same video on **all monitors**, frame-synced | one `mpv` process, one decode |
| **Cover** fill per monitor (default) | centered crop per screen; `contain` and `stretch` available |
| Mixed resolutions, **fractional scaling** | verified on two 4K panels at 150 % |
| Sharpness set by your **best** monitor | renderer pinned to the monitor with the largest work area, so a small panel, top bar or dock never limits a 4K screen |
| **Hot-plug** | dock / undock, 1–3 externals; playback never restarts |
| Lives in GNOME's **background layer** | unaffected by *show desktop*, workspaces, Alt+Tab, the dock; also shown in overview and app-grid previews |
| Never steals input | desktop right-click / drag-select work normally |
| **Hardware decoding** | whatever `mpv --hwdec=auto-safe` finds (VA-API, NVDEC, Vulkan). 4K60 H.264 on an AMD 780M: ~7 % of a core for mpv + ~9 % for GNOME Shell |
| **Seamless switching** | `set` swaps the file inside the running renderer, no flash |
| **Auto-pause** | when every monitor is covered, a fullscreen app is on top, or (opt-in) on battery |
| **Keep-awake** (`awake on`) | no auto-suspend or idle blanking while playing; off by default, released on `exit`, lock and uninstall |
| Resilient | remembered across logins; stops on lock; paused across suspend and restarted if the GPU reset froze it; crashed renderer respawned with back-off |
| **Frosted glass** (`glass on`) | the top bar and the left Ubuntu Dock blur what is behind them (wallpaper, video, windows passing by) and turn translucent; off by default, undone exactly on `glass off` |
| Any format mpv plays, no audio | mp4, mkv, webm, mov, gif, … |

**Not supported:** X11 · GNOME other than 50 (`install.sh --force` to try) · different videos per monitor · lock/login screen · playlists, schedules, network sources · GUI. The overview's rounded workspace corners are not applied to the video. Frosted glass covers the top bar and the dock only, not application title bars.

## Requirements

| Requirement | Check | Ubuntu package |
|---|---|---|
| GNOME Shell **50.x**, **Wayland** session | `gnome-shell --version`, `echo $XDG_SESSION_TYPE` | Ubuntu 26.04 default (pick *Ubuntu*, not *on Xorg*) |
| `mpv` ≥ 0.38 | `mpv --version` | `mpv` |
| `glib-compile-schemas` | `which glib-compile-schemas` | `libglib2.0-bin` |
| `git`, `python3`, `gnome-extensions` | | `git` (others preinstalled) |

**`./install.sh` installs the packages for you** (after asking, with `sudo`). It works out the full list from your graphics card, checks each package, and installs only what is missing, so a fresh computer gets everything:

| Needed on | Package |
|---|---|
| every machine | `mpv`, `libglib2.0-bin`, `python3` |
| Intel graphics (Broadwell and newer) | `intel-media-va-driver` |
| AMD graphics | Mesa's VA-API driver (`mesa-va-drivers` on older Ubuntu, part of `libgl1-mesa-dri` on newer) |
| NVIDIA graphics | proprietary driver ≥ 535, **not** installed by the script (kernel module; Secure Boot asks for a password): `sudo ubuntu-drivers install` |
| Intel / AMD | `vainfo` (tiny; the installer uses it to confirm hardware decoding works) |

By hand: `sudo apt install mpv libglib2.0-bin python3 intel-media-va-driver vainfo` (Intel). Hardware decoding matters: without it a 4K video burns a CPU core. A graphics driver alone is not enough, the *VA-API* driver above must be there too. Check with `vainfo` (should list `VAProfileH264…`) and, once the wallpaper plays, `neowallpaperlive status` → `mpv.hwdec-current` should be `vaapi`, not `no`.

Development only (`./install.sh --dev` adds them): `ffmpeg`, `gjs`, `bc`.

## Install

```bash
git clone https://github.com/wallace921029/neo-wallpaper-live.git
cd neo-wallpaper-live
./install.sh                 # or: ./install.sh --video ~/Videos/ocean.mp4
```

The extension goes to `~/.local/share/gnome-shell/extensions/` and the CLI to `~/.local/bin/neowallpaperlive`, no `sudo` needed for those. Only the package step uses `sudo`, and only after listing what it will install and asking. `--yes` skips the question, `--no-deps` skips the step; with no terminal (a script, CI) it prints the command instead of running it.

**Log out and back in after every install or update** — GNOME Shell on Wayland only loads extension code at login. Update with `git pull && ./install.sh`.

## Usage

```
neowallpaperlive set FILE          play FILE on every monitor (remembered across logins)
neowallpaperlive exit              stop; the static wallpaper shows again
neowallpaperlive start             resume the remembered file
neowallpaperlive status            settings + live state
neowallpaperlive fill MODE         cover (default) | contain | stretch
neowallpaperlive awake on|off      keep the computer awake while playing (default off)
neowallpaperlive autopause [RULE on|off]   RULE = covered (on) | fullscreen (on) | battery (off)
neowallpaperlive glass [on|off]    frosted top bar and dock (default off); no argument shows the settings
neowallpaperlive glass blur N | opacity X | brightness X   radius 0–200 (40) · tint 0–1 (0.35) · 0–1 (0.9)
neowallpaperlive glass redraw full|clipped   full (default) stops dark squares flickering around hovered icons; clipped is cheaper
neowallpaperlive mpv-args [ARG…]   extra mpv flags; no args clears them
neowallpaperlive log               follow the extension's log
neowallpaperlive uninstall         remove everything, reset settings (log out to fully unload)
```

Tips: use a video at least as large as your biggest monitor, ideally a 10–60 s seamless loop. Auto-pause keeps the last frame and only stops decoding; on a laptop consider `autopause battery on`.

## Troubleshooting

| Symptom | What to do |
|---|---|
| `set` says *log out and back in* | expected after install/update |
| Static wallpaper, `status` → `playing: false` | `neowallpaperlive log` relays mpv's error; test with `mpv FILE` |
| High CPU | `status` → `mpv.hwdec-current` is `no`: install the decoding packages above |
| Green / garbled frames | `mpv-args --vo=gpu-next`, or `--hwdec=no` to rule out the decoder |
| `awake on` but the screen still blanks | `status` → `keepAwake.active` must be `true` while playing (`error` set means no gnome-session); check `gnome-session-inhibit --list` |
| Dark squares flicker around a hovered top-bar item or dock icon with glass on | `neowallpaperlive glass redraw` should say `full`; `clipped` brings them back (Mutter repaints only the hovered rectangle and the blur then reads its own old output) |
| Video missing on a newly plugged monitor | `status` → `layers` ≥ monitor count; otherwise `exit && start` |
| Wallpaper strip along the right/bottom edge, or app grid shows a video band instead of desktop previews | fixed — update and log in again. If it persists, send `status`: every `layerBoxes` entry with `mapped: true` needs a `clone` box covering its `layer` box |

Logs: `journalctl --user -f _COMM=gnome-shell | grep NeoWallpaperLive`.

## How it works

```
mpv (hidden, minimized, hardware decoded)
  └─ window actor
       ├─ Clutter.Clone → Meta.BackgroundActor of monitor 0  (cover-scaled)
       ├─ Clutter.Clone → Meta.BackgroundActor of monitor 1
       └─ …
```

The extension wraps `BackgroundManager._createBackgroundActor`, so every background actor GNOME creates — desktop, workspace-switch animations, overview previews — gets a `Clutter.Clone` of the renderer. Clutter keeps an actor mapped while it has mapped clones, so the minimized mpv window keeps receiving frame callbacks. Thin, reversible patches hide the renderer from Alt+Tab, the overview, the dock and window animations.

Mutter caps a window at its monitor's work area, so the renderer is pinned to the monitor with the largest one (`width × height × scale²`, secondary preferred on ties) and re-pinned when monitors change. `status` reports `rendererMonitor`, `rendererBuffer`, `rendererRects`, each monitor's `workArea`, and `layerBoxes` (what Clutter allocated to each layer and clone).

```
extension/neowallpaperlive@local/
  extension.js          lifecycle, GSettings → renderer/layers
  modules/renderer.js   mpv process, window adoption, pinning, respawn
  modules/wallpaper.js  clones into background actors
  modules/fit.js        fill-mode geometry (pure, unit-tested)
  modules/stealth.js    hide the renderer from window lists / dock
  modules/glass.js      frosted top bar and dock (Shell.BlurEffect + tint)
  modules/control.js    D-Bus status (+ test hooks when NWL_TEST=1)
bin/neowallpaperlive    CLI
install.sh              installer
data/                   hidden .desktop entry for the renderer's app-id
tools/                  headless test harness
```

## Development

The harness runs a **separate headless GNOME Shell** with two virtual monitors (1920×1080, 1280×1024) and isolated XDG dirs, configures it through the real CLI, and samples mpv's position, the D-Bus status and screenshots. Your session is never touched.

```bash
tools/regression.sh             # all scenarios + assertions, ~15 min
tools/regression.sh smoke sleep # selected scenarios
tools/headless-test.sh smoke    # one scenario, raw table
gjs -m tools/fit-test.js        # fill-maths unit tests, no compositor needed
tools/install-test.sh           # install.sh's package logic on described machines (Intel, AMD, NVIDIA, hybrid, VM, ...); installs nothing
```

Scenarios: `smoke` (playback, stealth, workspaces, overview, fill modes, exit/start), `soak`, `autopause`, `pin`, `sleep` (suspend/resume, hung renderer), `switch` (in-place file change), `geom` (dock-sized strut insets the renderer), `appgrid` (previews keep their size with the video on), `glass` (blur really flattens detail under the bar and the dock, overview, disable/enable, dock settings restored). Unit tests cover what virtual monitors can't produce: fractional scaling and client-side shadows.

Raw table: `mpv-pos` advances, `drop` stays 0, `playing` is `True`, `layers` is 2 (more with the overview open), `ipc` is `<decoder>/<extension's pause>/<mpv's pause>` with both flags agreeing. Each sample's full `status` is saved as JSON beside its screenshot.

## Acknowledgements

The clone-into-background technique follows [Hanabi](https://github.com/jeffshee/gnome-ext-hanabi). This project trades Hanabi's per-monitor GStreamer renderers for a single mpv renderer with per-monitor cover fitting.
