using System.Globalization;
using System.Text.Json;
using Modulab.ControlCenter.Models;

namespace Modulab.ControlCenter.Feeds;

/// <summary>Pure parsers for the Reddit / Lemmy / Hacker News widget feeds.</summary>
public static class FeedParsers
{
    public static string WeatherLabel(int code) => code switch
    {
        0 => "Clear",
        1 or 2 => "Mostly clear",
        3 => "Overcast",
        45 or 48 => "Fog",
        51 or 53 or 55 => "Drizzle",
        61 or 63 or 65 => "Rain",
        71 or 73 or 75 => "Snow",
        80 or 81 or 82 => "Showers",
        95 or 96 or 99 => "Thunderstorm",
        _ => "Clouds",
    };

    public static string? Host(string? url)
    {
        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url, UriKind.Absolute, out var uri))
            return null;
        var host = uri.IdnHost;
        return host.StartsWith("www.", StringComparison.OrdinalIgnoreCase) ? host[4..] : host;
    }

    public static int ReadInt(JsonElement el)
    {
        if (el.ValueKind != JsonValueKind.Number) return 0;
        if (el.TryGetInt32(out var n)) return n;
        return el.TryGetDouble(out var d) ? (int)d : 0;
    }

    public static DateTimeOffset? ReadTime(JsonElement el)
    {
        if (el.ValueKind == JsonValueKind.Number && el.TryGetDouble(out var sec))
            return DateTimeOffset.FromUnixTimeSeconds((long)sec);
        if (el.ValueKind == JsonValueKind.String
            && DateTimeOffset.TryParse(el.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var dto))
            return dto;
        return null;
    }

    static string? HttpImage(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (!value.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            && !value.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            return null;
        return value;
    }

    static string Str(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

    public static List<FeedItem> ParseReddit(JsonElement root, string name, int take)
    {
        var items = new List<FeedItem>();
        if (!root.TryGetProperty("data", out var data)
            || !data.TryGetProperty("children", out var children)
            || children.ValueKind != JsonValueKind.Array)
            return items;

        foreach (var child in children.EnumerateArray())
        {
            if (!child.TryGetProperty("data", out var post)) continue;
            var title = Str(post, "title");
            if (string.IsNullOrWhiteSpace(title)) continue;
            var permalink = Str(post, "permalink");
            var discussion = string.IsNullOrEmpty(permalink)
                ? $"https://www.reddit.com/r/{name}"
                : $"https://www.reddit.com{permalink}";
            var author = Str(post, "author");
            var score = post.TryGetProperty("score", out var s) ? ReadInt(s) : 0;
            var comments = post.TryGetProperty("num_comments", out var nc) ? ReadInt(nc) : 0;
            var published = post.TryGetProperty("created_utc", out var created) ? ReadTime(created) : null;
            var selfPost = post.TryGetProperty("is_self", out var self) && self.ValueKind == JsonValueKind.True;
            var external = Str(post, "url");
            var link = !selfPost && !string.IsNullOrWhiteSpace(external) ? external : discussion;
            var domain = Str(post, "domain");
            if (string.IsNullOrWhiteSpace(domain) || domain.StartsWith("self.", StringComparison.Ordinal))
                domain = Host(link);
            else if (domain.StartsWith("www.", StringComparison.OrdinalIgnoreCase))
                domain = domain[4..];
            items.Add(new FeedItem(
                title,
                link,
                string.IsNullOrWhiteSpace(author) ? $"{score}" : $"u/{author} · {score}",
                HttpImage(Str(post, "thumbnail")),
                string.IsNullOrWhiteSpace(author) ? null : author,
                score,
                comments,
                published,
                domain,
                discussion));
            if (items.Count >= take) break;
        }

        return items;
    }

    public static List<FeedItem> ParseLemmy(JsonElement root, int take)
    {
        var items = new List<FeedItem>();
        if (!root.TryGetProperty("posts", out var posts) || posts.ValueKind != JsonValueKind.Array)
            return items;

        foreach (var entry in posts.EnumerateArray())
        {
            if (!entry.TryGetProperty("post", out var post)) continue;
            var title = Str(post, "name");
            if (string.IsNullOrWhiteSpace(title)) continue;
            var url = Str(post, "url");
            if (string.IsNullOrWhiteSpace(url))
                url = Str(post, "ap_id");
            if (string.IsNullOrWhiteSpace(url)) continue;
            var score = 0;
            var comments = 0;
            if (entry.TryGetProperty("counts", out var counts))
            {
                if (counts.TryGetProperty("score", out var sc)) score = ReadInt(sc);
                if (counts.TryGetProperty("comments", out var cc)) comments = ReadInt(cc);
            }
            var creator = entry.TryGetProperty("creator", out var cr) ? Str(cr, "name") : "";
            var published = post.TryGetProperty("published", out var pub) ? ReadTime(pub) : null;
            var discussion = Str(post, "ap_id");
            items.Add(new FeedItem(
                title,
                url,
                string.IsNullOrWhiteSpace(creator) ? $"{score}" : $"{score} · {creator}",
                HttpImage(Str(post, "thumbnail_url")),
                string.IsNullOrWhiteSpace(creator) ? null : creator,
                score,
                comments,
                published,
                Host(url),
                string.IsNullOrWhiteSpace(discussion) ? url : discussion));
            if (items.Count >= take) break;
        }

        return items;
    }

    /// <summary>One Hacker News item JSON → story, or null for non-stories / untitled items.</summary>
    public static FeedItem? ParseHackerNewsItem(JsonElement root, long id)
    {
        if (root.TryGetProperty("type", out var type) && type.GetString() != "story") return null;
        var title = Str(root, "title");
        if (string.IsNullOrWhiteSpace(title)) return null;
        var url = Str(root, "url");
        if (string.IsNullOrWhiteSpace(url)) url = $"https://news.ycombinator.com/item?id={id}";
        var by = Str(root, "by");
        var score = root.TryGetProperty("score", out var s) ? ReadInt(s) : 0;
        var comments = root.TryGetProperty("descendants", out var descendants) ? ReadInt(descendants) : 0;
        var published = root.TryGetProperty("time", out var time) ? ReadTime(time) : null;
        return new FeedItem(
            title,
            url,
            string.IsNullOrWhiteSpace(by) ? $"{score} pts" : $"{score} pts · {by}",
            null,
            string.IsNullOrWhiteSpace(by) ? null : by,
            score,
            comments,
            published,
            Host(url),
            $"https://news.ycombinator.com/item?id={id}");
    }
}
