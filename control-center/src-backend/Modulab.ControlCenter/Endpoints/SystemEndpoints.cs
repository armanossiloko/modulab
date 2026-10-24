using Modulab.ControlCenter.Infrastructure;
using Modulab.ControlCenter.Models;
using Modulab.ControlCenter.Monitoring;
using Modulab.ControlCenter.Tasks;
using Modulab.ControlCenter.Updates;

namespace Modulab.ControlCenter.Endpoints;

public static class SystemEndpoints
{
    public static void MapSystemEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api").WithTags("System");

        group.MapGet("/health", (LabPaths paths) =>
                Results.Json(new HealthResponse("ok", paths.Root), LabJsonContext.Default.HealthResponse))
            .WithName("GetHealth")
            .Produces<HealthResponse>();

        group.MapPost("/system/update", (LabScripts scripts, UpdateService updates, TaskBoard tasks) =>
            {
                var started = tasks.TryStart("control-center", "Control Center", "system-update",
                    "Downloading compose.yaml and updating the core stack…",
                    async run =>
                    {
                        await scripts.RunAsync("update-appliance.sh", [], run.Note);
                        updates.Invalidate();
                        return "Control Center is restarting";
                    },
                    out var snapshot,
                    "Update failed");
                return Api.TaskStarted(started, snapshot);
            })
            .WithName("UpdateControlCenter")
            .ProducesTask();

        group.MapGet("/system/metrics", (int? history, MetricsSampler metrics, HttpResponse response) =>
            {
                response.Headers.CacheControl = "no-store";
                return Results.Json(metrics.Snapshot(history ?? 120), LabJsonContext.Default.SystemMetricsResponse);
            })
            .WithName("GetSystemMetrics")
            .Produces<SystemMetricsResponse>();

        group.MapGet("/system/containers", async (ContainerService containers, CancellationToken ct) =>
            {
                try
                {
                    return Results.Json(await containers.GetAsync(ct), LabJsonContext.Default.ContainersResponse);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    return Api.Message(ex.Message, StatusCodes.Status502BadGateway);
                }
            })
            .WithName("GetContainers")
            .Produces<ContainersResponse>()
            .ProducesApiMessage(StatusCodes.Status502BadGateway);

        group.MapGet("/system/events", (int? limit, EventLog events) =>
                Results.Json(new EventsResponse(events.Recent(Math.Clamp(limit ?? 50, 1, 300))), LabJsonContext.Default.EventsResponse))
            .WithName("GetEvents")
            .Produces<EventsResponse>();

        group.MapGet("/system/notifications", (ControlCenterSettingsStore settings) =>
                Results.Json(ToDto(settings.Load().Notifications), LabJsonContext.Default.NotificationSettings))
            .WithName("GetNotificationSettings")
            .Produces<NotificationSettings>();

        group.MapPut("/system/notifications", (NotificationSettings? body, ControlCenterSettingsStore settings) =>
            {
                if (body is null)
                    return Api.BadRequest("Missing body");
                if (body.DiskThresholdPercent is < 50 or > 100)
                    return Api.BadRequest("Disk threshold must be between 50 and 100");
                foreach (var url in new[] { body.NtfyUrl, body.WebhookUrl })
                {
                    if (!string.IsNullOrWhiteSpace(url)
                        && (!Uri.TryCreate(url.Trim(), UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")))
                        return Api.BadRequest($"'{url}' is not an http(s) URL");
                }

                settings.Update(s =>
                {
                    var n = s.Notifications;
                    n.NtfyUrl = Blank(body.NtfyUrl);
                    // The token is write-only: an empty value keeps the stored one.
                    if (!string.IsNullOrEmpty(body.NtfyToken))
                        n.NtfyToken = body.NtfyToken.Trim();
                    if (n.NtfyUrl is null)
                        n.NtfyToken = null;
                    n.WebhookUrl = Blank(body.WebhookUrl);
                    n.DiskThresholdPercent = body.DiskThresholdPercent;
                    n.NotifyOnRecovery = body.NotifyOnRecovery;
                });
                return Results.Json(ToDto(settings.Load().Notifications), LabJsonContext.Default.NotificationSettings);
            })
            .WithName("PutNotificationSettings")
            .Accepts<NotificationSettings>("application/json")
            .Produces<NotificationSettings>()
            .ProducesApiMessage(StatusCodes.Status400BadRequest);

        group.MapPost("/system/notifications/test", async (ControlCenterSettingsStore settings, Notifier notifier, TimeProvider clock, CancellationToken ct) =>
            {
                var config = settings.Load().Notifications;
                if (string.IsNullOrWhiteSpace(config.NtfyUrl) && string.IsNullOrWhiteSpace(config.WebhookUrl))
                    return Api.BadRequest("Add an ntfy URL or webhook first");
                var e = new LabEvent("test", clock.GetUtcNow(), "info", "test", "Control Center", "Test notification from Modulab");
                try
                {
                    await notifier.SendAsync(e, config, ct);
                    return Api.Message("Test notification sent");
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    return Api.Message(ex.Message, StatusCodes.Status502BadGateway);
                }
            })
            .WithName("TestNotification")
            .Produces<ApiMessage>()
            .ProducesApiMessage(StatusCodes.Status400BadRequest, StatusCodes.Status502BadGateway);
    }

    static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    // The ntfy token is never sent back — only whether one is stored.
    static NotificationSettings ToDto(NotificationConfig n) => new(
        n.NtfyUrl,
        string.IsNullOrEmpty(n.NtfyToken) ? null : "",
        n.WebhookUrl,
        n.DiskThresholdPercent,
        n.NotifyOnRecovery);
}
