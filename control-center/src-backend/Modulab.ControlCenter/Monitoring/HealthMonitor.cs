using Modulab.ControlCenter.Catalog;
using Modulab.ControlCenter.Infrastructure;
using Modulab.ControlCenter.Lab;
using Modulab.ControlCenter.Models;
using Modulab.ControlCenter.Tasks;

namespace Modulab.ControlCenter.Monitoring;

/// <summary>
/// Every minute: are enabled apps up and healthy, and is any disk nearly full? Alerts fire on state
/// changes only (and after two bad checks in a row, so installs/updates do not page you).
/// </summary>
public sealed class HealthMonitor(
    LabConfigStore config,
    RecipeStore recipes,
    DockerCli docker,
    MetricsSampler metrics,
    ControlCenterSettingsStore settings,
    TaskBoard tasks,
    EventLog events,
    TimeProvider clock,
    ILogger<HealthMonitor> log) : BackgroundService
{
    static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);
    const int BadChecksBeforeAlert = 2;

    readonly Dictionary<string, AppState> apps = new(StringComparer.Ordinal);
    readonly HashSet<string> fullDisks = new(StringComparer.Ordinal);

    sealed class AppState
    {
        public string Reported = "ok";
        public int BadStreak;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Give base stacks time to come up after a reboot before judging them.
        await Task.Delay(TimeSpan.FromSeconds(30), clock, stoppingToken);
        using var timer = new PeriodicTimer(Interval, clock);
        do
        {
            try
            {
                await CheckAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning("Health check failed: {Message}", ex.Message);
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    public async Task CheckAsync(CancellationToken ct)
    {
        CheckDisks();

        IReadOnlyList<ContainerInfo> containers;
        try
        {
            containers = await docker.ListContainersAsync(ct);
        }
        catch (InvalidOperationException)
        {
            return; // Docker unreachable — nothing meaningful to report per app.
        }

        var enabled = config.Enabled();
        var busy = tasks.Snapshot() is { Status: "running" } t ? t.Id : null;
        var notifyRecovery = settings.Load().Notifications.NotifyOnRecovery;

        foreach (var recipe in recipes.All())
        {
            if (!enabled.Contains(recipe.Id) || recipe.Id == "control-center")
            {
                apps.Remove(recipe.Id);
                continue;
            }

            var state = apps.TryGetValue(recipe.Id, out var s) ? s : apps[recipe.Id] = new AppState();
            var problem = Assess(DockerCli.ForRecipe(containers, recipe.Id));

            // An update/restore in progress for this app is expected downtime.
            if (busy is not null && (busy == recipe.Id || busy is "restore" or "backup"))
                continue;

            if (problem is null)
            {
                state.BadStreak = 0;
                if (state.Reported != "ok")
                {
                    state.Reported = "ok";
                    events.Add("info", "app-recovered", recipe.Name, $"{recipe.Name} is running again", notifyRecovery);
                }
                continue;
            }

            state.BadStreak++;
            if (state.BadStreak >= BadChecksBeforeAlert && state.Reported != problem)
            {
                state.Reported = problem;
                events.Add("error", "app-" + problem, recipe.Name, Describe(recipe.Name, problem), notify: true);
            }
        }
    }

    /// <summary>null when healthy; otherwise "down", "restarting" or "unhealthy".</summary>
    public static string? Assess(IReadOnlyList<ContainerInfo> containers)
    {
        if (containers.Count == 0 || containers.All(c => c.State is not ("running" or "restarting")))
            return "down";
        if (containers.Any(c => c.State == "restarting"))
            return "restarting";
        if (containers.Any(c => c.State != "running"))
            return "down";
        if (containers.Any(c => c.Health == "unhealthy"))
            return "unhealthy";
        return null;
    }

    static string Describe(string name, string problem) => problem switch
    {
        "restarting" => $"{name} keeps restarting",
        "unhealthy" => $"{name} is failing its health check",
        _ => $"{name} is not running",
    };

    void CheckDisks()
    {
        var threshold = settings.Load().Notifications.DiskThresholdPercent;
        if (threshold is <= 0 or > 100)
            return;
        foreach (var disk in metrics.Disks())
        {
            if (disk.TotalBytes <= 0)
                continue;
            var pct = 100.0 * disk.UsedBytes / disk.TotalBytes;
            if (pct >= threshold && fullDisks.Add(disk.Path))
                events.Add("warning", "disk-full", disk.Label, $"{disk.Label} disk is {pct:0}% full ({disk.Path})", notify: true);
            // Hysteresis: re-arm only once usage drops clearly below the threshold.
            else if (pct < threshold - 2 && fullDisks.Remove(disk.Path))
                events.Add("info", "disk-ok", disk.Label, $"{disk.Label} disk is back to {pct:0}%", notify: false);
        }
    }
}
