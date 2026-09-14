namespace Modulab.ControlCenter.Extensions;

public static class SpaExtensions
{
    /// <summary>
    /// Serves Control Center static UI.
    /// Order: CONTROL_CENTER_ANGULAR_DIST → CONTROL_CENTER_WWWROOT → ContentRoot/wwwroot.
    /// </summary>
    public static WebApplication UseControlCenterSpa(this WebApplication app)
    {
        var wwwroot = Path.Combine(app.Environment.ContentRootPath, "wwwroot");

        var angularDist = Environment.GetEnvironmentVariable("CONTROL_CENTER_ANGULAR_DIST");
        if (!string.IsNullOrWhiteSpace(angularDist) && File.Exists(Path.Combine(angularDist, "index.html")))
        {
            wwwroot = Path.GetFullPath(angularDist);
        }
        else
        {
            var alt = Environment.GetEnvironmentVariable("CONTROL_CENTER_WWWROOT");
            // Require index.html so a seeded host wwwroot (dashboard.json only) does not
            // shadow the SPA baked into the image at ContentRoot/wwwroot.
            if (!string.IsNullOrWhiteSpace(alt) && File.Exists(Path.Combine(alt, "index.html")))
                wwwroot = Path.GetFullPath(alt);
        }

        if (!Directory.Exists(wwwroot))
            return app;

        var fileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(wwwroot);
        var staticOptions = new StaticFileOptions { FileProvider = fileProvider };
        var defaultOptions = new DefaultFilesOptions { FileProvider = fileProvider };
        defaultOptions.DefaultFileNames.Clear();
        defaultOptions.DefaultFileNames.Add("index.html");

        app.UseDefaultFiles(defaultOptions);
        app.UseStaticFiles(staticOptions);
        app.MapFallbackToFile("index.html", new StaticFileOptions { FileProvider = fileProvider });
        return app;
    }
}
