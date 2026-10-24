using Modulab.ControlCenter.Apps;
using Modulab.ControlCenter.Catalog;
using Modulab.ControlCenter.Infrastructure;
using Modulab.ControlCenter.Lab;
using Modulab.ControlCenter.Models;
using Modulab.ControlCenter.Tasks;
using Modulab.ControlCenter.Updates;

namespace Modulab.ControlCenter.Endpoints;

public static class AppEndpoints
{
    public static void MapAppEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api").WithTags("Apps");

        group.MapGet("/catalog", async (AppService apps, CancellationToken ct) =>
            {
                try
                {
                    return Results.Json(new CatalogResponse(await apps.CatalogAsync(ct)), LabJsonContext.Default.CatalogResponse);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    return Api.Error(ex);
                }
            })
            .WithName("GetCatalog")
            .Produces<CatalogResponse>()
            .ProducesApiMessage(StatusCodes.Status500InternalServerError);

        group.MapGet("/apps/{id}", async (string id, AppService apps, CancellationToken ct) =>
                await apps.ItemAsync(id, ct) is { } item
                    ? Results.Json(item, LabJsonContext.Default.CatalogItem)
                    : Api.UnknownApp(id))
            .WithName("GetApp")
            .Produces<CatalogItem>()
            .ProducesApiMessage(StatusCodes.Status404NotFound);

        group.MapPost("/apps/{id}/install", async (string id, InstallRequest? body, RecipeStore recipes, LabConfigStore config, AppService apps) =>
            {
                if (recipes.Find(id) is not { } recipe)
                    return Api.UnknownApp(id);
                if (!recipe.Installable)
                    return Api.BadRequest($"'{id}' is not installable");
                if (!config.IsReady())
                    return Api.BadRequest("Set a real lab.hostIp in Settings → Lab before installing apps");
                try
                {
                    await apps.InstallAsync(recipe, body?.Config);
                    return Api.Message($"Installed {id}");
                }
                catch (Exception ex)
                {
                    return Api.Error(ex);
                }
            })
            .WithName("InstallApp")
            .Accepts<InstallRequest>("application/json")
            .Produces<ApiMessage>()
            .ProducesApiMessage(StatusCodes.Status400BadRequest, StatusCodes.Status404NotFound, StatusCodes.Status500InternalServerError);

        group.MapPost("/apps/{id}/start", async (string id, RecipeStore recipes, AppService apps) =>
            {
                if (recipes.Find(id) is not { } recipe)
                    return Api.UnknownApp(id);
                try
                {
                    await apps.StartAsync(recipe);
                    return Api.Message($"Started {id}");
                }
                catch (Exception ex)
                {
                    return Api.Error(ex);
                }
            })
            .WithName("StartApp")
            .Produces<ApiMessage>()
            .ProducesApiMessage(StatusCodes.Status404NotFound, StatusCodes.Status500InternalServerError);

        group.MapPost("/apps/{id}/stop", async (string id, RecipeStore recipes, AppService apps) =>
            {
                if (recipes.Find(id) is not { } recipe)
                    return Api.UnknownApp(id);
                try
                {
                    await apps.StopAsync(recipe);
                    return Api.Message($"Stopped {id}");
                }
                catch (Exception ex)
                {
                    return Api.Error(ex);
                }
            })
            .WithName("StopApp")
            .Produces<ApiMessage>()
            .ProducesApiMessage(StatusCodes.Status404NotFound, StatusCodes.Status500InternalServerError);

        group.MapDelete("/apps/{id}", async (string id, bool? purge, RecipeStore recipes, AppService apps) =>
            {
                if (recipes.Find(id) is not { } recipe)
                    return Api.UnknownApp(id);
                if (recipe.Core)
                    return Api.BadRequest($"Cannot uninstall core app '{id}'");
                try
                {
                    return Api.Message(await apps.UninstallAsync(recipe, purge == true));
                }
                catch (Exception ex)
                {
                    return Api.Error(ex);
                }
            })
            .WithName("UninstallApp")
            .Produces<ApiMessage>()
            .ProducesApiMessage(StatusCodes.Status400BadRequest, StatusCodes.Status404NotFound, StatusCodes.Status500InternalServerError);

        group.MapGet("/apps/{id}/config", (string id, RecipeStore recipes, AppService apps) =>
                recipes.Find(id) is { } recipe
                    ? Results.Json(apps.GetConfig(recipe), LabJsonContext.Default.AppConfigResponse)
                    : Api.UnknownApp(id))
            .WithName("GetAppConfig")
            .Produces<AppConfigResponse>()
            .ProducesApiMessage(StatusCodes.Status404NotFound);

        group.MapPut("/apps/{id}/config", async (string id, InstallRequest? body, RecipeStore recipes, AppService apps) =>
            {
                if (recipes.Find(id) is not { } recipe)
                    return Api.UnknownApp(id);
                if (body?.Config is null)
                    return Api.BadRequest("Missing config");
                try
                {
                    await apps.ConfigureAsync(recipe, body.Config);
                    return Results.Json(apps.GetConfig(recipe), LabJsonContext.Default.AppConfigResponse);
                }
                catch (Exception ex)
                {
                    return Api.Error(ex);
                }
            })
            .WithName("PutAppConfig")
            .Accepts<InstallRequest>("application/json")
            .Produces<AppConfigResponse>()
            .ProducesApiMessage(StatusCodes.Status400BadRequest, StatusCodes.Status404NotFound, StatusCodes.Status500InternalServerError);

        group.MapPut("/apps/{id}/protection", async (string id, AppProtectionUpdate? body, RecipeStore recipes, AppService apps) =>
            {
                if (recipes.Find(id) is not { } recipe)
                    return Api.UnknownApp(id);
                if (body is null)
                    return Api.BadRequest("Missing body");
                try
                {
                    await apps.SetProtectedAsync(recipe, body.Protected);
                    return Api.Message(body.Protected
                        ? $"{recipe.Name} now requires the Control Center login"
                        : $"{recipe.Name} no longer requires the Control Center login");
                }
                catch (InvalidOperationException ex)
                {
                    return Api.BadRequest(ex.Message);
                }
                catch (Exception ex)
                {
                    return Api.Error(ex);
                }
            })
            .WithName("SetAppProtection")
            .Accepts<AppProtectionUpdate>("application/json")
            .Produces<ApiMessage>()
            .ProducesApiMessage(StatusCodes.Status400BadRequest, StatusCodes.Status404NotFound, StatusCodes.Status500InternalServerError);

        group.MapGet("/apps/{id}/logs", async (string id, int? tail, string? since, RecipeStore recipes, AppService apps, HttpResponse response, CancellationToken ct) =>
            {
                if (recipes.Find(id) is not { } recipe)
                    return Api.UnknownApp(id);
                response.Headers.CacheControl = "no-store";
                var logs = await apps.LogsAsync(recipe, Math.Clamp(tail ?? 300, 10, 2000), since, ct);
                return Results.Json(logs, LabJsonContext.Default.AppLogsResponse);
            })
            .WithName("GetAppLogs")
            .Produces<AppLogsResponse>()
            .ProducesApiMessage(StatusCodes.Status404NotFound);

        group.MapGet("/updates", async (bool? refresh, UpdateService updates, CancellationToken ct) =>
            {
                try
                {
                    return Results.Json(await updates.GetUpdatesAsync(refresh == true, ct), LabJsonContext.Default.UpdatesResponse);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    return Api.Error(ex);
                }
            })
            .WithName("GetUpdates")
            .Produces<UpdatesResponse>()
            .ProducesApiMessage(StatusCodes.Status500InternalServerError);

        group.MapGet("/apps/{id}/updates", async (string id, RecipeStore recipes, UpdateService updates, CancellationToken ct) =>
            {
                if (recipes.Find(id) is not { } recipe)
                    return Api.UnknownApp(id);
                try
                {
                    return Results.Json(await updates.CheckAppAsync(recipe, ct), LabJsonContext.Default.AppUpdateStatus);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    return Api.Error(ex);
                }
            })
            .WithName("GetAppUpdates")
            .Produces<AppUpdateStatus>()
            .ProducesApiMessage(StatusCodes.Status404NotFound, StatusCodes.Status500InternalServerError);

        group.MapPost("/apps/{id}/update", (string id, RecipeStore recipes, LabConfigStore config, LabScripts scripts, UpdateService updates, TaskBoard tasks) =>
            {
                if (recipes.Find(id) is not { } recipe)
                    return Api.UnknownApp(id);
                try
                {
                    config.Enable(id);
                }
                catch (Exception ex)
                {
                    return Api.Error(ex);
                }

                var started = tasks.TryStart(recipe.Id, recipe.Name, "update",
                    "Pulling the image and recreating the container…",
                    async run =>
                    {
                        // update.sh records the current image IDs first, so the update can be rolled back.
                        await scripts.RunAsync("update.sh", [id], run.Note);
                        updates.Invalidate();
                        return "Image pulled and container recreated";
                    },
                    out var snapshot,
                    "Update failed");
                return Api.TaskStarted(started, snapshot);
            })
            .WithName("UpdateApp")
            .ProducesTask()
            .ProducesApiMessage(StatusCodes.Status404NotFound, StatusCodes.Status500InternalServerError);

        group.MapPost("/apps/{id}/rollback", (string id, RecipeStore recipes, AppService apps, LabScripts scripts, UpdateService updates, TaskBoard tasks) =>
            {
                if (recipes.Find(id) is not { } recipe)
                    return Api.UnknownApp(id);
                if (!File.Exists(apps.RollbackRecordPath(id)))
                    return Api.BadRequest($"{recipe.Name} has no previous version to roll back to");

                var started = tasks.TryStart(recipe.Id, recipe.Name, "rollback",
                    "Restoring the images from before the last update…",
                    async run =>
                    {
                        await scripts.RunAsync("rollback.sh", [id], run.Note);
                        updates.Invalidate();
                        return "Rolled back to the previous images";
                    },
                    out var snapshot,
                    "Rollback failed");
                return Api.TaskStarted(started, snapshot);
            })
            .WithName("RollbackApp")
            .ProducesTask()
            .ProducesApiMessage(StatusCodes.Status400BadRequest, StatusCodes.Status404NotFound);

        group.MapGet("/tasks", (HttpResponse response, TaskBoard tasks) =>
            {
                response.Headers.CacheControl = "no-store";
                return Results.Json(new AppTaskSnapshot(tasks.Snapshot()), LabJsonContext.Default.AppTaskSnapshot);
            })
            .WithName("GetAppTask")
            .Produces<AppTaskSnapshot>();

        group.MapDelete("/tasks", (TaskBoard tasks) =>
                tasks.TryDismiss()
                    ? Results.Json(new AppTaskSnapshot(null), LabJsonContext.Default.AppTaskSnapshot)
                    : Api.Message("A task is still running", StatusCodes.Status409Conflict))
            .WithName("DismissAppTask")
            .Produces<AppTaskSnapshot>()
            .ProducesApiMessage(StatusCodes.Status409Conflict);
    }
}
