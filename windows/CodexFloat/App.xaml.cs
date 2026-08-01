using System.Windows;
using System.Windows.Threading;

namespace CodexFloat;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        StartupDiagnostics.Write($"Starting Vibe Float {typeof(App).Assembly.GetName().Version}");
        DispatcherUnhandledException += OnDispatcherUnhandledException;
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
            StartupDiagnostics.Write("Unhandled AppDomain exception", args.ExceptionObject as Exception);
        TaskScheduler.UnobservedTaskException += (_, args) =>
        {
            StartupDiagnostics.Write("Unobserved task exception", args.Exception);
            args.SetObserved();
        };

        try
        {
            var window = new MainWindow();
            MainWindow = window;
            window.Show();
            StartupDiagnostics.Write("Main window shown");
        }
        catch (Exception error)
        {
            StartupDiagnostics.Write("Startup failed", error);
            MessageBox.Show(
                $"Vibe Float 启动失败。\n\n{error.Message}\n\n诊断日志：\n{StartupDiagnostics.LogPath}",
                "Vibe Float",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    private static void OnDispatcherUnhandledException(
        object sender,
        DispatcherUnhandledExceptionEventArgs args)
    {
        StartupDiagnostics.Write("UI exception", args.Exception);
        MessageBox.Show(
            $"Vibe Float 遇到错误：\n{args.Exception.Message}\n\n诊断日志：\n{StartupDiagnostics.LogPath}",
            "Vibe Float",
            MessageBoxButton.OK,
            MessageBoxImage.Error);
        args.Handled = true;
    }
}
