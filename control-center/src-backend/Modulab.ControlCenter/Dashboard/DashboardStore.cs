using System.Text.Json;
using System.Text.Json.Nodes;
using Modulab.ControlCenter.Infrastructure;
using Modulab.ControlCenter.Models;

namespace Modulab.ControlCenter.Dashboard;

/// <summary>wwwroot/dashboard.json — boards, widgets and sidebar shortcuts.</summary>
public sealed class DashboardStore(LabPaths paths)
{
    static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };
    readonly Lock gate = new();

    /// <summary>Ensure wwwroot/dashboard.json exists by copying from tracked defaults.</summary>
    public void EnsureExists()
    {
        lock (gate)
        {
            if (File.Exists(paths.DashboardJson))
                return;
            Directory.CreateDirectory(Path.GetDirectoryName(paths.DashboardJson)!);
            if (File.Exists(paths.DashboardDefaults))
            {
                File.Copy(paths.DashboardDefaults, paths.DashboardJson);
                return;
            }
            File.WriteAllText(paths.DashboardJson, """{"title":"Modulab","pages":[{"id":"home","title":"Home","items":[]}]}""");
        }
    }

    public JsonNode Load()
    {
        EnsureExists();
        return JsonNode.Parse(File.ReadAllText(paths.DashboardJson))
            ?? throw new InvalidOperationException("dashboard.json is empty");
    }

    JsonObject LoadObject() =>
        Load() as JsonObject ?? throw new InvalidOperationException("dashboard.json must be an object");

    void Write(JsonObject root)
    {
        lock (gate)
            AtomicFile.WriteAllText(paths.DashboardJson, root.ToJsonString(Indented) + "\n");
    }

    public void Save(JsonNode body)
    {
        var incoming = body as JsonObject ?? throw new InvalidOperationException("Body must be a JSON object");
        if (File.Exists(paths.DashboardJson))
        {
            try
            {
                var existing = JsonNode.Parse(File.ReadAllText(paths.DashboardJson)) as JsonObject;
                if (existing?["_comment"] is not null && incoming["_comment"] is null)
                    incoming["_comment"] = existing["_comment"]!.DeepClone();
            }
            catch (JsonException)
            {
                // Corrupt existing file: overwrite with incoming.
            }
        }

        if (incoming["sidebar"] is JsonObject sidebar && sidebar["bookmarks"] is not null and not JsonArray)
            throw new InvalidOperationException("sidebar.bookmarks must be an array");

        Write(incoming);
    }

    public int ImportBookmarks(ImportBookmarksRequest body)
    {
        var root = LoadObject();
        var sidebar = root["sidebar"] as JsonObject ?? new JsonObject();
        root["sidebar"] = sidebar;
        var bookmarks = sidebar["bookmarks"] as JsonArray ?? new JsonArray();
        sidebar["bookmarks"] = bookmarks;

        var merge = body.MergeByTitle != false;
        var added = 0;

        foreach (var group in body.Groups)
        {
            if (group.Links is null || group.Links.Count == 0)
                continue;

            var title = string.IsNullOrWhiteSpace(group.Title) ? "Imported" : group.Title.Trim();
            var color = string.IsNullOrWhiteSpace(group.Color) ? "other" : group.Color.Trim();

            JsonObject? target = null;
            if (merge)
            {
                target = bookmarks.OfType<JsonObject>().FirstOrDefault(obj =>
                    string.Equals(obj["title"]?.GetValue<string>(), title, StringComparison.OrdinalIgnoreCase));
            }

            if (target is null)
            {
                target = new JsonObject { ["title"] = title, ["color"] = color, ["links"] = new JsonArray() };
                bookmarks.Add((JsonNode)target);
            }

            var links = target["links"] as JsonArray ?? new JsonArray();
            target["links"] = links;
            var existing = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var linkNode in links)
            {
                var url = (linkNode as JsonObject)?["url"]?.GetValue<string>();
                if (!string.IsNullOrWhiteSpace(url))
                    existing.Add(url);
            }

            foreach (var link in group.Links)
            {
                if (ToLinkNode(link) is not { } node || !existing.Add(link.Url))
                    continue;
                links.Add((JsonNode)node);
                added++;
            }
        }

        Write(root);
        return added;
    }

    public int ReplaceBookmarks(ReplaceBookmarksRequest body)
    {
        var root = LoadObject();
        var sidebar = root["sidebar"] as JsonObject ?? new JsonObject();
        root["sidebar"] = sidebar;

        if (body.ShowInstalledApps is bool showApps)
            sidebar["showInstalledApps"] = showApps;

        var bookmarks = new JsonArray();
        foreach (var group in body.Groups)
        {
            var links = new JsonArray();
            foreach (var link in group.Links ?? [])
            {
                if (ToLinkNode(link) is { } node)
                    links.Add((JsonNode)node);
            }

            bookmarks.Add((JsonNode)new JsonObject
            {
                ["title"] = string.IsNullOrWhiteSpace(group.Title) ? "Shortcuts" : group.Title.Trim(),
                ["color"] = string.IsNullOrWhiteSpace(group.Color) ? "other" : group.Color.Trim(),
                ["links"] = links,
            });
        }

        sidebar["bookmarks"] = bookmarks;
        Write(root);
        return bookmarks.Count;
    }

    /// <summary>http(s) links only; title/domain default to the host.</summary>
    static JsonObject? ToLinkNode(BookmarkLinkDto link)
    {
        if (string.IsNullOrWhiteSpace(link.Url) || !Uri.TryCreate(link.Url, UriKind.Absolute, out var uri))
            return null;
        if (uri.Scheme is not ("http" or "https"))
            return null;
        return new JsonObject
        {
            ["title"] = string.IsNullOrWhiteSpace(link.Title) ? uri.Host : link.Title.Trim(),
            ["url"] = link.Url.Trim(),
            ["domain"] = string.IsNullOrWhiteSpace(link.Domain) ? uri.Host : link.Domain.Trim(),
        };
    }
}
