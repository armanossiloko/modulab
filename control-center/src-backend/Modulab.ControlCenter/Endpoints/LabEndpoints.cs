using Modulab.ControlCenter.Infrastructure;
using Modulab.ControlCenter.Lab;
using Modulab.ControlCenter.Models;

namespace Modulab.ControlCenter.Endpoints;

public static class LabEndpoints
{
    public static void MapLabEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/lab").WithTags("Lab");

        group.MapGet("/status", async (HttpRequest req, LabSettingsService lab, CancellationToken ct) =>
                Results.Json(await lab.StatusAsync(req, ct), LabJsonContext.Default.LabStatusResponse))
            .WithName("GetLabStatus")
            .Produces<LabStatusResponse>();

        group.MapGet("/settings", (LabSettingsService lab) =>
            {
                try
                {
                    return Results.Json(lab.Get(), LabJsonContext.Default.LabSettingsResponse);
                }
                catch (Exception ex)
                {
                    return Api.Error(ex);
                }
            })
            .WithName("GetLabSettings")
            .Produces<LabSettingsResponse>()
            .ProducesApiMessage(StatusCodes.Status500InternalServerError);

        group.MapPut("/settings", async (LabSettingsUpdate? body, LabSettingsService lab) =>
            {
                if (body is null)
                    return Api.BadRequest("Missing body");
                try
                {
                    await lab.ApplyAsync(body);
                    return Results.Json(lab.Get(), LabJsonContext.Default.LabSettingsResponse);
                }
                catch (Exception ex)
                {
                    return Api.BadRequest(ex.Message);
                }
            })
            .WithName("PutLabSettings")
            .Produces<LabSettingsResponse>()
            .ProducesApiMessage(StatusCodes.Status400BadRequest);

        // Root certificate of Caddy's internal CA. Public on purpose: devices install it before signing in.
        group.MapGet("/ca.crt", (LabPaths paths) =>
                File.Exists(paths.CaddyRootCert)
                    ? Results.File(paths.CaddyRootCert, "application/x-x509-ca-cert", "modulab-root-ca.crt")
                    : Api.NotFound("No LAN certificate yet. Enable LAN HTTPS and open an https:// app link once."))
            .WithName("GetCaCertificate")
            .Produces(StatusCodes.Status200OK, contentType: "application/x-x509-ca-cert")
            .ProducesApiMessage(StatusCodes.Status404NotFound);
    }
}
