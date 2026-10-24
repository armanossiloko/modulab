using Modulab.ControlCenter.Backups;
using Modulab.ControlCenter.Models;

namespace Modulab.ControlCenter.Endpoints;

public static class BackupEndpoints
{
    public static void MapBackupEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/backups").WithTags("Backups");

        group.MapGet("", (BackupService backups, HttpResponse response) =>
            {
                response.Headers.CacheControl = "no-store";
                return Results.Json(backups.List(), LabJsonContext.Default.BackupListResponse);
            })
            .WithName("GetBackups")
            .Produces<BackupListResponse>();

        group.MapPost("", (BackupService backups) =>
                Api.TaskStarted(backups.TryStartBackup("manual", out var snapshot), snapshot))
            .WithName("RunBackup")
            .ProducesTask();

        group.MapPut("/settings", (BackupSettingsUpdate? body, BackupService backups) =>
            {
                if (body is null)
                    return Api.BadRequest("Missing body");
                try
                {
                    return Results.Json(backups.UpdateSettings(body), LabJsonContext.Default.BackupSettingsResponse);
                }
                catch (ArgumentException ex)
                {
                    return Api.BadRequest(ex.Message);
                }
            })
            .WithName("PutBackupSettings")
            .Accepts<BackupSettingsUpdate>("application/json")
            .Produces<BackupSettingsResponse>()
            .ProducesApiMessage(StatusCodes.Status400BadRequest);

        group.MapPost("/{id}/restore", (string id, RestoreRequest? body, BackupService backups) =>
            {
                try
                {
                    return Api.TaskStarted(backups.TryStartRestore(id, body ?? new RestoreRequest(null, null), out var snapshot), snapshot);
                }
                catch (KeyNotFoundException ex)
                {
                    return Api.NotFound(ex.Message);
                }
                catch (ArgumentException ex)
                {
                    return Api.BadRequest(ex.Message);
                }
            })
            .WithName("RestoreBackup")
            .Accepts<RestoreRequest>("application/json")
            .ProducesTask()
            .ProducesApiMessage(StatusCodes.Status400BadRequest, StatusCodes.Status404NotFound);

        group.MapDelete("/{id}", (string id, BackupService backups) =>
            {
                try
                {
                    backups.Delete(id);
                    return Api.Message($"Deleted backup {id}");
                }
                catch (KeyNotFoundException ex)
                {
                    return Api.NotFound(ex.Message);
                }
            })
            .WithName("DeleteBackup")
            .Produces<ApiMessage>()
            .ProducesApiMessage(StatusCodes.Status404NotFound);
    }
}
