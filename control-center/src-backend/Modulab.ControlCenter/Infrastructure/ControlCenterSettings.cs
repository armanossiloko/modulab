using System.Text.Json;

namespace Modulab.ControlCenter.Infrastructure;

/// <summary>
/// Control Center–only settings (data/control-center/settings.json). Kept out of lab.config.json so
/// credentials such as the restic password never end up in the generated .env.
/// </summary>
public sealed class ControlCenterSettings
{
    public BackupConfig Backup { get; set; } = new();
    public NotificationConfig Notifications { get; set; } = new();
}

public sealed class BackupConfig
{
    public bool Enabled { get; set; } = true;
    /// <summary>Local time of day (lab timezone), HH:mm.</summary>
    public string Time { get; set; } = "03:30";
    /// <summary>Local backups to keep.</summary>
    public int Keep { get; set; } = 7;
    public string? ResticRepository { get; set; }
    public string? ResticPassword { get; set; }
    /// <summary>Extra env for the repository backend (AWS_ACCESS_KEY_ID, B2_ACCOUNT_KEY, …).</summary>
    public Dictionary<string, string> ResticEnv { get; set; } = new(StringComparer.Ordinal);
    /// <summary>Lab-relative or absolute host paths copied straight to restic (media, photo libraries).</summary>
    public List<string> ResticExtraPaths { get; set; } = [];
    public int ResticKeepDaily { get; set; } = 7;
    public int ResticKeepWeekly { get; set; } = 4;
}

public sealed class NotificationConfig
{
    /// <summary>ntfy topic URL, e.g. https://ntfy.sh/my-lab-alerts.</summary>
    public string? NtfyUrl { get; set; }
    public string? NtfyToken { get; set; }
    /// <summary>Generic webhook: receives the event as JSON.</summary>
    public string? WebhookUrl { get; set; }
    public int DiskThresholdPercent { get; set; } = 90;
    public bool NotifyOnRecovery { get; set; } = true;
}

public sealed class ControlCenterSettingsStore(LabPaths paths)
{
    // Monitor (not System.Threading.Lock): Update re-enters through Load().
    readonly object gate = new();

    string FilePath => Path.Combine(paths.State, "settings.json");

    public ControlCenterSettings Load()
    {
        lock (gate)
        {
            if (!File.Exists(FilePath))
                return new ControlCenterSettings();
            try
            {
                return JsonSerializer.Deserialize(File.ReadAllText(FilePath), LabJsonContext.Default.ControlCenterSettings)
                    ?? new ControlCenterSettings();
            }
            catch (JsonException)
            {
                return new ControlCenterSettings();
            }
        }
    }

    public void Update(Action<ControlCenterSettings> mutate)
    {
        lock (gate)
        {
            var settings = Load();
            mutate(settings);
            AtomicFile.WriteAllText(FilePath, JsonSerializer.Serialize(settings, LabJsonContext.Default.ControlCenterSettings));
        }
    }
}
