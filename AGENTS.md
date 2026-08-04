# Vibe Float maintenance guide

## Repository map

- `windows/CodexFloat`: Windows 10/11 x64 WPF app targeting .NET 8.
- `macos/CodexFloat`: macOS 14+ SwiftUI app built with Swift 6.
- `com.tlm.codex-control.sdPlugin`: Node.js 20+ StreamDock plugin.
- `test/plugin.test.js`: Node test suite for the StreamDock plugin.
- `scripts/harness.ps1`: canonical Windows maintenance entry point.

## Required checks

Run the narrowest relevant check first, then the platform verification before handoff.

```powershell
.\scripts\harness.ps1 doctor
.\scripts\harness.ps1 test-plugin
.\scripts\harness.ps1 verify-windows
```

On macOS, build the native application with:

```bash
./scripts/build-vibe-float.sh
```

## Windows startup contract

`VibeFloat.exe --smoke-test` must construct and show the main window without connecting
to Codex or Claude, append `Smoke test passed` to
`%LOCALAPPDATA%\Vibe Float\startup.log`, and exit with code 0. Keep this path free of
dialogs so CI cannot hang or mistake an error dialog for a healthy process.

Normal startup failures must continue to be appended to the same log. Never commit that
log, user configuration, credentials, session data, tokens, or generated artifacts.

## Change discipline

- Keep Windows and macOS behavior aligned when changing shared product concepts.
- Add or update a regression check for bug fixes whenever a deterministic test seam exists.
- Preserve self-contained Windows publishing and the complete multi-file package layout.
- Do not edit generated output under `artifacts/`, `dist/`, `bin/`, `obj/`, or `.build/`.
