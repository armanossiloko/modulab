using System.Globalization;

namespace Modulab.ControlCenter.Monitoring;

/// <summary>Parsers for Linux /proc files. Containers share the host kernel, so these are host-wide numbers.</summary>
public static class ProcParsers
{
    public readonly record struct CpuTimes(ulong Idle, ulong Total);

    /// <summary>First "cpu " line of /proc/stat → idle (idle + iowait) and total jiffies.</summary>
    public static CpuTimes? ParseCpu(string procStat)
    {
        foreach (var line in procStat.Split('\n'))
        {
            if (!line.StartsWith("cpu ", StringComparison.Ordinal))
                continue;
            var fields = line.Split(' ', StringSplitOptions.RemoveEmptyEntries).Skip(1)
                .Select(f => ulong.TryParse(f, NumberStyles.None, CultureInfo.InvariantCulture, out var v) ? v : 0UL)
                .ToArray();
            if (fields.Length < 4)
                return null;
            // user nice system idle iowait irq softirq steal (guest time is already in user/nice)
            var idle = fields[3] + (fields.Length > 4 ? fields[4] : 0);
            ulong total = 0;
            for (var i = 0; i < Math.Min(fields.Length, 8); i++)
                total += fields[i];
            return new CpuTimes(idle, total);
        }
        return null;
    }

    public static double CpuPercent(CpuTimes previous, CpuTimes current)
    {
        var total = current.Total - previous.Total;
        var idle = current.Idle - previous.Idle;
        if (current.Total <= previous.Total || total == 0)
            return 0;
        return Math.Clamp(100.0 * (total - idle) / total, 0, 100);
    }

    /// <summary>/proc/meminfo → (total, used) bytes, where used = total − MemAvailable.</summary>
    public static (long Total, long Used)? ParseMemory(string meminfo)
    {
        long total = -1, available = -1;
        foreach (var line in meminfo.Split('\n'))
        {
            if (line.StartsWith("MemTotal:", StringComparison.Ordinal))
                total = Kb(line);
            else if (line.StartsWith("MemAvailable:", StringComparison.Ordinal))
                available = Kb(line);
        }
        if (total <= 0 || available < 0)
            return null;
        return (total, Math.Max(0, total - available));

        static long Kb(string line)
        {
            var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            return parts.Length >= 2 && long.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var kb)
                ? kb * 1024
                : -1;
        }
    }

    public static (double One, double Five, double Fifteen)? ParseLoad(string loadavg)
    {
        var parts = loadavg.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 3)
            return null;
        static double D(string s) => double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : 0;
        return (D(parts[0]), D(parts[1]), D(parts[2]));
    }

    public static long ParseUptime(string uptime)
    {
        var first = uptime.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
        return double.TryParse(first, NumberStyles.Float, CultureInfo.InvariantCulture, out var s) ? (long)s : 0;
    }
}
