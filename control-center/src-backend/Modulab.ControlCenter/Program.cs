using Modulab.ControlCenter;
using Modulab.ControlCenter.Auth;
using Modulab.ControlCenter.Dashboard;
using Modulab.ControlCenter.Endpoints;
using Modulab.ControlCenter.Extensions;
using Modulab.ControlCenter.Infrastructure;

// Full builder (not slim) so static files / SPA hosting work.
var builder = WebApplication.CreateBuilder(args);

builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Logging.SetMinimumLevel(LogLevel.Warning);

var paths = LabPaths.Resolve(builder.Configuration["MODULAB_ROOT"]);

// Control Center UI + /api on HOME_PORT (default 8888).
var port = int.TryParse(builder.Configuration["HOME_PORT"], out var homePort) ? homePort
    : int.TryParse(builder.Configuration["MODULAB_API_PORT"], out var apiPort) ? apiPort
    : 8888;

builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxConcurrentConnections = 64;
    options.Limits.MaxRequestBodySize = 1024 * 1024;
    // Skip binding during build-time OpenAPI document generation.
    if (!OpenApiExtensions.IsDocumentGeneration())
        options.ListenAnyIP(port);
});

builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.TypeInfoResolverChain.Insert(0, LabJsonContext.Default));
builder.AddControlCenterOpenApi();
builder.Services.AddControlCenter(paths);

var app = builder.Build();

app.UseMiddleware<AuthMiddleware>();
app.MapControlCenterOpenApi();
app.MapSystemEndpoints();
app.MapAuthEndpoints();
app.MapLabEndpoints();
app.MapAppEndpoints();
app.MapCustomAppEndpoints();
app.MapBackupEndpoints();
app.MapDashboardEndpoints();
app.MapWidgetEndpoints();

app.Services.GetRequiredService<DashboardStore>().EnsureExists();
// Prefer control-center/wwwroot (dev + Docker mount); fall back to wwwroot beside the binary.
if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("CONTROL_CENTER_WWWROOT")))
{
    var uiRoot = Path.Combine(paths.Root, "control-center", "wwwroot");
    if (Directory.Exists(uiRoot))
        Environment.SetEnvironmentVariable("CONTROL_CENTER_WWWROOT", uiRoot);
}

app.UseControlCenterSpa();
app.Run();

/// <summary>Entry point type, public so integration tests can host the app.</summary>
public partial class Program;
