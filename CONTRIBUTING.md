# 参与贡献

欢迎提交 Issue、功能建议和 Pull Request。

## 本地开发

```bash
git clone https://github.com/saheru/vibe-float.git
cd vibe-float
./scripts/build-vibe-float.sh
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

## 维护 Harness

仓库提供统一的 PowerShell 维护入口：

```powershell
# 检查 Node.js 20+、npm 和 .NET 8 SDK
.\scripts\harness.ps1 doctor

# 安装锁定依赖并运行 StreamDock 测试
.\scripts\harness.ps1 test-plugin

# 编译、发布并执行无副作用的 Windows 启动冒烟测试
.\scripts\harness.ps1 verify-windows
```

Windows 冒烟测试通过 `--smoke-test` 启动应用。该模式会构造并显示主窗口，
但不会连接本地 Codex/Claude 服务；测试必须正常退出并在本次启动日志中写入
`Smoke test passed`，因此错误对话框不会再被误判为启动成功。

## 提交要求

- 不要提交账号、Token、Cookie、Codex 会话或本地日志。
- UI 改动请验证最小窗口尺寸以及对应平台构建。
- Commit message 请清楚描述改动目的。
