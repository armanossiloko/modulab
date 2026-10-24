using Modulab.ControlCenter.Auth;
using Modulab.ControlCenter.Models;

namespace Modulab.ControlCenter.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth").WithTags("Auth");

        group.MapGet("/status", (HttpContext ctx, AuthService auth) =>
            {
                ctx.Response.Headers.CacheControl = "no-store";
                var signedIn = auth.IsAuthenticated(ctx);
                return Results.Json(
                    new AuthStatusResponse(auth.IsConfigured, signedIn, signedIn ? AuthService.Username : null),
                    LabJsonContext.Default.AuthStatusResponse);
            })
            .WithName("GetAuthStatus")
            .Produces<AuthStatusResponse>();

        group.MapPost("/setup", (HttpContext ctx, AuthSetupRequest? body, AuthService auth) =>
            {
                if (auth.IsConfigured)
                    return Api.Message("Control Center already has an admin password", StatusCodes.Status409Conflict);
                try
                {
                    auth.Setup(body?.Password ?? "");
                }
                catch (ArgumentException ex)
                {
                    return Api.BadRequest(ex.Message);
                }
                catch (InvalidOperationException ex)
                {
                    return Api.Message(ex.Message, StatusCodes.Status409Conflict);
                }
                auth.SignIn(ctx, remember: true);
                return Api.Message("Admin password set");
            })
            .WithName("SetupAuth")
            .Accepts<AuthSetupRequest>("application/json")
            .Produces<ApiMessage>()
            .ProducesApiMessage(StatusCodes.Status400BadRequest, StatusCodes.Status409Conflict);

        group.MapPost("/login", (HttpContext ctx, LoginRequest? body, AuthService auth) =>
            {
                if (!auth.IsConfigured)
                    return Api.Message("Set an admin password first", StatusCodes.Status409Conflict);
                var client = AuthService.ClientKey(ctx);
                if (auth.LockedOutFor(client) is { } wait)
                    return Api.Message(
                        $"Too many failed attempts. Try again in {Math.Ceiling(wait.TotalMinutes):0} min.",
                        StatusCodes.Status429TooManyRequests);
                if (!auth.VerifyPassword(body?.Password))
                {
                    auth.RecordFailure(client);
                    return Api.Message("Wrong password", StatusCodes.Status401Unauthorized);
                }
                auth.RecordSuccess(client);
                auth.SignIn(ctx, body?.Remember == true);
                return Api.Message("Signed in");
            })
            .WithName("Login")
            .Accepts<LoginRequest>("application/json")
            .Produces<ApiMessage>()
            .ProducesApiMessage(StatusCodes.Status401Unauthorized, StatusCodes.Status409Conflict, StatusCodes.Status429TooManyRequests);

        group.MapPost("/logout", (HttpContext ctx, AuthService auth) =>
            {
                auth.SignOut(ctx);
                return Api.Message("Signed out");
            })
            .WithName("Logout")
            .Produces<ApiMessage>();

        group.MapPost("/logout-all", (HttpContext ctx, AuthService auth) =>
            {
                auth.SignOutEverywhere();
                auth.SignIn(ctx, remember: false);
                return Api.Message("Signed out every other session");
            })
            .WithName("LogoutEverywhere")
            .Produces<ApiMessage>();

        group.MapPost("/password", (HttpContext ctx, ChangePasswordRequest? body, AuthService auth) =>
            {
                if (body is null)
                    return Api.BadRequest("Missing body");
                try
                {
                    if (!auth.ChangePassword(body.CurrentPassword, body.NewPassword))
                        return Api.Message("Current password is wrong", StatusCodes.Status403Forbidden);
                }
                catch (ArgumentException ex)
                {
                    return Api.BadRequest(ex.Message);
                }
                // New password rotated the session key; keep this browser signed in.
                auth.SignIn(ctx, remember: false);
                return Api.Message("Password changed. Other sessions were signed out.");
            })
            .WithName("ChangePassword")
            .Accepts<ChangePasswordRequest>("application/json")
            .Produces<ApiMessage>()
            .ProducesApiMessage(StatusCodes.Status400BadRequest, StatusCodes.Status403Forbidden);

        // Caddy forward_auth probe for protected app hostnames.
        group.MapGet("/verify", (HttpContext ctx, AuthService auth) =>
            {
                ctx.Response.Headers.CacheControl = "no-store";
                if (auth.IsAuthenticated(ctx))
                {
                    ctx.Response.Headers["X-Modulab-User"] = AuthService.Username;
                    return Results.NoContent();
                }
                return Results.Redirect(auth.LoginRedirect(ctx.Request));
            })
            .WithName("VerifySession")
            .Produces(StatusCodes.Status204NoContent)
            .Produces(StatusCodes.Status302Found);
    }
}
