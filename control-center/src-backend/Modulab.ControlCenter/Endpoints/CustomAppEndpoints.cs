using Modulab.ControlCenter.Catalog;
using Modulab.ControlCenter.Models;

namespace Modulab.ControlCenter.Endpoints;

public static class CustomAppEndpoints
{
    public static void MapCustomAppEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/custom-apps").WithTags("Custom apps");

        group.MapGet("/{id}", (string id, CustomAppService custom) =>
                custom.Get(id) is { } found
                    ? Results.Json(found, LabJsonContext.Default.CustomAppResponse)
                    : Api.NotFound($"Unknown custom app '{id}'"))
            .WithName("GetCustomApp")
            .Produces<CustomAppResponse>()
            .ProducesApiMessage(StatusCodes.Status404NotFound);

        group.MapPost("/validate", async (CustomAppRequest? body, bool? update, CustomAppService custom, CancellationToken ct) =>
            {
                if (body is null)
                    return Api.BadRequest("Missing body");
                return Results.Json(await custom.ValidateAsync(body, update == true, ct), LabJsonContext.Default.CustomAppValidation);
            })
            .WithName("ValidateCustomApp")
            .Accepts<CustomAppRequest>("application/json")
            .Produces<CustomAppValidation>()
            .ProducesApiMessage(StatusCodes.Status400BadRequest);

        group.MapPost("", (CustomAppRequest? body, CustomAppService custom, CancellationToken ct) =>
                SaveAsync(body, isUpdate: false, custom, ct))
            .WithName("CreateCustomApp")
            .Accepts<CustomAppRequest>("application/json")
            .Produces<CustomAppResponse>(StatusCodes.Status201Created)
            .Produces<CustomAppValidation>(StatusCodes.Status422UnprocessableEntity)
            .ProducesApiMessage(StatusCodes.Status400BadRequest);

        group.MapPut("/{id}", (string id, CustomAppRequest? body, CustomAppService custom, CancellationToken ct) =>
                body is not null && body.Id != id
                    ? Task.FromResult(Api.BadRequest("The id in the URL and body differ"))
                    : SaveAsync(body, isUpdate: true, custom, ct))
            .WithName("UpdateCustomApp")
            .Accepts<CustomAppRequest>("application/json")
            .Produces<CustomAppResponse>()
            .Produces<CustomAppValidation>(StatusCodes.Status422UnprocessableEntity)
            .ProducesApiMessage(StatusCodes.Status400BadRequest);

        group.MapDelete("/{id}", async (string id, CustomAppService custom, CancellationToken ct) =>
            {
                try
                {
                    await custom.DeleteAsync(id, ct);
                    return Api.Message($"Deleted {id}");
                }
                catch (KeyNotFoundException ex)
                {
                    return Api.NotFound(ex.Message);
                }
                catch (InvalidOperationException ex)
                {
                    return Api.Message(ex.Message, StatusCodes.Status409Conflict);
                }
            })
            .WithName("DeleteCustomApp")
            .Produces<ApiMessage>()
            .ProducesApiMessage(StatusCodes.Status404NotFound, StatusCodes.Status409Conflict);
    }

    static async Task<IResult> SaveAsync(CustomAppRequest? body, bool isUpdate, CustomAppService custom, CancellationToken ct)
    {
        if (body is null)
            return Api.BadRequest("Missing body");
        var (validation, recipe) = await custom.SaveAsync(body, isUpdate, ct);
        if (recipe is null)
            return Results.Json(validation, LabJsonContext.Default.CustomAppValidation, statusCode: StatusCodes.Status422UnprocessableEntity);
        return Results.Json(
            custom.Get(recipe.Id)!,
            LabJsonContext.Default.CustomAppResponse,
            statusCode: isUpdate ? StatusCodes.Status200OK : StatusCodes.Status201Created);
    }
}
