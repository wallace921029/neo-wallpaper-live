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
