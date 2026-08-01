using System.IO;
using System.Text;

namespace CodexFloat;

internal static class StartupDiagnostics
{
    private static readonly object Sync = new();

    internal static string LogPath { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Vibe Float",
        "startup.log");

    internal static void Write(string message, Exception? error = null)
    {
        try
        {
            lock (Sync)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
                var text = new StringBuilder()
                    .Append(DateTimeOffset.Now.ToString("O"))
                    .Append("  ")
                    .AppendLine(message);
                if (error is not null) text.AppendLine(error.ToString());
                File.AppendAllText(LogPath, text.ToString(), new UTF8Encoding(false));
            }
        }
        catch
        {
            // Diagnostics must never become another startup failure.
        }
    }
}
