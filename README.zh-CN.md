# NeoWallpaperLive

**给 Ubuntu 26.04（GNOME 50、Wayland）的每块显示器都铺上动态视频壁纸。**

[English README](README.md)

选一个视频，它就会铺满每一块屏幕，不管你是笔记本屏、2K 还是 4K 混用。还可以选择让顶栏和 Dock 变成磨砂玻璃，叠在视频上。所有操作都在终端里完成。

```bash
neowallpaperlive set ~/Videos/ocean.mp4   # 在所有显示器上播放
neowallpaperlive glass on                 # 顶栏和 Dock 变磨砂
neowallpaperlive exit                     # 恢复普通壁纸
```

**演示**（点击在 bilibili 观看）：

[![演示视频](http://i1.hdslb.com/bfs/archive/2dd27bb2b3679eea0e578bfd7d359d4381a2e77e.jpg)](https://www.bilibili.com/video/BV1Bee16jEHN/)

## 能做什么

- 同一个视频铺满**所有显示器**，画面同步，按每块屏幕的比例填满、不拉伸
- 对电脑负担小：**硬件解码**，窗口盖住桌面或有全屏应用时**自动暂停**
- 随便插拔显示器，视频不中断
- 始终在最底层：*显示桌面*、切换工作区、应用抽屉都照常使用
- 登录后自动恢复；换视频不闪屏
- 可选的**磨砂玻璃**顶栏和 Dock
- `mpv` 能播的格式都行（无声）

不支持：X11、其他 GNOME 版本、每块屏不同视频、锁屏界面、播放列表。

## 安装

需要 Ubuntu 26.04 默认的 GNOME 桌面，并且是 **Wayland** 会话（登录界面选 *Ubuntu*，不要选 *Ubuntu on Xorg*）。

```bash
git clone https://github.com/wallace921029/neo-wallpaper-live.git
cd neo-wallpaper-live
./install.sh
```

安装脚本会顺带装好壁纸依赖的东西：`mpv`，以及**你这块显卡的视频解码驱动**（没有它就由 CPU 来解码，风扇会告诉你的）。它会先列出要装什么并询问，回答 `Y`，`sudo` 提示时输入密码即可。

> **NVIDIA 用户：** 脚本不会代装显卡驱动本身。如果你是 NVIDIA 显卡，请自己运行一次 `sudo ubuntu-drivers install`。

**安装或更新后，请注销再登录一次。** GNOME 只在登录时加载新的扩展。

以后更新：`git pull && ./install.sh`。

## 使用

```bash
neowallpaperlive set ~/Videos/ocean.mp4   # 播放视频（下次登录自动记住）
neowallpaperlive exit                     # 停止，恢复普通壁纸
neowallpaperlive start                    # 再次播放记住的视频
```

**更多选项**（磨砂玻璃在下面有[单独一节](#磨砂玻璃顶栏和-dock)）：

```bash
neowallpaperlive fill contain             # 完整显示整个视频而不裁剪（cover | contain | stretch）
neowallpaperlive awake on                 # 播放时不让电脑休眠
neowallpaperlive autopause battery on     # 使用电池时也暂停（笔记本）
neowallpaperlive status                   # 查看设置和当前运行情况
neowallpaperlive help                     # 全部命令
neowallpaperlive uninstall                # 全部卸载
```

小提示：视频分辨率最好不低于你最大的那块屏幕，最好是 10–60 秒、首尾衔接自然的循环视频。

## 磨砂玻璃（顶栏和 Dock）

把顶栏和左侧 Dock 变成磨砂玻璃：它们身后的东西（你的视频、壁纸、路过的窗口）会模糊地透出来，上面再盖一层淡淡的着色。默认关闭，不需要装别的扩展。

```bash
neowallpaperlive glass on                 # 打开
neowallpaperlive glass off                # 关闭；Dock 会精确恢复原样
neowallpaperlive glass                    # 查看当前设置
```

调整效果，每项设置都会被记住：

```bash
neowallpaperlive glass opacity 0.2        # 着色深浅：0 = 完全透明，1 = 不透明（默认 0.35）
neowallpaperlive glass blur 60            # 模糊程度：0 到 200（默认 40）
neowallpaperlive glass brightness 0.8     # 模糊后画面的亮度：0 到 1（默认 0.9）
```

需要知道：

- 修改立即生效，不用注销。（第一次安装后，和任何更新一样，需要注销再登录。）
- 只作用于顶栏和 Dock，不包括应用自己的标题栏。
- 针对 Ubuntu 默认的 Dock 设计：满高、靠左。悬浮式 Dock 周围会露出一块模糊的矩形。
- 打开概览（活动）时，顶栏会恢复成普通样子。
- 开着磨砂时，每次变化都会整屏重画，这样才不会在悬停图标时周围闪深色方块。代价是多占一些 GPU；如果你愿意，`neowallpaperlive glass redraw clipped` 会少重画一些，但方块可能回来。`neowallpaperlive glass redraw full` 恢复默认。
- 开着磨砂时如果你改了 Dock 自己的透明度设置，`glass off` 会还原成打开磨砂之前的值。

## 遇到问题

| 问题 | 怎么办 |
|---|---|
| `set` 之后没有任何反应 | 安装后需要注销再登录一次 |
| 壁纸不播放 | `neowallpaperlive log` 会显示报错；也可以用 `mpv 你的视频.mp4` 直接试 |
| CPU 高、笔记本发烫、风扇响 | 运行 `neowallpaperlive status`，`hwdec-current` 不应该是 `no`。如果是，再运行一次 `./install.sh`（它会补装缺的驱动） |
| 开了磨砂后，图标周围闪深色方块 | `neowallpaperlive glass redraw` 应该显示 `full` |
| 画面发绿或花屏 | `neowallpaperlive mpv-args --hwdec=no`，并告诉我们是否解决 |

## 开发者

设计笔记见 [`PLAN.md`](PLAN.md)，测试套件在 `tools/`。测试在独立的无头 GNOME Shell 里运行，不会碰你的桌面会话：`tools/regression.sh`。

## 致谢

通过 GNOME 背景层显示视频的思路来自 [Hanabi](https://github.com/jeffshee/gnome-ext-hanabi)。
