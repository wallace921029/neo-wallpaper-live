# NeoWallpaperLive

**Live video wallpaper on every monitor for GNOME 50 on Wayland (Ubuntu 26.04).**

[中文说明 / Chinese README](README.zh-CN.md)

One video, decoded once by hardware, shown on all connected displays at the same time — laptop panel, 2K, 4K, any mix — each one filled edge to edge. Controlled from a small command line, no GUI.

```bash
neowallpaperlive set ~/Videos/ocean.mp4   # play on every monitor
neowallpaperlive exit                     # back to the static wallpaper
```

**Demo** (click to watch on bilibili):

[![Demo video](http://i1.hdslb.com/bfs/archive/2dd27bb2b3679eea0e578bfd7d359d4381a2e77e.jpg)](https://www.bilibili.com/video/BV1Bee16jEHN/)

---

## What it does

| Feature | Notes |
|---|---|
| Same video on **all monitors**, frame-synced | one `mpv` process, one decode, N screens |
| **Cover** fill on each monitor (default) | each screen gets its own centered crop; `contain` and `stretch` also available |
| Mixed resolutions and **fractional scaling** | verified with two 4K panels at 150 % |
| Sharpness is set by your **best** monitor | the compositor caps the renderer's surface at the size of the monitor it sits on, so it is pinned to the monitor with the most physical pixels — a 1080p laptop panel never limits an attached 4K screen |
| **Hot-plug** — dock / undock, 1 or 3 externals | playback never restarts; layers follow the monitors |
| Lives in GNOME's **background layer** | unaffected by *show desktop*, workspace switches, Alt+Tab, the dock; the video also appears in the overview's workspace previews and workspace-switch animations |
| Never steals input | right-click / drag-select on the desktop work normally |
| **Hardware decoding** | VA-API (AMD / Intel), NVDEC (NVIDIA), Vulkan — whatever `mpv --hwdec=auto-safe` finds. 4K60 H.264 ≈ 5 % CPU on an AMD 780M |
| Remembered across logins | starts automatically at login |
| **Seamless switching** | `set` swaps the file inside the running renderer, so changing wallpaper never flashes the static background |
| Stops while the screen is locked, resumes on unlock | saves power; the lock screen keeps its normal background |
| **Auto-pause** | decoding stops while every monitor is hidden behind windows, while a fullscreen app is on top (game, video), or — opt-in — on battery; resumes the moment the wallpaper is visible again. Rules switchable with `autopause` |
| **Keep-awake** toggle (`awake on`) | while the wallpaper plays: no automatic suspend, no idle screen blanking / locking. Off by default; released automatically on `exit`, lock, uninstall |
| Renderer crash recovery | mpv is restarted automatically (with back-off) |
| **Survives suspend / resume** | paused before the machine sleeps; after waking, playback is checked and the renderer restarted if the GPU reset left it frozen |
| Any format mpv/FFmpeg can play | mp4, mkv, webm, mov, gif, … |
| No audio, ever | wallpapers are silent by design |

## What it does not do

- **X11 sessions** — Wayland only.
- **GNOME versions other than 50** — it relies on shell internals that change between releases (`install.sh` checks and refuses; `--force` to try anyway).
- **Different videos per monitor** — one video everywhere is the design.
- **Lock screen / login screen** wallpaper.
- **Playlists, schedules, network sources** (YouTube etc.) — a single local file.
- **GUI / preferences panel** — CLI only.
- The overview's rounded workspace corners are not applied to the video (square corners on the video, rounded on the static wallpaper beneath it).

---

## Requirements

Install these **before** running the installer:

| Requirement | Check | Ubuntu package |
|---|---|---|
| GNOME Shell **50.x** | `gnome-shell --version` | (Ubuntu 26.04 default) |
| **Wayland** session | `echo $XDG_SESSION_TYPE` → `wayland` | choose *Ubuntu* (not *Ubuntu on Xorg*) at the login screen |
| `mpv` ≥ 0.38 | `mpv --version` | `mpv` |
| `glib-compile-schemas` | `which glib-compile-schemas` | `libglib2.0-bin` |
| `gnome-extensions` CLI | `which gnome-extensions` | `gnome-shell` (already present) |
| `python3` | `python3 --version` | `python3` (already present) |
| `git` | | `git` |

```bash
sudo apt install mpv libglib2.0-bin git
```

For hardware decoding (strongly recommended — software-decoding 4K burns a CPU core):

| GPU | Package |
|---|---|
| AMD / Intel | `mesa-va-drivers` (installed by default on Ubuntu) |
| NVIDIA | proprietary driver ≥ 535 (`nvidia-driver-*`), which ships NVDEC |

Check with `mpv --hwdec=auto-safe --msg-level=vd=v FILE` and look for `Using hardware decoding`.

Only needed for **development / running the test harness**: `ffmpeg`, `gjs`, `bc`.

## Install

```bash
git clone https://github.com/wallace921029/neo-wallpaper-live.git
cd neo-wallpaper-live
./install.sh
```

The installer is user-local (no `sudo`). It copies the extension to `~/.local/share/gnome-shell/extensions/`, compiles the settings schema, installs the CLI to `~/.local/bin/neowallpaperlive`, and enables the extension.

**GNOME Shell on Wayland only loads new extension code at login** — after the first install (and after every update) log out and back in. Then:

```bash
neowallpaperlive set ~/Videos/ocean.mp4
neowallpaperlive status
```

Install and start in one go: `./install.sh --video ~/Videos/ocean.mp4`.

**Update:** `git pull && ./install.sh`, then log out and back in.

## Usage

```
neowallpaperlive set FILE          play FILE on every monitor (remembered across logins)
neowallpaperlive exit              stop; the static wallpaper shows again
neowallpaperlive start             resume the remembered file
neowallpaperlive status            settings + live state (monitors, renderer pid, …)
neowallpaperlive fill MODE         cover (default) | contain | stretch
neowallpaperlive awake on|off      keep the computer awake while the wallpaper plays (default off)
neowallpaperlive autopause         show auto-pause rules and whether the video is paused right now
neowallpaperlive autopause RULE on|off   RULE = covered (default on) | fullscreen (default on) | battery (default off)
neowallpaperlive mpv-args [ARG…]   extra mpv flags for troubleshooting; no args clears them
neowallpaperlive log               follow the extension's log
neowallpaperlive uninstall         remove the extension, CLI, desktop entry and settings
```

Tips
- Pick a video at least as large as your biggest monitor; a 4K source stays sharp on a 4K panel, 1080p gets upscaled there.
- A short, seamlessly looping clip (10–60 s) looks best.
- `neowallpaperlive fill contain` if you would rather see black bars than a crop.
- Auto-pause keeps the last frame on screen and only stops decoding, so there is nothing to notice except lower CPU/GPU use. On a laptop consider `neowallpaperlive autopause battery on`.
- `neowallpaperlive awake on` for a presentation-style always-on screen. It only inhibits while a video is actually playing (`exit` releases it), uses gnome-session's standard inhibitor (the same one video players use), and is remembered across logins. `status` shows whether it is currently active.

## Uninstall

```bash
neowallpaperlive uninstall
```

Removes everything the installer put in place and resets the settings. Log out and back in to fully unload the extension.

## Troubleshooting

| Symptom | What to do |
|---|---|
| `neowallpaperlive set` says *log out and back in* | Expected after install/update — Wayland cannot reload extension code. |
| Static wallpaper, `status` shows `playing: false` | `neowallpaperlive log` — mpv's error is relayed there. Test the file directly: `mpv FILE`. |
| High CPU | Hardware decoding is not active: `neowallpaperlive status` → `mpv.hwdec-current` shows the decoder in use (`vaapi`, `nvdec`, `vulkan`…) or `no` for software decoding. Install the VA-API / NVIDIA packages above. |
| Green / garbled frames | Try `neowallpaperlive mpv-args --vo=gpu-next`, or `--hwdec=no` to rule out the decoder. |
| `awake on` but the screen still blanks / the machine sleeps | `neowallpaperlive status` → `keepAwake.active` must be `true` while playing. If `error` is set, gnome-session is not running (non-GNOME session). Check other inhibitors with `gnome-session-inhibit --list`. |
| Video missing on one monitor after plugging it in | `neowallpaperlive status` should list it under `monitors` with `layers` ≥ monitor count; if not, `neowallpaperlive exit && neowallpaperlive start`. |

Logs: `journalctl --user -f _COMM=gnome-shell | grep NeoWallpaperLive`.

---

## How it works

```
mpv (hidden, minimized, hardware decoded, native video size)
  └─ window actor
       ├─ Clutter.Clone → Meta.BackgroundActor of monitor 0  (cover-scaled)
       ├─ Clutter.Clone → Meta.BackgroundActor of monitor 1
       └─ Clutter.Clone → …
```

The renderer window is kept on the monitor with the most physical pixels (`width x height x scale^2`), re-pinned whenever monitors change: a Wayland surface is capped at the size of the output it is on, so leaving it on a small screen would cap the resolution every other screen sees. `neowallpaperlive status` reports `rendererMonitor` and `rendererBuffer`.

The extension wraps `BackgroundManager._createBackgroundActor`, so every background actor GNOME creates — the main desktop layer, the sliding copies in workspace-switch animations, the scaled copies in the overview — receives a `Clutter.Clone` of the renderer's window actor. Clutter keeps an actor mapped while it has mapped clones, so Mutter keeps sending frame callbacks to the minimized mpv window and it keeps rendering. A few thin, reversible patches hide the renderer window from Alt+Tab, the overview, workspace thumbnails, the dock and window animations.

```
extension/neowallpaperlive@local/
  extension.js          lifecycle + GSettings → renderer/layer sync
  modules/renderer.js   mpv process, window adoption, hiding, crash respawn
  modules/wallpaper.js  clones into background actors, fill-mode layout
  modules/stealth.js    hide the renderer from window lists / dock / animations
  modules/control.js    D-Bus status (+ test hooks when NWL_TEST=1)
  schemas/              GSettings schema
bin/neowallpaperlive    CLI
install.sh              user-local installer
data/                   hidden .desktop entry for the renderer's app-id
tools/                  headless test harness
```

## Development

`tools/headless-test.sh` starts a **separate, headless GNOME Shell** with two virtual monitors (1920×1080 and 1280×1024), installs the extension into isolated XDG directories, configures it through the real CLI, then drives it (workspace switch, background rebuild, overview, `fill`, `exit`/`start`) while sampling mpv's playback position, the extension's D-Bus status and stage screenshots. Your real session is never touched.

```bash
tools/regression.sh             # every scenario + assertions, ~10 min
tools/regression.sh smoke sleep # just these two

tools/headless-test.sh smoke    # a single scenario, prints the raw table
```

Scenarios: `smoke` (playback, stealth, workspaces, overview, fill modes, exit/start), `soak` (continuous playback), `autopause` (windows covering monitors, fullscreen), `pin` (renderer stays on the largest monitor), `sleep` (suspend/resume, hung renderer), `switch` (changing the file in place). `tools/regression.sh` runs them all and prints one PASS/FAIL line per invariant.

Reading the raw table: `mpv-pos` keeps advancing, `drop` stays 0, `playing=True layers=2 minim=True`, screenshot diffs stay non-zero, the `stealth` step reports `actors: 0, tab: 0, running: []`, and no JS errors.

## Acknowledgements

The clone-into-background technique follows [Hanabi](https://github.com/jeffshee/gnome-ext-hanabi). This project trades Hanabi's per-monitor GStreamer renderers for a single mpv renderer with per-monitor cover fitting.
