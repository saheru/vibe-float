using System.Windows;
using System.Windows.Threading;

namespace CodexFloat;

public partial class App : Application
{
    private bool _smokeTest;
    private Exception? _smokeTestFailure;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        _smokeTest = e.Args.Any(arg =>
            string.Equals(arg, "--smoke-test", StringComparison.OrdinalIgnoreCase));
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
            var window = new MainWindow(startServices: !_smokeTest);
            MainWindow = window;
            window.Show();
            StartupDiagnostics.Write("Main window shown");
            if (_smokeTest)
            {
                if (_smokeTestFailure is not null)
                    throw new InvalidOperationException("UI exception during smoke test", _smokeTestFailure);
                StartupDiagnostics.Write("Smoke test passed");
                window.Close();
                Shutdown(0);
            }
        }
        catch (Exception error)
        {
            StartupDiagnostics.Write("Startup failed", error);
            if (!_smokeTest)
            {
                MessageBox.Show(
                    $"Vibe Float 启动失败。\n\n{error.Message}\n\n诊断日志：\n{StartupDiagnostics.LogPath}",
                    "Vibe Float",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error);
            }
            Shutdown(1);
        }
    }

    private void OnDispatcherUnhandledException(
        object sender,
        DispatcherUnhandledExceptionEventArgs args)
    {
        StartupDiagnostics.Write("UI exception", args.Exception);
        if (_smokeTest)
        {
            _smokeTestFailure = args.Exception;
            args.Handled = true;
            return;
        }
        MessageBox.Show(
            $"Vibe Float 遇到错误：\n{args.Exception.Message}\n\n诊断日志：\n{StartupDiagnostics.LogPath}",
            "Vibe Float",
            MessageBoxButton.OK,
            MessageBoxImage.Error);
        args.Handled = true;
    }
}
