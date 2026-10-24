using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Modulab.ControlCenter.Auth;
using Modulab.ControlCenter.Backups;
using Modulab.ControlCenter.Infrastructure;
using Modulab.ControlCenter.Models;

namespace Modulab.ControlCenter;

/// <summary>Source-generated JSON metadata for every API and persisted type (required for Native AOT).</summary>
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    PropertyNameCaseInsensitive = true)]
// API
[JsonSerializable(typeof(HealthResponse))]
[JsonSerializable(typeof(ApiMessage))]
[JsonSerializable(typeof(LabStatusResponse))]
[JsonSerializable(typeof(LabSettingsResponse))]
[JsonSerializable(typeof(LabSettingsUpdate))]
[JsonSerializable(typeof(CatalogResponse))]
[JsonSerializable(typeof(CatalogItem))]
[JsonSerializable(typeof(InstallRequest))]
[JsonSerializable(typeof(AppConfigResponse))]
[JsonSerializable(typeof(AppProtectionUpdate))]
[JsonSerializable(typeof(FeedItem))]
[JsonSerializable(typeof(FeedResponse))]
[JsonSerializable(typeof(WeatherResponse))]
[JsonSerializable(typeof(ImportBookmarksRequest))]
[JsonSerializable(typeof(ReplaceBookmarksRequest))]
[JsonSerializable(typeof(ImageUpdateStatus))]
[JsonSerializable(typeof(AppUpdateStatus))]
[JsonSerializable(typeof(UpdatesResponse))]
[JsonSerializable(typeof(AppTaskDto))]
[JsonSerializable(typeof(AppTaskSnapshot))]
[JsonSerializable(typeof(AuthStatusResponse))]
[JsonSerializable(typeof(AuthSetupRequest))]
[JsonSerializable(typeof(LoginRequest))]
[JsonSerializable(typeof(ChangePasswordRequest))]
[JsonSerializable(typeof(BackupListResponse))]
[JsonSerializable(typeof(BackupSettingsResponse))]
[JsonSerializable(typeof(BackupSettingsUpdate))]
[JsonSerializable(typeof(BackupRunStatus))]
[JsonSerializable(typeof(RestoreRequest))]
[JsonSerializable(typeof(SystemMetricsResponse))]
[JsonSerializable(typeof(ContainersResponse))]
[JsonSerializable(typeof(EventsResponse))]
[JsonSerializable(typeof(LabEvent))]
[JsonSerializable(typeof(AppLogsResponse))]
[JsonSerializable(typeof(NotificationSettings))]
[JsonSerializable(typeof(CustomAppRequest))]
[JsonSerializable(typeof(CustomAppResponse))]
[JsonSerializable(typeof(CustomAppValidation))]
// Persisted
[JsonSerializable(typeof(Recipe))]
[JsonSerializable(typeof(AuthFile))]
[JsonSerializable(typeof(ControlCenterSettings))]
[JsonSerializable(typeof(BackupManifest))]
// Primitives / dynamic
[JsonSerializable(typeof(List<long>))]
[JsonSerializable(typeof(Dictionary<string, JsonElement>))]
[JsonSerializable(typeof(JsonElement))]
[JsonSerializable(typeof(JsonNode))]
[JsonSerializable(typeof(JsonObject))]
public partial class LabJsonContext : JsonSerializerContext;
