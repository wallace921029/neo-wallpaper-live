# NeoWallpaperLive

**GNOME 50 + Wayland（Ubuntu 26.04）下的多显示器动态视频壁纸。**

[English README](README.md)

一个视频，硬件解码一次，铺满所有已连接的显示器——笔记本内屏、2K、4K 任意混搭。纯命令行控制，没有图形界面。

```bash
neowallpaperlive set ~/Videos/ocean.mp4   # 在所有屏幕上播放
neowallpaperlive exit                     # 恢复静态壁纸
```

**演示视频**（点击跳转 B 站播放）：

[![演示视频](http://i1.hdslb.com/bfs/archive/2dd27bb2b3679eea0e578bfd7d359d4381a2e77e.jpg)](https://www.bilibili.com/video/BV1Bee16jEHN/)

## 功能

| 功能 | 说明 |
|---|---|
| **所有显示器**同一视频、帧同步 | 一个 `mpv` 进程，只解码一次 |
| 每块屏 **cover** 填充（默认） | 每块屏各自居中裁切；另有 `contain`、`stretch` |
| 混合分辨率、**分数缩放** | 已在两块 150 % 缩放的 4K 屏上验证 |
| 清晰度由**最好的**显示器决定 | 渲染窗口钉在工作区最大的显示器上，小屏、顶栏或 dock 都不会拖累 4K 屏 |
| **热插拔** | 插拔扩展坞、外接 1–3 块屏，播放不中断 |
| 位于 GNOME **背景层** | 不受"显示桌面"、工作区切换、Alt+Tab、dock 影响；概览和应用程序抽屉的桌面预览里也显示视频 |
| 不抢输入 | 桌面右键、框选一切正常 |
| **硬件解码** | `mpv --hwdec=auto-safe` 能找到的都行（VA-API、NVDEC、Vulkan）。AMD 780M 上 4K60 H.264：mpv 约占单核 7 %，GNOME Shell 合成另约 9 % |
| **无缝换片** | `set` 在运行中的渲染器里直接换文件，不闪回静态壁纸 |
| **自动暂停** | 所有屏幕都被窗口盖住、有全屏应用在前台，或（可选）使用电池时 |
| **防休眠**（`awake on`） | 播放期间不自动挂起、不息屏；默认关闭，`exit`、锁屏、卸载时自动释放 |
| 稳健 | 登录后自动恢复；锁屏时停止；休眠前暂停，唤醒后若 GPU 复位导致卡死则重启渲染器；渲染器崩溃自动重启（带退避） |
| mpv 能播的格式都行，永远静音 | mp4、mkv、webm、mov、gif…… |

**不支持：** X11 · GNOME 50 以外的版本（`install.sh --force` 可强行尝试）· 每块屏不同视频 · 锁屏/登录界面 · 播放列表、定时、网络源 · 图形界面。概览里工作区的圆角不作用于视频。

## 依赖

| 依赖 | 检查 | Ubuntu 包 |
|---|---|---|
| GNOME Shell **50.x**、**Wayland** 会话 | `gnome-shell --version`、`echo $XDG_SESSION_TYPE` | Ubuntu 26.04 默认（登录时选 *Ubuntu*，不要选 *on Xorg*） |
| `mpv` ≥ 0.38 | `mpv --version` | `mpv` |
| `glib-compile-schemas` | `which glib-compile-schemas` | `libglib2.0-bin` |
| `git`、`python3`、`gnome-extensions` | | `git`（其余系统自带） |

```bash
sudo apt install mpv libglib2.0-bin git
```

强烈建议启用硬件解码（软解 4K 会吃满一个核）：AMD / Intel 用 `mesa-va-drivers`（Ubuntu 默认已装），NVIDIA 用 ≥ 535 的闭源驱动。检查：`mpv --hwdec=auto-safe --msg-level=vd=v FILE` → 出现 `Using hardware decoding`。

仅开发需要：`ffmpeg`、`gjs`、`bc`。

## 安装

```bash
git clone https://github.com/wallace921029/neo-wallpaper-live.git
cd neo-wallpaper-live
./install.sh                 # 或：./install.sh --video ~/Videos/ocean.mp4
```

装在用户目录，无需 `sudo`：扩展到 `~/.local/share/gnome-shell/extensions/`，命令行工具到 `~/.local/bin/neowallpaperlive`。

**每次安装或更新后都要注销再登录**——Wayland 下 GNOME Shell 只在登录时加载扩展代码。更新：`git pull && ./install.sh`。

## 用法

```
neowallpaperlive set FILE          在所有屏幕上播放 FILE（跨登录保留）
neowallpaperlive exit              停止，恢复静态壁纸
neowallpaperlive start             恢复播放记住的文件
neowallpaperlive status            设置 + 实时状态
neowallpaperlive fill MODE         cover（默认）| contain | stretch
neowallpaperlive awake on|off      播放期间保持电脑唤醒（默认关）
neowallpaperlive autopause [RULE on|off]   RULE = covered（开）| fullscreen（开）| battery（关）
neowallpaperlive mpv-args [ARG…]   额外的 mpv 参数；不带参数则清空
neowallpaperlive log               跟踪扩展日志
neowallpaperlive uninstall         移除全部文件、重置设置（注销后彻底卸载）
```

小贴士：视频分辨率最好不低于你最大的显示器，10–60 秒的无缝循环片段效果最好。自动暂停只停解码、保留最后一帧；笔记本可以考虑 `autopause battery on`。

## 故障排查

| 现象 | 处理 |
|---|---|
| `set` 提示需要注销再登录 | 安装/更新后的正常现象 |
| 显示静态壁纸，`status` → `playing: false` | `neowallpaperlive log` 会转发 mpv 的报错；用 `mpv FILE` 直接测试 |
| CPU 占用高 | `status` → `mpv.hwdec-current` 为 `no`：安装上面的硬解包 |
| 画面发绿 / 花屏 | `mpv-args --vo=gpu-next`，或 `--hwdec=no` 排除解码器问题 |
| `awake on` 了仍然息屏 | 播放时 `status` → `keepAwake.active` 应为 `true`（有 `error` 说明没有 gnome-session）；用 `gnome-session-inhibit --list` 查看其他 inhibitor |
| 新插的显示器上没有视频 | `status` → `layers` 应 ≥ 显示器数；否则 `exit && start` |
| 右侧/下方边缘露出一条静态壁纸，或应用程序抽屉里只有一条视频带、看不到小桌面 | 已修复——更新后重新登录。若仍出现，请附上 `status`：`layerBoxes` 里每个 `mapped: true` 的条目，其 `clone` 框都应盖住 `layer` 框 |

日志：`journalctl --user -f _COMM=gnome-shell | grep NeoWallpaperLive`。

## 工作原理

```
mpv（隐藏、最小化、硬件解码）
  └─ 窗口 actor
       ├─ Clutter.Clone → 显示器 0 的 Meta.BackgroundActor（cover 缩放）
       ├─ Clutter.Clone → 显示器 1 的 Meta.BackgroundActor
       └─ …
```

扩展包装了 `BackgroundManager._createBackgroundActor`，GNOME 创建的每个背景 actor——桌面、工作区切换动画、概览预览——都会得到一个渲染窗口的 `Clutter.Clone`。只要 actor 还有已映射的 clone，Clutter 就认为它处于映射状态，于是最小化的 mpv 窗口持续收到帧回调。另有几处轻量、可还原的补丁，把渲染窗口从 Alt+Tab、概览、dock 和窗口动画中隐藏。

Mutter 把窗口限制在所在显示器的工作区内，所以渲染窗口钉在工作区最大的显示器上（`宽 × 高 × 缩放²`，相同时优先副屏），显示器变化时重新钉屏。`status` 会报告 `rendererMonitor`、`rendererBuffer`、`rendererRects`、每块屏的 `workArea`，以及 `layerBoxes`（Clutter 实际分配给每层 layer 和 clone 的框）。

```
extension/neowallpaperlive@local/
  extension.js          生命周期、GSettings → 渲染器/图层
  modules/renderer.js   mpv 进程、窗口认领、钉屏、崩溃重启
  modules/wallpaper.js  把 clone 放进背景 actor
  modules/fit.js        填充模式几何计算（纯函数，有单元测试）
  modules/stealth.js    从窗口列表 / dock 中隐藏渲染窗口
  modules/control.js    D-Bus 状态接口（NWL_TEST=1 时附带测试钩子）
bin/neowallpaperlive    命令行工具
install.sh              安装脚本
data/                   渲染窗口 app-id 对应的隐藏 .desktop
tools/                  headless 测试工具
```

## 开发

测试工具会启动一个**独立的 headless GNOME Shell**，带两块虚拟显示器（1920×1080、1280×1024）和隔离的 XDG 目录，通过真实的命令行完成配置，并采样 mpv 播放位置、D-Bus 状态和截图。不会碰你当前的会话。

```bash
tools/regression.sh             # 全部场景 + 断言，约 15 分钟
tools/regression.sh smoke sleep # 只跑指定场景
tools/headless-test.sh smoke    # 单个场景，输出原始表格
gjs -m tools/fit-test.js        # 填充数学单元测试，不需要合成器
```

场景：`smoke`（播放、隐身、工作区、概览、填充模式、exit/start）、`soak`、`autopause`、`pin`、`sleep`（休眠唤醒、渲染器挂死）、`switch`（原地换片）、`geom`（dock 尺寸的 strut 让渲染窗口内缩）、`appgrid`（开着视频时应用抽屉的预览保持原尺寸）。单元测试覆盖虚拟显示器造不出来的输入：分数缩放和客户端自绘阴影。

原始表格：`mpv-pos` 持续前进，`drop` 保持 0，`playing` 为 `True`，`layers` 为 2（概览打开时更多），`ipc` 为 `<解码器>/<扩展报告的暂停>/<mpv 实际的暂停>`，两个暂停标志一致。每次采样的完整 `status` 以 JSON 保存在对应截图旁。

## 致谢

clone 进背景层的做法来自 [Hanabi](https://github.com/jeffshee/gnome-ext-hanabi)。本项目把 Hanabi 的每屏一个 GStreamer 渲染器换成了单个 mpv 渲染器 + 每屏 cover 适配。
