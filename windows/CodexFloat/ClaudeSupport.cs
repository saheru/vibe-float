using System.IO;
using System.Text;
using System.Text.Json;

namespace CodexFloat;

internal enum TaskProvider { Codex, Claude }
internal enum TaskState { Active, Idle, NeedsInput, Error, Waiting }
internal sealed record VibeTask(
    string Id,
    string Title,
    string Cwd,
    TaskState State,
    TaskProvider Provider,
    DateTime UpdatedAt);

internal static class ClaudeSupport
{
    internal static readonly string[] Models = ["sonnet", "opus", "fable", "haiku"];
    internal static readonly string[] Efforts = ["low", "medium", "high", "xhigh", "max"];

    private static string Home => Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    private static string SettingsPath => Path.Combine(Home, ".claude", "settings.json");
    private static string UsagePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "Vibe Float", "claude-status.json");

    internal static List<VibeTask> ScanSessions(int limit = 16)
    {
        var root = Path.Combine(Home, ".claude", "projects");
        if (!Directory.Exists(root)) return [];
        return Directory.EnumerateFiles(root, "*.jsonl", SearchOption.AllDirectories)
            .Select(path => new FileInfo(path))
            .OrderByDescending(file => file.LastWriteTimeUtc)
            .Take(Math.Max(limit * 2, 24))
            .Select(ParseSession)
            .Where(task => task is not null)
            .Cast<VibeTask>()
            .OrderByDescending(task => task.UpdatedAt)
            .Take(limit)
            .ToList();
    }

    private static VibeTask? ParseSession(FileInfo file)
    {
        var lines = TailLines(file.FullName, 1024 * 1024);
        if (lines.Count == 0) return null;
        var cwd = "";
        var title = "";
        var fallback = "";
        var state = TaskState.Idle;
        var assistantText = "";

        foreach (var line in lines)
        {
            try
            {
                using var document = JsonDocument.Parse(line);
                var root = document.RootElement;
                var type = String(root, "type");
                var value = String(root, "cwd");
                if (!string.IsNullOrWhiteSpace(value)) cwd = value;
                switch (type)
                {
                    case "ai-title":
                        value = String(root, "aiTitle");
                        if (!string.IsNullOrWhiteSpace(value)) title = value;
                        break;
                    case "agent-name":
                        value = String(root, "agentName");
                        if (string.IsNullOrWhiteSpace(title) && !string.IsNullOrWhiteSpace(value)) title = value;
                        break;
                    case "last-prompt":
                        value = String(root, "lastPrompt");
                        if (!string.IsNullOrWhiteSpace(value)) fallback = value;
                        break;
                    case "user":
                        if (!Bool(root, "isMeta")) state = TaskState.Active;
                        break;
                    case "assistant":
                        if (Bool(root, "isApiErrorMessage") || root.TryGetProperty("error", out _))
                        {
                            state = TaskState.Error;
                            break;
                        }
                        if (!root.TryGetProperty("message", out var message)) break;
                        var usesTool = false;
                        var asksUser = false;
                        var text = new StringBuilder();
                        if (message.TryGetProperty("content", out var content) &&
                            content.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var item in content.EnumerateArray())
                            {
                                var itemType = String(item, "type");
                                if (itemType == "tool_use")
                                {
                                    usesTool = true;
                                    var name = String(item, "name");
                                    if (name is "AskUserQuestion" or "ask_user_question") asksUser = true;
                                }
                                if (itemType == "text") text.AppendLine(String(item, "text"));
                            }
                        }
                        if (text.Length > 0) assistantText = text.ToString().Trim();
                        if (asksUser) state = TaskState.NeedsInput;
                        else if (usesTool) state = TaskState.Active;
                        else if (!string.IsNullOrEmpty(String(message, "stop_reason")))
                            state = assistantText.EndsWith('?') || assistantText.EndsWith('？')
                                ? TaskState.NeedsInput : TaskState.Idle;
                        else state = TaskState.Active;
                        break;
                }
            }
            catch { }
        }
        if (state == TaskState.Active && DateTime.UtcNow - file.LastWriteTimeUtc > TimeSpan.FromMinutes(5))
            state = TaskState.Idle;
        if (string.IsNullOrWhiteSpace(title)) title = fallback;
        if (string.IsNullOrWhiteSpace(title)) title = "Claude 任务";
        return new VibeTask(
            Path.GetFileNameWithoutExtension(file.Name),
            title,
            cwd,
            state,
            TaskProvider.Claude,
            file.LastWriteTimeUtc);
    }

    internal static (string Model, string Effort) ReadConfiguration()
    {
        using var document = ReadDocument(SettingsPath);
        if (document is null) return ("sonnet", "high");
        return (
            String(document.RootElement, "model") is { Length: > 0 } model ? model : "sonnet",
            String(document.RootElement, "effortLevel") is { Length: > 0 } effort ? effort : "high"
        );
    }

    internal static void WriteConfiguration(string key, string value)
    {
        var data = ReadDictionary(SettingsPath);
        data[key] = JsonSerializer.SerializeToElement(value);
        Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
        File.WriteAllText(SettingsPath, JsonSerializer.Serialize(data, PrettyJSON), new UTF8Encoding(false));
    }

    internal static (double? FiveHour, double? SevenDay) ReadUsage()
    {
        using var document = ReadDocument(UsagePath);
        if (document is null ||
            !document.RootElement.TryGetProperty("rate_limits", out var limits))
            return (null, null);
        return (UsedPercent(limits, "five_hour"), UsedPercent(limits, "seven_day"));
    }

    internal static void InstallUsageCapture()
    {
        var appRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Vibe Float");
        Directory.CreateDirectory(appRoot);
        var scriptPath = Path.Combine(appRoot, "claude-status.ps1");
        var cachePath = UsagePath.Replace("'", "''");
        File.WriteAllText(scriptPath, $$"""
            param([string]$NextBase64 = "")
            $json = [Console]::In.ReadToEnd()
            [IO.File]::WriteAllText('{{cachePath}}', $json, [Text.UTF8Encoding]::new($false))
            if ($NextBase64) {
              $next = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($NextBase64))
              if ($next) { $json | & cmd.exe /d /s /c $next }
            }
            """, new UTF8Encoding(false));

        var settings = ReadDictionary(SettingsPath);
        var original = "";
        if (settings.TryGetValue("statusLine", out var status) &&
            status.ValueKind == JsonValueKind.Object &&
            status.TryGetProperty("command", out var command))
            original = command.GetString() ?? "";
        if (original.Contains("claude-status.ps1", StringComparison.OrdinalIgnoreCase)) return;
        var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(original));
        var wrapper = $"powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"{scriptPath}\" -NextBase64 \"{encoded}\"";
        var statusValues = status.ValueKind == JsonValueKind.Object
            ? status.EnumerateObject().ToDictionary(item => item.Name, item => item.Value.Clone())
            : [];
        statusValues["type"] = JsonSerializer.SerializeToElement("command");
        statusValues["command"] = JsonSerializer.SerializeToElement(wrapper);
        if (!statusValues.ContainsKey("padding"))
            statusValues["padding"] = JsonSerializer.SerializeToElement(0);
        settings["statusLine"] = JsonSerializer.SerializeToElement(statusValues);
        Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
        File.WriteAllText(SettingsPath, JsonSerializer.Serialize(settings, PrettyJSON), new UTF8Encoding(false));
    }

    private static double? UsedPercent(JsonElement limits, string name) =>
        limits.TryGetProperty(name, out var window) &&
        window.TryGetProperty("used_percentage", out var value) &&
        value.TryGetDouble(out var number) ? number : null;

    private static List<string> TailLines(string path, int maxBytes)
    {
        using var stream = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        var length = (int)Math.Min(stream.Length, maxBytes);
        stream.Seek(-length, SeekOrigin.End);
        var buffer = new byte[length];
        _ = stream.Read(buffer);
        var text = Encoding.UTF8.GetString(buffer);
        var lines = text.Split('\n', StringSplitOptions.RemoveEmptyEntries).ToList();
        if (stream.Length > maxBytes && lines.Count > 0) lines.RemoveAt(0);
        return lines;
    }

    private static JsonDocument? ReadDocument(string path)
    {
        try { return File.Exists(path) ? JsonDocument.Parse(File.ReadAllText(path)) : null; }
        catch { return null; }
    }

    private static Dictionary<string, JsonElement> ReadDictionary(string path)
    {
        try
        {
            return File.Exists(path)
                ? JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(File.ReadAllText(path)) ?? []
                : [];
        }
        catch { return []; }
    }

    private static string String(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object &&
        element.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";

    private static bool Bool(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) &&
        value.ValueKind is JsonValueKind.True;

    private static readonly JsonSerializerOptions PrettyJSON = new() { WriteIndented = true };
}
