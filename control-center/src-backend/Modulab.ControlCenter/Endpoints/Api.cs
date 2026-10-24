using Modulab.ControlCenter.Models;

namespace Modulab.ControlCenter.Endpoints;

/// <summary>Shorthands for JSON results through the source-generated context (AOT-safe).</summary>
public static class Api
{
    public static IResult Message(string message, int status = StatusCodes.Status200OK) =>
        Results.Json(new ApiMessage(message), LabJsonContext.Default.ApiMessage, statusCode: status);

    public static IResult NotFound(string message) => Message(message, StatusCodes.Status404NotFound);
    public static IResult BadRequest(string message) => Message(message, StatusCodes.Status400BadRequest);
    public static IResult Error(Exception ex) => Message(ex.Message, StatusCodes.Status500InternalServerError);

    public static IResult UnknownApp(string id) => NotFound($"Unknown app '{id}'");

    public static IResult Task(AppTaskDto snapshot, int status) =>
        Results.Json(new AppTaskSnapshot(snapshot), LabJsonContext.Default.AppTaskSnapshot, statusCode: status);

    /// <summary>202 when a task was started, 409 with the running task when busy.</summary>
    public static IResult TaskStarted(bool started, AppTaskDto snapshot) =>
        Task(snapshot, started ? StatusCodes.Status202Accepted : StatusCodes.Status409Conflict);

    public static RouteHandlerBuilder ProducesApiMessage(this RouteHandlerBuilder builder, params int[] statusCodes)
    {
        foreach (var code in statusCodes)
            builder.Produces<ApiMessage>(code);
        return builder;
    }

    public static RouteHandlerBuilder ProducesTask(this RouteHandlerBuilder builder) =>
        builder
            .Produces<AppTaskSnapshot>(StatusCodes.Status202Accepted)
            .Produces<AppTaskSnapshot>(StatusCodes.Status409Conflict);
}
