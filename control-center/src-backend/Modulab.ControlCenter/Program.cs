using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Modulab.ControlCenter.Extensions;

// Full builder (not slim) so static files / SPA hosting work like Fable.API.
var builder = WebApplication.CreateBuilder(args);

builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Logging.SetMinimumLevel(LogLevel.Warning);

var labRoot = Path.GetFullPath(
    Environment.GetEnvironmentVariable("LAB_ROOT")
    ?? (Directory.Exists("/lab") ? "/lab" : FindLabRoot()));

var apiKey = Environment.GetEnvironmentVariable("CONTROL_CENTER_API_KEY")
    ?? Environment.GetEnvironmentVariable("LAB_API_KEY")
    ?? ReadApiKey(labRoot)
    ?? "";

// Control Center UI + /api on HOME_PORT (default 8888).
var port = int.TryParse(Environment.GetEnvironmentVariable("HOME_PORT"), out var homePort) ? homePort
    : int.TryParse(Environment.GetEnvironmentVariable("LAB_API_PORT"), out var apiPort) ? apiPort
    : 8888;

builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxConcurrentConnections = 32;
    options.Limits.MaxRequestBodySize = 1024 * 1024;
    // Skip binding during build-time OpenAPI document generation.
    if (!IsOpenApiDocumentGeneration())
        options.ListenAnyIP(port);
});

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.TypeInfoResolverChain.Insert(0, LabJsonContext.Default);
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
});

builder.AddControlCenterOpenApi();

var app = builder.Build();
app.MapControlCenterOpenApi();

var sharedHttp = new HttpClient(new SocketsHttpHandler
{
    PooledConnectionLifetime = TimeSpan.FromMinutes(5),
})
{
    Timeout = TimeSpan.FromSeconds(10),
};
sharedHttp.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "ModulabControlCenter/1.0");

string WeatherLabel(int code) => code switch
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

List<FeedItem> ParseReddit(JsonElement root, string name, int take)
{
    var items = new List<FeedItem>();
    if (!root.TryGetProperty("data", out var data)
        || !data.TryGetProperty("children", out var children)
        || children.ValueKind != JsonValueKind.Array)
        return items;

    foreach (var child in children.EnumerateArray())
    {
        if (!child.TryGetProperty("data", out var post)) continue;
        var title = post.TryGetProperty("title", out var t) ? t.GetString() ?? "" : "";
        var permalink = post.TryGetProperty("permalink", out var p) ? p.GetString() ?? "" : "";
        var author = post.TryGetProperty("author", out var a) ? a.GetString() ?? "" : "";
        var score = post.TryGetProperty("score", out var s) && s.TryGetInt32(out var scoreVal) ? scoreVal : 0;
        var thumb = post.TryGetProperty("thumbnail", out var th) ? th.GetString() ?? "" : "";
        if (string.IsNullOrWhiteSpace(title)) continue;
        string? thumbUrl = thumb.StartsWith("http", StringComparison.OrdinalIgnoreCase) ? thumb : null;
        items.Add(new FeedItem(
            title,
            string.IsNullOrEmpty(permalink) ? $"https://www.reddit.com/r/{name}" : $"https://www.reddit.com{permalink}",
            $"u/{author} · {score}",
            thumbUrl));
        if (items.Count >= take) break;
    }

    return items;
}

List<FeedItem> ParseLemmy(JsonElement root, int take)
{
    var items = new List<FeedItem>();
    if (!root.TryGetProperty("posts", out var posts) || posts.ValueKind != JsonValueKind.Array)
        return items;

    foreach (var entry in posts.EnumerateArray())
    {
        if (!entry.TryGetProperty("post", out var post)) continue;
        var title = post.TryGetProperty("name", out var t) ? t.GetString() ?? "" : "";
        if (string.IsNullOrWhiteSpace(title)) continue;
        var url = post.TryGetProperty("url", out var u) ? u.GetString() : null;
        if (string.IsNullOrWhiteSpace(url))
            url = post.TryGetProperty("ap_id", out var ap) ? ap.GetString() : null;
        if (string.IsNullOrWhiteSpace(url)) continue;
        var score = entry.TryGetProperty("counts", out var counts)
            && counts.TryGetProperty("score", out var sc)
            && sc.TryGetInt32(out var scoreVal)
            ? scoreVal
            : 0;
        var creator = entry.TryGetProperty("creator", out var cr) && cr.TryGetProperty("name", out var cn)
            ? cn.GetString() ?? ""
            : "";
        var thumb = post.TryGetProperty("thumbnail_url", out var th) ? th.GetString() : null;
        items.Add(new FeedItem(title, url!, $"{score} · {creator}", string.IsNullOrWhiteSpace(thumb) ? null : thumb));
        if (items.Count >= take) break;
    }

    return items;
}

// Protect mutating API routes only — UI and health stay open on loopback.
app.Use(async (ctx, next) =>
{
    var path = ctx.Request.Path;
    if (!path.StartsWithSegments("/api"))
    {
        await next();
        return;
    }

    if (path.StartsWithSegments("/api/health") || ctx.Request.Method == HttpMethods.Get)
    {
        await next();
        return;
    }

    if (string.IsNullOrEmpty(apiKey))
    {
        await next();
        return;
    }

    if (!ctx.Request.Headers.TryGetValue("X-Lab-Key", out var provided)
        || !FixedTimeEquals(provided.ToString(), apiKey))
    {
        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await ctx.Response.WriteAsJsonAsync(new ApiMessage("Unauthorized"), LabJsonContext.Default.ApiMessage);
        return;
    }

    await next();
});

app.MapGet("/api/health", () => Results.Json(new HealthResponse("ok", labRoot), LabJsonContext.Default.HealthResponse))
    .WithName("GetHealth")
    .WithTags("System")
    .Produces<HealthResponse>(StatusCodes.Status200OK);

app.MapGet("/api/feeds/reddit", async (string? sub, int? limit, CancellationToken ct) =>
{
    var name = string.IsNullOrWhiteSpace(sub) ? "selfhosted" : sub.Trim();
    if (!System.Text.RegularExpressions.Regex.IsMatch(name, @"^[A-Za-z0-9_]{1,50}$"))
        return Results.Json(new ApiMessage("Invalid subreddit"), LabJsonContext.Default.ApiMessage, statusCode: 400);

    var take = Math.Clamp(limit ?? 6, 1, 15);
    try
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, $"https://www.reddit.com/r/{name}/hot.json?limit={take}&raw_json=1");
        req.Headers.TryAddWithoutValidation("User-Agent", "Mozilla/5.0 (compatible; Modulab/1.0)");
        req.Headers.TryAddWithoutValidation("Accept", "application/json");
        using var res = await sharedHttp.SendAsync(req, ct);
        if (res.IsSuccessStatusCode)
        {
            await using var stream = await res.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            var items = ParseReddit(doc.RootElement, name, take);
            if (items.Count > 0)
                return Results.Json(new FeedResponse("reddit", name, items), LabJsonContext.Default.FeedResponse);
        }

        // Reddit often blocks datacenter IPs — fall back to Lemmy community with the same name.
        using var lemmyRes = await sharedHttp.GetAsync(
            $"https://lemmy.world/api/v3/post/list?community_name={Uri.EscapeDataString(name)}&sort=Hot&limit={take}&type_=All",
            ct);
        if (!lemmyRes.IsSuccessStatusCode)
            return Results.Json(new ApiMessage($"Feed unavailable (Reddit {(int)res.StatusCode}, Lemmy {(int)lemmyRes.StatusCode})"), LabJsonContext.Default.ApiMessage, statusCode: 502);

        await using var lemmyStream = await lemmyRes.Content.ReadAsStreamAsync(ct);
        using var lemmyDoc = await JsonDocument.ParseAsync(lemmyStream, cancellationToken: ct);
        var lemmyItems = ParseLemmy(lemmyDoc.RootElement, take);
        return Results.Json(new FeedResponse("lemmy", name, lemmyItems), LabJsonContext.Default.FeedResponse);
    }
    catch (Exception ex)
    {
        return Results.Json(new ApiMessage(ex.Message), LabJsonContext.Default.ApiMessage, statusCode: 502);
    }
})
    .WithName("GetRedditFeed")
    .WithTags("Feeds")
    .Produces<FeedResponse>(StatusCodes.Status200OK)
    .ProducesApiMessage(StatusCodes.Status400BadRequest, StatusCodes.Status502BadGateway);

app.MapGet("/api/feeds/hn", async (int? limit, CancellationToken ct) =>
{
    var take = Math.Clamp(limit ?? 8, 1, 20);
    try
    {
        using var idsRes = await sharedHttp.GetAsync("https://hacker-news.firebaseio.com/v0/topstories.json", ct);
        idsRes.EnsureSuccessStatusCode();
        var ids = await idsRes.Content.ReadFromJsonAsync(LabJsonContext.Default.ListInt32, ct) ?? [];
        var items = new List<FeedItem>();
        foreach (var id in ids.Take(take * 2))
        {
            using var itemRes = await sharedHttp.GetAsync($"https://hacker-news.firebaseio.com/v0/item/{id}.json", ct);
            if (!itemRes.IsSuccessStatusCode) continue;
            await using var stream = await itemRes.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            var root = doc.RootElement;
            if (root.TryGetProperty("type", out var type) && type.GetString() != "story") continue;
            var title = root.TryGetProperty("title", out var t) ? t.GetString() ?? "" : "";
            if (string.IsNullOrWhiteSpace(title)) continue;
            var url = root.TryGetProperty("url", out var u) ? u.GetString() : null;
            if (string.IsNullOrWhiteSpace(url)) url = $"https://news.ycombinator.com/item?id={id}";
            var by = root.TryGetProperty("by", out var b) ? b.GetString() ?? "" : "";
            var score = root.TryGetProperty("score", out var s) && s.TryGetInt32(out var scoreVal) ? scoreVal : 0;
            items.Add(new FeedItem(title, url!, $"{score} pts · {by}", null));
            if (items.Count >= take) break;
        }

        return Results.Json(new FeedResponse("hn", "top", items), LabJsonContext.Default.FeedResponse);
    }
    catch (Exception ex)
    {
        return Results.Json(new ApiMessage(ex.Message), LabJsonContext.Default.ApiMessage, statusCode: 502);
    }
})
    .WithName("GetHackerNewsFeed")
    .WithTags("Feeds")
    .Produces<FeedResponse>(StatusCodes.Status200OK)
    .ProducesApiMessage(StatusCodes.Status502BadGateway);

app.MapGet("/api/weather", async (double? lat, double? lon, string? label, CancellationToken ct) =>
{
    var latitude = lat ?? 52.52;
    var longitude = lon ?? 13.405;
    var place = string.IsNullOrWhiteSpace(label) ? "Local" : label.Trim();
    try
    {
        var url =
            $"https://api.open-meteo.com/v1/forecast?latitude={latitude.ToString(System.Globalization.CultureInfo.InvariantCulture)}" +
            $"&longitude={longitude.ToString(System.Globalization.CultureInfo.InvariantCulture)}" +
            "&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&timezone=auto";
        using var res = await sharedHttp.GetAsync(url, ct);
        res.EnsureSuccessStatusCode();
        await using var stream = await res.Content.ReadAsStreamAsync(ct);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
        var current = doc.RootElement.GetProperty("current");
        var temp = current.GetProperty("temperature_2m").GetDouble();
        var code = current.GetProperty("weather_code").GetInt32();
        var wind = current.GetProperty("wind_speed_10m").GetDouble();
        var humidity = current.GetProperty("relative_humidity_2m").GetInt32();
        return Results.Json(
            new WeatherResponse(place, temp, code, WeatherLabel(code), wind, humidity),
            LabJsonContext.Default.WeatherResponse);
    }
    catch (Exception ex)
    {
        return Results.Json(new ApiMessage(ex.Message), LabJsonContext.Default.ApiMessage, statusCode: 502);
    }
})
    .WithName("GetWeather")
    .WithTags("Widgets")
    .Produces<WeatherResponse>(StatusCodes.Status200OK)
    .ProducesApiMessage(StatusCodes.Status502BadGateway);

app.MapGet("/api/catalog", () =>
{
    try
    {
        var recipes = LoadRecipes(labRoot);
        var enabled = LoadEnabled(labRoot);
        var (running, present) = ProbeContainers(labRoot, recipes);
        var items = recipes
            .Where(r => !string.Equals(r.Id, "control-center", StringComparison.OrdinalIgnoreCase))
            .Select(r => ToCatalogItem(r, enabled, running, present))
            .ToList();
        return Results.Json(new CatalogResponse(items), LabJsonContext.Default.CatalogResponse);
    }
    catch (Exception ex)
    {
        return Results.Json(new ApiMessage(ex.Message), LabJsonContext.Default.ApiMessage, statusCode: 500);
    }
})
    .WithName("GetCatalog")
    .WithTags("Apps")
    .Produces<CatalogResponse>(StatusCodes.Status200OK)
    .ProducesApiMessage(StatusCodes.Status500InternalServerError);

app.MapGet("/api/apps/{id}", (string id) =>
{
    var recipe = LoadRecipes(labRoot).FirstOrDefault(r => r.Id == id);
    if (recipe is null)
        return Results.Json(new ApiMessage($"Unknown app '{id}'"), LabJsonContext.Default.ApiMessage, statusCode: 404);

    var enabled = LoadEnabled(labRoot);
    var (running, present) = ProbeContainers(labRoot, [recipe]);
    return Results.Json(ToCatalogItem(recipe, enabled, running, present), LabJsonContext.Default.CatalogItem);
})
    .WithName("GetApp")
    .WithTags("Apps")
    .Produces<CatalogItem>(StatusCodes.Status200OK)
    .ProducesApiMessage(StatusCodes.Status404NotFound);

app.MapPost("/api/apps/{id}/install", async (string id, InstallRequest? body) =>
{
    var recipe = LoadRecipes(labRoot).FirstOrDefault(r => r.Id == id);
    if (recipe is null)
        return Results.Json(new ApiMessage($"Unknown app '{id}'"), LabJsonContext.Default.ApiMessage, statusCode: 404);
    if (!recipe.Installable)
        return Results.Json(new ApiMessage($"'{id}' is not installable"), LabJsonContext.Default.ApiMessage, statusCode: 400);

    try
    {
        await EnableAndStartAsync(labRoot, recipe, body?.Config);
        return Results.Json(new ApiMessage($"Installed {id}"), LabJsonContext.Default.ApiMessage);
    }
    catch (Exception ex)
    {
        // Install enables the app before start — roll back so failed installs stay "available".
        try { DisableApp(labRoot, id); } catch { /* best-effort */ }
        return Results.Json(new ApiMessage(ex.Message), LabJsonContext.Default.ApiMessage, statusCode: 500);
    }
})
    .WithName("InstallApp")
    .WithTags("Apps")
    .Accepts<InstallRequest>("application/json")
    .Produces<ApiMessage>(StatusCodes.Status200OK)
    .ProducesApiMessage(StatusCodes.Status400BadRequest, StatusCodes.Status404NotFound, StatusCodes.Status500InternalServerError);

app.MapPost("/api/apps/{id}/start", async (string id) =>
{
    var recipe = LoadRecipes(labRoot).FirstOrDefault(r => r.Id == id);
    if (recipe is null)
        return Results.Json(new ApiMessage($"Unknown app '{id}'"), LabJsonContext.Default.ApiMessage, statusCode: 404);

    try
    {
        EnsureEnabled(labRoot, id);
        await RunScriptAsync(labRoot, "render-config.sh");
        await RunScriptAsync(labRoot, "start.sh", id);
        return Results.Json(new ApiMessage($"Started {id}"), LabJsonContext.Default.ApiMessage);
    }
    catch (Exception ex)
    {
        return Results.Json(new ApiMessage(ex.Message), LabJsonContext.Default.ApiMessage, statusCode: 500);
    }
})
    .WithName("StartApp")
    .WithTags("Apps")
    .Produces<ApiMessage>(StatusCodes.Status200OK)
    .ProducesApiMessage(StatusCodes.Status404NotFound, StatusCodes.Status500InternalServerError);

app.MapPost("/api/apps/{id}/stop", async (string id) =>
{
    var recipe = LoadRecipes(labRoot).FirstOrDefault(r => r.Id == id);
    if (recipe is null)
        return Results.Json(new ApiMessage($"Unknown app '{id}'"), LabJsonContext.Default.ApiMessage, statusCode: 404);

    try
    {
        await RunScriptAsync(labRoot, "stop.sh", id);
        return Results.Json(new ApiMessage($"Stopped {id}"), LabJsonContext.Default.ApiMessage);
    }
    catch (Exception ex)
    {
        return Results.Json(new ApiMessage(ex.Message), LabJsonContext.Default.ApiMessage, statusCode: 500);
    }
})
    .WithName("StopApp")
    .WithTags("Apps")
    .Produces<ApiMessage>(StatusCodes.Status200OK)
    .ProducesApiMessage(StatusCodes.Status404NotFound, StatusCodes.Status500InternalServerError);

app.MapGet("/api/updates", async (bool? refresh, CancellationToken ct) =>
{
    try
    {
        var response = await GetUpdatesCachedAsync(labRoot, refresh == true, ct);
        return Results.Json(response, LabJsonContext.Default.UpdatesResponse);
    }
    catch (Exception ex)
    {
        return Results.Json(new ApiMessage(ex.Message), LabJsonContext.Default.ApiMessage, statusCode: 500);
    }
})
    .WithName("GetUpdates")
    .WithTags("Apps")
    .Produces<UpdatesResponse>(StatusCodes.Status200OK)
    .ProducesApiMessage(StatusCodes.Status500InternalServerError);

app.MapGet("/api/apps/{id}/updates", async (string id, bool? refresh, CancellationToken ct) =>
{
    var recipe = LoadRecipes(labRoot).FirstOrDefault(r => r.Id == id);
    if (recipe is null)
        return Results.Json(new ApiMessage($"Unknown app '{id}'"), LabJsonContext.Default.ApiMessage, statusCode: 404);

    try
    {
        var status = await CheckAppUpdatesAsync(labRoot, recipe, ct);
        return Results.Json(status, LabJsonContext.Default.AppUpdateStatus);
    }
    catch (Exception ex)
    {
        return Results.Json(new ApiMessage(ex.Message), LabJsonContext.Default.ApiMessage, statusCode: 500);
    }
})
    .WithName("GetAppUpdates")
    .WithTags("Apps")
    .Produces<AppUpdateStatus>(StatusCodes.Status200OK)
    .ProducesApiMessage(StatusCodes.Status404NotFound, StatusCodes.Status500InternalServerError);

app.MapPost("/api/apps/{id}/update", async (string id) =>
{
    var recipe = LoadRecipes(labRoot).FirstOrDefault(r => r.Id == id);
    if (recipe is null)
        return Results.Json(new ApiMessage($"Unknown app '{id}'"), LabJsonContext.Default.ApiMessage, statusCode: 404);

    try
    {
        EnsureEnabled(labRoot, id);
        await RunScriptAsync(labRoot, "update.sh", id);
        InvalidateUpdatesCache();
        return Results.Json(new ApiMessage($"Updated {id}"), LabJsonContext.Default.ApiMessage);
    }
    catch (Exception ex)
    {
        return Results.Json(new ApiMessage(ex.Message), LabJsonContext.Default.ApiMessage, statusCode: 500);
    }
})
    .WithName("UpdateApp")
    .WithTags("Apps")
    .Produces<ApiMessage>(StatusCodes.Status200OK)
    .ProducesApiMessage(StatusCodes.Status404NotFound, StatusCodes.Status500InternalServerError);

app.MapDelete("/api/apps/{id}", async (string id) =>
{
    var recipe = LoadRecipes(labRoot).FirstOrDefault(r => r.Id == id);
    if (recipe is null)
        return Results.Json(new ApiMessage($"Unknown app '{id}'"), LabJsonContext.Default.ApiMessage, statusCode: 404);
    if (recipe.Core)
        return Results.Json(new ApiMessage($"Cannot uninstall core app '{id}'"), LabJsonContext.Default.ApiMessage, statusCode: 400);

    try
    {
        await RunScriptAsync(labRoot, "stop.sh", id);
        DisableApp(labRoot, id);
        await RunScriptAsync(labRoot, "render-config.sh");
        return Results.Json(new ApiMessage($"Uninstalled {id} (volumes kept)"), LabJsonContext.Default.ApiMessage);
    }
    catch (Exception ex)
    {
        return Results.Json(new ApiMessage(ex.Message), LabJsonContext.Default.ApiMessage, statusCode: 500);
    }
})
    .WithName("UninstallApp")
    .WithTags("Apps")
    .Produces<ApiMessage>(StatusCodes.Status200OK)
    .ProducesApiMessage(StatusCodes.Status400BadRequest, StatusCodes.Status404NotFound, StatusCodes.Status500InternalServerError);

app.MapPost("/api/dashboard/bookmarks", (ImportBookmarksRequest? body) =>
{
    if (body?.Groups is null || body.Groups.Count == 0)
        return Results.Json(new ApiMessage("No bookmark groups to import"), LabJsonContext.Default.ApiMessage, statusCode: 400);

    try
    {
        var added = ImportBookmarkGroups(labRoot, body);
        return Results.Json(
            new ApiMessage($"Imported {added} shortcut(s) into dashboard.json"),
            LabJsonContext.Default.ApiMessage);
    }
    catch (Exception ex)
    {
        return Results.Json(new ApiMessage(ex.Message), LabJsonContext.Default.ApiMessage, statusCode: 500);
    }
})
    .WithName("ImportBookmarks")
    .WithTags("Dashboard")
    .Accepts<ImportBookmarksRequest>("application/json")
    .Produces<ApiMessage>(StatusCodes.Status200OK)
    .ProducesApiMessage(StatusCodes.Status400BadRequest, StatusCodes.Status500InternalServerError);

app.MapPut("/api/dashboard/bookmarks", (ReplaceBookmarksRequest? body) =>
{
    if (body?.Groups is null)
        return Results.Json(new ApiMessage("Missing bookmark groups"), LabJsonContext.Default.ApiMessage, statusCode: 400);

    try
    {
        var count = ReplaceBookmarkGroups(labRoot, body);
        return Results.Json(
            new ApiMessage($"Saved {count} shortcut group(s)"),
            LabJsonContext.Default.ApiMessage);
    }
    catch (Exception ex)
    {
        return Results.Json(new ApiMessage(ex.Message), LabJsonContext.Default.ApiMessage, statusCode: 500);
    }
})
    .WithName("ReplaceBookmarks")
    .WithTags("Dashboard")
    .Accepts<ReplaceBookmarksRequest>("application/json")
    .Produces<ApiMessage>(StatusCodes.Status200OK)
    .ProducesApiMessage(StatusCodes.Status400BadRequest, StatusCodes.Status500InternalServerError);

app.MapGet("/api/dashboard", () =>
{
    try
    {
        EnsureDashboardJson(labRoot);
        var path = DashboardJsonPath(labRoot);
        if (!File.Exists(path))
            return Results.Json(new ApiMessage("dashboard.json missing"), LabJsonContext.Default.ApiMessage, statusCode: 404);
        var node = JsonNode.Parse(File.ReadAllText(path))
            ?? throw new InvalidOperationException("dashboard.json is empty");
        return Results.Json(node, LabJsonContext.Default.JsonNode);
    }
    catch (Exception ex)
    {
        return Results.Json(new ApiMessage(ex.Message), LabJsonContext.Default.ApiMessage, statusCode: 500);
    }
})
    .WithName("GetDashboard")
    .WithTags("Dashboard")
    .Produces<JsonNode>(StatusCodes.Status200OK, "application/json")
    .ProducesApiMessage(StatusCodes.Status404NotFound, StatusCodes.Status500InternalServerError);

app.MapPut("/api/dashboard", (JsonNode? body) =>
{
    try
    {
        if (body is null)
            return Results.Json(new ApiMessage("Missing body"), LabJsonContext.Default.ApiMessage, statusCode: 400);
        SaveDashboardDocument(labRoot, body.ToJsonString());
        return Results.Json(new ApiMessage("Settings saved"), LabJsonContext.Default.ApiMessage);
    }
    catch (Exception ex)
    {
        return Results.Json(new ApiMessage(ex.Message), LabJsonContext.Default.ApiMessage, statusCode: 400);
    }
})
    .WithName("PutDashboard")
    .WithTags("Dashboard")
    .Accepts<JsonNode>("application/json")
    .Produces<ApiMessage>(StatusCodes.Status200OK)
    .ProducesApiMessage(StatusCodes.Status400BadRequest);

// Prefer control-center/wwwroot (dev + Docker mount); fall back to wwwroot beside the binary.
EnsureDashboardJson(labRoot);
if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("CONTROL_CENTER_WWWROOT")))
{
    var uiRoot = Path.Combine(labRoot, "control-center", "wwwroot");
    if (Directory.Exists(uiRoot))
        Environment.SetEnvironmentVariable("CONTROL_CENTER_WWWROOT", uiRoot);
}

app.UseControlCenterSpa();
app.Run();

static bool IsOpenApiDocumentGeneration() =>
    string.Equals(
        Environment.GetEnvironmentVariable("DOTNET_GenerateOpenApiDocuments"),
        "true",
        StringComparison.OrdinalIgnoreCase)
    || AppDomain.CurrentDomain.FriendlyName.Contains("GetDocument", StringComparison.OrdinalIgnoreCase);

static string FindLabRoot()
{
    var dir = new DirectoryInfo(Directory.GetCurrentDirectory());
    while (dir is not null)
    {
        if (File.Exists(Path.Combine(dir.FullName, "lab.config.json"))
            || File.Exists(Path.Combine(dir.FullName, "lab.config.example.json")))
            return dir.FullName;
        dir = dir.Parent;
    }

    return Directory.GetCurrentDirectory();
}

static string? ReadApiKey(string labRoot)
{
    var configPath = Path.Combine(labRoot, "lab.config.json");
    if (!File.Exists(configPath))
        return null;
    try
    {
        var node = JsonNode.Parse(File.ReadAllText(configPath));
        return node?["lab"]?["controlCenterApiKey"]?.GetValue<string>()
            ?? node?["lab"]?["labApiKey"]?.GetValue<string>();
    }
    catch
    {
        return null;
    }
}

static bool FixedTimeEquals(string a, string b)
{
    if (a.Length != b.Length)
        return false;
    var diff = 0;
    for (var i = 0; i < a.Length; i++)
        diff |= a[i] ^ b[i];
    return diff == 0;
}

static List<Recipe> LoadRecipes(string labRoot)
{
    var catalog = Path.Combine(labRoot, "catalog");
    var list = new List<Recipe>();
    if (!Directory.Exists(catalog))
        return list;

    foreach (var path in Directory.GetDirectories(catalog).OrderBy(p => p, StringComparer.Ordinal))
    {
        var recipePath = Path.Combine(path, "recipe.json");
        if (!File.Exists(recipePath))
            continue;
        try
        {
            var recipe = JsonSerializer.Deserialize(File.ReadAllText(recipePath), LabJsonContext.Default.Recipe);
            if (recipe is not null && !string.IsNullOrWhiteSpace(recipe.Id))
                list.Add(recipe);
        }
        catch
        {
            // skip broken recipe
        }
    }

    return list;
}

static HashSet<string> LoadEnabled(string labRoot)
{
    var configPath = Path.Combine(labRoot, "lab.config.json");
    var set = new HashSet<string>(StringComparer.Ordinal);
    if (!File.Exists(configPath))
        return set;

    try
    {
        var node = JsonNode.Parse(File.ReadAllText(configPath)) as JsonObject;
        if (node?["enabled"] is JsonArray arr)
        {
            foreach (var item in arr)
            {
                var id = item?.GetValue<string>();
                if (!string.IsNullOrWhiteSpace(id))
                    set.Add(id);
            }
        }
    }
    catch
    {
        // empty
    }

    return set;
}

static JsonObject LoadConfigObject(string labRoot)
{
    var configPath = Path.Combine(labRoot, "lab.config.json");
    if (!File.Exists(configPath))
    {
        var example = Path.Combine(labRoot, "lab.config.example.json");
        if (File.Exists(example))
            File.Copy(example, configPath);
        else
            File.WriteAllText(configPath, """{"lab":{},"enabled":["control-center","postgres","redis"]}""");
    }

    var node = JsonNode.Parse(File.ReadAllText(configPath)) as JsonObject
        ?? throw new InvalidOperationException("lab.config.json must be an object");
    return node;
}

static void SaveConfigObject(string labRoot, JsonObject config)
{
    var configPath = Path.Combine(labRoot, "lab.config.json");
    var json = config.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
    File.WriteAllText(configPath, json + "\n");
}

static void EnsureEnabled(string labRoot, string id)
{
    var config = LoadConfigObject(labRoot);
    if (config["enabled"] is not JsonArray enabled)
    {
        enabled = [];
        config["enabled"] = enabled;
    }

    if (!enabled.Any(n => n?.GetValue<string>() == id))
        enabled.Add((JsonNode)JsonValue.Create(id)!);

    SaveConfigObject(labRoot, config);
}

static void DisableApp(string labRoot, string id)
{
    var config = LoadConfigObject(labRoot);
    if (config["enabled"] is not JsonArray enabled)
        return;

    for (var i = enabled.Count - 1; i >= 0; i--)
    {
        if (enabled[i]?.GetValue<string>() == id)
            enabled.RemoveAt(i);
    }

    SaveConfigObject(labRoot, config);
}

static async Task EnableAndStartAsync(string labRoot, Recipe recipe, Dictionary<string, JsonElement>? configFields)
{
    var all = LoadRecipes(labRoot);
    var byId = all.ToDictionary(r => r.Id, StringComparer.Ordinal);

    void EnableTree(string id)
    {
        if (!byId.TryGetValue(id, out var node))
            return;
        foreach (var dep in node.DependsOn)
            EnableTree(dep);
        EnsureEnabled(labRoot, id);
    }

    EnableTree(recipe.Id);

    var config = LoadConfigObject(labRoot);
    var section = config[recipe.Id] as JsonObject ?? new JsonObject();
    foreach (var (key, value) in recipe.Defaults)
        section[key] = JsonNode.Parse(value.GetRawText());

    var lab = config["lab"] as JsonObject ?? new JsonObject();
    foreach (var field in recipe.Fields)
    {
        if (!string.IsNullOrEmpty(field.FromLab) && lab[field.FromLab] is not null && !section.ContainsKey(field.Key))
            section[field.Key] = lab[field.FromLab]!.DeepClone();
        else if (field.Default is { } def
                 && def.ValueKind is not JsonValueKind.Undefined and not JsonValueKind.Null
                 && !section.ContainsKey(field.Key))
            section[field.Key] = JsonNode.Parse(def.GetRawText());
    }

    if (configFields is not null)
    {
        foreach (var (key, value) in configFields)
            section[key] = JsonNode.Parse(value.GetRawText());
    }

    config[recipe.Id] = section;
    SaveConfigObject(labRoot, config);

    await RunScriptAsync(labRoot, "render-config.sh");
    await RunScriptAsync(labRoot, "start.sh", recipe.Id);
}

static void InvalidateUpdatesCache()
{
    lock (UpdatesCacheState.Lock)
    {
        UpdatesCacheState.Response = null;
    }
}

static async Task<UpdatesResponse> GetUpdatesCachedAsync(string labRoot, bool forceRefresh, CancellationToken ct)
{
    if (!forceRefresh)
    {
        lock (UpdatesCacheState.Lock)
        {
            if (UpdatesCacheState.Response is not null
                && DateTimeOffset.UtcNow - UpdatesCacheState.At < UpdatesCacheState.Ttl)
                return UpdatesCacheState.Response with { FromCache = true };
        }
    }

    var recipes = LoadRecipes(labRoot)
        .Where(r => !string.Equals(r.Id, "control-center", StringComparison.OrdinalIgnoreCase))
        .ToList();
    var enabled = LoadEnabled(labRoot);
    var (_, present) = ProbeContainers(labRoot, recipes);

    var targets = recipes
        .Where(r => enabled.Contains(r.Id) || present.Contains(r.Id) || r.Core)
        .Where(r => File.Exists(ResolveComposeFile(labRoot, r)))
        .ToList();

    var apps = new List<AppUpdateStatus>();
    foreach (var recipe in targets)
    {
        ct.ThrowIfCancellationRequested();
        apps.Add(await CheckAppUpdatesAsync(labRoot, recipe, ct));
    }

    var response = new UpdatesResponse(apps, DateTimeOffset.UtcNow, FromCache: false);
    lock (UpdatesCacheState.Lock)
    {
        UpdatesCacheState.Response = response;
        UpdatesCacheState.At = DateTimeOffset.UtcNow;
    }

    return response;
}

static async Task<AppUpdateStatus> CheckAppUpdatesAsync(string labRoot, Recipe recipe, CancellationToken ct)
{
    var images = new List<ImageUpdateStatus>();
    List<string> refs;
    try
    {
        refs = ComposeImageRefs(labRoot, recipe);
    }
    catch (Exception ex)
    {
        return new AppUpdateStatus(recipe.Id, recipe.Name, false, [
            new ImageUpdateStatus("", null, null, null, false, null, ex.Message)
        ]);
    }

    if (refs.Count == 0)
        return new AppUpdateStatus(recipe.Id, recipe.Name, false, images);

    foreach (var imageRef in refs)
    {
        ct.ThrowIfCancellationRequested();
        images.Add(await CheckImageUpdateAsync(labRoot, imageRef, ct));
    }

    return new AppUpdateStatus(
        recipe.Id,
        recipe.Name,
        images.Any(i => i.UpdateAvailable),
        images);
}

static async Task<ImageUpdateStatus> CheckImageUpdateAsync(
    string labRoot,
    string imageRef,
    CancellationToken ct)
{
    string? localId = null;
    string? localDigest = null;
    string? remoteDigest = null;
    string? error = null;
    var reasons = new List<string>();

    try
    {
        var (exit, stdout, stderr) = await RunAsync(
            "docker",
            $"image inspect {QuoteArg(imageRef)} --format \"{{{{json .}}}}\"",
            labRoot,
            20_000);
        if (exit == 0 && !string.IsNullOrWhiteSpace(stdout))
        {
            using var doc = JsonDocument.Parse(stdout);
            var root = doc.RootElement;
            if (root.ValueKind == JsonValueKind.Array && root.GetArrayLength() > 0)
                root = root[0];
            localId = root.TryGetProperty("Id", out var idEl) ? idEl.GetString() : null;
            localDigest = ExtractLocalDigest(root, imageRef);
        }
        else
        {
            error = string.IsNullOrWhiteSpace(stderr) ? "Local image not found" : stderr.Trim();
        }
    }
    catch (Exception ex)
    {
        error = ex.Message;
    }

    try
    {
        remoteDigest = await ResolveRemoteDigestAsync(labRoot, imageRef, ct);
    }
    catch (Exception ex)
    {
        error = string.IsNullOrEmpty(error) ? ex.Message : $"{error}; {ex.Message}";
    }

    if (!string.IsNullOrEmpty(localDigest)
        && !string.IsNullOrEmpty(remoteDigest)
        && !DigestsEqual(localDigest, remoteDigest))
        reasons.Add("newer-registry");

    // No local image but remote resolves → treat as needing pull/update.
    if (string.IsNullOrEmpty(localId) && !string.IsNullOrEmpty(remoteDigest))
        reasons.Add("newer-registry");

    // Container still on an older local image ID for this tag.
    if (!string.IsNullOrEmpty(localId) && ContainersUseStaleImage(labRoot, imageRef, localId))
        reasons.Add("container-stale");

    var reason = reasons.Count == 0 ? null : string.Join(",", reasons);
    return new ImageUpdateStatus(
        imageRef,
        localDigest,
        remoteDigest,
        localId,
        reasons.Count > 0,
        reason,
        error);
}

static async Task<string?> ResolveRemoteDigestAsync(string labRoot, string imageRef, CancellationToken ct)
{
    ct.ThrowIfCancellationRequested();
    var (exit, stdout, stderr) = await RunAsync(
        "docker",
        $"buildx imagetools inspect {QuoteArg(imageRef)} --format \"{{{{json .}}}}\"",
        labRoot,
        45_000);
    if (exit != 0 || string.IsNullOrWhiteSpace(stdout))
        throw new InvalidOperationException(
            string.IsNullOrWhiteSpace(stderr) ? $"Could not inspect remote image {imageRef}" : stderr.Trim());

    using var doc = JsonDocument.Parse(stdout);
    return ExtractRemoteDigest(doc.RootElement)
        ?? throw new InvalidOperationException($"No digest in imagetools output for {imageRef}");
}

static string? ExtractRemoteDigest(JsonElement root)
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

static string? ExtractLocalDigest(JsonElement imageInspect, string imageRef)
{
    if (!imageInspect.TryGetProperty("RepoDigests", out var digests) || digests.ValueKind != JsonValueKind.Array)
        return null;

    var repo = ImageRepo(imageRef);
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

    // Fall back to first digest if repo matching failed.
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

static string ImageRepo(string imageRef)
{
    var cut = imageRef.IndexOf('@');
    if (cut >= 0)
        imageRef = imageRef[..cut];
    var slash = imageRef.LastIndexOf('/');
    var name = slash >= 0 ? imageRef[(slash + 1)..] : imageRef;
    var colon = name.LastIndexOf(':');
    if (colon >= 0)
        name = name[..colon];
    // Prefer full path without tag for matching RepoDigests.
    cut = imageRef.LastIndexOf(':');
    if (cut > imageRef.LastIndexOf('/'))
        return imageRef[..cut];
    return imageRef;
}

static string? NormalizeDigest(string? value)
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

static bool DigestsEqual(string a, string b)
{
    var na = NormalizeDigest(a);
    var nb = NormalizeDigest(b);
    return !string.IsNullOrEmpty(na)
        && !string.IsNullOrEmpty(nb)
        && string.Equals(na, nb, StringComparison.OrdinalIgnoreCase);
}

static string ResolveComposeFile(string labRoot, Recipe recipe)
{
    if (!string.IsNullOrWhiteSpace(recipe.Compose))
    {
        var relative = recipe.Compose.Replace('/', Path.DirectorySeparatorChar)
            .Replace('\\', Path.DirectorySeparatorChar);
        return Path.GetFullPath(Path.Combine(labRoot, relative));
    }

    return Path.Combine(labRoot, $"docker-compose.{recipe.Id}.yml");
}

static List<string> ComposeImageRefs(string labRoot, Recipe recipe)
{
    var compose = ResolveComposeFile(labRoot, recipe);
    if (!File.Exists(compose))
        return [];

    var envFile = Path.Combine(labRoot, ".env");
    var args = File.Exists(envFile)
        ? $"compose --env-file {QuoteArg(envFile)} -f {QuoteArg(compose)} config --images"
        : $"compose -f {QuoteArg(compose)} config --images";
    var output = RunCapture("docker", args, labRoot, 30_000);
    return output
        .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Where(line => !string.IsNullOrWhiteSpace(line))
        .Distinct(StringComparer.Ordinal)
        .ToList();
}

static bool ContainersUseStaleImage(string labRoot, string imageRef, string localImageId)
{
    try
    {
        var output = RunCapture(
            "docker",
            $"ps -a --filter ancestor={QuoteArg(imageRef)} --format \"{{{{.ID}}}}\"",
            labRoot,
            15_000);
        var containerIds = output
            .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .ToList();
        if (containerIds.Count == 0)
            return false;

        foreach (var containerId in containerIds)
        {
            var (exit, stdout, _) = RunAsync(
                "docker",
                $"inspect {QuoteArg(containerId)} --format \"{{{{.Image}}}}\"",
                labRoot,
                15_000).GetAwaiter().GetResult();
            if (exit != 0 || string.IsNullOrWhiteSpace(stdout))
                continue;
            if (!DigestsEqual(stdout.Trim(), localImageId))
                return true;
        }
    }
    catch
    {
        return false;
    }

    return false;
}

static string QuoteArg(string value)
{
    if (string.IsNullOrEmpty(value))
        return "\"\"";
    if (!value.Contains(' ') && !value.Contains('"') && !value.Contains('\\'))
        return value;
    return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
}

static (HashSet<string> Running, HashSet<string> Present) ProbeContainers(string labRoot, List<Recipe> recipes)
{
    var running = new HashSet<string>(StringComparer.Ordinal);
    var present = new HashSet<string>(StringComparer.Ordinal);
    if (recipes.Count == 0)
        return (running, present);

    try
    {
        var output = RunCapture("docker", "ps -a --format \"{{.Names}}\\t{{.State}}\"", labRoot);
        var states = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in output.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var parts = line.Split('\t', 2, StringSplitOptions.TrimEntries);
            if (parts.Length == 0 || string.IsNullOrWhiteSpace(parts[0]))
                continue;
            states[parts[0]] = parts.Length > 1 ? parts[1] : "";
        }

        var names = states.Keys.ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var recipe in recipes)
        {
            if (!TryMatchContainer(names, recipe.Id, out var matchedName))
                continue;
            present.Add(recipe.Id);
            if (states.TryGetValue(matchedName, out var state)
                && state.Equals("running", StringComparison.OrdinalIgnoreCase))
                running.Add(recipe.Id);
        }
    }
    catch
    {
        // treat all as absent/stopped
    }

    return (running, present);
}

static bool TryMatchContainer(HashSet<string> names, string recipeId, out string matchedName)
{
    matchedName = "";
    foreach (var name in names)
    {
        if (name.Equals(recipeId, StringComparison.OrdinalIgnoreCase)
            || name.StartsWith(recipeId + "-", StringComparison.OrdinalIgnoreCase)
            || name.StartsWith(recipeId + "_", StringComparison.OrdinalIgnoreCase)
            || name.Contains("-" + recipeId + "-", StringComparison.OrdinalIgnoreCase)
            || name.Contains("_" + recipeId + "_", StringComparison.OrdinalIgnoreCase)
            || name.EndsWith("-" + recipeId, StringComparison.OrdinalIgnoreCase)
            || name.EndsWith("_" + recipeId, StringComparison.OrdinalIgnoreCase))
        {
            matchedName = name;
            return true;
        }
    }

    return false;
}

static CatalogItem ToCatalogItem(
    Recipe recipe,
    HashSet<string> enabled,
    HashSet<string> running,
    HashSet<string> present)
{
    var isRunning = running.Contains(recipe.Id);
    var isPresent = present.Contains(recipe.Id);
    var isEnabled = enabled.Contains(recipe.Id) || recipe.Core;

    // Status from Docker + whether the app is still expected in the stack (enabled).
    string status;
    if (isRunning)
        status = "running";
    else if (isPresent)
        status = "stopped";
    else if (isEnabled)
        status = "removed"; // expected in stack, but container deleted outside Control Center
    else
        status = "available";

    return new CatalogItem(
        recipe.Id,
        recipe.Name,
        recipe.Description,
        recipe.Category,
        recipe.Port,
        recipe.Path,
        recipe.Installable,
        recipe.Core,
        recipe.DependsOn,
        recipe.Fields,
        isEnabled,
        isRunning,
        status);
}

static async Task RunScriptAsync(string labRoot, string script, string? arg = null)
{
    var scriptPath = Path.Combine(labRoot, "scripts", script);
    if (!File.Exists(scriptPath))
        throw new InvalidOperationException($"Missing {scriptPath}");

    var args = arg is null ? $"\"{scriptPath}\"" : $"\"{scriptPath}\" {arg}";
    var (exit, stdout, stderr) = await RunAsync("bash", args, labRoot);
    if (exit != 0)
        throw new InvalidOperationException($"bash {script} failed ({exit}): {stderr}\n{stdout}".Trim());
}

static Task<(int Exit, string StdOut, string StdErr)> RunAsync(
    string file,
    string args,
    string cwd,
    int? timeoutMs = null)
{
    return Task.Run(() =>
    {
        var psi = new ProcessStartInfo
        {
            FileName = file,
            Arguments = args,
            WorkingDirectory = cwd,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        using var proc = Process.Start(psi) ?? throw new InvalidOperationException($"Failed to start {file}");
        var stdout = proc.StandardOutput.ReadToEnd();
        var stderr = proc.StandardError.ReadToEnd();
        if (timeoutMs is int ms)
        {
            if (!proc.WaitForExit(ms))
            {
                try { proc.Kill(entireProcessTree: true); } catch { /* ignore */ }
                throw new TimeoutException($"{file} timed out after {ms}ms");
            }
        }
        else
        {
            proc.WaitForExit();
        }

        return (proc.ExitCode, stdout, stderr);
    });
}

static string RunCapture(string file, string args, string cwd, int timeoutMs = 15_000)
{
    var psi = new ProcessStartInfo
    {
        FileName = file,
        Arguments = args,
        WorkingDirectory = cwd,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        UseShellExecute = false,
        CreateNoWindow = true,
    };
    using var proc = Process.Start(psi) ?? throw new InvalidOperationException($"Failed to start {file}");
    var stdout = proc.StandardOutput.ReadToEnd();
    if (!proc.WaitForExit(timeoutMs))
    {
        try { proc.Kill(entireProcessTree: true); } catch { /* ignore */ }
        throw new TimeoutException($"{file} timed out after {timeoutMs}ms");
    }

    return stdout.Trim();
}

static string DashboardJsonPath(string labRoot) =>
    Path.Combine(labRoot, "control-center", "wwwroot", "dashboard.json");

static string DashboardDefaultsPath(string labRoot) =>
    Path.Combine(labRoot, "control-center", "defaults", "dashboard.json");

/// <summary>Ensure wwwroot/dashboard.json exists by copying from tracked defaults.</summary>
static void EnsureDashboardJson(string labRoot)
{
    var path = DashboardJsonPath(labRoot);
    if (File.Exists(path))
        return;

    var defaults = DashboardDefaultsPath(labRoot);
    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    if (File.Exists(defaults))
    {
        File.Copy(defaults, path);
        return;
    }

    File.WriteAllText(path, """{"title":"Modulab","pages":[{"id":"home","title":"Home","items":[]}]}""");
}

static int ImportBookmarkGroups(string labRoot, ImportBookmarksRequest body)
{
    EnsureDashboardJson(labRoot);
    var path = DashboardJsonPath(labRoot);
    if (!File.Exists(path))
        throw new InvalidOperationException($"Missing {path}");

    var root = JsonNode.Parse(File.ReadAllText(path)) as JsonObject
        ?? throw new InvalidOperationException("dashboard.json must be an object");

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
            foreach (var node in bookmarks)
            {
                if (node is JsonObject obj
                    && string.Equals(obj["title"]?.GetValue<string>(), title, StringComparison.OrdinalIgnoreCase))
                {
                    target = obj;
                    break;
                }
            }
        }

        if (target is null)
        {
            target = new JsonObject
            {
                ["title"] = title,
                ["color"] = color,
                ["links"] = new JsonArray(),
            };
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
            if (string.IsNullOrWhiteSpace(link.Url) || !Uri.TryCreate(link.Url, UriKind.Absolute, out var uri))
                continue;
            if (uri.Scheme is not ("http" or "https"))
                continue;
            if (existing.Contains(link.Url))
                continue;

            var domain = string.IsNullOrWhiteSpace(link.Domain) ? uri.Host : link.Domain.Trim();
            var titleText = string.IsNullOrWhiteSpace(link.Title) ? uri.Host : link.Title.Trim();
            links.Add((JsonNode)new JsonObject
            {
                ["title"] = titleText,
                ["url"] = link.Url.Trim(),
                ["domain"] = domain,
            });
            existing.Add(link.Url);
            added++;
        }
    }

    var json = root.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
    File.WriteAllText(path, json + "\n");
    return added;
}

static int ReplaceBookmarkGroups(string labRoot, ReplaceBookmarksRequest body)
{
    EnsureDashboardJson(labRoot);
    var path = DashboardJsonPath(labRoot);
    if (!File.Exists(path))
        throw new InvalidOperationException($"Missing {path}");

    var root = JsonNode.Parse(File.ReadAllText(path)) as JsonObject
        ?? throw new InvalidOperationException("dashboard.json must be an object");

    var sidebar = root["sidebar"] as JsonObject ?? new JsonObject();
    root["sidebar"] = sidebar;

    if (body.ShowInstalledApps is bool showApps)
        sidebar["showInstalledApps"] = showApps;

    var bookmarks = new JsonArray();
    foreach (var group in body.Groups)
    {
        var title = string.IsNullOrWhiteSpace(group.Title) ? "Shortcuts" : group.Title.Trim();
        var color = string.IsNullOrWhiteSpace(group.Color) ? "other" : group.Color.Trim();
        var links = new JsonArray();

        if (group.Links is not null)
        {
            foreach (var link in group.Links)
            {
                if (string.IsNullOrWhiteSpace(link.Url) || !Uri.TryCreate(link.Url, UriKind.Absolute, out var uri))
                    continue;
                if (uri.Scheme is not ("http" or "https"))
                    continue;

                var domain = string.IsNullOrWhiteSpace(link.Domain) ? uri.Host : link.Domain.Trim();
                var titleText = string.IsNullOrWhiteSpace(link.Title) ? uri.Host : link.Title.Trim();
                links.Add((JsonNode)new JsonObject
                {
                    ["title"] = titleText,
                    ["url"] = link.Url.Trim(),
                    ["domain"] = domain,
                });
            }
        }

        bookmarks.Add((JsonNode)new JsonObject
        {
            ["title"] = title,
            ["color"] = color,
            ["links"] = links,
        });
    }

    sidebar["bookmarks"] = bookmarks;

    var json = root.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
    File.WriteAllText(path, json + "\n");
    return bookmarks.Count;
}

static void SaveDashboardDocument(string labRoot, string bodyText)
{
    if (string.IsNullOrWhiteSpace(bodyText))
        throw new InvalidOperationException("Empty body");

    var incoming = JsonNode.Parse(bodyText) as JsonObject
        ?? throw new InvalidOperationException("Body must be a JSON object");

    var path = DashboardJsonPath(labRoot);
    if (File.Exists(path))
    {
        try
        {
            var existing = JsonNode.Parse(File.ReadAllText(path)) as JsonObject;
            if (existing?["_comment"] is not null && incoming["_comment"] is null)
                incoming["_comment"] = existing["_comment"]!.DeepClone();
        }
        catch
        {
            // ignore corrupt existing file; overwrite with incoming
        }
    }

    if (incoming["sidebar"] is JsonObject sidebar && sidebar["bookmarks"] is not null and not JsonArray)
        throw new InvalidOperationException("sidebar.bookmarks must be an array");

    var json = incoming.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    File.WriteAllText(path, json + "\n");
}

internal sealed record HealthResponse(string Status, string LabRoot);
internal sealed record ApiMessage(string Message);
internal sealed record CatalogResponse(List<CatalogItem> Apps);
internal sealed record FeedItem(string Title, string Url, string Meta, string? Thumb);
internal sealed record FeedResponse(string Source, string Channel, List<FeedItem> Items);
internal sealed record WeatherResponse(string Label, double TemperatureC, int WeatherCode, string Summary, double WindKmh, int Humidity);
internal sealed record CatalogItem(
    string Id,
    string Name,
    string Description,
    string Category,
    int? Port,
    string? Path,
    bool Installable,
    bool Core,
    List<string> DependsOn,
    List<RecipeField> Fields,
    bool Enabled,
    bool Running,
    string Status);
internal sealed record InstallRequest(Dictionary<string, JsonElement>? Config);
internal sealed record BookmarkLinkDto(string Title, string Url, string? Domain);
internal sealed record BookmarkGroupDto(string Title, string? Color, List<BookmarkLinkDto> Links);
internal sealed record ImportBookmarksRequest(List<BookmarkGroupDto> Groups, bool? MergeByTitle);
internal sealed record ReplaceBookmarksRequest(List<BookmarkGroupDto> Groups, bool? ShowInstalledApps);
internal sealed record ImageUpdateStatus(
    string Image,
    string? LocalDigest,
    string? RemoteDigest,
    string? LocalId,
    bool UpdateAvailable,
    string? Reason,
    string? Error);
internal sealed record AppUpdateStatus(
    string Id,
    string Name,
    bool UpdateAvailable,
    List<ImageUpdateStatus> Images);
internal sealed record UpdatesResponse(
    List<AppUpdateStatus> Apps,
    DateTimeOffset CheckedAt,
    bool FromCache);

internal sealed class Recipe
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Category { get; set; } = "other";
    public string Compose { get; set; } = "";
    public string EnvFile { get; set; } = "";
    public int? Port { get; set; }
    public string? Path { get; set; }
    public bool Installable { get; set; } = true;
    public bool Core { get; set; }
    public List<string> DependsOn { get; set; } = [];
    public Dictionary<string, JsonElement> Defaults { get; set; } = new();
    public List<RecipeField> Fields { get; set; } = [];
}

internal sealed class RecipeField
{
    public string Key { get; set; } = "";
    public string Label { get; set; } = "";
    public string Type { get; set; } = "string";
    public bool Required { get; set; }
    public string? FromLab { get; set; }
    public JsonElement? Default { get; set; }
}

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    PropertyNameCaseInsensitive = true)]
[JsonSerializable(typeof(HealthResponse))]
[JsonSerializable(typeof(ApiMessage))]
[JsonSerializable(typeof(CatalogResponse))]
[JsonSerializable(typeof(CatalogItem))]
[JsonSerializable(typeof(FeedItem))]
[JsonSerializable(typeof(FeedResponse))]
[JsonSerializable(typeof(WeatherResponse))]
[JsonSerializable(typeof(InstallRequest))]
[JsonSerializable(typeof(BookmarkLinkDto))]
[JsonSerializable(typeof(BookmarkGroupDto))]
[JsonSerializable(typeof(ImportBookmarksRequest))]
[JsonSerializable(typeof(ReplaceBookmarksRequest))]
[JsonSerializable(typeof(ImageUpdateStatus))]
[JsonSerializable(typeof(AppUpdateStatus))]
[JsonSerializable(typeof(UpdatesResponse))]
[JsonSerializable(typeof(List<ImageUpdateStatus>))]
[JsonSerializable(typeof(List<AppUpdateStatus>))]
[JsonSerializable(typeof(List<BookmarkLinkDto>))]
[JsonSerializable(typeof(List<BookmarkGroupDto>))]
[JsonSerializable(typeof(Recipe))]
[JsonSerializable(typeof(RecipeField))]
[JsonSerializable(typeof(List<Recipe>))]
[JsonSerializable(typeof(List<RecipeField>))]
[JsonSerializable(typeof(List<CatalogItem>))]
[JsonSerializable(typeof(List<int>))]
[JsonSerializable(typeof(double))]
[JsonSerializable(typeof(double?))]
[JsonSerializable(typeof(Dictionary<string, JsonElement>))]
[JsonSerializable(typeof(JsonNode))]
[JsonSerializable(typeof(JsonObject))]
internal partial class LabJsonContext : JsonSerializerContext;

file static class UpdatesCacheState
{
    public static readonly object Lock = new();
    public static UpdatesResponse? Response;
    public static DateTimeOffset At;
    public static readonly TimeSpan Ttl = TimeSpan.FromMinutes(15);
}
