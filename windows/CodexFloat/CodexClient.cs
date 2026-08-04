using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace CodexFloat;

internal sealed class CodexClient : IAsyncDisposable
{
    private readonly ConcurrentDictionary<long, TaskCompletionSource<JsonElement>> _pending = new();
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private readonly CancellationTokenSource _lifetime = new();
    private Process? _fallbackProcess;
    private Process? _sharedHost;
    private StreamWriter? _input;
    private ClientWebSocket? _socket;
    private long _nextId;

    public string SharedEndpoint { get; } =
        Environment.GetEnvironmentVariable("VIBE_CODEX_APP_SERVER") ?? "ws://127.0.0.1:45876";

    public bool UsesSharedServer => _socket?.State == WebSocketState.Open;

    public async Task StartAsync()
    {
        if (UsesSharedServer || _fallbackProcess is { HasExited: false }) return;
        try
        {
            LaunchSharedHost();
            Exception? lastError = null;
            for (var attempt = 0; attempt < 30; attempt++)
            {
                try
                {
                    var socket = new ClientWebSocket();
                    await socket.ConnectAsync(new Uri(SharedEndpoint), _lifetime.Token);
                    _socket = socket;
                    _ = Task.Run(() => ReadWebSocketLoopAsync(socket));
                    await InitializeAsync();
                    return;
                }
                catch (Exception error)
                {
                    lastError = error;
                    _socket?.Dispose();
                    _socket = null;
                    await Task.Delay(100);
                }
            }
            throw lastError ?? new InvalidOperationException("共享 Codex App Server 启动超时");
        }
        catch
        {
            await StartStdioAsync();
        }
    }

    private void LaunchSharedHost()
    {
        if (_sharedHost is { HasExited: false }) return;
        var codex = FindCodex();
        var info = CodexProcessInfo(codex, $"app-server --listen {SharedEndpoint}");
        info.RedirectStandardInput = false;
        info.RedirectStandardOutput = false;
        info.RedirectStandardError = false;
        _sharedHost = Process.Start(info);
    }

    private async Task StartStdioAsync()
    {
        var codex = FindCodex();
        var info = CodexProcessInfo(codex, "app-server");
        info.RedirectStandardInput = true;
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;
        _fallbackProcess = Process.Start(info) ?? throw new InvalidOperationException("无法启动 Codex app-server");
        _input = _fallbackProcess.StandardInput;
        _ = Task.Run(ReadStdioLoopAsync);
        _ = Task.Run(async () =>
        {
            while (await _fallbackProcess.StandardError.ReadLineAsync() is not null) { }
        });
        await InitializeAsync();
    }

    private async Task InitializeAsync()
    {
        await RequestAsync("initialize", new
        {
            clientInfo = new { name = "vibe_float_windows", title = "Vibe Float", version = "0.5.7" },
            capabilities = new { experimentalApi = true, requestAttestation = false }
        });
        await NotifyAsync("initialized", new { });
    }

    private static ProcessStartInfo CodexProcessInfo(string codex, string arguments)
    {
        var commandFile = codex.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase);
        return new ProcessStartInfo
        {
            FileName = commandFile ? "cmd.exe" : codex,
            Arguments = commandFile ? $"/d /s /c \"\"{codex}\" {arguments}\"" : arguments,
            UseShellExecute = false,
            CreateNoWindow = true
        };
    }

    public async Task<JsonElement> RequestAsync(string method, object parameters)
    {
        if (!UsesSharedServer && _input is null) throw new InvalidOperationException("Codex 未连接");
        var id = Interlocked.Increment(ref _nextId);
        var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[id] = completion;
        await SendAsync(new { method, id, @params = parameters });
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(method == "thread/list" ? 30 : 15));
        using var registration = timeout.Token.Register(() =>
            completion.TrySetException(new TimeoutException($"{method} 请求超时")));
        return await completion.Task;
    }

    public Task NotifyAsync(string method, object parameters) =>
        SendAsync(new { method, @params = parameters });

    private async Task SendAsync(object message)
    {
        var json = JsonSerializer.Serialize(message);
        await _writeLock.WaitAsync();
        try
        {
            if (_socket is { State: WebSocketState.Open } socket)
            {
                var bytes = Encoding.UTF8.GetBytes(json);
                await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, _lifetime.Token);
                return;
            }
            if (_input is null) return;
            await _input.WriteLineAsync(json);
            await _input.FlushAsync();
        }
        finally
        {
            _writeLock.Release();
        }
    }

    private async Task ReadStdioLoopAsync()
    {
        if (_fallbackProcess is null) return;
        while (await _fallbackProcess.StandardOutput.ReadLineAsync() is { } line)
            HandleMessage(line);
        FailPending(new InvalidOperationException("Codex app-server 已断开"));
    }

    private async Task ReadWebSocketLoopAsync(ClientWebSocket socket)
    {
        var buffer = new byte[64 * 1024];
        try
        {
            while (socket.State == WebSocketState.Open && !_lifetime.IsCancellationRequested)
            {
                using var message = new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), _lifetime.Token);
                    if (result.MessageType == WebSocketMessageType.Close) return;
                    message.Write(buffer, 0, result.Count);
                } while (!result.EndOfMessage);
                HandleMessage(Encoding.UTF8.GetString(message.ToArray()));
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception error) { FailPending(error); }
    }

    private void HandleMessage(string line)
    {
        try
        {
            using var document = JsonDocument.Parse(line);
            var root = document.RootElement;
            if (!root.TryGetProperty("id", out var idElement) || !idElement.TryGetInt64(out var id)) return;
            if (!_pending.TryRemove(id, out var completion)) return;
            if (root.TryGetProperty("error", out var error))
            {
                var message = error.TryGetProperty("message", out var text) ? text.GetString() : "Codex 请求失败";
                completion.TrySetException(new InvalidOperationException(message));
            }
            else
            {
                completion.TrySetResult(root.TryGetProperty("result", out var result)
                    ? result.Clone()
                    : JsonDocument.Parse("{}").RootElement.Clone());
            }
        }
        catch { }
    }

    private void FailPending(Exception error)
    {
        foreach (var completion in _pending.Values) completion.TrySetException(error);
        _pending.Clear();
    }

    internal static string FindCodex()
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var candidates = new[]
        {
            Environment.GetEnvironmentVariable("CODEX_PATH"),
            Path.Combine(appData, "npm", "codex.cmd"),
            Path.Combine(home, ".local", "bin", "codex.exe"),
            Path.Combine(home, ".local", "bin", "codex.cmd")
        };
        foreach (var candidate in candidates)
            if (!string.IsNullOrWhiteSpace(candidate) && File.Exists(candidate)) return candidate;

        using var where = Process.Start(new ProcessStartInfo
        {
            FileName = "where.exe",
            Arguments = "codex",
            RedirectStandardOutput = true,
            UseShellExecute = false,
            CreateNoWindow = true
        });
        var found = where?.StandardOutput.ReadLine();
        if (!string.IsNullOrWhiteSpace(found)) return found;
        throw new FileNotFoundException("找不到 Codex CLI，请先安装 Codex 或设置 CODEX_PATH");
    }

    public async ValueTask DisposeAsync()
    {
        _lifetime.Cancel();
        try
        {
            if (_socket is { State: WebSocketState.Open } socket)
                await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Vibe Float closed", CancellationToken.None);
        }
        catch { }
        try
        {
            if (_fallbackProcess is { HasExited: false }) _fallbackProcess.Kill(entireProcessTree: true);
        }
        catch { }
        _socket?.Dispose();
        _lifetime.Dispose();
        _writeLock.Dispose();
        _fallbackProcess?.Dispose();
        _sharedHost?.Dispose();
    }
}
