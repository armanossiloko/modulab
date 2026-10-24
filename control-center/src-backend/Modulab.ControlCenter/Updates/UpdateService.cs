using System.Text.Json;
using Modulab.ControlCenter.Catalog;
using Modulab.ControlCenter.Infrastructure;
using Modulab.ControlCenter.Lab;
using Modulab.ControlCenter.Models;

namespace Modulab.ControlCenter.Updates;

/// <summary>Registry digest checks for installed stacks, plus installed version/release metadata.</summary>
public sealed class UpdateService(
    LabPaths paths,
    LabConfigStore config,
    RecipeStore recipes,
    DockerCli docker)
{
    static readonly TimeSpan UpdatesTtl = TimeSpan.FromMinutes(15);
    static readonly TimeSpan ReleasesTtl = TimeSpan.FromSeconds(45);

    readonly Lock gate = new();
    UpdatesResponse? updates;
    DateTimeOffset updatesAt;
    Dictionary<string, ImageRelease>? releases;
    DateTimeOffset releasesAt;

    public void Invalidate()
    {
        lock (gate)
        {
            updates = null;
            releases = null;
        }
    }

    public void InvalidateReleases()
    {
        lock (gate)
            releases = null;
    }

    public async Task<UpdatesResponse> GetUpdatesAsync(bool forceRefresh, CancellationToken ct)
    {
        if (!forceRefresh)
        {
            lock (gate)
            {
                if (updates is not null && DateTimeOffset.UtcNow - updatesAt < UpdatesTtl)
                    return updates with { FromCache = true };
            }
        }

        var all = recipes.All().Where(r => r.Id != "control-center").ToList();
        var enabled = config.Enabled();
        var containers = await docker.TryListContainersAsync(ct);
        var targets = all
            .Where(r => enabled.Contains(r.Id) || r.Core || DockerCli.ForRecipe(containers, r.Id).Count > 0)
            .Where(r => File.Exists(recipes.ResolveComposeFile(r)))
            .ToList();

        var apps = new List<AppUpdateStatus>();
        foreach (var recipe in targets)
        {
            ct.ThrowIfCancellationRequested();
            apps.Add(await CheckAppAsync(recipe, ct));
        }

        var response = new UpdatesResponse(apps, DateTimeOffset.UtcNow, FromCache: false);
        lock (gate)
        {
            updates = response;
            updatesAt = DateTimeOffset.UtcNow;
        }
        return response;
    }

    public async Task<AppUpdateStatus> CheckAppAsync(Recipe recipe, CancellationToken ct)
    {
        List<string> refs;
        try
        {
            refs = await ComposeImageRefsAsync(recipe, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return new AppUpdateStatus(recipe.Id, recipe.Name, false,
                [new ImageUpdateStatus("", null, null, null, false, null, ex.Message)]);
        }

        var images = new List<ImageUpdateStatus>();
        foreach (var imageRef in refs)
        {
            ct.ThrowIfCancellationRequested();
            images.Add(await CheckImageAsync(imageRef, ct));
        }

        return new AppUpdateStatus(recipe.Id, recipe.Name, images.Any(i => i.UpdateAvailable), images);
    }

    async Task<ImageUpdateStatus> CheckImageAsync(string imageRef, CancellationToken ct)
    {
        string? localId = null;
        string? localDigest = null;
        string? remoteDigest = null;
        string? error = null;
        var reasons = new List<string>();

        try
        {
            var inspect = await docker.InspectImageAsync(imageRef, ct);
            if (inspect is { } root)
            {
                localId = root.TryGetProperty("Id", out var idEl) ? idEl.GetString() : null;
                localDigest = ImageRefs.ExtractLocalDigest(root, imageRef);
            }
            else
            {
                error = "Local image not found";
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            error = ex.Message;
        }

        try
        {
            remoteDigest = await ResolveRemoteDigestAsync(imageRef, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            error = string.IsNullOrEmpty(error) ? ex.Message : $"{error}; {ex.Message}";
        }

        if (!string.IsNullOrEmpty(localDigest)
            && !string.IsNullOrEmpty(remoteDigest)
            && !ImageRefs.DigestsEqual(localDigest, remoteDigest))
            reasons.Add("newer-registry");

        // No local image but remote resolves → needs pull/update.
        if (string.IsNullOrEmpty(localId) && !string.IsNullOrEmpty(remoteDigest))
            reasons.Add("newer-registry");

        // Container still on an older local image ID for this tag.
        if (!string.IsNullOrEmpty(localId) && await ContainersUseStaleImageAsync(imageRef, localId, ct))
            reasons.Add("container-stale");

        return new ImageUpdateStatus(
            imageRef,
            localDigest,
            remoteDigest,
            localId,
            reasons.Count > 0,
            reasons.Count == 0 ? null : string.Join(",", reasons.Distinct()),
            error);
    }

    async Task<string?> ResolveRemoteDigestAsync(string imageRef, CancellationToken ct)
    {
        var result = await docker.RunAsync(
            ["buildx", "imagetools", "inspect", imageRef, "--format", "{{json .}}"],
            TimeSpan.FromSeconds(45),
            ct);
        if (!result.Ok || string.IsNullOrWhiteSpace(result.StdOut))
            throw new InvalidOperationException(
                string.IsNullOrWhiteSpace(result.StdErr) ? $"Could not inspect remote image {imageRef}" : result.StdErr.Trim());

        using var doc = JsonDocument.Parse(result.StdOut);
        return ImageRefs.ExtractRemoteDigest(doc.RootElement)
            ?? throw new InvalidOperationException($"No digest in imagetools output for {imageRef}");
    }

    public async Task<List<string>> ComposeImageRefsAsync(Recipe recipe, CancellationToken ct)
    {
        var compose = recipes.ResolveComposeFile(recipe);
        if (!File.Exists(compose))
            return [];

        var args = new List<string> { "compose" };
        if (File.Exists(paths.Env))
        {
            args.Add("--env-file");
            args.Add(paths.Env);
        }
        args.AddRange(["-f", compose, "config", "--images"]);
        var result = await docker.RunAsync(args, TimeSpan.FromSeconds(30), ct);
        if (!result.Ok)
            throw new InvalidOperationException(result.StdErr.Trim());
        return result.StdOut
            .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct(StringComparer.Ordinal)
            .ToList();
    }

    async Task<bool> ContainersUseStaleImageAsync(string imageRef, string localImageId, CancellationToken ct)
    {
        try
        {
            var ps = await docker.RunAsync(["ps", "-a", "--filter", $"ancestor={imageRef}", "--format", "{{.ID}}"], ct: ct);
            foreach (var containerId in ps.StdOut.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var inspect = await docker.RunAsync(["inspect", containerId, "--format", "{{.Image}}"], ct: ct);
                if (inspect.Ok
                    && !string.IsNullOrWhiteSpace(inspect.StdOut)
                    && !ImageRefs.DigestsEqual(inspect.StdOut.Trim(), localImageId))
                    return true;
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return false;
        }

        return false;
    }

    /// <summary>Installed version + image build date per app id (short cache; feeds the Library cards).</summary>
    public async Task<Dictionary<string, ImageRelease>> ReleasesAsync(
        IReadOnlyList<Recipe> forRecipes,
        IReadOnlyList<ContainerInfo> containers,
        CancellationToken ct)
    {
        lock (gate)
        {
            if (releases is not null && DateTimeOffset.UtcNow - releasesAt < ReleasesTtl)
                return releases;
        }

        var imageByApp = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var recipe in forRecipes)
        {
            var match = DockerCli.ForRecipe(containers, recipe.Id).FirstOrDefault();
            if (match is not null && !string.IsNullOrWhiteSpace(match.Image))
                imageByApp[recipe.Id] = match.Image;
        }

        var byImage = new Dictionary<string, ImageRelease?>(StringComparer.Ordinal);
        await Parallel.ForEachAsync(
            imageByApp.Values.Distinct(StringComparer.Ordinal).ToList(),
            new ParallelOptions { MaxDegreeOfParallelism = 4, CancellationToken = ct },
            async (image, token) =>
            {
                var release = await InspectReleaseAsync(image, token);
                lock (byImage)
                    byImage[image] = release;
            });

        var byId = new Dictionary<string, ImageRelease>(StringComparer.OrdinalIgnoreCase);
        foreach (var (id, image) in imageByApp)
        {
            if (byImage.TryGetValue(image, out var release) && release is not null)
                byId[id] = release;
        }

        lock (gate)
        {
            releases = byId;
            releasesAt = DateTimeOffset.UtcNow;
        }
        return byId;
    }

    async Task<ImageRelease?> InspectReleaseAsync(string imageRef, CancellationToken ct)
    {
        JsonElement? inspect;
        try
        {
            inspect = await docker.InspectImageAsync(imageRef, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return null;
        }
        if (inspect is not { } root)
            return null;

        DateTimeOffset? released = null;
        if (root.TryGetProperty("Created", out var created)
            && DateTimeOffset.TryParse(created.GetString(), out var built))
            released = built;

        string? version = null;
        if (root.TryGetProperty("Config", out var cfg)
            && cfg.TryGetProperty("Labels", out var labels)
            && labels.ValueKind == JsonValueKind.Object
            && labels.TryGetProperty("org.opencontainers.image.version", out var label)
            && label.ValueKind == JsonValueKind.String)
            version = label.GetString();

        if (string.IsNullOrWhiteSpace(version))
            version = ImageRefs.VersionFromRef(imageRef);

        version = string.IsNullOrWhiteSpace(version) ? null : version.Trim();
        return version is null && released is null ? null : new ImageRelease(version, released);
    }
}
