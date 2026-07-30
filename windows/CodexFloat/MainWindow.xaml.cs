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
    private readonly DispatcherTimer _metadataTimer = new() { Interval = TimeSpan.FromSeconds(3) };
    private readonly List<TaskCard> _tasks = [];
    private List<string> _solEfforts = ["low", "medium", "high", "xhigh"];
    private string? _solModel;
    private string _effort = "medium";
    private bool _refreshingTasks;
    private bool _refreshingMetadata;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += async (_, _) => await StartAsync();
        _taskTimer.Tick += async (_, _) => await RefreshTasksAsync();
        _metadataTimer.Tick += async (_, _) => await RefreshMetadataAsync();
        RenderEmptyTasks();
        RenderEffort();
        RenderUsage(null);
    }

    private async Task StartAsync()
    {
        try
        {
            await _codex.StartAsync();
            await RefreshAsync();
            _taskTimer.Start();
            _metadataTimer.Start();
        }
        catch (Exception error)
        {
            Title = $"Codex Float — {error.Message}";
            RenderDisconnected();
        }
    }

    private async Task RefreshAsync()
    {
        await Task.WhenAll(RefreshTasksAsync(), RefreshMetadataAsync());
    }

    private async Task RefreshTasksAsync()
    {
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
            Title = "Codex Float";
        }
        catch (Exception error)
        {
            Title = $"Codex Float — {error.Message}";
        }
        finally
        {
            _refreshingTasks = false;
        }
    }

    private async Task RefreshMetadataAsync()
    {
        if (_refreshingMetadata) return;
        _refreshingMetadata = true;
        try
        {
            var modelsTask = _codex.RequestAsync("model/list", new { limit = 100, includeHidden = false });
            var configTask = _codex.RequestAsync("config/read", new { includeLayers = false });
            var usageTask = _codex.RequestAsync("account/rateLimits/read", new { });
            await Task.WhenAll(modelsTask, configTask, usageTask);
            ApplyModels(modelsTask.Result, configTask.Result);
            RenderUsage(ExtractWeek(usageTask.Result));
        }
        catch (Exception error)
        {
            Title = $"Codex Float — {error.Message}";
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
        _tasks.Clear();
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
                _tasks.Add(new TaskCard(id, title, cwd, InferState(thread)));
                if (_tasks.Count == 3) break;
            }
        }
        for (var index = 0; index < 3; index++) RenderTask(index, index < _tasks.Count ? _tasks[index] : null);
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
            Title = $"Codex Float — {error.Message}";
        }
    }

    private void Task_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: string tag } || !int.TryParse(tag, out var index) || index >= _tasks.Count) return;
        Process.Start(new ProcessStartInfo($"codex://threads/{Uri.EscapeDataString(_tasks[index].Id)}")
        {
            UseShellExecute = true
        });
    }

    private void RenderTask(int index, TaskCard? task)
    {
        var button = new[] { TaskButton0, TaskButton1, TaskButton2 }[index];
        var icon = new[] { TaskIcon0, TaskIcon1, TaskIcon2 }[index];
        var ring = new[] { TaskIconRing0, TaskIconRing1, TaskIconRing2 }[index];
        var status = new[] { TaskStatus0, TaskStatus1, TaskStatus2 }[index];
        var project = new[] { TaskProject0, TaskProject1, TaskProject2 }[index];
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
        project.Text = ProjectCode(task.Cwd); project.Foreground = brush;
        button.ToolTip = task.Title;
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

    private void RenderUsage(double? percent)
    {
        UsageText.Text = percent is null ? "N/A" : $"{Math.Round(percent.Value):0}%";
        if (percent is null)
        {
            UsageArc.Data = null;
            return;
        }
        var color = percent >= 90 ? "#FF5F6D" : percent >= 70 ? "#FFBD45" : "#53D68A";
        UsageArc.Stroke = Brush(color);
        UsageArc.Data = ArcGeometry(percent.Value, 48, 48, 42);
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

    private static double? ExtractWeek(JsonElement result)
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
                Number(value, "windowDurationMins") is > 600)
            .OrderBy(window => Math.Abs(Number(window!.Value, "windowDurationMins")!.Value - 10080))
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

    private static string ProjectCode(string cwd)
    {
        var name = string.IsNullOrWhiteSpace(cwd) ? "CODEX" : Path.GetFileName(cwd.TrimEnd('\\', '/'));
        return new string(name.Take(4).ToArray()).ToUpperInvariant();
    }

    private static SolidColorBrush Brush(string hex) =>
        new((Color)ColorConverter.ConvertFromString(hex));

    private void RenderEmptyTasks()
    {
        for (var index = 0; index < 3; index++) RenderTask(index, null);
    }

    private void RenderDisconnected()
    {
        RenderEmptyTasks();
        EffortText.Text = "离线";
        UsageText.Text = "离线";
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
        _metadataTimer.Stop();
        await _codex.DisposeAsync();
    }

    private sealed record TaskCard(string Id, string Title, string Cwd, TaskState State);
    private enum TaskState { Active, Idle, NeedsInput, Error, Waiting }
}
