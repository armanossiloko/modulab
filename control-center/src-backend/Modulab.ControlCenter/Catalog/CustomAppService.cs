using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using System.Text.RegularExpressions;
using Modulab.ControlCenter.Infrastructure;
using Modulab.ControlCenter.Lab;
using Modulab.ControlCenter.Models;

namespace Modulab.ControlCenter.Catalog;

/// <summary>
/// User-defined apps in catalog.local/&lt;id&gt;/ (recipe.json + docker-compose.yml). Kit upgrades never touch
/// this folder, and the scripts resolve its compose file like any built-in stack.
/// </summary>
public sealed partial class CustomAppService(
    LabPaths paths,
    LabConfigStore config,
    RecipeStore recipes,
    DockerCli docker)
{
    public const int MaxComposeBytes = 64 * 1024;
    static readonly JsonTypeInfo<Recipe> IndentedRecipe = (JsonTypeInfo<Recipe>)
        new JsonSerializerOptions(LabJsonContext.Default.Options) { WriteIndented = true }.GetTypeInfo(typeof(Recipe));
    static readonly HashSet<string> Reserved = new(StringComparer.Ordinal) { "all", "control-center", "home", "modulab" };
    static readonly HashSet<string> Categories = new(StringComparer.Ordinal) { "media", "productivity", "tools", "infrastructure", "other" };

    [GeneratedRegex(@"^[a-z][a-z0-9-]{1,39}$")]
    private static partial Regex IdRegex();

    [GeneratedRegex(@"^[a-z0-9][a-z0-9-]{0,40}$")]
    private static partial Regex HostRegex();

    [GeneratedRegex(@"^[A-Za-z_][A-Za-z0-9_]*$")]
    private static partial Regex EnvKeyRegex();

    /// <summary>Bind mounts relative to the compose file break: Compose runs from inside Control Center.</summary>
    [GeneratedRegex(@"^\s*-?\s*(source:\s*)?['""]?\.{1,2}/", RegexOptions.Multiline)]
    private static partial Regex RelativeBindRegex();

    string Dir(string id) => Path.Combine(paths.LocalCatalog, id);
    string ComposePath(string id) => Path.Combine(Dir(id), "docker-compose.yml");

    public CustomAppResponse? Get(string id)
    {
        var recipe = recipes.Find(id);
        if (recipe is not { Custom: true })
            return null;
        var compose = File.Exists(ComposePath(id)) ? File.ReadAllText(ComposePath(id)) : "";
        return new CustomAppResponse(
            recipe.Id,
            recipe.Name,
            recipe.Description,
            recipe.Category,
            recipe.Port,
            recipe.Proxy?.Host,
            recipe.Proxy?.Port,
            compose,
            recipe.Data,
            recipe.Fields);
    }

    public async Task<CustomAppValidation> ValidateAsync(CustomAppRequest req, bool isUpdate, CancellationToken ct)
    {
        var errors = new List<string>();
        var warnings = new List<string>();
        var others = recipes.All().Where(r => r.Id != req.Id).ToList();
        var existing = recipes.Find(req.Id);

        if (string.IsNullOrWhiteSpace(req.Id) || !IdRegex().IsMatch(req.Id))
            errors.Add("Id must be 2–40 characters: lowercase letters, digits and dashes, starting with a letter");
        else if (Reserved.Contains(req.Id))
            errors.Add($"'{req.Id}' is reserved");
        else if (existing is { Custom: false })
            errors.Add($"'{req.Id}' is a built-in app. Pick another id, or customise it with docker-compose.{req.Id}.override.yml");
        else if (existing is not null && !isUpdate)
            errors.Add($"A custom app '{req.Id}' already exists");
        else if (existing is null && isUpdate)
            errors.Add($"Unknown custom app '{req.Id}'");

        if (string.IsNullOrWhiteSpace(req.Name))
            errors.Add("Name is required");
        if (req.Category is { } cat && !Categories.Contains(cat))
            errors.Add($"Category must be one of: {string.Join(", ", Categories)}");
        if (req.Port is < 1 or > 65535)
            errors.Add("Port must be between 1 and 65535");
        if (req.Port is int port && others.FirstOrDefault(r => r.Port == port) is { } clash)
            warnings.Add($"Port {port} is also used by {clash.Name}; they cannot run at the same time");

        if (!string.IsNullOrWhiteSpace(req.ProxyHost))
        {
            if (!HostRegex().IsMatch(req.ProxyHost))
                errors.Add("Hostname label must be lowercase letters, digits and dashes");
            else if (others.Any(r => r.Proxy?.Host == req.ProxyHost || r.Dns.Contains(req.ProxyHost)))
                errors.Add($"Hostname '{req.ProxyHost}' is already used by another app");
            if ((req.ProxyPort ?? req.Port) is null)
                errors.Add("A hostname needs a port to proxy to");
        }

        foreach (var path in req.DataPaths ?? [])
        {
            var norm = path.Replace('\\', '/').Trim();
            if (!norm.StartsWith("data/", StringComparison.Ordinal) || norm.Contains("..") || norm.TrimEnd('/') is "data" or "data/control-center")
                errors.Add($"Data path '{path}' must be a folder under data/ (for example data/{req.Id})");
        }

        foreach (var field in req.Fields ?? [])
        {
            if (!EnvKeyRegex().IsMatch(field.Key))
                errors.Add($"Field key '{field.Key}' must be a valid environment variable name");
        }

        if (string.IsNullOrWhiteSpace(req.Compose))
            errors.Add("Compose file is required");
        else if (System.Text.Encoding.UTF8.GetByteCount(req.Compose) > MaxComposeBytes)
            errors.Add("Compose file is larger than 64 KB");
        else if (errors.Count == 0)
            await ValidateComposeAsync(req, errors, warnings, ct);

        return new CustomAppValidation(errors.Count == 0, errors, warnings);
    }

    async Task ValidateComposeAsync(CustomAppRequest req, List<string> errors, List<string> warnings, CancellationToken ct)
    {
        if (RelativeBindRegex().IsMatch(req.Compose))
            errors.Add("Relative bind mounts (./…) do not work here. Use ${MODULAB_HOST_ROOT}/data/" + req.Id + "/… instead");

        Directory.CreateDirectory(paths.LocalCatalog);
        var tmp = Path.Combine(paths.LocalCatalog, $".validate-{req.Id}-{Guid.NewGuid():n}.yml");
        try
        {
            await File.WriteAllTextAsync(tmp, req.Compose, ct);
            var args = new List<string> { "compose" };
            if (File.Exists(paths.Env))
                args.AddRange(["--env-file", paths.Env]);
            args.AddRange(["-f", tmp, "config", "--format", "json"]);
            var result = await docker.RunAsync(args, TimeSpan.FromSeconds(30), ct);
            if (!result.Ok)
            {
                errors.Add("Compose file is invalid: " + CleanComposeError(result.StdErr, tmp));
                return;
            }

            using var doc = JsonDocument.Parse(result.StdOut);
            if (!doc.RootElement.TryGetProperty("services", out var services)
                || services.ValueKind != JsonValueKind.Object
                || !services.EnumerateObject().Any())
            {
                errors.Add("Compose file has no services");
                return;
            }

            foreach (var service in services.EnumerateObject())
            {
                var name = service.Value.TryGetProperty("container_name", out var cn) ? cn.GetString() : null;
                if (string.IsNullOrWhiteSpace(name) || !DockerCli.MatchesRecipe(name, req.Id))
                {
                    errors.Add(
                        $"Service '{service.Name}': set container_name to '{req.Id}' (or '{req.Id}-{service.Name}') so Control Center can track it");
                }

                if (!service.Value.TryGetProperty("restart", out _))
                    warnings.Add($"Service '{service.Name}' has no restart policy; it will not come back after a reboot (add restart: unless-stopped)");
            }
        }
        finally
        {
            try { File.Delete(tmp); } catch (IOException) { /* best-effort */ }
        }
    }

    static string CleanComposeError(string stderr, string tmpPath)
    {
        var text = stderr.Replace(tmpPath, "docker-compose.yml").Trim();
        var line = text.Split('\n', StringSplitOptions.RemoveEmptyEntries).LastOrDefault() ?? text;
        return line.Length > 300 ? line[..300] : line;
    }

    public async Task<(CustomAppValidation Validation, Recipe? Recipe)> SaveAsync(
        CustomAppRequest req,
        bool isUpdate,
        CancellationToken ct)
    {
        var validation = await ValidateAsync(req, isUpdate, ct);
        if (!validation.Ok)
            return (validation, null);

        var dataPaths = (req.DataPaths ?? []).Select(p => p.Replace('\\', '/').Trim().TrimEnd('/')).Where(p => p.Length > 0).ToList();
        if (dataPaths.Count == 0)
            dataPaths.Add($"data/{req.Id}");

        var recipe = new Recipe
        {
            Id = req.Id,
            Name = req.Name.Trim(),
            Description = req.Description?.Trim() ?? "",
            Category = req.Category ?? "other",
            Compose = $"catalog.local/{req.Id}/docker-compose.yml",
            Port = req.Port,
            Installable = true,
            Proxy = string.IsNullOrWhiteSpace(req.ProxyHost)
                ? null
                : new RecipeProxy { Host = req.ProxyHost, Port = req.ProxyPort ?? req.Port },
            Dns = string.IsNullOrWhiteSpace(req.ProxyHost) ? [] : [req.ProxyHost],
            Data = dataPaths,
            Fields = req.Fields ?? [],
            Defaults = req.Defaults ?? new Dictionary<string, JsonElement>(),
        };

        var dir = Dir(req.Id);
        Directory.CreateDirectory(dir);
        foreach (var data in dataPaths)
            Directory.CreateDirectory(Path.Combine(paths.Root, data));
        AtomicFile.WriteAllText(ComposePath(req.Id), req.Compose.Replace("\r\n", "\n"));
        AtomicFile.WriteAllText(Path.Combine(dir, "recipe.json"), JsonSerializer.Serialize(recipe, IndentedRecipe) + "\n");
        recipe.Custom = true;
        recipe.Directory = dir;
        return (validation, recipe);
    }

    public async Task DeleteAsync(string id, CancellationToken ct)
    {
        var recipe = recipes.Find(id);
        if (recipe is not { Custom: true })
            throw new KeyNotFoundException($"Unknown custom app '{id}'");
        if (config.Enabled().Contains(id))
            throw new InvalidOperationException($"Uninstall {recipe.Name} before deleting it");
        if (DockerCli.ForRecipe(await docker.TryListContainersAsync(ct), id).Count > 0)
            throw new InvalidOperationException($"{recipe.Name} still has containers; uninstall it first");
        Directory.Delete(Dir(id), recursive: true);
    }
}
