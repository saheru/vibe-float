# Changelog

[简体中文](CHANGELOG.md) · [English](CHANGELOG_EN.md) · [日本語](CHANGELOG_JA.md)

This file records notable changes to the Vibe Float desktop apps and the StreamDock Vibe Control plugin.

## [0.5.3] - 2026-08-04

### Added

- Match live Codex and Claude sessions in Otty by session ID and focus their exact original pane.
- Automatically detect a CLI terminal or select Otty, Terminal, iTerm2, Ghostty, Kitty, or WezTerm.
- Set one global CLI terminal in the macOS app or configure each StreamDock task button independently.
- Fall back to resuming the session in the selected terminal when the original pane no longer exists.

## [0.5.2] - 2026-08-04

### Added

- Automatically distinguish Codex CLI tasks from Codex Desktop tasks and label their source on each card.
- Resume CLI tasks with `codex resume <task ID>` while desktop tasks continue to open in Codex Desktop.

### Fixed

- Fixed the Windows CLI task launcher build.
- Fixed cloud builds for the universal macOS package and dashboard sizing.

## [0.5.1] - 2026-08-01

### Fixed

- Clear stale account data and refresh StreamDock immediately after switching Codex accounts.
- Ship Windows as a reliable self-contained portable directory with a launcher, error dialog, and diagnostic log.
- Run a real Windows launch smoke test before publishing the package.

## [0.5.0] - 2026-07-30

### Added

- Added Claude recent tasks, Model, Effort, five-hour Usage, and weekly Usage to StreamDock.
- Claude Model and Effort controls update local settings and work with buttons or dials.
- Collect Claude Usage through the local Status Line while preserving an existing command.
- Play prominent sounds and show notifications with task titles when Claude finishes or needs input.

## [0.4.0] - 2026-07-30

### Added

- Added a dedicated Codex five-hour Usage module before weekly Usage.
- Made the number of recent tasks configurable from 1 to 8.
- Added a compact automatic grid for larger module sets.
- Added complete Chinese, English, and Japanese project homepages.

## [0.3.2] - 2026-07-30

### Fixed

- Fixed Codex CLI discovery when launching from Finder or Login Items.
- Reconnect to `codex app-server` every two seconds after an unexpected exit.
- A single failed request no longer marks all of Codex offline.
- Claude tasks remain visible while Codex reconnects.

## [0.3.1] - 2026-07-30

### Improved

- Added prominent `CODEX` and `CLAUDE` source labels to task cards.
- Kept source labels independent from running, input, completed, and error status colors.
- Fixed the macOS window moving off-screen after module-count changes.

## [0.3.0] - 2026-07-30

### Major update

- Renamed Codex Float to Vibe Float.
- Added Claude Code recent tasks, Model, Effort, and Usage to macOS and Windows.
- Made every task and control module optional with an adaptive layout.
- Added separate Codex and Claude Usage identities and progress rings.

## [0.2.5] - 2026-07-30

### Improved

- Restored the Dock-free floating utility experience on macOS.
- Added a menu-bar entry for refresh, configuration, and quit.

## [0.2.4] - 2026-07-30

### Improved

- Made the macOS app visible in the Dock with Dock-menu and `⌘Q` quit support.

## [0.2.3] - 2026-07-30

### Design

- Redesigned the app icon around task cards, Sol Effort, and the Usage ring.
- Generated complete multi-size icon resources for macOS and Windows.

## [0.2.2] - 2026-07-30

### Added

- Introduced a unified app icon for macOS and Windows.
- Documented the macOS DMG/ZIP, Windows ZIP, and StreamDock plugin downloads.

## [0.2.1] - 2026-07-30

### Improved

- Switched task status to event-driven refresh with an independent 0.8-second polling fallback.
- Decoupled task, Usage, model, and configuration requests.
- Released the generic StreamDock control plugin with task, model, permission, Effort, Usage, and notification support.

## [0.2.0] - 2026-07-30

### Initial public release

- Released native SwiftUI for macOS and WPF for Windows.
- Added three recent Codex tasks, Sol Effort, weekly Usage, always-on-top behavior, dragging, and resizing.
- Read all state from the local Codex app-server.

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
