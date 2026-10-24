using System.Globalization;
using System.Text.Json;

namespace Modulab.ControlCenter.Infrastructure;

/// <summary>One row of <c>docker ps -a</c>.</summary>
public sealed record ContainerInfo(
    string Name,
    string State,
    string Status,
    string Image,
    string? Health)
{
    public bool IsUp => State is "running" or "restarting";
}

/// <summary>One row of <c>docker stats --no-stream</c>.</summary>
public sealed record ContainerStatsRow(
    string Name,
    double CpuPercent,
    long MemoryBytes,
    long MemoryLimitBytes,
    string NetIo,
    string BlockIo);

/// <summary>Thin wrapper over the docker CLI (the image ships the static client + compose plugin).</summary>
public sealed class DockerCli(LabPaths paths, ICommandRunner runner)
{
    static readonly TimeSpan Short = TimeSpan.FromSeconds(15);

    public async Task<IReadOnlyList<ContainerInfo>> ListContainersAsync(CancellationToken ct = default)
    {
        var result = await runner.RunAsync(
            "docker",
            ["ps", "-a", "--format", "{{.Names}}\t{{.State}}\t{{.Status}}\t{{.Image}}"],
            paths.Root,
            Short,
            ct);
        if (!result.Ok)
            throw new InvalidOperationException(Trimmed(result.StdErr, "docker ps failed"));
        return ParseContainerList(result.StdOut);
    }

    /// <summary>Containers, or an empty list when the daemon is unreachable.</summary>
    public async Task<IReadOnlyList<ContainerInfo>> TryListContainersAsync(CancellationToken ct = default)
    {
        try
        {
            return await ListContainersAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return [];
        }
    }

    public static IReadOnlyList<ContainerInfo> ParseContainerList(string output)
    {
        var list = new List<ContainerInfo>();
        foreach (var line in output.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = line.Split('\t');
            if (parts.Length < 2 || string.IsNullOrWhiteSpace(parts[0]))
                continue;
            var status = parts.Length > 2 ? parts[2].Trim() : "";
            list.Add(new ContainerInfo(
                parts[0].Trim(),
                parts[1].Trim().ToLowerInvariant(),
                status,
                parts.Length > 3 ? parts[3].Trim() : "",
                HealthFromStatus(status)));
        }
        return list;
    }

    /// <summary>Extract "healthy" / "unhealthy" / "starting" from a docker ps status column.</summary>
    public static string? HealthFromStatus(string status)
    {
        if (status.Contains("(unhealthy)", StringComparison.OrdinalIgnoreCase)) return "unhealthy";
        if (status.Contains("(healthy)", StringComparison.OrdinalIgnoreCase)) return "healthy";
        if (status.Contains("(health: starting)", StringComparison.OrdinalIgnoreCase)) return "starting";
        return null;
    }

    public async Task<bool> IsRunningAsync(string name, CancellationToken ct = default)
    {
        var containers = await TryListContainersAsync(ct);
        return containers.Any(c => c.Name == name && c.State == "running");
    }

    /// <summary>
    /// Match a recipe id to container names: exact, or the id as a dash/underscore separated segment
    /// (immich → immich_server, futo-notes → futo-notes-server).
    /// </summary>
    public static bool MatchesRecipe(string containerName, string recipeId) =>
        containerName.Equals(recipeId, StringComparison.OrdinalIgnoreCase)
        || containerName.StartsWith(recipeId + "-", StringComparison.OrdinalIgnoreCase)
        || containerName.StartsWith(recipeId + "_", StringComparison.OrdinalIgnoreCase)
        || containerName.Contains("-" + recipeId + "-", StringComparison.OrdinalIgnoreCase)
        || containerName.Contains("_" + recipeId + "_", StringComparison.OrdinalIgnoreCase)
        || containerName.EndsWith("-" + recipeId, StringComparison.OrdinalIgnoreCase)
        || containerName.EndsWith("_" + recipeId, StringComparison.OrdinalIgnoreCase);

    public static IReadOnlyList<ContainerInfo> ForRecipe(IEnumerable<ContainerInfo> containers, string recipeId) =>
        containers.Where(c => MatchesRecipe(c.Name, recipeId)).ToList();

    public async Task<JsonElement?> InspectImageAsync(string imageRef, CancellationToken ct = default)
    {
        var result = await runner.RunAsync(
            "docker",
            ["image", "inspect", imageRef, "--format", "{{json .}}"],
            paths.Root,
            TimeSpan.FromSeconds(20),
            ct);
        if (!result.Ok || string.IsNullOrWhiteSpace(result.StdOut))
            return null;
        using var doc = JsonDocument.Parse(result.StdOut);
        var root = doc.RootElement;
        if (root.ValueKind == JsonValueKind.Array && root.GetArrayLength() > 0)
            root = root[0];
        return root.Clone();
    }

    public async Task<CommandResult> RunAsync(IReadOnlyList<string> args, TimeSpan? timeout = null, CancellationToken ct = default) =>
        await runner.RunAsync("docker", args, paths.Root, timeout ?? Short, ct);

    public async Task<IReadOnlyList<ContainerStatsRow>> StatsAsync(CancellationToken ct = default)
    {
        var result = await runner.RunAsync(
            "docker",
            ["stats", "--no-stream", "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}"],
            paths.Root,
            TimeSpan.FromSeconds(30),
            ct);
        if (!result.Ok)
            throw new InvalidOperationException(Trimmed(result.StdErr, "docker stats failed"));
        return ParseStats(result.StdOut);
    }

    public static IReadOnlyList<ContainerStatsRow> ParseStats(string output)
    {
        var rows = new List<ContainerStatsRow>();
        foreach (var line in output.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = line.Split('\t');
            if (parts.Length < 5)
                continue;
            var cpu = double.TryParse(parts[1].Trim().TrimEnd('%'), NumberStyles.Float, CultureInfo.InvariantCulture, out var c) ? c : 0;
            var mem = parts[2].Split('/', 2, StringSplitOptions.TrimEntries);
            rows.Add(new ContainerStatsRow(
                parts[0].Trim(),
                cpu,
                ParseSize(mem.ElementAtOrDefault(0)),
                ParseSize(mem.ElementAtOrDefault(1)),
                parts[3].Trim(),
                parts[4].Trim()));
        }
        return rows;
    }

    /// <summary>Parse docker's human sizes: "12.5MiB", "1.2GB", "512kB", "0B".</summary>
    public static long ParseSize(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return 0;
        text = text.Trim();
        var i = 0;
        while (i < text.Length && (char.IsDigit(text[i]) || text[i] == '.'))
            i++;
        if (!double.TryParse(text[..i], NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
            return 0;
        var unit = text[i..].Trim().ToUpperInvariant();
        double factor = unit switch
        {
            "B" or "" => 1,
            "KB" => 1e3,
            "MB" => 1e6,
            "GB" => 1e9,
            "TB" => 1e12,
            "KIB" => 1024,
            "MIB" => 1024d * 1024,
            "GIB" => 1024d * 1024 * 1024,
            "TIB" => 1024d * 1024 * 1024 * 1024,
            _ => 1,
        };
        return (long)(value * factor);
    }

    public async Task<string> LogsAsync(string container, int tail, string? since, CancellationToken ct = default)
    {
        var args = new List<string> { "logs", "--timestamps", "--tail", tail.ToString(CultureInfo.InvariantCulture) };
        if (!string.IsNullOrWhiteSpace(since))
        {
            args.Add("--since");
            args.Add(since);
        }
        args.Add(container);
        var result = await runner.RunAsync("docker", args, paths.Root, TimeSpan.FromSeconds(20), ct);
        if (!result.Ok && string.IsNullOrWhiteSpace(result.StdOut))
            throw new InvalidOperationException(Trimmed(result.StdErr, $"docker logs {container} failed"));
        // Containers write to both streams; docker logs replays them on stdout/stderr respectively.
        return result.StdOut + result.StdErr;
    }

    static string Trimmed(string text, string fallback) =>
        string.IsNullOrWhiteSpace(text) ? fallback : text.Trim();
}
