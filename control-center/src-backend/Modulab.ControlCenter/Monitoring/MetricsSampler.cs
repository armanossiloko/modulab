using Modulab.ControlCenter.Infrastructure;
using Modulab.ControlCenter.Models;

namespace Modulab.ControlCenter.Monitoring;

/// <summary>
/// Samples host CPU / memory every 10 s and keeps 24 h of one-minute points in memory
/// (~1.4k small records). No time-series database needed.
/// </summary>
public sealed class MetricsSampler(LabPaths paths, TimeProvider clock) : BackgroundService
{
    static readonly TimeSpan SampleEvery = TimeSpan.FromSeconds(10);
    const int HistoryPoints = 24 * 60;

    readonly Lock gate = new();
    readonly Queue<MetricPoint> history = new();
    HostMetrics? latest;
    ProcParsers.CpuTimes? lastCpu;
    double minuteCpuSum;
    double minuteMemSum;
    int minuteSamples;
    DateTimeOffset minuteStart;

    public static bool Supported => File.Exists("/proc/stat");

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!Supported)
            return;
        minuteStart = clock.GetUtcNow();
        using var timer = new PeriodicTimer(SampleEvery, clock);
        do
        {
            try
            {
                Sample();
            }
            catch (IOException)
            {
                // /proc hiccup — next sample.
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    void Sample()
    {
        var cpuNow = ProcParsers.ParseCpu(File.ReadAllText("/proc/stat"));
        var cpu = cpuNow is { } c && lastCpu is { } p ? ProcParsers.CpuPercent(p, c) : 0;
        lastCpu = cpuNow;
        var mem = ProcParsers.ParseMemory(File.ReadAllText("/proc/meminfo"));
        var load = ProcParsers.ParseLoad(File.ReadAllText("/proc/loadavg"));
        var uptime = ProcParsers.ParseUptime(File.ReadAllText("/proc/uptime"));

        var metrics = new HostMetrics(
            Math.Round(cpu, 1),
            Environment.ProcessorCount,
            mem?.Used ?? 0,
            mem?.Total ?? 0,
            load?.One ?? 0,
            load?.Five ?? 0,
            load?.Fifteen ?? 0,
            uptime);

        var now = clock.GetUtcNow();
        lock (gate)
        {
            latest = metrics;
            minuteCpuSum += metrics.CpuPercent;
            minuteMemSum = minuteMemSum + (metrics.MemoryTotalBytes > 0
                ? 100.0 * metrics.MemoryUsedBytes / metrics.MemoryTotalBytes
                : 0);
            minuteSamples++;
            if (now - minuteStart >= TimeSpan.FromMinutes(1))
            {
                history.Enqueue(new MetricPoint(
                    now,
                    Math.Round(minuteCpuSum / minuteSamples, 1),
                    Math.Round(minuteMemSum / minuteSamples, 1)));
                while (history.Count > HistoryPoints)
                    history.Dequeue();
                minuteCpuSum = minuteMemSum = 0;
                minuteSamples = 0;
                minuteStart = now;
            }
        }
    }

    public SystemMetricsResponse Snapshot(int historyMinutes)
    {
        lock (gate)
        {
            var points = history.TakeLast(Math.Clamp(historyMinutes, 0, HistoryPoints)).ToList();
            return new SystemMetricsResponse(latest, Disks(), points);
        }
    }

    /// <summary>Disk usage for the lab state dir, plus backups / media when they live on another filesystem.</summary>
    public List<DiskUsage> Disks()
    {
        var result = new List<DiskUsage>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        DriveInfo[] drives;
        try
        {
            drives = DriveInfo.GetDrives().Where(d => d.IsReady && d.TotalSize > 0).ToArray();
        }
        catch (IOException)
        {
            return result;
        }

        void Add(string label, string path)
        {
            if (!Directory.Exists(path))
                return;
            var full = Path.GetFullPath(ResolveLink(path));
            var drive = drives
                .Where(d => IsUnder(full, d.RootDirectory.FullName))
                .OrderByDescending(d => d.RootDirectory.FullName.Length)
                .FirstOrDefault();
            if (drive is null || !seen.Add(drive.RootDirectory.FullName))
                return;
            result.Add(new DiskUsage(label, full, drive.TotalSize - drive.TotalFreeSpace, drive.TotalSize));
        }

        Add("Lab data", paths.Root);
        Add("Backups", paths.Backups);
        Add("Media", Path.Combine(paths.Root, "media"));
        return result;
    }

    static bool IsUnder(string path, string mount)
    {
        var root = mount.TrimEnd('/', '\\');
        return root.Length == 0
            || path.Equals(root, StringComparison.Ordinal)
            || path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal);
    }

    static string ResolveLink(string path)
    {
        try
        {
            var info = new DirectoryInfo(path);
            return info.LinkTarget is not null ? info.ResolveLinkTarget(returnFinalTarget: true)?.FullName ?? path : path;
        }
        catch (IOException)
        {
            return path;
        }
    }
}
