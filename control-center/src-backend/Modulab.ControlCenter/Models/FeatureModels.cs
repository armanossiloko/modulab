using System.Text.Json;

namespace Modulab.ControlCenter.Models;

// ── Auth ────────────────────────────────────────────────────────────────────

public sealed record AuthStatusResponse(bool Configured, bool Authenticated, string? Username);
public sealed record AuthSetupRequest(string Password);
public sealed record LoginRequest(string Password, bool? Remember);
public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);

// ── Backups ─────────────────────────────────────────────────────────────────

public sealed record BackupInfo(
    string Id,
    DateTimeOffset CreatedAt,
    long SizeBytes,
    List<string> Databases,
    List<string> Apps,
    bool HasConfig,
    string Trigger);

public sealed record BackupSettingsResponse(
    bool Enabled,
    string Time,
    int Keep,
    string? ResticRepository,
    bool ResticPasswordSet,
    Dictionary<string, string> ResticEnv,
    List<string> ResticExtraPaths,
    int ResticKeepDaily,
    int ResticKeepWeekly);

public sealed record BackupSettingsUpdate(
    bool? Enabled,
    string? Time,
    int? Keep,
    string? ResticRepository,
    string? ResticPassword,
    Dictionary<string, string>? ResticEnv,
    List<string>? ResticExtraPaths,
    int? ResticKeepDaily,
    int? ResticKeepWeekly);

public sealed record BackupRunStatus(
    DateTimeOffset At,
    string Status,
    string? BackupId,
    string? Message,
    string? ResticStatus);

public sealed record BackupListResponse(
    List<BackupInfo> Backups,
    BackupSettingsResponse Settings,
    BackupRunStatus? LastRun,
    DateTimeOffset? NextRun);

public sealed record RestoreRequest(List<string>? Apps, bool? Config);

// ── Monitoring ──────────────────────────────────────────────────────────────

public sealed record HostMetrics(
    double CpuPercent,
    int CpuCount,
    long MemoryUsedBytes,
    long MemoryTotalBytes,
    double Load1,
    double Load5,
    double Load15,
    long UptimeSeconds);

public sealed record DiskUsage(string Label, string Path, long UsedBytes, long TotalBytes);
public sealed record MetricPoint(DateTimeOffset At, double Cpu, double Memory);

public sealed record SystemMetricsResponse(
    HostMetrics? Host,
    List<DiskUsage> Disks,
    List<MetricPoint> History);

public sealed record ContainerRow(
    string Name,
    string? AppId,
    string State,
    string Status,
    string? Health,
    string Image,
    double? CpuPercent,
    long? MemoryBytes,
    long? MemoryLimitBytes,
    int RestartCount);

public sealed record ContainersResponse(List<ContainerRow> Containers, DateTimeOffset SampledAt);

public sealed record LabEvent(
    string Id,
    DateTimeOffset At,
    string Level,
    string Kind,
    string Source,
    string Message);

public sealed record EventsResponse(List<LabEvent> Events);

public sealed record LogLine(string? Time, string Text);
public sealed record ContainerLogs(string Name, string State, List<LogLine> Lines);
public sealed record AppLogsResponse(string Id, List<ContainerLogs> Containers);

public sealed record NotificationSettings(
    string? NtfyUrl,
    string? NtfyToken,
    string? WebhookUrl,
    int DiskThresholdPercent,
    bool NotifyOnRecovery);

// ── Custom apps ─────────────────────────────────────────────────────────────

public sealed record CustomAppRequest(
    string Id,
    string Name,
    string? Description,
    string? Category,
    int? Port,
    string? ProxyHost,
    int? ProxyPort,
    string Compose,
    List<string>? DataPaths,
    List<RecipeField>? Fields,
    Dictionary<string, JsonElement>? Defaults);

public sealed record CustomAppResponse(
    string Id,
    string Name,
    string Description,
    string Category,
    int? Port,
    string? ProxyHost,
    int? ProxyPort,
    string Compose,
    List<string> DataPaths,
    List<RecipeField> Fields);

public sealed record CustomAppValidation(bool Ok, List<string> Errors, List<string> Warnings);
