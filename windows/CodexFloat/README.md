# Codex Float for Windows

Windows 10/11 原生 WPF 版本，功能与 macOS 五区面板一致：

- 最近三个 Codex 任务
- Sol 推理强度切换
- 周 Usage 动态进度轮
- 始终置顶、拖动移动、右下角缩放

## 构建

```powershell
dotnet publish .\CodexFloat.csproj `
  -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true
```

GitHub Actions 会为每个 Release 自动生成 Windows x64 免安装压缩包。
