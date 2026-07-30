using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Text.Json;

namespace CodexFloat;

internal sealed class CodexClient : IAsyncDisposable
{
    private readonly ConcurrentDictionary<long, TaskCompletionSource<JsonElement>> _pending = new();
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private Process? _process;
    private StreamWriter? _input;
    private long _nextId;

    public async Task StartAsync()
    {
        if (_process is { HasExited: false }) return;
        var codex = FindCodex();
        var info = new ProcessStartInfo
        {
            FileName = codex.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase) ? "cmd.exe" : codex,
            Arguments = codex.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase)
                ? $"/d /s /c \"\\\"{codex}\\\" app-server\""
                : "app-server",
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        _process = Process.Start(info) ?? throw new InvalidOperationException("无法启动 Codex app-server");
        _input = _process.StandardInput;
        _ = Task.Run(ReadLoopAsync);
        _ = Task.Run(async () =>
        {
            while (await _process.StandardError.ReadLineAsync() is not null) { }
        });

        await RequestAsync("initialize", new
        {
            clientInfo = new { name = "vibe_float_windows", title = "Vibe Float", version = "0.4.0" },
            capabilities = new { experimentalApi = true }
        });
        await NotifyAsync("initialized", new { });
    }

    public async Task<JsonElement> RequestAsync(string method, object parameters)
    {
        if (_input is null) throw new InvalidOperationException("Codex 未连接");
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
        if (_input is null) return;
        var json = JsonSerializer.Serialize(message);
        await _writeLock.WaitAsync();
        try
        {
            await _input.WriteLineAsync(json);
            await _input.FlushAsync();
        }
        finally
        {
            _writeLock.Release();
        }
    }

    private async Task ReadLoopAsync()
    {
        if (_process is null) return;
        while (await _process.StandardOutput.ReadLineAsync() is { } line)
        {
            try
            {
                using var document = JsonDocument.Parse(line);
                var root = document.RootElement;
                if (!root.TryGetProperty("id", out var idElement) || !idElement.TryGetInt64(out var id)) continue;
                if (!_pending.TryRemove(id, out var completion)) continue;
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
        foreach (var completion in _pending.Values)
            completion.TrySetException(new InvalidOperationException("Codex app-server 已断开"));
        _pending.Clear();
    }

    private static string FindCodex()
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

    public ValueTask DisposeAsync()
    {
        try
        {
            if (_process is { HasExited: false }) _process.Kill(entireProcessTree: true);
        }
        catch { }
        _writeLock.Dispose();
        _process?.Dispose();
        return ValueTask.CompletedTask;
    }
}
