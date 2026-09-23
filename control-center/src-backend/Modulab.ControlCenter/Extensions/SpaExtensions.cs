namespace Modulab.ControlCenter.Extensions;

public static class SpaExtensions
{
    /// <summary>
    /// Serves Control Center static UI.
    /// Order: CONTROL_CENTER_ANGULAR_DIST → CONTROL_CENTER_WWWROOT → ContentRoot/wwwroot.
    /// A candidate directory is used only when it contains index.html (avoids empty host mounts).
    /// </summary>
    public static WebApplication UseControlCenterSpa(this WebApplication app)
    {
        var wwwroot = Path.Combine(app.Environment.ContentRootPath, "wwwroot");

        var angularDist = Environment.GetEnvironmentVariable("CONTROL_CENTER_ANGULAR_DIST");
        if (HasSpaIndex(angularDist))
            wwwroot = Path.GetFullPath(angularDist!);
        else
        {
            var alt = Environment.GetEnvironmentVariable("CONTROL_CENTER_WWWROOT");
            if (HasSpaIndex(alt))
                wwwroot = Path.GetFullPath(alt!);
        }

        if (!Directory.Exists(wwwroot) || !File.Exists(Path.Combine(wwwroot, "index.html")))
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

    static bool HasSpaIndex(string? path) =>
        !string.IsNullOrWhiteSpace(path)
        && File.Exists(Path.Combine(path, "index.html"));
}
