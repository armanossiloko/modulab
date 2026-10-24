using System.Text.Json;

namespace Modulab.ControlCenter.Updates;

/// <summary>Pure helpers for image references and digests.</summary>
public static class ImageRefs
{
    public static string? ExtractRemoteDigest(JsonElement root)
    {
        if (root.TryGetProperty("manifest", out var manifest) && manifest.TryGetProperty("digest", out var md))
            return NormalizeDigest(md.GetString());
        if (root.TryGetProperty("Manifest", out var manifest2) && manifest2.TryGetProperty("Digest", out var md2))
            return NormalizeDigest(md2.GetString());
        if (root.TryGetProperty("descriptor", out var desc) && desc.TryGetProperty("digest", out var dd))
            return NormalizeDigest(dd.GetString());
        if (root.TryGetProperty("Descriptor", out var desc2) && desc2.TryGetProperty("digest", out var dd2))
            return NormalizeDigest(dd2.GetString());
        if (root.TryGetProperty("digest", out var d))
            return NormalizeDigest(d.GetString());
        return null;
    }

    public static string? ExtractLocalDigest(JsonElement imageInspect, string imageRef)
    {
        if (!imageInspect.TryGetProperty("RepoDigests", out var digests) || digests.ValueKind != JsonValueKind.Array)
            return null;

        var repo = Repository(imageRef);
        foreach (var entry in digests.EnumerateArray())
        {
            var text = entry.GetString();
            if (string.IsNullOrWhiteSpace(text))
                continue;
            var at = text.IndexOf('@');
            if (at <= 0)
                continue;
            var entryRepo = text[..at];
            if (!string.IsNullOrEmpty(repo)
                && !entryRepo.Equals(repo, StringComparison.OrdinalIgnoreCase)
                && !entryRepo.EndsWith("/" + repo, StringComparison.OrdinalIgnoreCase)
                && !repo.EndsWith("/" + entryRepo, StringComparison.OrdinalIgnoreCase))
                continue;
            return NormalizeDigest(text[(at + 1)..]);
        }

        // Fall back to the first digest if repo matching failed.
        foreach (var entry in digests.EnumerateArray())
        {
            var text = entry.GetString();
            if (string.IsNullOrWhiteSpace(text))
                continue;
            var at = text.IndexOf('@');
            if (at >= 0)
                return NormalizeDigest(text[(at + 1)..]);
        }

        return null;
    }

    /// <summary>Image reference without tag or digest: "ghcr.io/a/b:1.2@sha256:…" → "ghcr.io/a/b".</summary>
    public static string Repository(string imageRef)
    {
        var at = imageRef.IndexOf('@');
        if (at >= 0)
            imageRef = imageRef[..at];
        var colon = imageRef.LastIndexOf(':');
        return colon > imageRef.LastIndexOf('/') ? imageRef[..colon] : imageRef;
    }

    public static string? NormalizeDigest(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;
        value = value.Trim();
        var at = value.LastIndexOf('@');
        if (at >= 0)
            value = value[(at + 1)..];
        return value.StartsWith("sha256:", StringComparison.OrdinalIgnoreCase)
            ? value.ToLowerInvariant()
            : value;
    }

    public static bool DigestsEqual(string a, string b)
    {
        var na = NormalizeDigest(a);
        var nb = NormalizeDigest(b);
        return !string.IsNullOrEmpty(na)
            && !string.IsNullOrEmpty(nb)
            && string.Equals(na, nb, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>The tag when it is pinned and looks like a version (10.11.10, v3, 2025.03.0).</summary>
    public static string? VersionFromRef(string imageRef)
    {
        var digest = imageRef.IndexOf('@');
        if (digest >= 0)
            imageRef = imageRef[..digest];
        var slash = imageRef.LastIndexOf('/');
        var colon = imageRef.LastIndexOf(':');
        if (colon < 0 || colon < slash)
            return null;
        var tag = imageRef[(colon + 1)..];
        if (tag.Length == 0 || IsFloatingTag(tag) || !tag.Any(char.IsDigit))
            return null;
        return tag;
    }

    public static bool IsFloatingTag(string tag) => tag.ToLowerInvariant() switch
    {
        "latest" or "stable" or "main" or "master" or "release" or "local" or "edge" or "nightly" or "dev" or "develop" => true,
        _ => false,
    };
}
