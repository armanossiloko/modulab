using Modulab.ControlCenter.Models;

namespace Modulab.ControlCenter.Auth;

/// <summary>
/// Guards /api: a valid session cookie is required except for health, sign-in and the forward_auth probe.
/// State-changing requests from another origin are refused (cookie-based CSRF guard).
/// </summary>
public sealed class AuthMiddleware(RequestDelegate next, AuthService auth)
{
    static readonly string[] PublicPrefixes =
    [
        "/api/health",
        "/api/auth/status",
        "/api/auth/setup",
        "/api/auth/login",
        "/api/auth/logout",
        "/api/auth/verify",
        "/api/lab/ca.crt",
    ];

    public async Task InvokeAsync(HttpContext ctx)
    {
        var path = ctx.Request.Path.Value ?? "";
        if (!path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase))
        {
            await next(ctx);
            return;
        }

        if (!HttpMethods.IsGet(ctx.Request.Method) && !HttpMethods.IsHead(ctx.Request.Method) && IsCrossOrigin(ctx.Request))
        {
            await Reject(ctx, StatusCodes.Status403Forbidden, "Cross-origin request refused");
            return;
        }

        if (PublicPrefixes.Any(p => path.Equals(p, StringComparison.OrdinalIgnoreCase)) || auth.IsAuthenticated(ctx))
        {
            await next(ctx);
            return;
        }

        await Reject(
            ctx,
            StatusCodes.Status401Unauthorized,
            auth.IsConfigured ? "Sign in required" : "Set an admin password first");
    }

    /// <summary>Origin (or Referer) must match the host the request was sent to.</summary>
    static bool IsCrossOrigin(HttpRequest req)
    {
        var origin = req.Headers.Origin.ToString();
        if (string.IsNullOrEmpty(origin))
            origin = req.Headers.Referer.ToString();
        if (string.IsNullOrEmpty(origin))
            return false; // non-browser clients (curl, scripts) send neither
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
            return true;
        var host = req.Headers["X-Forwarded-Host"].ToString();
        if (string.IsNullOrEmpty(host))
            host = req.Host.Value ?? "";
        var hostOnly = host.Split(':')[0];
        return !string.Equals(uri.Host, hostOnly, StringComparison.OrdinalIgnoreCase);
    }

    static Task Reject(HttpContext ctx, int status, string message)
    {
        ctx.Response.StatusCode = status;
        ctx.Response.Headers.CacheControl = "no-store";
        return ctx.Response.WriteAsJsonAsync(new ApiMessage(message), LabJsonContext.Default.ApiMessage);
    }
}
