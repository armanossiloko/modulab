using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Modulab.ControlCenter.Catalog;
using Modulab.ControlCenter.Infrastructure;
using Modulab.ControlCenter.Lab;
using Modulab.ControlCenter.Models;
using Modulab.ControlCenter.Updates;

namespace Modulab.ControlCenter.Apps;

/// <summary>Install / start / stop / uninstall lab apps and build their Library entries.</summary>
public sealed partial class AppService(
    LabPaths paths,
    LabConfigStore config,
    RecipeStore recipes,
    LabScripts scripts,
    DockerCli docker,
    UpdateService updates,
    ILogger<AppService> log)
{
    [GeneratedRegex(@"^[A-Za-z_][A-Za-z0-9_]*$")]
    private static partial Regex EnvKeyRegex();

    public async Task<List<CatalogItem>> CatalogAsync(CancellationToken ct)
    {
        var all = recipes.All();
        return await ItemsAsync(all, ct);
    }

    public async Task<CatalogItem?> ItemAsync(string id, CancellationToken ct)
    {
        var recipe = recipes.Find(id);
        if (recipe is null)
            return null;
        return (await ItemsAsync([recipe], ct)).Single();
    }

    async Task<List<CatalogItem>> ItemsAsync(List<Recipe> list, CancellationToken ct)
    {
        var enabled = config.Enabled();
        var containers = await docker.TryListContainersAsync(ct);
        var releases = await updates.ReleasesAsync(list, containers, ct);
        var cfg = config.Load();
        var lab = config.Lab(cfg);
        var protectedApps = LabConfigStore.GetStringList(lab, "protectedApps").ToHashSet(StringComparer.Ordinal);
        var lanProxy = LanProxyEnabled(cfg);
        var https = lanProxy && LabConfigStore.GetBool(lab, "enableLanHttps");
        var domain = LabConfigStore.GetString(lab, "domain") ?? "network.lan";

        return list
            .Select(r => ToItem(r, enabled, containers, releases.GetValueOrDefault(r.Id), protectedApps, lanProxy, https, domain))
            .ToList();
    }

    CatalogItem ToItem(
        Recipe recipe,
        HashSet<string> enabled,
        IReadOnlyList<ContainerInfo> containers,
        ImageRelease? release,
        HashSet<string> protectedApps,
        bool lanProxy,
        bool https,
        string domain)
    {
        var mine = DockerCli.ForRecipe(containers, recipe.Id);
        var isRunning = mine.Any(c => c.IsUp);
        var isEnabled = enabled.Contains(recipe.Id) || recipe.Core;

        // Status from Docker + whether the app is still expected in the stack (enabled).
        var status = isRunning ? "running"
            : mine.Count > 0 ? "stopped"
            : isEnabled ? "removed" // enabled in the lab, but no container — Install creates it
            : "available";

        string? health = null;
        if (mine.Any(c => c.Health == "unhealthy"))
            health = "unhealthy";
        else if (mine.Any(c => c.Health == "starting"))
            health = "starting";
        else if (mine.Any(c => c.Health == "healthy"))
            health = "healthy";

        string? url = null;
        var path = recipe.Path ?? "";
        if (lanProxy && !string.IsNullOrWhiteSpace(recipe.Proxy?.Host))
            url = $"{(https ? "https" : "http")}://{recipe.Proxy!.Host}.{domain}{path}";
        else if (recipe.Port is int port)
            url = $"http://127.0.0.1:{port}{path}";

        return new CatalogItem(
            recipe.Id,
            recipe.Name,
            recipe.Description,
            recipe.Category,
            recipe.Port,
            recipe.Path,
            url,
            recipe.Installable,
            recipe.Core,
            recipe.DependsOn,
            recipe.Fields,
            isEnabled,
            isRunning,
            status,
            release?.Version,
            release?.ReleasedAt,
            recipe.Custom,
            protectedApps.Contains(recipe.Id),
            CanProtect(recipe),
            File.Exists(RollbackRecordPath(recipe.Id)),
            health);
    }

    public static bool CanProtect(Recipe recipe) =>
        recipe.Id != "control-center" && !string.IsNullOrWhiteSpace(recipe.Proxy?.Host);

    public string RollbackRecordPath(string id) => Path.Combine(paths.State, "rollback", $"{id}.json");

    static bool LanProxyEnabled(JsonObject cfg) =>
        cfg["caddy"] is JsonObject caddy && LabConfigStore.GetBool(caddy, "ENABLE_LAN_PROXY");

    public async Task InstallAsync(Recipe recipe, Dictionary<string, JsonElement>? fields)
    {
        var byId = recipes.All().ToDictionary(r => r.Id, StringComparer.Ordinal);
        var visiting = new HashSet<string>(StringComparer.Ordinal);

        config.Update(cfg =>
        {
            void EnableTree(string id)
            {
                if (!visiting.Add(id) || !byId.TryGetValue(id, out var node))
                    return;
                foreach (var dep in node.DependsOn)
                    EnableTree(dep);
                LabConfigStore.SetEnabled(cfg, id, true);
            }

            EnableTree(recipe.Id);
            var section = cfg[recipe.Id] as JsonObject ?? new JsonObject();
            // Match install.sh: defaults fill missing keys only (do not clobber user config).
            foreach (var (key, value) in recipe.Defaults)
            {
                if (!section.ContainsKey(key))
                    section[key] = JsonNode.Parse(value.GetRawText());
            }

            var lab = config.Lab(cfg);
            foreach (var field in recipe.Fields)
            {
                if (!string.IsNullOrEmpty(field.FromLab) && lab[field.FromLab] is not null && !section.ContainsKey(field.Key))
                    section[field.Key] = lab[field.FromLab]!.DeepClone();
                else if (field.Default is { } def
                         && def.ValueKind is not JsonValueKind.Undefined and not JsonValueKind.Null
                         && !section.ContainsKey(field.Key))
                    section[field.Key] = JsonNode.Parse(def.GetRawText());
            }

            ApplyFields(recipe, section, fields);
            cfg[recipe.Id] = section;
        });

        await ApplyPreferSharedRedisAsync(recipe);

        try
        {
            await scripts.RunAsync("render-config.sh");
            await scripts.RunAsync("start.sh", recipe.Id);
            await EnsureContainerRunningAsync(recipe);
        }
        catch
        {
            // Install enables the app before start — roll back so failed installs stay "available".
            try { config.Disable(recipe.Id); } catch { /* best-effort */ }
            throw;
        }

        // Install succeeded; LAN DNS/proxy reload is best-effort when edge stacks exist.
        await scripts.TryRunAsync("refresh-edge.sh");
        updates.InvalidateReleases();
    }

    /// <summary>Copy submitted install/config values for keys the recipe declares (plus valid env keys for custom apps).</summary>
    static void ApplyFields(Recipe recipe, JsonObject section, Dictionary<string, JsonElement>? fields)
    {
        if (fields is null)
            return;
        var declared = recipe.Fields.Select(f => f.Key).ToHashSet(StringComparer.Ordinal);
        foreach (var (key, value) in fields)
        {
            if (!declared.Contains(key) && !(recipe.Custom && EnvKeyRegex().IsMatch(key)))
                continue;
            section[key] = JsonNode.Parse(value.GetRawText());
        }
    }

    async Task ApplyPreferSharedRedisAsync(Recipe recipe)
    {
        var prefersRedis = recipe.Id == "immich" || recipe.PreferShared.Contains("redis", StringComparer.Ordinal);
        if (!prefersRedis)
            return;

        var redisOk = config.Enabled().Contains("redis") || await docker.IsRunningAsync("redis");
        config.Update(cfg =>
        {
            var section = cfg[recipe.Id] as JsonObject ?? new JsonObject();
            // Explicit hostname from install form / prior config: honor sidecar vs shared.
            if (LabConfigStore.GetString(section, "REDIS_HOSTNAME") == "immich-redis")
            {
                section["useSidecarRedis"] = true;
            }
            else
            {
                section["REDIS_HOSTNAME"] = redisOk ? "redis" : "immich-redis";
                section["useSidecarRedis"] = !redisOk;
            }
            cfg[recipe.Id] = section;
        });
    }

    async Task EnsureContainerRunningAsync(Recipe recipe)
    {
        var mine = DockerCli.ForRecipe(await docker.TryListContainersAsync(), recipe.Id);
        if (mine.Any(c => c.IsUp))
            return;
        var name = string.IsNullOrWhiteSpace(recipe.Name) ? recipe.Id : recipe.Name;
        throw new InvalidOperationException(mine.Count > 0
            ? $"{name} installed, but its container is not running."
            : $"{name} install did not create a container.");
    }

    public async Task StartAsync(Recipe recipe)
    {
        config.Enable(recipe.Id);
        await scripts.RunAsync("render-config.sh");
        await scripts.RunAsync("start.sh", recipe.Id);
        await scripts.TryRunAsync("refresh-edge.sh");
        updates.InvalidateReleases();
    }

    public Task StopAsync(Recipe recipe) => scripts.RunAsync("stop.sh", recipe.Id);

    /// <summary>Stop and disable. With <paramref name="purge"/>, also delete volumes, data directories and the app's database.</summary>
    public async Task<string> UninstallAsync(Recipe recipe, bool purge)
    {
        if (purge)
            await scripts.RunAsync("stop.sh", recipe.Id, "-v");
        else
            await scripts.RunAsync("stop.sh", recipe.Id);

        config.Update(cfg =>
        {
            LabConfigStore.SetEnabled(cfg, recipe.Id, false);
            if (purge)
                cfg.Remove(recipe.Id);
            var lab = config.Lab(cfg);
            if (lab["protectedApps"] is JsonArray arr)
            {
                for (var i = arr.Count - 1; i >= 0; i--)
                {
                    if (arr[i] is JsonValue v && v.TryGetValue<string>(out var s) && s == recipe.Id)
                        arr.RemoveAt(i);
                }
            }
        });

        var removed = new List<string>();
        if (purge)
        {
            foreach (var rel in recipe.Data)
            {
                var full = SafeDataPath(rel);
                if (full is null || !Directory.Exists(full))
                    continue;
                Directory.Delete(full, recursive: true);
                removed.Add(rel);
            }

            if (await DropDatabaseAsync(recipe) is { } db)
                removed.Add($"database {db}");
            if (File.Exists(RollbackRecordPath(recipe.Id)))
                File.Delete(RollbackRecordPath(recipe.Id));
        }

        await scripts.RunAsync("render-config.sh");
        await scripts.TryRunAsync("refresh-edge.sh");
        updates.Invalidate();

        if (!purge)
            return $"Uninstalled {recipe.Id} (data kept)";
        return removed.Count == 0
            ? $"Uninstalled {recipe.Id} and removed its volumes"
            : $"Uninstalled {recipe.Id}; removed {string.Join(", ", removed)}";
    }

    /// <summary>Resolve a recipe data path, refusing anything outside data/ (never media/, never the lab root).</summary>
    public string? SafeDataPath(string relative)
    {
        if (string.IsNullOrWhiteSpace(relative) || Path.IsPathRooted(relative))
            return null;
        var dataRoot = Path.GetFullPath(Path.Combine(paths.Root, "data")) + Path.DirectorySeparatorChar;
        var full = Path.GetFullPath(Path.Combine(paths.Root, relative));
        if (!full.StartsWith(dataRoot, StringComparison.Ordinal))
            return null;
        // data/control-center holds auth + backups metadata; never let a recipe claim it.
        var own = Path.GetFullPath(paths.State) + Path.DirectorySeparatorChar;
        if ((full + Path.DirectorySeparatorChar).StartsWith(own, StringComparison.Ordinal))
            return null;
        return full;
    }

    async Task<string?> DropDatabaseAsync(Recipe recipe)
    {
        var db = recipe.Database;
        if (string.IsNullOrWhiteSpace(db) || !EnvKeyRegex().IsMatch(db))
            return null;

        var lab = config.Lab(config.Load());
        var defaultDb = LabConfigStore.GetString(lab, "postgresDb") ?? "modulab";
        if (db == defaultDb)
            return null;
        // Another installed app may share the database name — keep it then.
        var enabled = config.Enabled();
        if (recipes.All().Any(r => r.Id != recipe.Id && r.Database == db && enabled.Contains(r.Id)))
            return null;
        if (!await docker.IsRunningAsync("postgres"))
        {
            log.LogWarning("Purge {Id}: postgres is not running, database {Db} kept", recipe.Id, db);
            return null;
        }

        var user = LabConfigStore.GetString(lab, "postgresUser") ?? "modulab";
        var result = await docker.RunAsync(
            ["exec", "postgres", "psql", "-U", user, "-d", defaultDb, "-v", "ON_ERROR_STOP=1",
             "-c", $"DROP DATABASE IF EXISTS \"{db}\" WITH (FORCE)"],
            TimeSpan.FromSeconds(60));
        if (!result.Ok)
            throw new InvalidOperationException($"Could not drop database {db}: {result.StdErr.Trim()}");
        return db;
    }

    public AppConfigResponse GetConfig(Recipe recipe)
    {
        var cfg = config.Load();
        var section = cfg[recipe.Id] as JsonObject ?? new JsonObject();
        var lab = config.Lab(cfg);
        var values = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var field in recipe.Fields)
        {
            JsonNode? node = section[field.Key];
            if (node is null && !string.IsNullOrEmpty(field.FromLab))
                node = lab[field.FromLab];
            if (node is null && recipe.Defaults.TryGetValue(field.Key, out var def))
            {
                values[field.Key] = def;
                continue;
            }
            if (node is null && field.Default is { } fd)
            {
                values[field.Key] = fd;
                continue;
            }
            if (node is not null)
                values[field.Key] = JsonSerializer.Deserialize(node.ToJsonString(), LabJsonContext.Default.JsonElement);
        }
        return new AppConfigResponse(recipe.Id, recipe.Fields, values);
    }

    /// <summary>Save install-form values for an installed app and recreate it.</summary>
    public async Task ConfigureAsync(Recipe recipe, Dictionary<string, JsonElement> fields)
    {
        config.Update(cfg =>
        {
            var section = cfg[recipe.Id] as JsonObject ?? new JsonObject();
            ApplyFields(recipe, section, fields);
            cfg[recipe.Id] = section;
        });
        await scripts.RunAsync("render-config.sh");
        if (config.Enabled().Contains(recipe.Id))
        {
            await scripts.RunAsync("start.sh", recipe.Id);
            await scripts.TryRunAsync("refresh-edge.sh");
        }
        updates.Invalidate();
    }

    /// <summary>Put the Control Center login in front of an app's LAN hostname (Caddy forward_auth).</summary>
    public async Task SetProtectedAsync(Recipe recipe, bool on)
    {
        if (!CanProtect(recipe))
            throw new InvalidOperationException($"{recipe.Name} has no LAN hostname to protect");

        config.Update(cfg =>
        {
            var lab = config.Lab(cfg);
            var list = LabConfigStore.GetStringList(lab, "protectedApps");
            list.Remove(recipe.Id);
            if (on)
                list.Add(recipe.Id);
            list.Sort(StringComparer.Ordinal);
            lab["protectedApps"] = new JsonArray(list.Select(x => (JsonNode)JsonValue.Create(x)!).ToArray());
        });

        await scripts.RunAsync("render-config.sh");
        // Port binding changes (loopback when protected) need the app recreated.
        if (config.Enabled().Contains(recipe.Id))
            await scripts.TryRunAsync("start.sh", recipe.Id);
        await scripts.TryRunAsync("refresh-edge.sh");
    }

    public async Task<AppLogsResponse> LogsAsync(Recipe recipe, int tail, string? since, CancellationToken ct)
    {
        var containers = DockerCli.ForRecipe(await docker.TryListContainersAsync(ct), recipe.Id);
        var result = new List<ContainerLogs>();
        foreach (var container in containers.OrderBy(c => c.Name, StringComparer.Ordinal))
        {
            string text;
            try
            {
                text = await docker.LogsAsync(container.Name, tail, since, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                text = $"(logs unavailable: {ex.Message})";
            }
            result.Add(new ContainerLogs(container.Name, container.State, ParseLogLines(text, tail)));
        }
        return new AppLogsResponse(recipe.Id, result);
    }

    /// <summary>Split <c>docker logs --timestamps</c> output into (time, text), oldest first.</summary>
    public static List<LogLine> ParseLogLines(string text, int tail)
    {
        var lines = new List<LogLine>();
        foreach (var raw in text.Split('\n'))
        {
            var line = CommandRunner.StripAnsi(raw.TrimEnd('\r'));
            if (line.Length == 0)
                continue;
            var space = line.IndexOf(' ');
            if (space > 0 && DateTimeOffset.TryParse(line[..space], null, System.Globalization.DateTimeStyles.RoundtripKind, out _))
                lines.Add(new LogLine(line[..space], line[(space + 1)..]));
            else
                lines.Add(new LogLine(null, line));
        }

        // stdout and stderr arrive as two blocks; RFC3339 timestamps sort lexically.
        var ordered = lines
            .Select((l, i) => (l, i))
            .OrderBy(x => x.l.Time ?? "", StringComparer.Ordinal)
            .ThenBy(x => x.i)
            .Select(x => x.l)
            .ToList();
        return ordered.Count > tail ? ordered[^tail..] : ordered;
    }
}
