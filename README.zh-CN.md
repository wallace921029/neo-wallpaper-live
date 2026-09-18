# NeoWallpaperLive

**GNOME 50 + Wayland（Ubuntu 26.04）下的多显示器动态视频壁纸。**

[English README](README.md)

一个视频，硬件解码一次，同时铺满所有已连接的显示器——笔记本内屏、2K、4K 任意混搭，每块屏各自 cover 填充。纯命令行控制，没有图形界面。

```bash
neowallpaperlive set ~/Videos/ocean.mp4   # 在所有屏幕上播放
neowallpaperlive exit                     # 恢复静态壁纸
```

**演示视频：** [bilibili](https://www.bilibili.com/video/BV1Bee16jEHN/)

---

## 支持的功能

| 功能 | 说明 |
|---|---|
| 同一视频在**所有显示器**上播放，帧同步 | 一个 `mpv` 进程、一次解码、N 块屏 |
| 每块屏 **cover** 填充（默认） | 各自居中裁切；也提供 `contain`、`stretch` |
| 混合分辨率与**分数缩放** | 已在两块 150 % 缩放的 4K 屏上验证 |
| **热插拔**——插拔坞站、外接 1 块或 3 块 | 播放不会重启，图层自动跟随显示器 |
| 位于 GNOME 的**背景层** | 不受"显示桌面"、切换工作区、Alt+Tab、Dock 影响；概览里的工作区预览和工作区切换动画中也有视频 |
| 不抢输入 | 桌面右键、框选图标一切正常 |
| **硬件解码** | VA-API（AMD / Intel）、NVDEC（NVIDIA）、Vulkan——`mpv --hwdec=auto-safe` 能找到什么就用什么。AMD 780M 上 4K60 H.264 约 5 % CPU |
| 设置跨登录保留 | 登录后自动开始播放 |
| 锁屏时停止、解锁后恢复 | 省电；锁屏保持系统原有背景 |
| **保持唤醒**开关（`awake on`） | 壁纸播放期间：不自动挂起、不自动息屏/锁屏。默认关闭；`exit`、锁屏、卸载时自动释放 |
| 渲染进程崩溃自动恢复 | mpv 会自动重启（带退避） |
| mpv/FFmpeg 能播的格式都行 | mp4、mkv、webm、mov、gif…… |
| 永远不出声 | 壁纸设计上就是静音的 |

## 不支持的功能

- **X11 会话**——只支持 Wayland。
- **GNOME 50 以外的版本**——依赖 Shell 内部实现，版本间会变（`install.sh` 会检查并拒绝；`--force` 可强行尝试）。
- **每块屏放不同视频**——设计目标就是一个视频到处播。
- **锁屏 / 登录界面**壁纸。
- 全屏应用或游戏运行时、使用电池时的**自动暂停**（计划中）。
- **播放列表、定时、网络源**（YouTube 等）——只播放单个本地文件。
- **图形界面 / 设置面板**——只有命令行。
- 概览中工作区预览的圆角不会作用到视频上（视频是直角，下面的静态壁纸是圆角）。

---

## 安装前的依赖

运行安装脚本**之前**先装好这些：

| 依赖 | 检查方式 | Ubuntu 软件包 |
|---|---|---|
| GNOME Shell **50.x** | `gnome-shell --version` | （Ubuntu 26.04 自带） |
| **Wayland** 会话 | `echo $XDG_SESSION_TYPE` 输出 `wayland` | 登录界面选择 *Ubuntu*（不是 *Ubuntu on Xorg*） |
| `mpv` ≥ 0.38 | `mpv --version` | `mpv` |
| `glib-compile-schemas` | `which glib-compile-schemas` | `libglib2.0-bin` |
| `gnome-extensions` 命令 | `which gnome-extensions` | `gnome-shell`（已自带） |
| `python3` | `python3 --version` | `python3`（已自带） |
| `git` | | `git` |

```bash
sudo apt install mpv libglib2.0-bin git
```

硬件解码（强烈建议——4K 软解会占满一个 CPU 核心）：

| GPU | 软件包 |
|---|---|
| AMD / Intel | `mesa-va-drivers`（Ubuntu 默认已装） |
| NVIDIA | 闭源驱动 ≥ 535（`nvidia-driver-*`），自带 NVDEC |

用 `mpv --hwdec=auto-safe --msg-level=vd=v 文件` 检查，看到 `Using hardware decoding` 即可。

仅**开发 / 跑测试**需要：`ffmpeg`、`gjs`、`bc`。

## 安装

```bash
git clone https://github.com/wallace921029/neo-wallpaper-live.git
cd neo-wallpaper-live
./install.sh
```

安装是用户级的，不需要 `sudo`。脚本会把扩展复制到 `~/.local/share/gnome-shell/extensions/`，编译设置 schema，把 CLI 装到 `~/.local/bin/neowallpaperlive`，并启用扩展。

**Wayland 下的 GNOME Shell 只在登录时加载新的扩展代码**——首次安装（以及每次更新）后需要注销再登录。然后：

```bash
neowallpaperlive set ~/Videos/ocean.mp4
neowallpaperlive status
```

安装并直接开始播放：`./install.sh --video ~/Videos/ocean.mp4`。

**更新：** `git pull && ./install.sh`，然后注销重新登录。

## 使用

```
neowallpaperlive set FILE          在所有显示器上播放 FILE（跨登录保留）
neowallpaperlive exit              停止；恢复静态壁纸
neowallpaperlive start             继续播放上次的文件
neowallpaperlive status            设置 + 运行状态（显示器、渲染进程 pid……）
neowallpaperlive fill MODE         cover（默认）| contain | stretch
neowallpaperlive awake on|off      壁纸播放期间保持电脑唤醒（默认 off）
neowallpaperlive mpv-args [ARG…]   排障用的额外 mpv 参数；不带参数则清空
neowallpaperlive log               实时查看扩展日志
neowallpaperlive uninstall         删除扩展、CLI、desktop 条目和全部设置
```

建议
- 选一个分辨率不低于最大显示器的视频：4K 源在 4K 屏上是清晰的，1080p 会被放大。
- 10–60 秒、首尾无缝衔接的短片效果最好。
- 宁要黑边不要裁切的话：`neowallpaperlive fill contain`。
- 想让屏幕像演示模式一样常亮：`neowallpaperlive awake on`。它只在视频真正播放时才生效（`exit` 后立即释放），用的是 gnome-session 的标准 inhibitor（和视频播放器同一套），设置跨登录保留；`status` 可以看到当前是否已生效。

## 卸载

```bash
neowallpaperlive uninstall
```

会删掉安装脚本放置的所有东西并重置设置。注销重新登录后扩展彻底卸载。

## 排障

| 现象 | 处理 |
|---|---|
| `neowallpaperlive set` 提示要注销重登 | 安装/更新后的正常现象——Wayland 无法热加载扩展代码。 |
| 显示的是静态壁纸，`status` 里 `playing: false` | `neowallpaperlive log` 里有 mpv 转发的报错。直接测试文件：`mpv 文件`。 |
| CPU 占用高 | 硬解没生效。用 `mpv --hwdec=auto-safe --msg-level=vd=v 文件` 检查；按上表装 VA-API / NVIDIA 相关包。 |
| 绿屏 / 花屏 | 试 `neowallpaperlive mpv-args --vo=gpu-next`，或用 `--hwdec=no` 排除解码器问题。 |
| `awake on` 了但屏幕还是会黑 / 电脑还是会睡 | `neowallpaperlive status` 里播放期间 `keepAwake.active` 必须是 `true`。若 `error` 有值，说明 gnome-session 没在运行（非 GNOME 会话）。用 `gnome-session-inhibit --list` 看其他 inhibitor。 |
| 新插的显示器上没有视频 | `neowallpaperlive status` 的 `monitors` 应列出它且 `layers` ≥ 显示器数；否则 `neowallpaperlive exit && neowallpaperlive start`。 |

日志：`journalctl --user -f _COMM=gnome-shell | grep NeoWallpaperLive`。

---

## 工作原理

```
mpv（隐藏、已最小化、硬件解码、按视频原始尺寸渲染）
  └─ 窗口 actor
       ├─ Clutter.Clone → 显示器 0 的 Meta.BackgroundActor（cover 缩放）
       ├─ Clutter.Clone → 显示器 1 的 Meta.BackgroundActor
       └─ Clutter.Clone → ……
```

扩展包裹了 `BackgroundManager._createBackgroundActor`，于是 GNOME 创建的每一个背景 actor——桌面主图层、工作区切换动画里的滑动副本、概览里的缩放副本——都会得到一个渲染窗口的 `Clutter.Clone`。Clutter 会让拥有已映射 clone 的 actor 保持映射状态，所以 Mutter 持续给已最小化的 mpv 窗口发 frame callback，mpv 也就持续出帧。再加几个薄薄的、可撤销的补丁，把渲染窗口从 Alt+Tab、概览、工作区缩略图、Dock 和窗口动画中隐藏掉。

```
extension/neowallpaperlive@local/
  extension.js          生命周期 + GSettings → 渲染/图层同步
  modules/renderer.js   mpv 进程、窗口认领、隐藏、崩溃重启
  modules/wallpaper.js  clone 进背景 actor、填充模式布局
  modules/stealth.js    从窗口列表 / Dock / 动画中隐藏渲染窗口
  modules/control.js    D-Bus 状态（NWL_TEST=1 时附带测试钩子）
  schemas/              GSettings schema
bin/neowallpaperlive    命令行
install.sh              用户级安装脚本
data/                   渲染窗口 app-id 对应的隐藏 .desktop 条目
tools/                  headless 测试工具
```

## 开发

`tools/headless-test.sh` 会启动一个**独立的 headless GNOME Shell**，带两块虚拟显示器（1920×1080 和 1280×1024），把扩展装进隔离的 XDG 目录，通过真实的 CLI 配置，然后驱动它（切工作区、重建背景层、开关概览、`fill`、`exit`/`start`），同时采样 mpv 播放位置、扩展的 D-Bus 状态和舞台截图。你的真实会话完全不受影响。

```bash
tools/headless-test.sh smoke    # 约 1.5 分钟
tools/headless-test.sh soak     # 约 1.5 分钟持续播放
tools/headless-test.sh all
```

预期：`mpv-pos` 持续增长、`drop` 保持 0、`playing=True layers=2 minim=True`、截图差异非零、`stealth` 步骤输出 `actors: 0, tab: 0, running: []`，且无 JS 错误。

## 致谢

clone 进背景层的技术路线来自 [Hanabi](https://github.com/jeffshee/gnome-ext-hanabi)。本项目把 Hanabi 的每屏一个 GStreamer 渲染器换成了单个 mpv 渲染器 + 每屏独立 cover 适配。
