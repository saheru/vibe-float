using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace CodexFloat;

public partial class MainWindow : Window
{
    private readonly CodexClient _codex = new();
    private readonly DispatcherTimer _taskTimer = new() { Interval = TimeSpan.FromMilliseconds(800) };
    private readonly DispatcherTimer _claudeTimer = new() { Interval = TimeSpan.FromSeconds(2) };
    private readonly DispatcherTimer _metadataTimer = new() { Interval = TimeSpan.FromSeconds(3) };
    private readonly List<VibeTask> _tasks = [];
    private readonly List<VibeTask> _codexTasks = [];
    private readonly List<VibeTask> _claudeTasks = [];
    private List<string> _solEfforts = ["low", "medium", "high", "xhigh"];
    private string? _solModel;
    private string _effort = "medium";
    private string _claudeModel = "sonnet";
    private string _claudeEffort = "high";
    private bool _codexConnected;
    private bool _refreshingTasks;
    private bool _refreshingMetadata;
    private bool _refreshingClaude;
    private HashSet<string> _enabledModules = [];
    private int _taskCount = 3;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += async (_, _) => await StartAsync();
        _taskTimer.Tick += async (_, _) => await RefreshTasksAsync();
        _claudeTimer.Tick += async (_, _) => await RefreshClaudeAsync();
        _metadataTimer.Tick += async (_, _) => await RefreshMetadataAsync();
        LoadModuleSettings();
        LoadTaskCount();
        RenderEmptyTasks();
        RenderEffort();
        RenderUsage(null, CodexFiveHourUsageText, CodexFiveHourUsageArc);
        RenderUsage(null, CodexUsageText, CodexUsageArc);
        RenderUsage(null, ClaudeUsageText, ClaudeUsageArc);
        RenderClaudeControls();
        ApplyModuleLayout(true);
    }

    private async Task StartAsync()
    {
        _taskTimer.Start();
        _claudeTimer.Start();
        _metadataTimer.Start();
        try
        {
            await RefreshClaudeAsync();
            await _codex.StartAsync();
            _codexConnected = true;
            await RefreshAsync();
            StartupDiagnostics.Write("Codex app-server connected");
        }
        catch (Exception error)
        {
            _codexConnected = false;
            Title = $"Vibe Float — Codex: {error.Message}";
            RenderDisconnected();
            MergeTasks();
            StartupDiagnostics.Write("Started without Codex connection", error);
        }
    }

    private async Task RefreshAsync()
    {
        await Task.WhenAll(RefreshTasksAsync(), RefreshMetadataAsync());
    }

    private async Task RefreshTasksAsync()
    {
        if (!_codexConnected) return;
        if (_refreshingTasks) return;
        _refreshingTasks = true;
        try
        {
            var result = await _codex.RequestAsync("thread/list", new
            {
                limit = 16,
                sortKey = "updated_at",
                sortDirection = "desc",
                archived = false,
                useStateDbOnly = true
            });
            ApplyThreads(result);
            Title = "Vibe Float";
        }
        catch (Exception error)
        {
            Title = $"Vibe Float — Codex: {error.Message}";
        }
        finally
        {
            _refreshingTasks = false;
        }
    }

    private async Task RefreshMetadataAsync()
    {
        if (!_codexConnected) return;
        if (_refreshingMetadata) return;
        _refreshingMetadata = true;
        try
        {
            var modelsTask = _codex.RequestAsync("model/list", new { limit = 100, includeHidden = false });
            var configTask = _codex.RequestAsync("config/read", new { includeLayers = false });
            var usageTask = _codex.RequestAsync("account/rateLimits/read", new { });
            await Task.WhenAll(modelsTask, configTask, usageTask);
            ApplyModels(modelsTask.Result, configTask.Result);
            RenderUsage(ExtractFiveHour(usageTask.Result), CodexFiveHourUsageText, CodexFiveHourUsageArc);
            RenderUsage(ExtractWeek(usageTask.Result), CodexUsageText, CodexUsageArc);
        }
        catch (Exception error)
        {
            Title = $"Vibe Float — Codex: {error.Message}";
        }
        finally
        {
            _refreshingMetadata = false;
        }
    }

    private void ApplyModels(JsonElement modelResult, JsonElement configResult)
    {
        if (modelResult.TryGetProperty("data", out var models))
        {
            foreach (var model in models.EnumerateArray())
            {
                var id = String(model, "model");
                var display = String(model, "displayName");
                if (id == "gpt-5.6-sol" || $"{id} {display}".Contains("sol", StringComparison.OrdinalIgnoreCase))
                {
                    _solModel = id;
                    if (model.TryGetProperty("supportedReasoningEfforts", out var supported))
                    {
                        var values = supported.EnumerateArray()
                            .Select(item => String(item, "reasoningEffort"))
                            .Where(value => !string.IsNullOrEmpty(value))
                            .ToList();
                        if (values.Count > 0) _solEfforts = values;
                    }
                    break;
                }
            }
        }
        if (configResult.TryGetProperty("config", out var config))
        {
            var configured = String(config, "model_reasoning_effort");
            if (_solEfforts.Contains(configured)) _effort = configured;
        }
        RenderEffort();
    }

    private void ApplyThreads(JsonElement result)
    {
        _codexTasks.Clear();
        if (result.TryGetProperty("data", out var data))
        {
            foreach (var thread in data.EnumerateArray())
            {
                if (thread.TryGetProperty("parentThreadId", out var parent) && parent.ValueKind != JsonValueKind.Null) continue;
                var id = String(thread, "id");
                if (string.IsNullOrEmpty(id)) continue;
                var cwd = String(thread, "cwd");
                var title = String(thread, "name");
                if (string.IsNullOrEmpty(title)) title = String(thread, "preview");
                var updated = Number(thread, "updatedAt") is { } seconds
                    ? DateTimeOffset.FromUnixTimeSeconds((long)seconds).UtcDateTime
                    : DateTime.UtcNow;
                _codexTasks.Add(new VibeTask(id, title, cwd, InferState(thread), TaskProvider.Codex, updated));
                if (_codexTasks.Count == 16) break;
            }
        }
        MergeTasks();
    }

    private async Task RefreshClaudeAsync()
    {
        if (_refreshingClaude) return;
        _refreshingClaude = true;
        try
        {
            var snapshot = await Task.Run(() => (
                Tasks: ClaudeSupport.ScanSessions(8),
                Config: ClaudeSupport.ReadConfiguration(),
                Usage: ClaudeSupport.ReadUsage()
            ));
            _claudeTasks.Clear();
            _claudeTasks.AddRange(snapshot.Tasks);
            _claudeModel = snapshot.Config.Model;
            _claudeEffort = snapshot.Config.Effort;
            RenderClaudeControls();
            RenderUsage(snapshot.Usage.SevenDay, ClaudeUsageText, ClaudeUsageArc);
            MergeTasks();
        }
        finally
        {
            _refreshingClaude = false;
        }
    }

    private void MergeTasks()
    {
        _tasks.Clear();
        _tasks.AddRange(_codexTasks
            .Concat(_claudeTasks)
            .OrderByDescending(task => task.UpdatedAt)
            .Take(8));
        for (var index = 0; index < 8; index++)
            RenderTask(index, index < _tasks.Count ? _tasks[index] : null);
    }

    private async void ClaudeModel_Click(object sender, RoutedEventArgs e)
    {
        var choices = new[] { _claudeModel }.Concat(ClaudeSupport.Models).Distinct().ToList();
        var next = choices[(Math.Max(0, choices.IndexOf(_claudeModel)) + 1) % choices.Count];
        await Task.Run(() => ClaudeSupport.WriteConfiguration("model", next));
        _claudeModel = next;
        RenderClaudeControls();
    }

    private async void ClaudeEffort_Click(object sender, RoutedEventArgs e)
    {
        var choices = ClaudeSupport.Efforts.ToList();
        var next = choices[(Math.Max(0, choices.IndexOf(_claudeEffort)) + 1) % choices.Count];
        await Task.Run(() => ClaudeSupport.WriteConfiguration("effortLevel", next));
        _claudeEffort = next;
        RenderClaudeControls();
    }

    private void RenderClaudeControls()
    {
        ClaudeModelText.Text = ShortClaudeModel(_claudeModel);
        var color = _claudeEffort.ToLowerInvariant() switch
        {
            "low" => "#53D68A",
            "medium" => "#35A7FF",
            "high" => "#FFBD45",
            "xhigh" => "#FF7A59",
            "max" => "#FF5F6D",
            _ => "#B77CFF"
        };
        ClaudeEffortText.Text = _claudeEffort.ToUpperInvariant();
        ClaudeEffortText.Foreground = Brush(color);
        ClaudeEffortPill.BorderBrush = Brush(color);
        ClaudeEffortPill.Background = Brush($"20{color[1..]}");
    }

    private static string ShortClaudeModel(string model)
    {
        foreach (var name in new[] { "fable", "opus", "sonnet", "haiku" })
            if (model.Contains(name, StringComparison.OrdinalIgnoreCase))
                return name.ToUpperInvariant();
        return new string(model.Take(8).ToArray()).ToUpperInvariant();
    }

    private async void EnableClaudeUsage_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            await Task.Run(ClaudeSupport.InstallUsageCapture);
            MessageBox.Show(
                "Claude Usage 采集已启用。重启正在运行的 Claude Code 会话后，5h/周限额会自动同步。",
                "Vibe Float",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Vibe Float", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private string ModuleSettingsPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "Vibe Float", "modules.json");
    private string TaskCountPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "Vibe Float", "task-count.txt");
    private string CodexFiveHourMigrationPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "Vibe Float", "codex-5h-added.flag");

    private void LoadModuleSettings()
    {
        try
        {
            if (File.Exists(ModuleSettingsPath))
                _enabledModules = JsonSerializer.Deserialize<HashSet<string>>(
                    File.ReadAllText(ModuleSettingsPath)) ?? [];
        }
        catch { }
        if (_enabledModules.Count == 0)
            _enabledModules = [
                "codexEffort", "codexFiveHourUsage", "codexUsage",
                "claudeModel", "claudeEffort", "claudeUsage"
            ];
        else if (!File.Exists(CodexFiveHourMigrationPath))
        {
            _enabledModules.Add("codexFiveHourUsage");
            SaveModuleSettings();
        }
        Directory.CreateDirectory(Path.GetDirectoryName(CodexFiveHourMigrationPath)!);
        File.WriteAllText(CodexFiveHourMigrationPath, "1");
    }

    private void LoadTaskCount()
    {
        try
        {
            if (File.Exists(TaskCountPath) &&
                int.TryParse(File.ReadAllText(TaskCountPath), out var count))
                _taskCount = Math.Clamp(count, 1, 8);
        }
        catch { }
        UpdateTaskCountMenu();
    }

    private void SaveModuleSettings()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(ModuleSettingsPath)!);
        File.WriteAllText(ModuleSettingsPath, JsonSerializer.Serialize(_enabledModules));
    }

    private void ModuleToggle_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not MenuItem { Tag: string key } item) return;
        if (item.IsChecked) _enabledModules.Add(key);
        else if (_enabledModules.Count > 1) _enabledModules.Remove(key);
        else item.IsChecked = true;
        SaveModuleSettings();
        ApplyModuleLayout(true);
    }

    private void TaskCount_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not MenuItem { Tag: string tag } || !int.TryParse(tag, out var count)) return;
        _taskCount = Math.Clamp(count, 1, 8);
        Directory.CreateDirectory(Path.GetDirectoryName(TaskCountPath)!);
        File.WriteAllText(TaskCountPath, _taskCount.ToString());
        UpdateTaskCountMenu();
        ApplyModuleLayout(true);
    }

    private void UpdateTaskCountMenu()
    {
        var items = new[]
        {
            TaskCount1, TaskCount2, TaskCount3, TaskCount4,
            TaskCount5, TaskCount6, TaskCount7, TaskCount8
        };
        for (var index = 0; index < items.Length; index++)
            items[index].IsChecked = index + 1 == _taskCount;
    }

    private void ApplyModuleLayout(bool resize)
    {
        var entries = new (string Key, FrameworkElement View, MenuItem Menu)[]
        {
            ("codexEffort", EffortButton, ModuleCodexEffort),
            ("codexFiveHourUsage", CodexFiveHourUsageButton, ModuleCodexFiveHourUsage),
            ("codexUsage", CodexUsageButton, ModuleCodexUsage),
            ("claudeModel", ClaudeModelButton, ModuleClaudeModel),
            ("claudeEffort", ClaudeEffortButton, ModuleClaudeEffort),
            ("claudeUsage", ClaudeUsageButton, ModuleClaudeUsage)
        };
        foreach (var entry in entries)
        {
            var enabled = _enabledModules.Contains(entry.Key);
            entry.View.Visibility = enabled ? Visibility.Visible : Visibility.Collapsed;
            entry.Menu.IsChecked = enabled;
        }
        var taskButtons = new FrameworkElement[]
        {
            TaskButton0, TaskButton1, TaskButton2, TaskButton3,
            TaskButton4, TaskButton5, TaskButton6, TaskButton7
        };
        for (var index = 0; index < taskButtons.Length; index++)
            taskButtons[index].Visibility = index < _taskCount ? Visibility.Visible : Visibility.Collapsed;

        var count = Math.Max(1, _taskCount + entries.Count(entry => _enabledModules.Contains(entry.Key)));
        var columns = count <= 5 ? count : Math.Min(5, (int)Math.Ceiling(count / 2d));
        var rows = (int)Math.Ceiling(count / (double)columns);
        ModuleGrid.Columns = columns;
        ModuleGrid.Rows = rows;
        if (resize)
        {
            Width = Math.Max(300, columns * 150 + 32);
            Height = Math.Max(175, rows * 180 + 32);
        }
    }

    private static TaskState InferState(JsonElement thread)
    {
        if (thread.TryGetProperty("status", out var status))
        {
            if (status.TryGetProperty("activeFlags", out var flags) &&
                flags.EnumerateArray().Any(flag =>
                    new[] { "waitingOnApproval", "waitingOnUserInput", "needsInput" }.Contains(flag.GetString())))
                return TaskState.NeedsInput;
            var type = String(status, "type");
            if (!string.IsNullOrEmpty(type) && type != "notLoaded")
                return type switch
                {
                    "active" => TaskState.Active,
                    "idle" => TaskState.Idle,
                    "systemError" => TaskState.Error,
                    _ => TaskState.Waiting
                };
        }
        return TaskState.Idle;
    }

    private async void Effort_Click(object sender, RoutedEventArgs e)
    {
        if (_solModel is null || _solEfforts.Count == 0) return;
        var current = Math.Max(0, _solEfforts.IndexOf(_effort));
        var next = _solEfforts[(current + 1) % _solEfforts.Count];
        try
        {
            await _codex.RequestAsync("config/batchWrite", new
            {
                edits = new object[]
                {
                    new { keyPath = "model", value = _solModel, mergeStrategy = "upsert" },
                    new { keyPath = "model_reasoning_effort", value = next, mergeStrategy = "upsert" }
                },
                reloadUserConfig = true
            });
            _effort = next;
            RenderEffort();
        }
        catch (Exception error)
        {
            Title = $"Vibe Float — Codex: {error.Message}";
        }
    }

    private void Task_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: string tag } || !int.TryParse(tag, out var index) || index >= _tasks.Count) return;
        var task = _tasks[index];
        if (task.Provider == TaskProvider.Codex)
        {
            Process.Start(new ProcessStartInfo($"codex://threads/{Uri.EscapeDataString(task.Id)}")
            {
                UseShellExecute = true
            });
            return;
        }
        var cwd = string.IsNullOrWhiteSpace(task.Cwd)
            ? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
            : task.Cwd;
        Process.Start(new ProcessStartInfo("cmd.exe",
            $"/d /s /c start \"Claude\" cmd.exe /k \"cd /d \\\"{cwd}\\\" && claude --resume \\\"{task.Id}\\\"\"")
        {
            UseShellExecute = false,
            CreateNoWindow = true
        });
    }

    private void RenderTask(int index, VibeTask? task)
    {
        var button = new[] { TaskButton0, TaskButton1, TaskButton2, TaskButton3, TaskButton4, TaskButton5, TaskButton6, TaskButton7 }[index];
        var icon = new[] { TaskIcon0, TaskIcon1, TaskIcon2, TaskIcon3, TaskIcon4, TaskIcon5, TaskIcon6, TaskIcon7 }[index];
        var ring = new[] { TaskIconRing0, TaskIconRing1, TaskIconRing2, TaskIconRing3, TaskIconRing4, TaskIconRing5, TaskIconRing6, TaskIconRing7 }[index];
        var status = new[] { TaskStatus0, TaskStatus1, TaskStatus2, TaskStatus3, TaskStatus4, TaskStatus5, TaskStatus6, TaskStatus7 }[index];
        var project = new[] { TaskProject0, TaskProject1, TaskProject2, TaskProject3, TaskProject4, TaskProject5, TaskProject6, TaskProject7 }[index];
        if (task is null)
        {
            var gray = Brush("#8490A3");
            icon.Text = "○"; icon.Foreground = gray;
            ring.BorderBrush = gray; ring.Background = Brush("#208490A3");
            status.Text = "空闲"; project.Text = $"#{index + 1}";
            project.Foreground = gray; button.ToolTip = null;
            return;
        }
        var (glyph, label, color) = task.State switch
        {
            TaskState.Active => ("▶", "执行中", "#35A7FF"),
            TaskState.Idle => ("✓", "完成", "#53D68A"),
            TaskState.NeedsInput => ("?", "待回复", "#FFBD45"),
            TaskState.Error => ("!", "错误", "#FF5F6D"),
            _ => ("○", "等待", "#8490A3")
        };
        var brush = Brush(color);
        icon.Text = glyph; icon.Foreground = brush;
        ring.BorderBrush = brush; ring.Background = Brush($"20{color[1..]}");
        status.Text = label;
        var provider = task.Provider == TaskProvider.Claude ? "CLAUDE" : "CODEX";
        var providerColor = task.Provider == TaskProvider.Claude ? Brush("#F08C51") : Brush("#35A7FF");
        project.Text = $"{provider}·{ProjectCode(task.Cwd, provider)}"; project.Foreground = providerColor;
        button.ToolTip = $"[{(task.Provider == TaskProvider.Claude ? "Claude" : "Codex")}] {task.Title}";
    }

    private void RenderEffort()
    {
        var color = _effort.ToLowerInvariant() switch
        {
            "minimal" => "#8490A3",
            "low" => "#53D68A",
            "medium" => "#35A7FF",
            "high" => "#FFBD45",
            "xhigh" => "#FF7A59",
            "max" => "#FF5F6D",
            "ultra" => "#B77CFF",
            _ => "#4E9CFF"
        };
        EffortText.Text = _effort.ToUpperInvariant();
        EffortText.Foreground = Brush(color);
        EffortPill.BorderBrush = Brush(color);
        EffortPill.Background = Brush($"20{color[1..]}");
    }

    private static void RenderUsage(double? percent, TextBlock text, System.Windows.Shapes.Path arc)
    {
        text.Text = percent is null ? "N/A" : $"{Math.Round(percent.Value):0}%";
        if (percent is null)
        {
            arc.Data = null;
            return;
        }
        var color = percent >= 90 ? "#FF5F6D" : percent >= 70 ? "#FFBD45" : "#53D68A";
        arc.Stroke = Brush(color);
        arc.Data = ArcGeometry(percent.Value, 48, 48, 42);
    }

    private static Geometry ArcGeometry(double percent, double cx, double cy, double radius)
    {
        percent = Math.Clamp(percent, 0.001, 99.999);
        var start = new Point(cx, cy - radius);
        var angle = percent / 100 * Math.PI * 2;
        var end = new Point(cx + radius * Math.Sin(angle), cy - radius * Math.Cos(angle));
        var figure = new PathFigure { StartPoint = start, IsClosed = false };
        figure.Segments.Add(new ArcSegment(end, new Size(radius, radius), 0, percent > 50,
            SweepDirection.Clockwise, true));
        return new PathGeometry([figure]);
    }

    private static double? ExtractFiveHour(JsonElement result) =>
        ExtractWindow(result, 300, duration => duration > 0 && duration <= 600);

    private static double? ExtractWeek(JsonElement result) =>
        ExtractWindow(result, 10080, duration => duration > 600);

    private static double? ExtractWindow(JsonElement result, double targetMinutes, Func<double, bool> accepts)
    {
        var snapshots = new List<JsonElement>();
        if (result.TryGetProperty("rateLimits", out var canonical)) snapshots.Add(canonical);
        if (result.TryGetProperty("rateLimitsByLimitId", out var byId))
        {
            if (byId.TryGetProperty("codex", out var codex)) snapshots.Add(codex);
            snapshots.AddRange(byId.EnumerateObject().Where(item => item.Name != "codex").Select(item => item.Value));
        }
        return snapshots
            .SelectMany(snapshot => new[] { Property(snapshot, "primary"), Property(snapshot, "secondary") })
            .Where(window => window is { } value &&
                Number(value, "windowDurationMins") is { } duration && accepts(duration))
            .OrderBy(window => Math.Abs(Number(window!.Value, "windowDurationMins")!.Value - targetMinutes))
            .Select(window => Number(window!.Value, "usedPercent"))
            .FirstOrDefault();
    }

    private static JsonElement? Property(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) ? value : null;

    private static double? Number(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.TryGetDouble(out var number) ? number : null;

    private static string String(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";

    private static string ProjectCode(string cwd, string fallback = "CX")
    {
        var name = string.IsNullOrWhiteSpace(cwd) ? fallback : Path.GetFileName(cwd.TrimEnd('\\', '/'));
        return new string(name.Take(4).ToArray()).ToUpperInvariant();
    }

    private static SolidColorBrush Brush(string hex) =>
        new((Color)ColorConverter.ConvertFromString(hex));

    private void RenderEmptyTasks()
    {
        for (var index = 0; index < 8; index++) RenderTask(index, null);
    }

    private void RenderDisconnected()
    {
        RenderEmptyTasks();
        EffortText.Text = "离线";
        CodexFiveHourUsageText.Text = "离线";
        CodexUsageText.Text = "离线";
    }

    private void Window_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.OriginalSource is DependencyObject source &&
            (FindParent<Button>(source) is not null || FindParent<System.Windows.Controls.Primitives.Thumb>(source) is not null))
            return;
        if (e.LeftButton == MouseButtonState.Pressed) DragMove();
    }

    private static T? FindParent<T>(DependencyObject? current) where T : DependencyObject
    {
        while (current is not null)
        {
            if (current is T match) return match;
            current = VisualTreeHelper.GetParent(current);
        }
        return null;
    }

    private void ResizeThumb_DragDelta(object sender, System.Windows.Controls.Primitives.DragDeltaEventArgs e)
    {
        Width = Math.Max(MinWidth, Width + e.HorizontalChange);
        Height = Math.Max(MinHeight, Height + e.VerticalChange);
    }

    private async void Refresh_Click(object sender, RoutedEventArgs e) => await RefreshAsync();
    private void Exit_Click(object sender, RoutedEventArgs e) => Close();
    private async void Window_Closed(object? sender, EventArgs e)
    {
        _taskTimer.Stop();
        _claudeTimer.Stop();
        _metadataTimer.Stop();
        await _codex.DisposeAsync();
    }

}
