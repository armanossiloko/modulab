using System.Text.Json.Nodes;
using Modulab.ControlCenter.Catalog;
using Modulab.ControlCenter.Infrastructure;
using Modulab.ControlCenter.Models;

namespace Modulab.ControlCenter.Lab;

/// <summary>Settings → Lab: host IP, domain, shared credentials, LAN proxy / HTTPS / Pi-hole.</summary>
public sealed class LabSettingsService(
    LabPaths paths,
    LabConfigStore config,
    RecipeStore recipes,
    LabScripts scripts,
    DockerCli docker,
    ILogger<LabSettingsService> log)
{
    public async Task<LabStatusResponse> StatusAsync(HttpRequest req, CancellationToken ct)
    {
        var cfg = config.Load();
        var lab = config.Lab(cfg);
        var hostIp = LabConfigStore.GetString(lab, "hostIp") ?? "";
        var needsHostIp = LabConfigStore.IsPlaceholderHostIp(hostIp);
        var enabled = config.Enabled();
        var containers = await docker.TryListContainersAsync(ct);
        bool Running(string name) => containers.Any(c => c.Name == name && c.State == "running");
        var baseOk = Running("postgres") && (!enabled.Contains("caddy") || Running("caddy"));
        return new LabStatusResponse(
            Ready: !needsHostIp,
            NeedsHostIp: needsHostIp,
            BaseStacksRunning: baseOk,
            HostIp: string.IsNullOrWhiteSpace(hostIp) ? null : hostIp,
            SuggestedHostIp: SuggestHostIp(req),
            Domain: LabConfigStore.GetString(lab, "domain") ?? "network.lan",
            LanHttps: LanProxy(cfg) && LabConfigStore.GetBool(lab, "enableLanHttps"),
            WeakSecrets: config.WeakSecrets());
    }

    static bool LanProxy(JsonObject cfg) =>
        cfg["caddy"] is JsonObject caddy && LabConfigStore.GetBool(caddy, "ENABLE_LAN_PROXY");

    static string? SuggestHostIp(HttpRequest req)
    {
        var fromEnv = Environment.GetEnvironmentVariable("MODULAB_HOST_IP");
        if (!string.IsNullOrWhiteSpace(fromEnv) && !LabConfigStore.IsPlaceholderHostIp(fromEnv))
            return fromEnv.Trim();

        var host = req.Host.Host;
        if (!string.IsNullOrWhiteSpace(host)
            && host is not "localhost" and not "127.0.0.1"
            && !host.Contains(':')
            && System.Net.IPAddress.TryParse(host, out _))
            return host;

        return null;
    }

    public LabSettingsResponse Get()
    {
        var cfg = config.Load();
        var lab = config.Lab(cfg);
        return new LabSettingsResponse(
            HostIp: LabConfigStore.GetString(lab, "hostIp") ?? "",
            Domain: LabConfigStore.GetString(lab, "domain") ?? "network.lan",
            Timezone: LabConfigStore.GetString(lab, "timezone") ?? "UTC",
            PostgresUser: LabConfigStore.GetString(lab, "postgresUser") ?? "modulab",
            PostgresPassword: LabConfigStore.GetString(lab, "postgresPassword") ?? "modulab",
            PostgresDb: LabConfigStore.GetString(lab, "postgresDb") ?? "modulab",
            PiholePassword: LabConfigStore.GetString(lab, "piholePassword") ?? "modulab",
            EnableLanProxy: LanProxy(cfg),
            EnablePihole: config.Enabled().Contains("pihole"),
            EnableLanHttps: LabConfigStore.GetBool(lab, "enableLanHttps"),
            CaCertificateAvailable: File.Exists(paths.CaddyRootCert));
    }

    public async Task ApplyAsync(LabSettingsUpdate body)
    {
        var before = config.Lab(config.Load());
        var oldPassword = LabConfigStore.GetString(before, "postgresPassword") ?? "modulab";
        var user = LabConfigStore.GetString(before, "postgresUser") ?? "modulab";
        var db = LabConfigStore.GetString(before, "postgresDb") ?? "modulab";
        var rotatePostgres = body.PostgresPassword is not null && body.PostgresPassword != oldPassword;
        if (rotatePostgres && string.IsNullOrWhiteSpace(body.PostgresPassword))
            throw new InvalidOperationException("Postgres password cannot be empty");

        // Change the role password first: if that fails, the config keeps the password that still works.
        if (rotatePostgres && await docker.IsRunningAsync("postgres"))
            await RotatePostgresPasswordAsync(user, db, body.PostgresPassword!);

        var enableCaddy = false;
        config.Update(cfg =>
        {
            var lab = config.Lab(cfg);
            if (cfg["caddy"] is not JsonObject caddy)
            {
                caddy = new JsonObject();
                cfg["caddy"] = caddy;
            }

            if (body.HostIp is not null) lab["hostIp"] = body.HostIp.Trim();
            if (body.Domain is not null) lab["domain"] = body.Domain.Trim();
            if (body.Timezone is not null) lab["timezone"] = body.Timezone.Trim();
            if (body.PostgresUser is not null) lab["postgresUser"] = body.PostgresUser;
            if (body.PostgresPassword is not null) lab["postgresPassword"] = body.PostgresPassword;
            if (body.PostgresDb is not null) lab["postgresDb"] = body.PostgresDb;
            if (body.PiholePassword is not null) lab["piholePassword"] = body.PiholePassword;
            if (body.EnableLanProxy is bool lan) caddy["ENABLE_LAN_PROXY"] = lan;
            if (body.EnableLanHttps is bool https) lab["enableLanHttps"] = https;

            LabConfigStore.SetEnabled(cfg, "control-center", true);
            LabConfigStore.SetEnabled(cfg, "postgres", true);
            if (body.EnableLanProxy is true)
                LabConfigStore.SetEnabled(cfg, "caddy", true);
            if (body.EnablePihole is bool ph)
                LabConfigStore.SetEnabled(cfg, "pihole", ph);
            enableCaddy = LabConfigStore.GetStringList(cfg, "enabled").Contains("caddy");
        });

        await scripts.RunAsync("render-config.sh");
        await scripts.TryRunAsync("start.sh", "postgres");

        if (rotatePostgres)
        {
            // Recreate apps whose env carries the old password.
            var enabled = config.Enabled();
            foreach (var recipe in recipes.All())
            {
                if (!enabled.Contains(recipe.Id) || recipe.Id is "postgres" or "control-center")
                    continue;
                if (recipe.Database is not null || recipe.DependsOn.Contains("postgres"))
                    await scripts.TryRunAsync("start.sh", recipe.Id);
            }
        }

        if (enableCaddy)
            await scripts.TryRunAsync("start.sh", "caddy");

        if (body.EnablePihole is true)
            await scripts.TryRunAsync("start.sh", "pihole");
        else if (body.EnablePihole is false)
            await scripts.TryRunAsync("stop.sh", "pihole");

        await scripts.TryRunAsync("refresh-edge.sh");
    }

    async Task RotatePostgresPasswordAsync(string user, string db, string password)
    {
        var literal = "'" + password.Replace("'", "''") + "'";
        var ident = "\"" + user.Replace("\"", "\"\"") + "\"";
        var result = await docker.RunAsync(
            ["exec", "postgres", "psql", "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1",
             "-c", $"ALTER ROLE {ident} WITH PASSWORD {literal}"],
            TimeSpan.FromSeconds(30));
        if (!result.Ok)
            throw new InvalidOperationException($"Could not change the Postgres password: {result.StdErr.Trim()}");
        log.LogWarning("Postgres password for role {User} rotated", user);
    }
}
