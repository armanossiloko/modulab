namespace Modulab.ControlCenter.Infrastructure;

/// <summary>Runs scripts/*.sh through run_bash.py so Windows CRLF checkouts work inside Linux bash.</summary>
public sealed class LabScripts(LabPaths paths, ICommandRunner runner, ILogger<LabScripts> log)
{
    public async Task RunAsync(string script, params string[] args) =>
        await RunAsync(script, args, onLine: null);

    public async Task RunAsync(
        string script,
        IReadOnlyList<string> args,
        Action<string>? onLine,
        CancellationToken ct = default)
    {
        var bashRunner = Path.Combine(paths.Scripts, "run_bash.py");
        if (!File.Exists(bashRunner))
            throw new InvalidOperationException($"Missing {bashRunner}");
        var scriptPath = Path.Combine(paths.Scripts, script);
        if (!File.Exists(scriptPath))
            throw new InvalidOperationException($"Missing {scriptPath}");

        var argv = new List<string> { bashRunner, script };
        argv.AddRange(args);

        if (onLine is null)
        {
            var result = await runner.RunAsync("python3", argv, paths.Root, ct: ct);
            if (!result.Ok)
                throw new InvalidOperationException(
                    $"bash {script} failed ({result.Exit}): {result.StdErr}\n{result.StdOut}".Trim());
            return;
        }

        var exit = await runner.StreamAsync("python3", argv, paths.Root, onLine, ct);
        if (exit != 0)
            throw new InvalidOperationException($"bash {script} failed ({exit})");
    }

    /// <summary>Run scripts/&lt;script&gt; with python3, streaming output. Extra env stays out of argv.</summary>
    public async Task RunPythonAsync(
        string script,
        IReadOnlyList<string> args,
        IReadOnlyDictionary<string, string>? env,
        Action<string> onLine,
        CancellationToken ct = default)
    {
        var scriptPath = Path.Combine(paths.Scripts, script);
        if (!File.Exists(scriptPath))
            throw new InvalidOperationException($"Missing {scriptPath}");
        var argv = new List<string> { scriptPath };
        argv.AddRange(args);
        var tail = new Queue<string>();
        var exit = await runner.StreamAsync("python3", argv, paths.Root, line =>
        {
            tail.Enqueue(line);
            if (tail.Count > 5)
                tail.Dequeue();
            onLine(line);
        }, ct, env);
        if (exit != 0)
            throw new InvalidOperationException($"{script} failed ({exit}): {string.Join('\n', tail)}");
    }

    /// <summary>Run a script whose failure should be logged, not surfaced (edge refresh after install).</summary>
    public async Task TryRunAsync(string script, params string[] args)
    {
        try
        {
            await RunAsync(script, args);
        }
        catch (Exception ex)
        {
            log.LogWarning("{Script} {Args}: {Message}", script, string.Join(' ', args), ex.Message);
        }
    }
}
