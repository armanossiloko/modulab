namespace Modulab.ControlCenter.Infrastructure;

/// <summary>Well-known paths inside the lab state directory (MODULAB_ROOT, /lab in the appliance).</summary>
public sealed class LabPaths
{
    public LabPaths(string root)
    {
        Root = Path.GetFullPath(root);
    }

    public string Root { get; }

    public string Config => Path.Combine(Root, "lab.config.json");
    public string ExampleConfig => Path.Combine(Root, "lab.config.example.json");
    public string Env => Path.Combine(Root, ".env");
    public string Catalog => Path.Combine(Root, "catalog");

    /// <summary>User-owned recipes. Never touched by kit seeding.</summary>
    public string LocalCatalog => Path.Combine(Root, "catalog.local");

    public string Scripts => Path.Combine(Root, "scripts");
    public string Backups => Path.Combine(Root, "backups");

    /// <summary>Control Center's own state (auth, events, rollback records).</summary>
    public string State => Path.Combine(Root, "data", "control-center");

    public string DashboardJson => Path.Combine(Root, "control-center", "wwwroot", "dashboard.json");
    public string DashboardDefaults => Path.Combine(Root, "control-center", "defaults", "dashboard.json");

    /// <summary>Root certificate of Caddy's internal CA (LAN HTTPS).</summary>
    public string CaddyRootCert =>
        Path.Combine(Root, "data", "caddy", "data", "caddy", "pki", "authorities", "local", "root.crt");

    /// <summary>
    /// Resolve the lab root: explicit setting → /lab (appliance) → nearest parent with lab.config(.example).json.
    /// </summary>
    public static LabPaths Resolve(string? configured)
    {
        if (!string.IsNullOrWhiteSpace(configured))
            return new LabPaths(configured);
        if (Directory.Exists("/lab"))
            return new LabPaths("/lab");

        var dir = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "lab.config.json"))
                || File.Exists(Path.Combine(dir.FullName, "lab.config.example.json")))
                return new LabPaths(dir.FullName);
            dir = dir.Parent;
        }

        return new LabPaths(Directory.GetCurrentDirectory());
    }
}
