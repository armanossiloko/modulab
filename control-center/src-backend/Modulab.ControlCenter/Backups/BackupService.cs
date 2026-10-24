using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Modulab.ControlCenter.Infrastructure;
using Modulab.ControlCenter.Lab;
using Modulab.ControlCenter.Models;
using Modulab.ControlCenter.Monitoring;
using Modulab.ControlCenter.Tasks;

namespace Modulab.ControlCenter.Backups;

/// <summary>manifest.json written by scripts/backup.py into each backups/&lt;id&gt;/ folder.</summary>
public sealed class BackupManifest
{
    public string Id { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public string Trigger { get; set; } = "manual";
    public List<string> Databases { get; set; } = [];
    public List<string> Apps { get; set; } = [];
    public bool HasConfig { get; set; }
    public long SizeBytes { get; set; }
}

/// <summary>Local backups (pg_dump + app data + config) with optional restic copy, run as lab tasks.</summary>
public sealed partial class BackupService(
    LabPaths paths,
    LabConfigStore config,
    ControlCenterSettingsStore settings,
    LabScripts scripts,
    TaskBoard tasks,
    EventLog events,
    TimeProvider clock)
{
    [GeneratedRegex(@"^\d{8}-\d{6}$")]
    private static partial Regex BackupIdRegex();

    [GeneratedRegex(@"^([01]\d|2[0-3]):[0-5]\d$")]
    private static partial Regex TimeRegex();

    [GeneratedRegex(@"^[A-Z_][A-Z0-9_]*$")]
    private static partial Regex EnvNameRegex();

    [GeneratedRegex(@"^[a-z0-9][a-z0-9-]*$")]
    private static partial Regex AppIdRegex();

    string StatusFile => Path.Combine(paths.State, "backup-status.json");

    public static bool IsValidId(string id) => BackupIdRegex().IsMatch(id);

    public BackupListResponse List()
    {
        var list = new List<BackupInfo>();
        if (Directory.Exists(paths.Backups))
        {
            foreach (var dir in Directory.GetDirectories(paths.Backups))
            {
                var id = Path.GetFileName(dir);
                var manifestPath = Path.Combine(dir, "manifest.json");
                if (!IsValidId(id) || !File.Exists(manifestPath))
                    continue; // in-progress or foreign folders
                try
                {
                    var m = JsonSerializer.Deserialize(File.ReadAllText(manifestPath), LabJsonContext.Default.BackupManifest);
                    if (m is not null)
                        list.Add(new BackupInfo(id, m.CreatedAt, m.SizeBytes, m.Databases, m.Apps, m.HasConfig, m.Trigger));
                }
                catch (JsonException)
                {
                    // Skip unreadable manifests.
                }
            }
        }

        var cfg = settings.Load().Backup;
        return new BackupListResponse(
            list.OrderByDescending(b => b.CreatedAt).ToList(),
            ToResponse(cfg),
            LastRun(),
            cfg.Enabled ? NextRun(cfg, clock.GetUtcNow()) : null);
    }

    static BackupSettingsResponse ToResponse(BackupConfig c) => new(
        c.Enabled,
        c.Time,
        c.Keep,
        c.ResticRepository,
        !string.IsNullOrEmpty(c.ResticPassword),
        // Never echo secret values back — only which keys are set.
        c.ResticEnv.ToDictionary(kv => kv.Key, _ => "", StringComparer.Ordinal),
        c.ResticExtraPaths,
        c.ResticKeepDaily,
        c.ResticKeepWeekly);

    public BackupSettingsResponse UpdateSettings(BackupSettingsUpdate body)
    {
        if (body.Time is not null && !TimeRegex().IsMatch(body.Time))
            throw new ArgumentException("Time must be HH:mm (24h)");
        if (body.Keep is < 1 or > 365)
            throw new ArgumentException("Keep must be between 1 and 365");
        if (body.ResticKeepDaily is < 0 or > 365 || body.ResticKeepWeekly is < 0 or > 520)
            throw new ArgumentException("Restic retention is out of range");
        if (body.ResticEnv is not null && body.ResticEnv.Keys.Any(k => !EnvNameRegex().IsMatch(k)))
            throw new ArgumentException("Restic environment names must be UPPER_SNAKE_CASE");

        settings.Update(s =>
        {
            var b = s.Backup;
            if (body.Enabled is bool enabled) b.Enabled = enabled;
            if (body.Time is not null) b.Time = body.Time;
            if (body.Keep is int keep) b.Keep = keep;
            if (body.ResticRepository is not null)
                b.ResticRepository = string.IsNullOrWhiteSpace(body.ResticRepository) ? null : body.ResticRepository.Trim();
            // Empty string clears the password; null leaves it unchanged.
            if (body.ResticPassword is not null)
                b.ResticPassword = body.ResticPassword.Length == 0 ? null : body.ResticPassword;
            if (body.ResticEnv is not null)
            {
                var next = new Dictionary<string, string>(StringComparer.Ordinal);
                foreach (var (key, value) in body.ResticEnv)
                {
                    // Blank value = keep the stored secret for that key.
                    if (string.IsNullOrEmpty(value) && b.ResticEnv.TryGetValue(key, out var existing))
                        next[key] = existing;
                    else if (!string.IsNullOrEmpty(value))
                        next[key] = value;
                }
                b.ResticEnv = next;
            }
            if (body.ResticExtraPaths is not null)
                b.ResticExtraPaths = body.ResticExtraPaths.Select(p => p.Trim()).Where(p => p.Length > 0).Distinct().ToList();
            if (body.ResticKeepDaily is int kd) b.ResticKeepDaily = kd;
            if (body.ResticKeepWeekly is int kw) b.ResticKeepWeekly = kw;
        });
        return ToResponse(settings.Load().Backup);
    }

    public BackupRunStatus? LastRun()
    {
        if (!File.Exists(StatusFile))
            return null;
        try
        {
            return JsonSerializer.Deserialize(File.ReadAllText(StatusFile), LabJsonContext.Default.BackupRunStatus);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>Next scheduled run in UTC, from HH:mm in the lab timezone.</summary>
    public DateTimeOffset NextRun(BackupConfig cfg, DateTimeOffset nowUtc)
    {
        var tz = LabTimeZone();
        var parts = cfg.Time.Split(':');
        var hour = int.Parse(parts[0], CultureInfo.InvariantCulture);
        var minute = int.Parse(parts[1], CultureInfo.InvariantCulture);
        var localNow = TimeZoneInfo.ConvertTime(nowUtc, tz);
        var candidate = new DateTime(localNow.Year, localNow.Month, localNow.Day, hour, minute, 0, DateTimeKind.Unspecified);
        if (candidate <= localNow.DateTime)
            candidate = candidate.AddDays(1);
        // Skip a local time that does not exist (DST spring-forward).
        while (tz.IsInvalidTime(candidate))
            candidate = candidate.AddMinutes(30);
        return new DateTimeOffset(candidate, tz.GetUtcOffset(candidate)).ToUniversalTime();
    }

    TimeZoneInfo LabTimeZone()
    {
        var name = LabConfigStore.GetString(config.Lab(config.Load()), "timezone");
        if (!string.IsNullOrWhiteSpace(name) && TimeZoneInfo.TryFindSystemTimeZoneById(name, out var tz))
            return tz;
        return TimeZoneInfo.Utc;
    }

    /// <summary>Start a backup task. Returns false (with the running task) when another task is busy.</summary>
    public bool TryStartBackup(string trigger, out AppTaskDto snapshot)
    {
        var cfg = settings.Load().Backup;
        return tasks.TryStart(
            "backup",
            "Backup",
            "backup",
            "Dumping databases and archiving app data…",
            async run =>
            {
                var args = new List<string> { "--trigger", trigger, "--keep", cfg.Keep.ToString(CultureInfo.InvariantCulture) };
                string? resticStatus = null;
                try
                {
                    await RunPythonAsync("backup.py", args, ResticEnv(cfg), run.Note);
                    if (!string.IsNullOrWhiteSpace(cfg.ResticRepository))
                        resticStatus = "ok";
                }
                catch (Exception ex)
                {
                    WriteStatus(new BackupRunStatus(clock.GetUtcNow(), "error", LatestId(), ex.Message, null));
                    events.Add("error", "backup-failed", "Backups", $"Backup failed: {Short(ex.Message)}", notify: true);
                    throw;
                }

                var id = LatestId();
                WriteStatus(new BackupRunStatus(clock.GetUtcNow(), "ok", id, null, resticStatus));
                events.Add("info", "backup-ok", "Backups", $"Backup {id} finished", notify: false);
                return $"Backup {id} finished";
            },
            out snapshot,
            "Backup failed");
    }

    public bool TryStartRestore(string id, RestoreRequest body, out AppTaskDto snapshot)
    {
        if (!IsValidId(id) || !Directory.Exists(Path.Combine(paths.Backups, id)))
            throw new KeyNotFoundException($"Unknown backup '{id}'");
        var apps = body.Apps ?? [];
        if (apps.Any(a => !AppIdRegex().IsMatch(a)))
            throw new ArgumentException("Invalid app id");
        if (apps.Count == 0 && body.Config != true)
            throw new ArgumentException("Choose the config and/or at least one app to restore");

        var args = new List<string> { id };
        if (body.Config == true)
            args.Add("--config");
        foreach (var app in apps)
        {
            args.Add("--app");
            args.Add(app);
        }

        return tasks.TryStart(
            "restore",
            "Restore",
            "restore",
            $"Restoring from backup {id}…",
            async run =>
            {
                await RunPythonAsync("restore.py", args, null, run.Note);
                events.Add("warning", "restore", "Backups", $"Restored {Describe(body)} from backup {id}", notify: false);
                return $"Restored {Describe(body)}";
            },
            out snapshot,
            "Restore failed");
    }

    static string Describe(RestoreRequest body)
    {
        var parts = new List<string>();
        if (body.Config == true) parts.Add("config");
        parts.AddRange(body.Apps ?? []);
        return string.Join(", ", parts);
    }

    public void Delete(string id)
    {
        var dir = Path.Combine(paths.Backups, id);
        if (!IsValidId(id) || !Directory.Exists(dir))
            throw new KeyNotFoundException($"Unknown backup '{id}'");
        Directory.Delete(dir, recursive: true);
    }

    string? LatestId() =>
        Directory.Exists(paths.Backups)
            ? Directory.GetDirectories(paths.Backups)
                .Select(Path.GetFileName)
                .Where(n => n is not null && IsValidId(n) && File.Exists(Path.Combine(paths.Backups, n, "manifest.json")))
                .OrderDescending(StringComparer.Ordinal)
                .FirstOrDefault()
            : null;

    void WriteStatus(BackupRunStatus status) =>
        AtomicFile.WriteAllText(StatusFile, JsonSerializer.Serialize(status, LabJsonContext.Default.BackupRunStatus));

    static Dictionary<string, string>? ResticEnv(BackupConfig cfg)
    {
        if (string.IsNullOrWhiteSpace(cfg.ResticRepository))
            return null;
        if (string.IsNullOrEmpty(cfg.ResticPassword))
            throw new InvalidOperationException("Restic repository is set but has no password");
        var env = new Dictionary<string, string>(cfg.ResticEnv, StringComparer.Ordinal)
        {
            ["RESTIC_REPOSITORY"] = cfg.ResticRepository,
            ["RESTIC_PASSWORD"] = cfg.ResticPassword,
            ["MODULAB_RESTIC_ENV_KEYS"] = string.Join(',', cfg.ResticEnv.Keys),
            ["MODULAB_RESTIC_EXTRA_PATHS"] = string.Join('\n', cfg.ResticExtraPaths),
            ["MODULAB_RESTIC_KEEP_DAILY"] = cfg.ResticKeepDaily.ToString(CultureInfo.InvariantCulture),
            ["MODULAB_RESTIC_KEEP_WEEKLY"] = cfg.ResticKeepWeekly.ToString(CultureInfo.InvariantCulture),
        };
        return env;
    }

    Task RunPythonAsync(string script, List<string> args, Dictionary<string, string>? env, Action<string> onLine) =>
        scripts.RunPythonAsync(script, args, env, onLine);

    static string Short(string message)
    {
        var line = message.Split('\n', StringSplitOptions.RemoveEmptyEntries).LastOrDefault() ?? message;
        return line.Length > 200 ? line[..200] : line;
    }
}
