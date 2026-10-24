using System.Text.Json;

namespace Modulab.ControlCenter.Models;

public sealed record HealthResponse(string Status, string LabRoot);
public sealed record ApiMessage(string Message);

public sealed record LabStatusResponse(
    bool Ready,
    bool NeedsHostIp,
    bool BaseStacksRunning,
    string? HostIp,
    string? SuggestedHostIp,
    string Domain,
    bool LanHttps = false,
    List<string>? WeakSecrets = null);

public sealed record LabSettingsResponse(
    string HostIp,
    string Domain,
    string Timezone,
    string PostgresUser,
    string PostgresPassword,
    string PostgresDb,
    string PiholePassword,
    bool EnableLanProxy,
    bool EnablePihole,
    bool EnableLanHttps = false,
    bool CaCertificateAvailable = false);

public sealed record LabSettingsUpdate(
    string? HostIp,
    string? Domain,
    string? Timezone,
    string? PostgresUser,
    string? PostgresPassword,
    string? PostgresDb,
    string? PiholePassword,
    bool? EnableLanProxy,
    bool? EnablePihole,
    bool? EnableLanHttps = null);

public sealed record CatalogResponse(List<CatalogItem> Apps);

public sealed record CatalogItem(
    string Id,
    string Name,
    string Description,
    string Category,
    int? Port,
    string? Path,
    string? Url,
    bool Installable,
    bool Core,
    List<string> DependsOn,
    List<RecipeField> Fields,
    bool Enabled,
    bool Running,
    string Status,
    string? Version = null,
    DateTimeOffset? ReleasedAt = null,
    bool Custom = false,
    bool Protected = false,
    bool CanProtect = false,
    bool HasRollback = false,
    string? Health = null);

public sealed record ImageRelease(string? Version, DateTimeOffset? ReleasedAt);
public sealed record InstallRequest(Dictionary<string, JsonElement>? Config);
public sealed record AppConfigResponse(string Id, List<RecipeField> Fields, Dictionary<string, JsonElement> Values);
public sealed record AppProtectionUpdate(bool Protected);

public sealed record BookmarkLinkDto(string Title, string Url, string? Domain);
public sealed record BookmarkGroupDto(string Title, string? Color, List<BookmarkLinkDto> Links);
public sealed record ImportBookmarksRequest(List<BookmarkGroupDto> Groups, bool? MergeByTitle);
public sealed record ReplaceBookmarksRequest(List<BookmarkGroupDto> Groups, bool? ShowInstalledApps);

public sealed record FeedItem(
    string Title,
    string Url,
    string Meta,
    string? Thumb,
    string? Author = null,
    int? Score = null,
    int? Comments = null,
    DateTimeOffset? PublishedAt = null,
    string? Domain = null,
    string? DiscussionUrl = null);

public sealed record FeedResponse(string Source, string Channel, List<FeedItem> Items);
public sealed record WeatherResponse(string Label, double TemperatureC, int WeatherCode, string Summary, double WindKmh, int Humidity);

public sealed record ImageUpdateStatus(
    string Image,
    string? LocalDigest,
    string? RemoteDigest,
    string? LocalId,
    bool UpdateAvailable,
    string? Reason,
    string? Error);

public sealed record AppUpdateStatus(
    string Id,
    string Name,
    bool UpdateAvailable,
    List<ImageUpdateStatus> Images);

public sealed record UpdatesResponse(
    List<AppUpdateStatus> Apps,
    DateTimeOffset CheckedAt,
    bool FromCache);

public sealed record AppTaskDto(
    string Id,
    string Name,
    string Action,
    string Status,
    string Latest,
    string[] Lines,
    string? Error,
    DateTimeOffset StartedAt);

public sealed record AppTaskSnapshot(AppTaskDto? Current);
