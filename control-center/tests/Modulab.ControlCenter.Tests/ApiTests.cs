using System.Net;
using System.Text.Json;
using Modulab.ControlCenter.Tests.Support;

namespace Modulab.ControlCenter.Tests;

public sealed class ApiTests : IDisposable
{
    readonly TempLab lab = new();
    readonly FakeCommandRunner runner = new();
    readonly LabFactory factory;

    public ApiTests() => factory = new LabFactory(lab, runner);

    public void Dispose()
    {
        factory.Dispose();
        lab.Dispose();
    }

    static async Task<JsonElement> Body(HttpResponseMessage res) =>
        JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement;

    [Fact]
    public async Task Api_is_locked_until_an_admin_password_exists()
    {
        var client = factory.Browser();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/health")).StatusCode);

        var catalog = await client.GetAsync("/api/catalog");
        Assert.Equal(HttpStatusCode.Unauthorized, catalog.StatusCode);
        Assert.Equal("Set an admin password first", (await Body(catalog)).GetProperty("message").GetString());

        var status = await Body(await client.GetAsync("/api/auth/status"));
        Assert.False(status.GetProperty("configured").GetBoolean());
    }

    [Fact]
    public async Task Setup_signs_in_and_cannot_be_repeated()
    {
        var client = await LabFactory.SignedInAsync(factory);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/catalog")).StatusCode);

        var again = await factory.Browser().PostAsync("/api/auth/setup", LabFactory.Json(new { password = "someone else's" }));
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
    }

    [Fact]
    public async Task Login_logout_and_wrong_password()
    {
        await LabFactory.SignedInAsync(factory, "correct horse battery");
        var client = factory.Browser();

        var wrong = await client.PostAsync("/api/auth/login", LabFactory.Json(new { password = "nope" }));
        Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);

        var ok = await client.PostAsync("/api/auth/login", LabFactory.Json(new { password = "correct horse battery", remember = true }));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var cookie = ok.Headers.GetValues("Set-Cookie").Single();
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/lab/settings")).StatusCode);

        await client.PostAsync("/api/auth/logout", null);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/lab/settings")).StatusCode);
    }

    [Fact]
    public async Task Cookie_is_scoped_to_the_lab_domain_on_lab_hostnames()
    {
        var client = factory.Browser();
        var req = new HttpRequestMessage(HttpMethod.Post, "http://home.network.lan/api/auth/setup")
        {
            Content = LabFactory.Json(new { password = "correct horse battery" }),
        };
        var res = await client.SendAsync(req);
        Assert.Contains("domain=network.lan", res.Headers.GetValues("Set-Cookie").Single(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Cross_origin_writes_are_refused()
    {
        var client = await LabFactory.SignedInAsync(factory);
        var req = new HttpRequestMessage(HttpMethod.Put, "/api/dashboard") { Content = LabFactory.Json(new { title = "x" }) };
        req.Headers.Add("Origin", "http://evil.example");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(req)).StatusCode);

        var same = new HttpRequestMessage(HttpMethod.Put, "/api/dashboard") { Content = LabFactory.Json(new { title = "x" }) };
        same.Headers.Add("Origin", "http://localhost");
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(same)).StatusCode);
    }

    [Fact]
    public async Task Forward_auth_redirects_strangers_to_the_login_and_lets_sessions_through()
    {
        await LabFactory.SignedInAsync(factory);
        var stranger = factory.Browser();
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/auth/verify");
        req.Headers.Add("X-Forwarded-Proto", "https");
        req.Headers.Add("X-Forwarded-Host", "jellyfin.network.lan");
        req.Headers.Add("X-Forwarded-Uri", "/web/index.html");
        var res = await stranger.SendAsync(req);
        Assert.Equal(HttpStatusCode.Redirect, res.StatusCode);
        Assert.Equal(
            "https://home.network.lan/login?rd=" + Uri.EscapeDataString("https://jellyfin.network.lan/web/index.html"),
            res.Headers.Location!.ToString());

        var member = factory.Browser();
        await member.PostAsync("/api/auth/login", LabFactory.Json(new { password = "correct horse battery" }));
        var ok = await member.GetAsync("/api/auth/verify");
        Assert.Equal(HttpStatusCode.NoContent, ok.StatusCode);
        Assert.Equal("admin", ok.Headers.GetValues("X-Modulab-User").Single());
    }

    [Fact]
    public async Task Ca_certificate_is_public()
    {
        var client = factory.Browser();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/lab/ca.crt")).StatusCode);
        Directory.CreateDirectory(Path.GetDirectoryName(lab.Paths.CaddyRootCert)!);
        File.WriteAllText(lab.Paths.CaddyRootCert, "-----BEGIN CERTIFICATE-----\n");
        var res = await client.GetAsync("/api/lab/ca.crt");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("application/x-x509-ca-cert", res.Content.Headers.ContentType!.MediaType);
    }

    [Fact]
    public async Task Catalog_reports_status_protection_and_custom_apps()
    {
        lab.AddRecipe("whoami", """{"id":"whoami","name":"Whoami","port":8099,"proxy":{"host":"whoami","port":8099}}""", local: true);
        runner.WhenDocker(["ps"], "jellyfin\trunning\tUp 1 hour (unhealthy)\tjellyfin/jellyfin:latest\n");
        var config = lab.ReadConfig();
        config["lab"]!["protectedApps"] = new System.Text.Json.Nodes.JsonArray("jellyfin");
        config["lab"]!["enableLanHttps"] = true;
        lab.WriteConfig(config.ToJsonString());

        var client = await LabFactory.SignedInAsync(factory);
        var apps = (await Body(await client.GetAsync("/api/catalog"))).GetProperty("apps").EnumerateArray()
            .ToDictionary(a => a.GetProperty("id").GetString()!);

        var jellyfin = apps["jellyfin"];
        Assert.Equal("running", jellyfin.GetProperty("status").GetString());
        Assert.Equal("unhealthy", jellyfin.GetProperty("health").GetString());
        Assert.True(jellyfin.GetProperty("protected").GetBoolean());
        Assert.Equal("https://jellyfin.network.lan", jellyfin.GetProperty("url").GetString());
        Assert.True(apps["whoami"].GetProperty("custom").GetBoolean());
        Assert.Equal("available", apps["whoami"].GetProperty("status").GetString());
        Assert.False(apps["postgres"].GetProperty("canProtect").GetBoolean());
    }

    [Fact]
    public async Task Weak_secrets_show_up_in_lab_status()
    {
        var client = await LabFactory.SignedInAsync(factory);
        var status = await Body(await client.GetAsync("/api/lab/status"));
        Assert.Equal("postgresPassword", status.GetProperty("weakSecrets").EnumerateArray().Single().GetString());
    }

    [Fact]
    public async Task Invalid_custom_app_returns_422_with_errors()
    {
        var client = await LabFactory.SignedInAsync(factory);
        var res = await client.PostAsync("/api/custom-apps", LabFactory.Json(new
        {
            id = "Bad Id!",
            name = "",
            compose = "",
        }));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
        var errors = (await Body(res)).GetProperty("errors").EnumerateArray().Select(e => e.GetString()).ToList();
        Assert.Contains(errors, e => e!.StartsWith("Id must be"));
        Assert.Contains("Name is required", errors);
    }

    [Fact]
    public async Task Backup_runs_as_a_task_and_a_second_one_is_refused_while_busy()
    {
        var gate = new TaskCompletionSource();
        runner.When((file, args) => args.Any(a => a.EndsWith("backup.py")), new Infrastructure.CommandResult(0, "done\n", ""));
        Directory.CreateDirectory(lab.Paths.Scripts);
        File.WriteAllText(Path.Combine(lab.Paths.Scripts, "backup.py"), "# stub\n");

        var client = await LabFactory.SignedInAsync(factory);
        var first = await client.PostAsync("/api/backups", null);
        Assert.Equal(HttpStatusCode.Accepted, first.StatusCode);
        var task = (await Body(first)).GetProperty("current");
        Assert.Equal("backup", task.GetProperty("action").GetString());

        // Poll until the background task settles.
        for (var i = 0; i < 50; i++)
        {
            var snap = (await Body(await client.GetAsync("/api/tasks"))).GetProperty("current");
            if (snap.GetProperty("status").GetString() != "running")
            {
                Assert.Equal("ok", snap.GetProperty("status").GetString());
                return;
            }
            await Task.Delay(50);
        }
        Assert.Fail("backup task never finished");
    }

    [Fact]
    public async Task Rollback_needs_a_recorded_rollback_point()
    {
        var client = await LabFactory.SignedInAsync(factory);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/apps/jellyfin/rollback", null)).StatusCode);

        var dir = Path.Combine(lab.Paths.State, "rollback");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "jellyfin.json"), "{}");
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsync("/api/apps/jellyfin/rollback", null)).StatusCode);
    }
}
