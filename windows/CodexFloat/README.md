# Vibe Float for Windows

Windows 10/11 原生 WPF 模块化 Codex + Claude Code 悬浮面板。支持 1～8 个混合最近任务、Codex Sol/5h/周 Usage、Claude Model/Effort/Usage，以及按模块数量智能排列。

## 构建

```powershell
dotnet publish .\CodexFloat.csproj `
  -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true
```

输出程序为 `VibeFloat.exe`。GitHub Actions 会生成 Windows x64 免安装压缩包。
