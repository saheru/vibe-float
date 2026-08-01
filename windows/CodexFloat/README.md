# Vibe Float for Windows

Windows 10/11 原生 WPF 模块化 Codex + Claude Code 悬浮面板。支持 1～8 个混合最近任务、Codex Sol/5h/周 Usage、Claude Model/Effort/Usage，以及按模块数量智能排列。

## 构建

```powershell
dotnet publish .\CodexFloat.csproj `
  -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=false
```

GitHub Actions 会生成 Windows x64 免安装便携目录压缩包。请完整解压后运行 `Start-Vibe-Float.cmd` 或 `VibeFloat.exe`；多文件发布避免了单文件自解压被安全软件或临时目录策略拦截的问题。启动错误会写入 `%LOCALAPPDATA%\Vibe Float\startup.log`。
