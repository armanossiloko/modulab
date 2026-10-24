using System.Text.Json.Nodes;
using Modulab.ControlCenter.Dashboard;
using Modulab.ControlCenter.Models;

namespace Modulab.ControlCenter.Endpoints;

public static class DashboardEndpoints
{
    public static void MapDashboardEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/dashboard").WithTags("Dashboard");

        group.MapPost("/bookmarks", (ImportBookmarksRequest? body, DashboardStore dashboard) =>
            {
                if (body?.Groups is null || body.Groups.Count == 0)
                    return Api.BadRequest("No bookmark groups to import");
                try
                {
                    return Api.Message($"Imported {dashboard.ImportBookmarks(body)} shortcut(s) into dashboard.json");
                }
                catch (Exception ex)
                {
                    return Api.Error(ex);
                }
            })
            .WithName("ImportBookmarks")
            .Accepts<ImportBookmarksRequest>("application/json")
            .Produces<ApiMessage>()
            .ProducesApiMessage(StatusCodes.Status400BadRequest, StatusCodes.Status500InternalServerError);

        group.MapPut("/bookmarks", (ReplaceBookmarksRequest? body, DashboardStore dashboard) =>
            {
                if (body?.Groups is null)
                    return Api.BadRequest("Missing bookmark groups");
                try
                {
                    return Api.Message($"Saved {dashboard.ReplaceBookmarks(body)} shortcut group(s)");
                }
                catch (Exception ex)
                {
                    return Api.Error(ex);
                }
            })
            .WithName("ReplaceBookmarks")
            .Accepts<ReplaceBookmarksRequest>("application/json")
            .Produces<ApiMessage>()
            .ProducesApiMessage(StatusCodes.Status400BadRequest, StatusCodes.Status500InternalServerError);

        group.MapGet("", (DashboardStore dashboard) =>
            {
                try
                {
                    return Results.Json(dashboard.Load(), LabJsonContext.Default.JsonNode);
                }
                catch (Exception ex)
                {
                    return Api.Error(ex);
                }
            })
            .WithName("GetDashboard")
            .Produces<JsonNode>(StatusCodes.Status200OK, "application/json")
            .ProducesApiMessage(StatusCodes.Status500InternalServerError);

        group.MapPut("", (JsonNode? body, DashboardStore dashboard) =>
            {
                if (body is null)
                    return Api.BadRequest("Missing body");
                try
                {
                    dashboard.Save(body);
                    return Api.Message("Settings saved");
                }
                catch (Exception ex)
                {
                    return Api.BadRequest(ex.Message);
                }
            })
            .WithName("PutDashboard")
            .Accepts<JsonNode>("application/json")
            .Produces<ApiMessage>()
            .ProducesApiMessage(StatusCodes.Status400BadRequest);
    }
}
