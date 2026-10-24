using System.Globalization;
using Modulab.ControlCenter.Catalog;
using Modulab.ControlCenter.Infrastructure;
using Modulab.ControlCenter.Models;

namespace Modulab.ControlCenter.Monitoring;

/// <summary>Container table for the System page: state, health, CPU/memory, restarts. Cached briefly — docker stats is slow.</summary>
public sealed class ContainerService(DockerCli docker, RecipeStore recipes, TimeProvider clock)
{
    static readonly TimeSpan Ttl = TimeSpan.FromSeconds(10);
    readonly SemaphoreSlim gate = new(1, 1);
    ContainersResponse? cached;

    public async Task<ContainersResponse> GetAsync(CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            if (cached is not null && clock.GetUtcNow() - cached.SampledAt < Ttl)
                return cached;

            var containers = await docker.ListContainersAsync(ct);
            IReadOnlyList<ContainerStatsRow> stats;
            try
            {
                stats = await docker.StatsAsync(ct);
            }
            catch (Exception ex) when (ex is InvalidOperationException or TimeoutException)
            {
                stats = [];
            }
            var restarts = await RestartCountsAsync(containers.Select(c => c.Name).ToList(), ct);
            var ids = recipes.All().Select(r => r.Id).OrderByDescending(id => id.Length).ToList();

            var rows = containers
                .Select(c =>
                {
                    var s = stats.FirstOrDefault(x => x.Name == c.Name);
                    return new ContainerRow(
                        c.Name,
                        ids.FirstOrDefault(id => DockerCli.MatchesRecipe(c.Name, id)),
                        c.State,
                        c.Status,
                        c.Health,
                        c.Image,
                        s?.CpuPercent,
                        s?.MemoryBytes,
                        s?.MemoryLimitBytes,
                        restarts.GetValueOrDefault(c.Name));
                })
                .OrderBy(r => r.AppId ?? "~")
                .ThenBy(r => r.Name, StringComparer.Ordinal)
                .ToList();

            cached = new ContainersResponse(rows, clock.GetUtcNow());
            return cached;
        }
        finally
        {
            gate.Release();
        }
    }

    async Task<Dictionary<string, int>> RestartCountsAsync(List<string> names, CancellationToken ct)
    {
        var result = new Dictionary<string, int>(StringComparer.Ordinal);
        if (names.Count == 0)
            return result;
        var args = new List<string> { "inspect", "--format", "{{.Name}}\t{{.RestartCount}}" };
        args.AddRange(names);
        var output = await docker.RunAsync(args, TimeSpan.FromSeconds(20), ct);
        foreach (var line in output.StdOut.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = line.Split('\t');
            if (parts.Length == 2 && int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var n))
                result[parts[0].TrimStart('/')] = n;
        }
        return result;
    }
}
