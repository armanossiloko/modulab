using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Modulab.ControlCenter.Feeds;
using Modulab.ControlCenter.Models;

namespace Modulab.ControlCenter.Endpoints;

public static partial class WidgetEndpoints
{
    [GeneratedRegex(@"^[A-Za-z0-9_]{1,50}$")]
    private static partial Regex SubredditRegex();

    public static void MapWidgetEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/feeds/reddit", async (string? sub, int? limit, HttpClient http, CancellationToken ct) =>
            {
                var name = string.IsNullOrWhiteSpace(sub) ? "selfhosted" : sub.Trim();
                if (!SubredditRegex().IsMatch(name))
                    return Api.BadRequest("Invalid subreddit");

                var take = Math.Clamp(limit ?? 6, 1, 15);
                try
                {
                    using var req = new HttpRequestMessage(HttpMethod.Get, $"https://www.reddit.com/r/{name}/hot.json?limit={take}&raw_json=1");
                    req.Headers.TryAddWithoutValidation("User-Agent", "Mozilla/5.0 (compatible; Modulab/1.0)");
                    req.Headers.TryAddWithoutValidation("Accept", "application/json");
                    using var res = await http.SendAsync(req, ct);
                    if (res.IsSuccessStatusCode)
                    {
                        await using var stream = await res.Content.ReadAsStreamAsync(ct);
                        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
                        var items = FeedParsers.ParseReddit(doc.RootElement, name, take);
                        if (items.Count > 0)
                            return Results.Json(new FeedResponse("reddit", name, items), LabJsonContext.Default.FeedResponse);
                    }

                    // Reddit often blocks datacenter IPs — fall back to the Lemmy community with the same name.
                    using var lemmyRes = await http.GetAsync(
                        $"https://lemmy.world/api/v3/post/list?community_name={Uri.EscapeDataString(name)}&sort=Hot&limit={take}&type_=All",
                        ct);
                    if (!lemmyRes.IsSuccessStatusCode)
                        return Api.Message($"Feed unavailable (Reddit {(int)res.StatusCode}, Lemmy {(int)lemmyRes.StatusCode})", StatusCodes.Status502BadGateway);

                    await using var lemmyStream = await lemmyRes.Content.ReadAsStreamAsync(ct);
                    using var lemmyDoc = await JsonDocument.ParseAsync(lemmyStream, cancellationToken: ct);
                    return Results.Json(
                        new FeedResponse("lemmy", name, FeedParsers.ParseLemmy(lemmyDoc.RootElement, take)),
                        LabJsonContext.Default.FeedResponse);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    return Api.Message(ex.Message, StatusCodes.Status502BadGateway);
                }
            })
            .WithName("GetRedditFeed")
            .WithTags("Feeds")
            .Produces<FeedResponse>()
            .ProducesApiMessage(StatusCodes.Status400BadRequest, StatusCodes.Status502BadGateway);

        app.MapGet("/api/feeds/hn", async (int? limit, HttpClient http, CancellationToken ct) =>
            {
                var take = Math.Clamp(limit ?? 8, 1, 20);
                try
                {
                    using var idsRes = await http.GetAsync("https://hacker-news.firebaseio.com/v0/topstories.json", ct);
                    idsRes.EnsureSuccessStatusCode();
                    var ids = await idsRes.Content.ReadFromJsonAsync(LabJsonContext.Default.ListInt64, ct) ?? [];
                    var items = new List<FeedItem>();
                    foreach (var id in ids.Take(take * 2))
                    {
                        using var itemRes = await http.GetAsync($"https://hacker-news.firebaseio.com/v0/item/{id}.json", ct);
                        if (!itemRes.IsSuccessStatusCode) continue;
                        await using var stream = await itemRes.Content.ReadAsStreamAsync(ct);
                        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
                        if (FeedParsers.ParseHackerNewsItem(doc.RootElement, id) is { } item)
                            items.Add(item);
                        if (items.Count >= take) break;
                    }
                    return Results.Json(new FeedResponse("hn", "top", items), LabJsonContext.Default.FeedResponse);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    return Api.Message(ex.Message, StatusCodes.Status502BadGateway);
                }
            })
            .WithName("GetHackerNewsFeed")
            .WithTags("Feeds")
            .Produces<FeedResponse>()
            .ProducesApiMessage(StatusCodes.Status502BadGateway);

        app.MapGet("/api/weather", async (double? lat, double? lon, string? label, HttpClient http, CancellationToken ct) =>
            {
                var latitude = (lat ?? 52.52).ToString(CultureInfo.InvariantCulture);
                var longitude = (lon ?? 13.405).ToString(CultureInfo.InvariantCulture);
                var place = string.IsNullOrWhiteSpace(label) ? "Local" : label.Trim();
                try
                {
                    var url = $"https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}" +
                        "&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&timezone=auto";
                    using var res = await http.GetAsync(url, ct);
                    res.EnsureSuccessStatusCode();
                    await using var stream = await res.Content.ReadAsStreamAsync(ct);
                    using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
                    var current = doc.RootElement.GetProperty("current");
                    var code = current.GetProperty("weather_code").GetInt32();
                    return Results.Json(
                        new WeatherResponse(
                            place,
                            current.GetProperty("temperature_2m").GetDouble(),
                            code,
                            FeedParsers.WeatherLabel(code),
                            current.GetProperty("wind_speed_10m").GetDouble(),
                            current.GetProperty("relative_humidity_2m").GetInt32()),
                        LabJsonContext.Default.WeatherResponse);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    return Api.Message(ex.Message, StatusCodes.Status502BadGateway);
                }
            })
            .WithName("GetWeather")
            .WithTags("Widgets")
            .Produces<WeatherResponse>()
            .ProducesApiMessage(StatusCodes.Status502BadGateway);
    }
}
