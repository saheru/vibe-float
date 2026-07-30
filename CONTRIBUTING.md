# 参与贡献

欢迎提交 Issue、功能建议和 Pull Request。

## 本地开发

```bash
git clone https://github.com/saheru/codex-float.git
cd codex-float
./scripts/build-codex-float.sh
```

Windows 版本需要 .NET 8 SDK：

```powershell
dotnet build .\windows\CodexFloat\CodexFloat.csproj
```

StreamDock 插件：

```bash
npm install
npm test
npm run package:streamdock
```

## 提交要求

- 不要提交账号、Token、Cookie、Codex 会话或本地日志。
- UI 改动请验证最小窗口尺寸以及对应平台构建。
- Commit message 请清楚描述改动目的。
