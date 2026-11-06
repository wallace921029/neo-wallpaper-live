# NeoWallpaperLive

**A live video wallpaper on every monitor, for Ubuntu 26.04 (GNOME 50, Wayland).**

[中文说明](README.zh-CN.md)

Pick one video and it plays edge to edge on every screen, whatever mix of laptop panel, 2K and 4K you have. Optionally, the top bar and the dock turn into frosted glass over it. Everything is controlled from the terminal.

```bash
neowallpaperlive set ~/Videos/ocean.mp4   # play it on every monitor
neowallpaperlive glass on                 # frosted top bar and dock
neowallpaperlive exit                     # back to the normal wallpaper
```

**Demo** (click to watch on bilibili):

[![Demo video](http://i1.hdslb.com/bfs/archive/2dd27bb2b3679eea0e578bfd7d359d4381a2e77e.jpg)](https://www.bilibili.com/video/BV1Bee16jEHN/)

## What you get

- One video on **all monitors**, in sync, scaled to fill each screen without stretching
- Light on the machine: **hardware decoding**, and it **pauses by itself** when windows cover the desktop or a fullscreen app is on top
- Plug and unplug monitors freely; the video keeps playing
- Stays behind everything: *show desktop*, workspaces and the app grid all work normally
- Remembered across logins; switching to another video has no flash
- Optional **frosted glass** top bar and dock
- Any video format `mpv` can play (no sound)

Not supported: X11, other GNOME versions, a different video per monitor, the lock screen, playlists.

## Install

You need Ubuntu 26.04 with the default GNOME desktop on a **Wayland** session (choose *Ubuntu*, not *Ubuntu on Xorg*, at the login screen).

```bash
git clone https://github.com/wallace921029/neo-wallpaper-live.git
cd neo-wallpaper-live
./install.sh
```

The installer also sets up what the wallpaper depends on: `mpv`, and the **video-decoding driver for your graphics card** (without it the CPU does the decoding and the fan will let you know). It lists what it is going to install and asks first; answer `Y` and enter your password when `sudo` asks.

> **NVIDIA:** the installer won't install the graphics driver itself. If you have an NVIDIA card, run `sudo ubuntu-drivers install` once.

**Log out and back in after installing or updating.** GNOME only loads new extensions at login.

To update later: `git pull && ./install.sh`.

## Use it

```bash
neowallpaperlive set ~/Videos/ocean.mp4   # play a video (remembered next time you log in)
neowallpaperlive exit                     # stop, show the normal wallpaper again
neowallpaperlive start                    # play the remembered video again
```

**More options** (frosted glass has [its own section](#frosted-glass-top-bar-and-dock) below):

```bash
neowallpaperlive fill contain             # fit the whole video instead of cropping (cover | contain | stretch)
neowallpaperlive awake on                 # don't let the computer sleep while the video plays
neowallpaperlive autopause battery on     # also pause on battery (laptops)
neowallpaperlive status                   # show settings and what is happening right now
neowallpaperlive help                     # every command
neowallpaperlive uninstall                # remove everything
```

Tips: use a video at least as large as your biggest screen, ideally a 10–60 second loop that starts and ends the same.

## Frosted glass (top bar and dock)

Turns the top bar and the left dock into frosted glass: whatever is behind them (your video, the wallpaper, a window passing by) shows through, blurred, under a light tint. It is off by default and needs no other extension.

```bash
neowallpaperlive glass on                 # turn it on
neowallpaperlive glass off                # turn it off; the dock goes back exactly as it was
neowallpaperlive glass                    # show the current settings
```

Tune the look. Each setting is remembered:

```bash
neowallpaperlive glass opacity 0.2        # how strong the tint is: 0 = clear glass, 1 = solid (default 0.35)
neowallpaperlive glass blur 60            # how blurry: 0 to 200 (default 40)
neowallpaperlive glass brightness 0.8     # how bright the blurred picture is: 0 to 1 (default 0.9)
```

Good to know:

- Changes apply at once, no logout needed. (The first time, log out and back in after installing, like any update.)
- It works on the top bar and on the dock. Application title bars are not touched.
- It is built for Ubuntu's default dock: full height, on the left. A floating dock shows a blurred rectangle around itself.
- The top bar goes back to plain while the overview (Activities) is open.
- With glass on, the whole screen is redrawn on every change. That is what stops dark squares flickering around hovered icons. It costs some GPU; if you prefer, `neowallpaperlive glass redraw clipped` redraws less, but the squares can come back. `neowallpaperlive glass redraw full` goes back to the default.
- If you change the dock's own transparency while glass is on, `glass off` restores the values it had before glass was turned on.

## If something is wrong

| Problem | What to do |
|---|---|
| Nothing happens after `set` | You need to log out and back in once after installing |
| The wallpaper doesn't play | `neowallpaperlive log` shows the error; also try `mpv yourvideo.mp4` |
| High CPU, hot laptop, loud fan | Run `neowallpaperlive status`: `hwdec-current` should not be `no`. If it is, run `./install.sh` again (it installs the missing driver) |
| Dark squares flicker around icons with glass on | `neowallpaperlive glass redraw` should say `full` |
| Green or garbled picture | `neowallpaperlive mpv-args --hwdec=no`, and tell us if that fixes it |

## For developers

See [`PLAN.md`](PLAN.md) for the design notes, and `tools/` for the test suite. It runs in a separate headless GNOME Shell and never touches your session: `tools/regression.sh`.

## Thanks

The idea of showing the video through GNOME's background layer comes from [Hanabi](https://github.com/jeffshee/gnome-ext-hanabi).
