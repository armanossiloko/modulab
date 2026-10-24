using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;

namespace Modulab.ControlCenter.Infrastructure;

public sealed record CommandResult(int Exit, string StdOut, string StdErr)
{
    public bool Ok => Exit == 0;
}

/// <summary>Runs host processes (docker, python3). Abstracted so tests can fake the CLI.</summary>
public interface ICommandRunner
{
    Task<CommandResult> RunAsync(
        string file,
        IReadOnlyList<string> args,
        string cwd,
        TimeSpan? timeout = null,
        CancellationToken ct = default,
        IReadOnlyDictionary<string, string>? env = null);

    /// <summary>Run and forward stdout + stderr line by line. Returns the exit code.</summary>
    Task<int> StreamAsync(
        string file,
        IReadOnlyList<string> args,
        string cwd,
        Action<string> onLine,
        CancellationToken ct = default,
        IReadOnlyDictionary<string, string>? env = null);
}

public sealed partial class CommandRunner : ICommandRunner
{
    [GeneratedRegex(@"\u001B\[[0-?]*[ -/]*[@-~]")]
    private static partial Regex AnsiRegex();

    public static string StripAnsi(string value) => AnsiRegex().Replace(value, "");

    static ProcessStartInfo StartInfo(
        string file,
        IReadOnlyList<string> args,
        string cwd,
        IReadOnlyDictionary<string, string>? env)
    {
        var psi = new ProcessStartInfo
        {
            FileName = file,
            WorkingDirectory = cwd,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var arg in args)
            psi.ArgumentList.Add(arg);
        if (env is not null)
        {
            foreach (var (key, value) in env)
                psi.Environment[key] = value;
        }
        return psi;
    }

    public async Task<CommandResult> RunAsync(
        string file,
        IReadOnlyList<string> args,
        string cwd,
        TimeSpan? timeout = null,
        CancellationToken ct = default,
        IReadOnlyDictionary<string, string>? env = null)
    {
        using var proc = Process.Start(StartInfo(file, args, cwd, env))
            ?? throw new InvalidOperationException($"Failed to start {file}");
        // Drain both pipes concurrently. Reading stdout to completion before stderr
        // deadlocks when the child fills the unread pipe (docker compose pull progress).
        var stdoutTask = proc.StandardOutput.ReadToEndAsync(CancellationToken.None);
        var stderrTask = proc.StandardError.ReadToEndAsync(CancellationToken.None);

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        if (timeout is { } limit)
            timeoutCts.CancelAfter(limit);
        try
        {
            await proc.WaitForExitAsync(timeoutCts.Token);
        }
        catch (OperationCanceledException)
        {
            try { proc.Kill(entireProcessTree: true); } catch { /* already gone */ }
            try { await Task.WhenAll(stdoutTask, stderrTask); } catch { /* ignore */ }
            if (ct.IsCancellationRequested)
                throw;
            throw new TimeoutException($"{file} timed out after {timeout!.Value.TotalMilliseconds:0}ms");
        }

        return new CommandResult(proc.ExitCode, await stdoutTask, await stderrTask);
    }

    public async Task<int> StreamAsync(
        string file,
        IReadOnlyList<string> args,
        string cwd,
        Action<string> onLine,
        CancellationToken ct = default,
        IReadOnlyDictionary<string, string>? env = null)
    {
        using var proc = Process.Start(StartInfo(file, args, cwd, env))
            ?? throw new InvalidOperationException($"Failed to start {file}");
        // Read both pipes at once. Docker writes pull progress on stderr; waiting for
        // stdout to close before reading stderr deadlocks the pull.
        var stdoutTask = PumpAsync(proc.StandardOutput, onLine, ct);
        var stderrTask = PumpAsync(proc.StandardError, onLine, ct);
        await proc.WaitForExitAsync(ct);
        await Task.WhenAll(stdoutTask, stderrTask);
        return proc.ExitCode;
    }

    static async Task PumpAsync(StreamReader reader, Action<string> onLine, CancellationToken ct)
    {
        var buffer = new char[1024];
        var pending = new StringBuilder();
        while (true)
        {
            var read = await reader.ReadAsync(buffer.AsMemory(), ct);
            if (read == 0)
                break;
            for (var i = 0; i < read; i++)
            {
                var ch = buffer[i];
                if (ch is '\n' or '\r')
                    FlushPending();
                else
                    pending.Append(ch);
            }
        }

        FlushPending();

        void FlushPending()
        {
            if (pending.Length == 0)
                return;
            var line = StripAnsi(pending.ToString()).Trim();
            pending.Clear();
            if (line.Length > 0)
                onLine(line);
        }
    }
}
