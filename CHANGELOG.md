# 更新日志

[简体中文](CHANGELOG.md) · [English](CHANGELOG_EN.md) · [日本語](CHANGELOG_JA.md)

本文件记录 Vibe Float 桌面应用与 StreamDock Vibe Control 插件的重要更新。

## [0.5.6] - 2026-08-04

### 新增

- macOS App、Windows App 与 StreamDock 插件通过本机共享 App Server 启动 Codex CLI，并新增 Model 与权限控制；会话可用 `thread/settings/update` 即时切换模型、Reasoning Effort 与权限，新设置从下一轮生效。

## [0.5.5] - 2026-08-04

### 修复

- 最近任务由每 5 秒刷新提升为每 0.8 秒刷新，并在 Codex 任务事件发生后约 0.12 秒主动更新。
- 通过 Codex 进程当前打开的 rollout 文件与 `OTTY_PANE_ID` 精确绑定正在运行的任务和 Otty 标签页。
- Otty 数据库出现重复或过期映射时，使用任务工作目录进一步校验，避免切错标签页或新建窗口。
- 同一任务在 8 秒内连续按下时只激活终端，不会重复创建窗口。

## [0.5.4] - 2026-08-04

### 修复

- 修复 Otty 在运行中暂时清空 `resume_key` 时，任务按钮错误新建窗口的问题。
- 当数据库映射缺失时，通过 Codex 会话创建时间与进程继承的 `OTTY_PANE_ID` 重新定位原标签页。
- 若同一个任务已经被错误恢复到新窗口，优先切回最初启动该任务的标签页。

## [0.5.3] - 2026-08-04

### 新增

- 使用会话 ID 自动识别 Otty 中仍在运行的 Codex 与 Claude 会话，并精确切回原标签页。
- CLI 任务终端支持自动识别，也可选择 Otty、Terminal、iTerm2、Ghostty、Kitty 或 WezTerm。
- macOS 应用提供全局 CLI 终端设置；StreamDock 的每个任务按钮可独立设置终端。
- 找不到原会话时，自动在所选终端中使用 `resume` 恢复任务。

## [0.5.2] - 2026-08-04

### 新增

- 自动区分 Codex CLI 与 Codex Desktop 任务，并在任务卡中显示不同来源。
- 点击 CLI 任务会在终端运行 `codex resume <任务 ID>`；桌面任务继续打开 Codex Desktop。

### 修复

- 修复 Windows CLI 任务启动器编译问题。
- 修复 macOS 通用安装包的云端构建与面板尺寸构建问题。

## [0.5.1] - 2026-08-01

### 修复

- Codex 切换账号后，StreamDock 会清除旧账号缓存并立即刷新显示。
- Windows 改用稳定的 self-contained 便携目录，新增启动脚本、错误窗口和诊断日志。
- Windows 安装包在发布前执行实际启动冒烟测试。

## [0.5.0] - 2026-07-30

### 新增

- StreamDock 插件新增 Claude 最近任务、Model、Effort、5h Usage 与周 Usage 模块。
- Claude Model 与 Effort 写入本地设置，并支持旋钮和按键切换。
- Claude Usage 通过本地 Status Line 采集，同时保留用户原有命令。
- Claude 任务完成或待回复时支持醒目的提示音和带任务标题的通知。

## [0.4.0] - 2026-07-30

### 新增

- 新增独立的 Codex 5h Usage 模块，并排列在 Codex 周 Usage 之前。
- 最近任务数量可设置为 1～8 个。
- 模块数量增加时自动使用紧凑网格布局。
- 增加完整的中文、英文和日文首页。

## [0.3.2] - 2026-07-30

### 修复

- 修复从 Finder 或登录项启动时找不到 Codex CLI 的问题。
- Codex app-server 意外退出后每两秒自动重连。
- 单次请求失败不再错误地将整个 Codex 标记为离线。
- Codex 重连期间继续保留 Claude 任务显示。

## [0.3.1] - 2026-07-30

### 改进

- 使用醒目的 `CODEX` 与 `CLAUDE` 标签区分任务来源。
- 项目行同步显示来源，状态颜色继续独立表示执行中、待回复、完成和错误。
- 修复 macOS 模块数量改变后窗口可能超出屏幕的问题。

## [0.3.0] - 2026-07-30

### 重大更新

- Codex Float 正式更名为 Vibe Float。
- macOS 与 Windows 应用新增 Claude Code 最近任务、Model、Effort 和 Usage 支持。
- 所有任务与控制模块均可单独开关，并根据数量智能排列。
- Codex 与 Claude Usage 使用独立标识与进度轮。

## [0.2.5] - 2026-07-30

### 改进

- macOS 恢复无 Dock 图标的纯悬浮体验。
- 增加菜单栏入口，提供立即刷新、配置和退出功能。

## [0.2.4] - 2026-07-30

### 改进

- macOS 应用可显示在 Dock，并支持 Dock 菜单与 `⌘Q` 退出。

## [0.2.3] - 2026-07-30

### 设计

- 重新设计应用图标，以任务卡、Sol Effort 和 Usage 进度环表达产品功能。
- 为 macOS 与 Windows 生成完整的多尺寸图标资源。

## [0.2.2] - 2026-07-30

### 新增

- macOS 与 Windows 首次采用统一应用图标。
- 增加 macOS DMG、ZIP、Windows ZIP 与 StreamDock 插件的下载说明。

## [0.2.1] - 2026-07-30

### 改进

- 任务状态改为事件触发刷新，并增加 0.8 秒独立轮询兜底。
- 任务、Usage、模型和配置请求互不阻塞。
- 发布通用 StreamDock 控制插件，支持任务、模型、权限、Effort、Usage 与通知。

## [0.2.0] - 2026-07-30

### 首次公开发布

- 发布原生 macOS SwiftUI 与 Windows WPF 悬浮应用。
- 支持最近三个 Codex 任务、Sol Effort、周 Usage、始终置顶、拖动与缩放。
- 所有状态均从本机 Codex app-server 读取。

[0.5.5]: https://github.com/saheru/vibe-float/releases/tag/v0.5.5
[0.5.4]: https://github.com/saheru/vibe-float/releases/tag/v0.5.4
[0.5.3]: https://github.com/saheru/vibe-float/releases/tag/v0.5.3
[0.5.2]: https://github.com/saheru/vibe-float/releases/tag/v0.5.2
[0.5.1]: https://github.com/saheru/vibe-float/releases/tag/v0.5.1
[0.5.0]: https://github.com/saheru/vibe-float/releases/tag/v0.5.0
[0.4.0]: https://github.com/saheru/vibe-float/releases/tag/v0.4.0
[0.3.2]: https://github.com/saheru/vibe-float/releases/tag/v0.3.2
[0.3.1]: https://github.com/saheru/vibe-float/releases/tag/v0.3.1
[0.3.0]: https://github.com/saheru/vibe-float/releases/tag/v0.3.0
[0.2.5]: https://github.com/saheru/vibe-float/releases/tag/v0.2.5
[0.2.4]: https://github.com/saheru/vibe-float/releases/tag/v0.2.4
[0.2.3]: https://github.com/saheru/vibe-float/releases/tag/v0.2.3
[0.2.2]: https://github.com/saheru/vibe-float/releases/tag/v0.2.2
[0.2.1]: https://github.com/saheru/vibe-float/releases/tag/v0.2.1
[0.2.0]: https://github.com/saheru/vibe-float/releases/tag/v0.2.0
