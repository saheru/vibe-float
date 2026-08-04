<div align="center">

[简体中文](README.md) · **English** · [日本語](README_JA.md)

<img src="docs/images/app-icon.png" width="128" alt="Vibe Float icon">

![Vibe Float](docs/images/hero-en.svg)

# Vibe Float & StreamDock Control

**A configurable floating dashboard for Codex and Claude Code tasks, models, effort levels, and usage.**

[![macOS 14+](https://img.shields.io/badge/macOS-14%2B-111827?logo=apple&logoColor=white)](https://github.com/saheru/vibe-float/releases)
[![Windows 10/11](https://img.shields.io/badge/Windows-10%20%2F%2011-0078D4?logo=windows11&logoColor=white)](https://github.com/saheru/vibe-float/releases)
[![Apple Silicon + Intel](https://img.shields.io/badge/Mac-Apple%20Silicon%20%2B%20Intel-35a7ff)](https://github.com/saheru/vibe-float/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-b77cff)](LICENSE)

[Download the latest release](https://github.com/saheru/vibe-float/releases/latest) ·
[Changelog](CHANGELOG_EN.md) ·
[Modules](#configurable-modules) ·
[Installation](#installation) ·
[StreamDock](#streamdock-vibe-control)

</div>

---

Vibe Float is a native **SwiftUI app for macOS** and **WPF app for Windows**. It combines recent Codex and Claude Code sessions in one always-on-top panel, while keeping every module optional.

All task and usage data stays on your computer. Codex data comes from the local `codex app-server`; Claude sessions and settings are read from Claude Code's local files.

![Core features](docs/images/features-en.svg)

## Configurable modules

| Module | What it shows | Action |
|---|---|---|
| Recent Tasks 1–8 | A configurable number of the most recently updated Codex or Claude sessions | Resume Codex/Claude CLI in Terminal or open Codex Desktop |
| Codex · Model | The current Codex model | Click to switch the selected CLI session immediately |
| Codex · Permissions | `READ`, `AUTO`, or `FULL` | Click to switch the selected CLI session immediately |
| Codex · Sol Effort | The current Sol reasoning effort with level-specific colors | Click to cycle the effort |
| Codex · 5h Usage | Live five-hour usage with a threshold-colored progress ring | Refreshes automatically |
| Codex · Weekly Usage | Live weekly usage with a threshold-colored progress ring | Refreshes automatically |
| Claude · Model | The default Claude Code model | Click to cycle the model |
| Claude · Effort | `low`, `medium`, `high`, `xhigh`, or `max` | Click to cycle the effort |
| Claude · Weekly Usage | Claude's seven-day limit in a separate progress ring | Collected locally through Status Line |

Choose from 1–8 recent task cards and enable any combination of the remaining modules. Codex 5h Usage is placed immediately before Codex Weekly Usage. Vibe Float automatically switches between a single row and a compact grid, then adjusts the window size to match.

## Automatic task detection

- Codex and Claude sessions are merged by their real last-updated time.
- Blue **CODEX CLI** / **CODEX APP** badges and `CLI·PROJECT` / `APP·PROJECT` labels distinguish Codex task origins.
- An orange **CLAUDE** badge and `CLAUDE·PROJECT` label identify Claude tasks.
- State colors remain independent: running, waiting for input, completed, or failed.
- Codex CLI and desktop tasks are detected automatically: CLI tasks resume in a terminal with `codex resume <id>`, while desktop tasks open through `codex://threads/<id>`.
- Live Codex and Claude sessions in Otty are matched by session ID and focused in their original pane. Terminal, iTerm2, Ghostty, Kitty, and WezTerm are available as configurable fallbacks.
- Claude tasks open a terminal and run `claude --resume <session-id>`.
- The macOS app, Windows app, and StreamDock plugin share one loopback-only App Server. CLI sessions resumed from a task card receive Model, Permission, and Sol Effort changes through `thread/settings/update` starting with their next turn.

If the Codex child process exits, Vibe Float automatically reconnects every two seconds. Claude tasks remain available while Codex reconnects.

## Installation

Download the latest files from [GitHub Releases](https://github.com/saheru/vibe-float/releases/latest).

### macOS

- Download `Vibe-Float-macOS.dmg` and drag **Vibe Float** into Applications.
- Alternatively, use `Vibe-Float-macOS.zip`.
- Supports macOS 14+, Apple Silicon, and Intel Macs.
- Install and sign in to Codex CLI and/or Claude Code for the corresponding modules.

If Gatekeeper blocks the locally signed build:

```bash
xattr -dr com.apple.quarantine "/Applications/Vibe Float.app"
```

Vibe Float runs as a menu-bar utility without a Dock icon. Use the menu-bar icon to configure modules, refresh data, or quit.

### Windows

- Download `Vibe-Float-Windows-x64.zip`.
- Extract the **entire folder**, then run `Start-Vibe-Float.cmd` (recommended) or `VibeFloat.exe`. Do not launch it from the ZIP preview. Startup diagnostics are written to `%LOCALAPPDATA%\Vibe Float\startup.log`.
- Supports Windows 10/11 x64.
- The package is self-contained; a separate .NET installation is not required.

## Claude Usage setup

Claude rate-limit information is supplied to Status Line by Claude Code. Enable the local capture bridge once:

- **macOS:** Vibe Float menu → **Claude** → `启用 Usage 采集` (Enable Usage Capture)
- **Windows:** right-click the panel → **Enable Claude Usage Capture**

Restart active Claude Code sessions afterward. The bridge preserves and continues to execute your existing Status Line command. Credentials are never read or stored.

## Controls

- Drag an empty area to move the window.
- Drag the lower-right handle to resize.
- Click a task to open or resume it.
- Click a model or effort card to cycle its value.
- Right-click the panel to refresh or quit.
- Configure visible modules from the macOS menu bar or Windows context menu.
- Set the number of recent task cards from the same menu.

## How it works

```mermaid
flowchart LR
    Float["Vibe Float<br/>SwiftUI / WPF"] --> Codex["Local codex app-server"]
    Float --> Claude["Local Claude Code sessions and settings"]
    Codex --> Threads["Tasks and states"]
    Codex --> Usage["Codex usage"]
    Codex --> Config["Sol configuration"]
    Claude --> Resume["claude --resume"]
    Claude --> ClaudeConfig["Model and effort"]
    Claude --> ClaudeUsage["Status Line usage snapshot"]
```

## StreamDock Vibe Control

The repository also contains a generic StreamDock plugin for Codex and Claude Code:

- Recent task buttons
- Model and reasoning-effort controls
- Permission controls
- Dedicated Sol effort control
- Five-hour and weekly usage rings
- Completion and waiting-for-input notifications
- Claude CLI task cards with terminal resume
- Separate Claude Model and Effort controls
- Claude five-hour and weekly usage rings

The desktop apps and plugin use a local-only shared Codex App Server. Codex CLI sessions opened or resumed from a task card connect to it, so model, reasoning-effort, and permission changes are applied to the selected session through `thread/settings/update`. A running turn keeps its original settings; the next turn uses the new values immediately. Standalone CLI sessions must be resumed from a task card once to opt in.

Claude Model and Effort changes update `~/.claude/settings.json` for new Claude Code CLI sessions. Enable the local Status Line capture from a Claude Usage action's property inspector, then restart active Claude CLI sessions.

The plugin detects Codex login identity changes. After you switch Codex accounts, it reconnects to the shared `app-server`, clears the previous account cache, and refreshes models plus 5h/weekly Usage without requiring you to re-add actions.

## Build from source

### macOS

```bash
git clone https://github.com/saheru/vibe-float.git
cd vibe-float
./scripts/build-vibe-float.sh
```

### Windows

```powershell
dotnet publish .\windows\CodexFloat\CodexFloat.csproj `
  -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=false
```

## Privacy

- No analytics, telemetry SDK, or third-party backend.
- Tasks, settings, and usage snapshots remain local.
- Codex and Claude credentials are never read or uploaded.
- Claude Usage capture only stores the Status Line JSON snapshot locally.

## License

[MIT](LICENSE) © 2026 tlm
