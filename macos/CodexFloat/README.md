# Codex Float

macOS 原生 Codex 悬浮面板，固定显示五个区域：

1. 最近任务 1
2. 最近任务 2
3. 最近任务 3
4. Sol 推理强度
5. Codex 周用量

## 操作

- 拖动面板空白处：移动悬浮窗
- 拖动窗口右下角的三条白色斜线：自由缩放整个五区面板
- 点击任务：在 Codex 桌面端打开对应任务
- 点击 Sol：循环切换 Sol 支持的推理强度
- 右键面板：立即刷新或退出
- 任务状态由事件触发并以 0.8 秒轮询兜底；Usage 每 3 秒刷新
- 面板始终置于其他窗口上方

## 构建

```bash
./scripts/build-codex-float.sh
```

产物：

- `dist/Codex Float.app`
- `dist/Codex-Float-macOS.zip`
- `dist/Codex-Float-macOS.dmg`

发布包同时支持 Apple Silicon 和 Intel Mac。

## 安装

```bash
./scripts/install-codex-float.sh
```
