# 开发计划 / Development Plan

状态标记：`[ ]` 待办 · `[~]` 进行中 · `[x]` 已完成 · `[-]` 决定不做

工作方式：一次只做一项，完成后报告并等待指令再开始下一项。每项完成的标准是：代码 + 对应测试/验证 + 文档同步。

## 已完成 / Done

- [x] **v0.1 基线**：单 mpv 渲染器 + 每显示器 `Clutter.Clone` 进 `Meta.BackgroundActor`，cover/contain/stretch，Alt+Tab / 概览 / Dock / 动画隐身，CLI（set / exit / start / status / fill / mpv-args / log / uninstall），`install.sh`，headless 测试 harness，中英 README。
- [x] **keep-awake**（`neowallpaperlive awake on|off`）：通过 `org.gnome.SessionManager.Inhibit` 在播放期间禁止自动挂起与息屏/锁屏；`exit`、锁屏、卸载时释放；卸载后校验无残留。
- [x] README 演示视频（可点击封面图）。

## 第一梯队 / Tier 1 — 用户直接受益，优先

- [x] **T1 · mpv 生产环境 IPC 通道**（2026-09-18）
  始终以 `--input-ipc-server` 启动 mpv（socket `$XDG_RUNTIME_DIR/neowallpaperlive-<WAYLAND_DISPLAY>.sock`，测试环境与真实会话互不干扰），`modules/mpvipc.js` 异步 JSON IPC 客户端（请求/应答按 request_id 配对，断线自动拒绝挂起请求，进程重启自动重连）；`status` 增加 `mpv` 段：`hwdec-current`、编码、分辨率、帧率、播放位置、丢帧、暂停状态，500 ms 超时保护。headless 冒烟测试表格新增 `ipc` 列（显示扩展经 IPC 读到的 hwdec），全程 `vaapi`。
- [x] **T2 · 自动暂停**（2026-09-18）
  `modules/autopause.js`：三条独立规则 —— `covered`（当前工作区里每块显示器的工作区都被窗口盖满，默认开）、`fullscreen`（任一显示器上有全屏窗口，默认开）、`battery`（UPower `OnBattery`，默认关）。300 ms 防抖；概览打开时不算被盖住。CLI `neowallpaperlive autopause [RULE on|off]`，`status` 增加 `autoPause` 段（当前是否暂停、原因、是否电池供电、各规则开关）。harness 新增 `autopause` 场景：真实派生 mpv 窗口去盖屏/全屏，`ipc` 列显示 `<hwdec>/<扩展报告的暂停>/<直接查询的暂停>`，两者必须一致。
  过程中发现并修复 T1 的真实缺陷：`MpvIpc.command()` 对同一输出流并发调用 `write_all_async`（GIO 不允许），导致 `status` 里排在后面的属性（`pause`）静默丢失、显示为未暂停。改为写入串行化后两个来源完全一致。
- [x] **T3 · 渲染窗口钉在最佳显示器**（2026-09-18）
  按物理像素（`宽 × 高 × 缩放²`）选出最好的显示器，认领窗口后与每次 `monitors-changed` 时 `move_to_monitor` 钉过去；`status` 增加 `rendererMonitor` / `rendererBuffer`。harness 新增 `pin` 场景（用 2560×1440 的大视频，让"surface 被所在显示器尺寸截断"可观测）：强制把渲染窗口挪到 1280×1024 的小屏后缓冲掉到 `1280x1024`，重钉后回到 `1920x1048`，连做两轮均正确。
- [x] **T4 · 休眠 / 唤醒处理**（2026-09-18）
  `modules/sleepwatch.js` 订阅 logind `PrepareForSleep`：睡前通过 IPC 暂停 mpv；醒来后先 `autoPause.resync()` 把真实的暂停决定重新下发（否则睡前那次强制暂停没人撤销，壁纸会永久停住），2 s 后做健康检查——间隔 1.5 s 读两次 `time-pos`，不前进或 IPC 超时就重启渲染器，规避 VA-API 上下文在 GPU 复位后冻结/绿屏。harness 新增 `sleep` 场景：在会话总线上伪造同一个信号（`NWL_TEST=1` 时扩展改听会话总线），并用 SIGSTOP 模拟挂死的渲染器。
- [x] **T5 · `set` 无缝切换**（2026-09-18）
  `Renderer.switchTo()` 用 IPC `loadfile … replace` 换片，窗口与 clone 不重建、播放不中断；loadfile 只是排队，所以轮询 `path` 属性确认 mpv 真的接手（最多 2 s），失败才回退到重启。extension 侧用 generation + `_switchTarget` 防止连续 `set` 互相踩踏。harness 新增 `switch` 场景：三次来回切换 1280×720 ↔ 2560×1440，pid 始终不变，缓冲随视频尺寸变化。
  附带发现：启动时 mpv 的 surface 会被所在显示器截断（见 T3），但**切换后**重新申请的尺寸不受此限制，因此原地换片实际能拿到比启动时更高的缓冲分辨率。

**统一回归**（2026-09-18）：`tools/regression.sh` 跑全部 6 个场景并校验 53 条不变式，全部通过。

**实机验证结论**（2026-09-18，GNOME 50.1 / Wayland / AMD 780M）：T1 硬解 `vaapi` + IPC 正常；T2 自动暂停在真实桌面上多次正确暂停/恢复；T4 睡前暂停生效（唤醒路径通常被锁屏的 disable/enable 周期取代，扩展重新启动渲染器，结果同样正确）；T5 原地换片 pid 不变；keep-awake inhibitor flags=12 注册/释放正常。CPU 实测：mpv 约 6.8 %，gnome-shell 合成额外约 9.5 %（基线 2.5 %）。热插拔期间日志里的 JS 错误来自 `ubuntu-dock` 和 GNOME 自身的 `workspace.js`，非本扩展。

- [x] **T13 · 钉屏时机修正**（2026-09-18，实机验证发现）
  钉屏原本在 `_adopt()` 里做，那时 Mutter 还没完成布局，首帧之后会把移动覆盖掉。改为首帧 + 500 ms 后再钉，并在钉好之后才隐藏窗口。
  **放弃修复"渲染分辨率只有 98%"**：Mutter 把普通窗口限制在所在显示器的**工作区**内（屏幕高减顶栏），`move_resize_frame()` 和 mpv 自己的 `window-scale` 都绕不过（实机实测，mpv 自报 `current-window-scale: 0.979`）。唯一能绕过的 `make_fullscreen()` 会触发我们自己的全屏暂停规则、并带来焦点问题，为 2% 的线性分辨率不值得。已删掉无效代码并把该约束写进注释。
  实机附带发现：顶栏只在**主显示器**上，所以渲染窗口落在非主显示器时反而能拿到完整原生分辨率（实测 3840×2160）。
- [x] **T14 · 钉屏失败时自愈**（2026-09-18，实机热插拔发现）
  实机拔插后渲染器留在 5.5 MP 的笔记本内屏上、没有迁移到 8.3 MP 的外接屏，`monitors-changed` 的 `move_to_monitor()` 没有生效（headless 里同样的调用一直有效，机制未查清）。改为：显示器变化后等 800 ms 钉屏 → 再等 800 ms **校验是否真的到位** → 未到位则重启渲染器（每个渲染器最多 2 次，避免死循环）；启动 settle 之后也走同一套校验。回归新增断言"钉屏成功时不得触发重启"。
- [x] **T15 · 副屏右侧/下方露底修复**（2026-09-18，用户实机报告）
  开机自启后，视频在每块屏上整体向左上偏移，右边和下边露出静态壁纸，缺口正好是主屏 dock 宽（51）和顶栏高（32）。
  根因在 `wallpaper.js` 的 `offX = frame.x - buf.x`：这个差值本意是**客户端自绘阴影**的内边距，代码无条件相信它。渲染器被钉在主屏时会被 Mutter 限制在工作区内，窗口正好坐落在 `(51, 32)`；1.5 倍分数缩放下 frame 与 buffer 两个矩形分别计算、分别取整，原点没对齐，于是"窗口在屏幕上的位置"被当成了阴影内边距。
  修复：内边距按"frame 内缩量不可能超过两者尺寸差"钳位。无阴影时（尺寸相等）内边距恒为 0，原点是否对齐不再有任何影响。
  填充数学抽成无依赖的纯模块 `modules/fit.js`，`tools/fit-test.js` 用 gjs 直接跑、不需要合成器，15 条用例覆盖 harness 造不出来的输入（分数缩放、自绘阴影、原点错位、resize 当帧）。已验证修复前 FAIL、修复后 PASS。
  `status` 新增 `rendererRects`、`layerBoxes`（每层 layer/clone/source 的真实 allocation）、每块屏的 `workArea`。harness 新增 `geom` 场景（用和 Ubuntu Dock 相同的方式注册左侧 strut，让工作区在两个轴上都被裁），回归新增断言"cover/stretch 下 clone 必须盖满 layer 每一条边"。
  **局限**：headless 虚拟显示器不支持分数缩放（Mutter 只给 `supported_scales: [1]`），真机 1.5 倍环境无法在 harness 复现；原点错位是从症状数值推断并由单元测试复现，尚需真机 `rendererRects` 实证。
- [x] **T16 · 钉屏优先选择最大工作区显示器（解决双 4K 副屏右下撕裂）**（2026-09-18，用户实机报告）
  在双 4K（或相同分辨率多屏）环境下，旧算法 `_bestMonitorIndex()` 仅比较物理分辨率（`m.width * scale * m.height * scale`）。因两屏像素相同，判定条件 `>` 停留选中主屏（Monitor 0）。而主屏受 Mutter 工作区限制，被 Ubuntu 顶栏（32px）和 Dock（51px）硬性缩水为 2509×1408；同时现代 GNOME Shell 的 `ClutterPaintNode` 渲染管线忽略了 `Clutter.Clone` 旧式的 Cogl 矩阵缩放，导致视频在副屏上始终按 2509×1408 原始尺寸绘制，在副屏右侧露出 51px、下方露出 32px 的未重绘撕裂带。
  修复：`_bestMonitorIndex()` 改用**实际可用工作区**的物理像素进行选屏（`area = ws.get_work_area_for_monitor(m.index)`），并在像素相同时优先选择非主显示器（`m.index !== Main.layoutManager.primaryIndex`）。副屏没有顶栏和 Dock 占用，拥有满血完整的 2560×1440（物理 3840×2160），mpv 钉在副屏即可获得完整无损画幅，主副屏双向铺满，彻底消除 51px 和 32px 的撕裂缝隙。

- [x] **T17 · 应用程序抽屉里的小桌面被视频挤没**（2026-09-24，用户实机报告）
  按两次 Super / Super+A 打开应用程序抽屉，顶部本应有两个小桌面预览，开着视频时却只看到一条视频带。
  这条不是工作区缩略图（`ThumbnailsBox` 在 APP_GRID 下 `opacity = 0`），而是 `_workspacesDisplay` 被压到屏幕高度的 15%（`SMALL_WORKSPACE_RATIO`）。每个 `Workspace` 是 `BinLayout`，宽度取子节点首选宽度的最大值：`WorkspaceLayout` 按工作区宽高比给出正确值（harness 里 288），`WorkspaceBackground` 正常返回 0。我们的 layer 是没有 layout manager 的普通 `Clutter.Actor`，默认把 clone 的首选尺寸——也就是视频分辨率——向上汇报，一路传到 `WorkspaceBackground`，于是预览被撑成视频那么宽（harness 1280，实机 4K 视频约 3840），互相重叠、溢出屏幕。窗口选择器里工作区本来就够大，所以只有应用抽屉暴露。
  修复：layer 重写 `vfunc_get_preferred_width/height` 返回 `[0, 0]`，尺寸完全来自 `BindConstraint`。
  harness 新增 `appgrid` 场景：在应用抽屉里开关视频做 A/B，断言开视频时预览宽度与关视频时一致、背景首选宽度为 0。已验证旧代码 FAIL（`w=1280,1280,1280 bg=1280`）、新代码 PASS（`w=288,288,1025 bg=0`）。
  附带：`status.layerBoxes` 增加 `mapped`；概览打开期间桌面层被隐藏、Clutter 不给它布局，clone 框是"从未分配"的无穷值（旧代码同样如此，无可见影响），覆盖断言改为只判断屏幕上可见的层，但可见层里出现未分配的 clone 仍算失败。

- [x] **T18 · 顶栏和左侧 Dock 磨砂半透明**（2026-11-06，用户需求；不依赖 Blur my Shell）
  `modules/glass.js` + `neowallpaperlive glass on|off|blur N|opacity X|brightness X`（默认关）。用 GNOME 自带的 `Shell.BlurEffect`（`BACKGROUND` 模式：模糊身后已经画好的内容，含我们的视频 clone 和路过的窗口）加半透明着色，只挂特效、不碰任何布局。
  **实测发现（决定了挂载位置）**：同一个特效，挂在 `Main.panel` 上完全不生效，挂在外层容器 `panelBox` 上才生效；Dock 同理——挂在 `.dash-background` 或 `dash` 上不生效，挂在 `dashtodockBox`（再外一层）才生效。靠"铺白条纹、量剩余对比度"测出（半径 0 → 40：顶栏 72 → 19.7，Dock 75 → 0.5；顶栏剩余的是背后红绿色带本身的渐变，肉眼确认条纹已完全消失）。
  **着色走哪一层**：顶栏用生成的小样式表（`#panel.nwl-glass`，概览/锁屏下回到透明）——概览每次开合都会重写 `Main.panel.style`，内联样式活不下来。Dock 的背景样式归它自己的主题管理器，每次变动都会重写，所以改走它自己的 GSettings（`transparency-mode=FIXED` + `background-opacity`），原值存进 `glass-dock-backup`，关闭、禁用扩展（含锁屏）时精确还原；上次异常退出留下的备份不会被覆盖。
  **应用抽屉**：这是 Blur my Shell 在 Ubuntu 26.04 上"所有应用消失"的触发点（它为模糊 Dock 强行提前计算布局，Ubuntu 打过补丁的 Shell 会把空网格算成每页 0 个图标，上游 #1159，修复 #1168）。我们从不读 allocation，应用抽屉在磨砂开着时图标和小桌面预览都完整（截图确认）。
  Dock 主题管理器会在 uiGroup 里短暂放同名的空 `dummy` 容器，按名字找 Dock 会撞上它们——空闲时再查一次，并只对仍在舞台上的容器报警。
  harness 新增 `glass` 场景（带真实 Ubuntu Dock）：24 条断言，含"半径 0 对照 / 半径 40 抹平"、概览让位、禁用再启用、关闭后 Dock 设置与原来完全一致。
  **局限**：①只在无头虚拟显示器验证，真机 GPU 上每帧对 4K60 视频做模糊的开销未测；②只测了默认的"满高、靠左"Ubuntu Dock，悬浮式（`extend-height` 关）下模糊区域是 Dock 外围的矩形，圆角处会露出模糊的边；③`hwdec-current` 在本机无头环境里是 `no`（写磨砂代码之前就是），回归里"硬解"那条在这台机器上会失败，与磨砂无关；④应用自己的标题栏不在范围内。

- [x] **T19 · `install.sh` 按"全新电脑"自动装依赖，含硬解驱动**（2026-11-06，用户实机发现软解）
  实机现象：Intel Arc（Meteor Lake）机器上视频走 CPU 软解（`hwdec-current: no`，mpv 约 97% CPU）。根因：没装 VA-API 驱动 `intel-media-va-driver`（也没有 `vainfo`）。README 原来写"AMD / Intel 用 `mesa-va-drivers`（Ubuntu 默认已装）"——对 Intel 是错的（Intel 靠独立的 intel-media-driver），对 26.04 的 AMD 也过时（`mesa-va-drivers` 已无候选，Mesa 的 VA-API 在 `libgl1-mesa-dri` 里）。已改正。
  新增 `install-deps.sh`（被 install.sh 引用）：**按全新 Ubuntu 桌面规划，而不是按当前这台机器缺什么**——读 `/sys/class/drm/card*/device/vendor` 识别显卡厂商（双显卡各算一次），算出完整清单（所有机器 `mpv`/`libglib2.0-bin`/`python3`；Intel `intel-media-va-driver`；AMD 现查 `mesa-va-drivers` 是否存在，否则 `libgl1-mesa-dri`；Intel/AMD 加 `vainfo`；`--dev` 加 `ffmpeg`/`gjs`/`bc`），再逐个 `dpkg-query` 检查，只装缺的。NVIDIA 驱动不代装（内核模块、Secure Boot 要设密码），只给 `sudo ubuntu-drivers install` 的提示；虚拟机等识别不了的显卡如实说明会走 CPU。装完用 `vainfo` 确认 H.264 可解，失败只警告不中断。
  **不静默提权**：终端里先列清单再问 `[Y/n]`；`--yes` 免问；`--no-deps` 跳过；没有终端又没 `--yes` 时只打印命令。无 apt 的系统打印包清单交给用户。
  `tools/install-test.sh`：23 条，用伪造的 `/sys/class/drm`、dpkg 数据库和记录用的 sudo/apt-get/vainfo 描述机器——全新 Intel、`--yes`、vainfo 失败、AMD 两种包布局、AMD 已装、NVIDIA 有/无驱动、Intel+NVIDIA、双 Intel 卡去重、虚拟机、读不到显卡、已装齐、部分已装、`--dev`、apt 失败、无 apt，以及用真实伪终端测"回答 n"和"直接回车"。故意改坏 3 处，5 条检查随即失败，证明测试有效。
  **局限**：①端到端的真实 `sudo apt-get` 没在我这里跑过（需要密码），装包路径靠桩测试覆盖；②`intel-media-va-driver` 只覆盖 Broadwell 及更新的 Intel，更老的要 `i965-va-driver`，脚本未处理；③Intel/AMD 之外的显卡（含 NVIDIA）装完后是否真走硬解，仍要看 `status` 的 `hwdec-current`。

- [~] **T20 · 磨砂开着时悬停出现闪烁的深色方块**（2026-11-06，用户实机报告：Ghostty 最大化时悬停顶栏或 dock 会闪方块，Chrome 最大化不会）
  **假设（用户尚未确认）**：`BACKGROUND` 模糊读的是"身后已画好的像素"。Mutter 默认只重画变化的小矩形（悬停高亮），矩形之外的缓冲区里还是上一帧——对顶栏和 dock 而言，那已经是模糊加着色后的结果。模糊读到自己的旧输出，等于叠了两层着色，深色方块随两块缓冲区交替而闪。上游 Blur my Shell 的 README 描述过同类"黑色矩形"问题，它的 "Artifact handling" 里最强的一档就是关闭局部重绘。**没能在本地复现**：无头截图走的是整屏重画，看不到上屏帧里的残留。**也没解释**为什么 Chrome 最大化不出现而 Ghostty 出现。
  **做法**：磨砂开着时调用 `Clutter.add_debug_flags(0, DISABLE_CLIPPED_REDRAWS, 0)`，每次变化整屏重画；关闭、禁用扩展时精确还原，且只在标志原本没被别人设置时才动它。设置项 `glass-full-redraw`（默认开），`neowallpaperlive glass redraw full|clipped` 可退回。视频播放时壁纸本来就每帧整屏损坏，所以主要多出来的是"视频暂停（被窗口盖住）时悬停那一下"的整屏重画。
  harness 的 `glass` 场景用 `Clutter.get_debug_flags()` 读出标志：关闭时 0、开启 2、`redraw clipped` 回 0、`redraw full` 再 2、禁用再启用后 2、`glass off` 回 0，6 条断言。
  **待办**：①用户先在 Looking Glass 里手动打开该标志（`imports.gi.Clutter.add_debug_flags(null, imports.gi.Clutter.DrawDebugFlag.DISABLE_CLIPPED_REDRAWS, null)`）确认方块消失，再装新版；②确认后测整屏重画的 GPU 开销；③若方块没消失，说明假设不对，回到"读到的到底是什么"重新查（比如给顶栏和 dock 的模糊换成对模糊目标整体重绘，而不是全局禁用）。

## 第二梯队 / Tier 2 — 健壮性

- [ ] **T6 · 猴子补丁存在性保护**
  `stealth.js` 的 `_patch` 在原方法不存在时（未来 GNOME 版本改名）跳过并记日志，而不是把 `undefined` 包装后在用户按 Alt+Tab 时才炸。
- [ ] **T7 · 渲染器放弃重启时桌面通知**
  连续失败 5 次后 `Main.notify()` 一条通知，指向 `neowallpaperlive log`。
- [ ] **T8 · 焦点抢占验证与修复**
  `set` 时 mpv 窗口从映射到首帧之间可能短暂抢走键盘焦点；真机验证，若成立则在认领后把焦点还给之前的窗口。
- [ ] **T9 · 真机热插拔验证 + harness 真热插拔场景**
  在真机拔插外接屏确认播放不中断；harness 用 Mutter ScreenCast `RecordVirtual` 动态增减虚拟显示器做回归。

## 第三梯队 / Tier 3 — 工程化

- [ ] **T10 · CI**
  GitHub Actions 用 `ubuntu:26.04` 容器跑 `tools/headless-test.sh smoke`，每次 push 自动回归。
- [ ] **T11 · LICENSE**
  选择许可证（MIT / GPL 等，由仓库所有者决定）。
- [ ] **T12 · harness 中 mock `org.gnome.SessionManager`**
  让 keep-awake 也有自动化覆盖。

## 决定不做 / Won't do

- [-] 每显示器不同视频（设计目标是同一视频铺满所有屏）
- [-] 图形界面 / 设置面板
- [-] 播放列表、定时、网络源
- [-] 首帧抽图做静态壁纸兜底（需引入 ffmpeg 并备份/还原用户壁纸，收益小于复杂度）
- [-] 调 mpv 着色器参数省 GPU（`--vo=gpu` 默认已是最便宜路径）
