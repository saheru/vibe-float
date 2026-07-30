# Vibe Float for macOS

macOS 原生模块化 Codex + Claude Code 悬浮面板。

- 最近 1～8 个 Codex / Claude 任务混合排序，数量可配置
- Codex Sol Effort、5h Usage 与周 Usage
- Claude Model、Effort 与周 Usage
- 菜单栏设置任务数量、自由开关其余模块，按数量智能排列
- 始终置顶、跨桌面、自由缩放

## 构建

```bash
./scripts/build-vibe-float.sh
```

产物：

- `dist/Vibe Float.app`
- `dist/Vibe-Float-macOS.zip`
- `dist/Vibe-Float-macOS.dmg`

发布包同时支持 Apple Silicon 和 Intel Mac。
