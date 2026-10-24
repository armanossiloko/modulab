using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using Modulab.ControlCenter.Apps;
using Modulab.ControlCenter.Auth;
using Modulab.ControlCenter.Backups;
using Modulab.ControlCenter.Catalog;
using Modulab.ControlCenter.Infrastructure;
using Modulab.ControlCenter.Lab;
using Modulab.ControlCenter.Models;
using Modulab.ControlCenter.Monitoring;
using Modulab.ControlCenter.Tasks;
using Modulab.ControlCenter.Tests.Support;
using Modulab.ControlCenter.Updates;

namespace Modulab.ControlCenter.Tests;

public sealed class LabConfigStoreTests : IDisposable
{
    readonly TempLab lab = new();

    public void Dispose() => lab.Dispose();

    [Fact]
    public void New_config_from_example_gets_random_secrets()
    {
        File.Delete(lab.Paths.Config);
        File.WriteAllText(lab.Paths.ExampleConfig,
            """{"lab":{"postgresPassword":"$generate","piholePassword":"$generate","domain":"x.lan"},"enabled":[]}""");
        var store = new LabConfigStore(lab.Paths);

        var labSection = store.Lab(store.Load());
        var pg = LabConfigStore.GetString(labSection, "postgresPassword")!;
        Assert.NotEqual("$generate", pg);
        Assert.True(pg.Length >= 20);
        Assert.DoesNotContain('/', pg);
        Assert.NotEqual(pg, LabConfigStore.GetString(labSection, "piholePassword"));
        Assert.Equal("x.lan", LabConfigStore.GetString(labSection, "domain"));
        // Persisted, so later reads see the same secret.
        Assert.Equal(pg, LabConfigStore.GetString(store.Lab(store.Load()), "postgresPassword"));
    }

    [Fact]
    public void Weak_secrets_lists_old_shared_defaults() =>
        Assert.Equal(["postgresPassword"], new LabConfigStore(lab.Paths).WeakSecrets());

    [Fact]
    public void Enable_and_disable_are_idempotent()
    {
        var store = new LabConfigStore(lab.Paths);
        store.Enable("jellyfin");
        store.Enable("jellyfin");
        Assert.Single(store.Enabled(), "jellyfin".Equals);
        store.Disable("jellyfin");
        Assert.DoesNotContain("jellyfin", store.Enabled());
    }

    [Theory]
    [InlineData("", true)]
    [InlineData("127.0.0.1", true)]
    [InlineData("192.168.1.10", true)]
    [InlineData("192.168.1.50", false)]
    public void Placeholder_host_ips(string ip, bool placeholder) =>
        Assert.Equal(placeholder, LabConfigStore.IsPlaceholderHostIp(ip));
}

public sealed class AuthServiceTests : IDisposable
{
    readonly TempLab lab = new();
    readonly FakeTimeProvider clock = new(DateTimeOffset.Parse("2026-06-01T12:00:00Z"));
    readonly AuthService auth;

    public AuthServiceTests() => auth = new AuthService(lab.Paths, new LabConfigStore(lab.Paths), clock);

    public void Dispose() => lab.Dispose();

    [Fact]
    public void Setup_once_then_verify()
    {
        Assert.False(auth.IsConfigured);
        auth.Setup("hunter2hunter2");
        Assert.True(auth.IsConfigured);
        Assert.True(auth.VerifyPassword("hunter2hunter2"));
        Assert.False(auth.VerifyPassword("hunter2hunter3"));
        Assert.Throws<InvalidOperationException>(() => auth.Setup("another-password"));
    }

    [Fact]
    public void Short_passwords_are_rejected() => Assert.Throws<ArgumentException>(() => auth.Setup("short"));

    [Fact]
    public void Tokens_expire_and_cannot_be_forged()
    {
        auth.Setup("hunter2hunter2");
        var token = auth.IssueToken(remember: false);
        Assert.True(auth.ValidateToken(token));

        var parts = token.Split('.');
        var forged = $"{parts[0]}.{long.Parse(parts[1]) + 999999}.{parts[2]}.{parts[3]}";
        Assert.False(auth.ValidateToken(forged));
        Assert.False(auth.ValidateToken("garbage"));

        clock.Advance(TimeSpan.FromHours(13));
        Assert.False(auth.ValidateToken(token));
    }

    [Fact]
    public void Changing_the_password_signs_out_existing_sessions()
    {
        auth.Setup("hunter2hunter2");
        var token = auth.IssueToken(remember: true);
        Assert.False(auth.ChangePassword("wrong-password", "new-password-1"));
        Assert.True(auth.ValidateToken(token));
        Assert.True(auth.ChangePassword("hunter2hunter2", "new-password-1"));
        Assert.False(auth.ValidateToken(token));
        Assert.True(auth.VerifyPassword("new-password-1"));
    }

    [Fact]
    public void Deleting_auth_json_resets_to_setup()
    {
        auth.Setup("hunter2hunter2");
        File.Delete(Path.Combine(lab.Paths.State, "auth.json"));
        Assert.False(auth.IsConfigured);
    }

    [Fact]
    public void Repeated_failures_lock_the_client_out_for_a_while()
    {
        for (var i = 0; i < 4; i++)
            auth.RecordFailure("10.0.0.9");
        Assert.Null(auth.LockedOutFor("10.0.0.9"));
        auth.RecordFailure("10.0.0.9");
        Assert.NotNull(auth.LockedOutFor("10.0.0.9"));
        Assert.Null(auth.LockedOutFor("10.0.0.10"));
        clock.Advance(TimeSpan.FromMinutes(2));
        Assert.Null(auth.LockedOutFor("10.0.0.9"));
    }
}

public sealed class BackupScheduleTests : IDisposable
{
    readonly TempLab lab = new();

    public void Dispose() => lab.Dispose();

    BackupService Service(string timezone)
    {
        var config = new LabConfigStore(lab.Paths);
        config.Update(c => config.Lab(c)["timezone"] = timezone);
        var clock = TimeProvider.System;
        var runner = new FakeCommandRunner();
        var events = new EventLog(lab.Paths, new Notifier(new ControlCenterSettingsStore(lab.Paths), new HttpClient(), NullLogger<Notifier>.Instance), clock);
        return new BackupService(
            lab.Paths, config, new ControlCenterSettingsStore(lab.Paths),
            new LabScripts(lab.Paths, runner, NullLogger<LabScripts>.Instance),
            new TaskBoard(NullLogger<TaskBoard>.Instance), events, clock);
    }

    [Fact]
    public void Next_run_is_later_today_or_tomorrow_in_the_lab_timezone()
    {
        var service = Service("UTC");
        var cfg = new BackupConfig { Time = "03:30" };
        Assert.Equal(DateTimeOffset.Parse("2026-06-01T03:30:00Z"), service.NextRun(cfg, DateTimeOffset.Parse("2026-06-01T01:00:00Z")));
        Assert.Equal(DateTimeOffset.Parse("2026-06-02T03:30:00Z"), service.NextRun(cfg, DateTimeOffset.Parse("2026-06-01T03:30:00Z")));
    }

    [Fact]
    public void Next_run_honours_timezone_offsets()
    {
        var service = Service("Europe/Berlin");
        var cfg = new BackupConfig { Time = "03:30" };
        // Berlin is UTC+2 in summer: 03:30 local = 01:30 UTC.
        Assert.Equal(DateTimeOffset.Parse("2026-06-02T01:30:00Z"), service.NextRun(cfg, DateTimeOffset.Parse("2026-06-01T12:00:00Z")));
    }

    [Fact]
    public void Lists_only_complete_backups_newest_first()
    {
        var service = Service("UTC");
        foreach (var (id, at) in new[] { ("20260101-033000", "2026-01-01T03:30:00Z"), ("20260102-033000", "2026-01-02T03:30:00Z") })
        {
            var dir = Path.Combine(lab.Paths.Backups, id);
            Directory.CreateDirectory(dir);
            File.WriteAllText(Path.Combine(dir, "manifest.json"),
                $$"""{"id":"{{id}}","createdAt":"{{at}}","databases":["n8n"],"apps":["jellyfin"],"hasConfig":true,"sizeBytes":10}""");
        }
        Directory.CreateDirectory(Path.Combine(lab.Paths.Backups, ".20260103-033000.partial"));

        var list = service.List();
        Assert.Equal(["20260102-033000", "20260101-033000"], list.Backups.Select(b => b.Id));
    }

    [Fact]
    public void Settings_never_echo_secrets()
    {
        var service = Service("UTC");
        var res = service.UpdateSettings(new BackupSettingsUpdate(null, "04:00", 5, "/mnt/usb/restic", "s3cret",
            new Dictionary<string, string> { ["AWS_SECRET_ACCESS_KEY"] = "abc" }, ["media"], null, null));
        Assert.True(res.ResticPasswordSet);
        Assert.Equal("", res.ResticEnv["AWS_SECRET_ACCESS_KEY"]);

        // Blank value keeps the stored secret.
        service.UpdateSettings(new BackupSettingsUpdate(null, null, null, null, null,
            new Dictionary<string, string> { ["AWS_SECRET_ACCESS_KEY"] = "" }, null, null, null));
        Assert.Equal("abc", new ControlCenterSettingsStore(lab.Paths).Load().Backup.ResticEnv["AWS_SECRET_ACCESS_KEY"]);
    }

    [Theory]
    [InlineData("25:00")]
    [InlineData("3:30")]
    public void Invalid_times_are_rejected(string time) =>
        Assert.Throws<ArgumentException>(() => Service("UTC").UpdateSettings(
            new BackupSettingsUpdate(null, time, null, null, null, null, null, null, null)));
}

public sealed class RecipeAndAppTests : IDisposable
{
    readonly TempLab lab = new();
    readonly FakeCommandRunner runner = new();

    public void Dispose() => lab.Dispose();

    RecipeStore Recipes() => new(lab.Paths, NullLogger<RecipeStore>.Instance);

    AppService Apps()
    {
        var config = new LabConfigStore(lab.Paths);
        var docker = new DockerCli(lab.Paths, runner);
        return new AppService(lab.Paths, config, Recipes(),
            new LabScripts(lab.Paths, runner, NullLogger<LabScripts>.Instance), docker,
            new UpdateService(lab.Paths, config, Recipes(), docker), NullLogger<AppService>.Instance);
    }

    [Fact]
    public void Local_recipes_load_but_cannot_shadow_built_ins()
    {
        lab.AddRecipe("jellyfin", """{"id":"jellyfin","name":"Evil twin"}""", local: true);
        lab.AddRecipe("whoami", """{"id":"whoami","name":"Whoami"}""", local: true);
        var all = Recipes().All();
        Assert.Equal("Jellyfin", all.Single(r => r.Id == "jellyfin").Name);
        var custom = all.Single(r => r.Id == "whoami");
        Assert.True(custom.Custom);
        Assert.EndsWith(Path.Combine("catalog.local", "whoami", "docker-compose.yml"), Recipes().ResolveComposeFile(custom));
    }

    [Theory]
    [InlineData("data/jellyfin", true)]
    [InlineData("data/../media", false)]
    [InlineData("media", false)]
    [InlineData("data", false)]
    [InlineData("data/control-center", false)]
    [InlineData("data/control-center/x", false)]
    [InlineData("/etc", false)]
    public void Purge_only_touches_app_folders_under_data(string rel, bool allowed) =>
        Assert.Equal(allowed, Apps().SafeDataPath(rel) is not null);

    [Fact]
    public async Task Purge_uninstall_deletes_data_and_drops_the_database()
    {
        var config = new LabConfigStore(lab.Paths);
        config.Enable("n8n");
        Directory.CreateDirectory(Path.Combine(lab.Root, "data", "n8n", "nodes"));
        runner.WhenDocker(["ps"], "postgres\trunning\tUp\timg\n");

        var message = await Apps().UninstallAsync(Recipes().Find("n8n")!, purge: true);

        Assert.False(Directory.Exists(Path.Combine(lab.Root, "data", "n8n")));
        Assert.True(runner.Ran("stop.sh n8n -v"));
        Assert.True(runner.Ran("DROP DATABASE IF EXISTS \"n8n\" WITH (FORCE)"));
        Assert.DoesNotContain("n8n", config.Enabled());
        Assert.Contains("database n8n", message);
    }

    [Fact]
    public async Task Plain_uninstall_keeps_data()
    {
        Directory.CreateDirectory(Path.Combine(lab.Root, "data", "jellyfin"));
        await Apps().UninstallAsync(Recipes().Find("jellyfin")!, purge: false);
        Assert.True(Directory.Exists(Path.Combine(lab.Root, "data", "jellyfin")));
        Assert.False(runner.Ran("DROP DATABASE"));
    }

    [Fact]
    public async Task Protecting_an_app_records_it_and_rerenders()
    {
        new LabConfigStore(lab.Paths).Enable("jellyfin");
        await Apps().SetProtectedAsync(Recipes().Find("jellyfin")!, true);
        var protectedApps = lab.ReadConfig()["lab"]!["protectedApps"]!.AsArray().Select(n => n!.GetValue<string>());
        Assert.Equal(["jellyfin"], protectedApps);
        Assert.True(runner.Ran("render-config.sh"));
        Assert.True(runner.Ran("start.sh jellyfin"));

        await Assert.ThrowsAsync<InvalidOperationException>(() => Apps().SetProtectedAsync(Recipes().Find("postgres")!, true));
    }

    [Fact]
    public async Task Install_failure_rolls_back_the_enabled_flag()
    {
        runner.When((file, args) => args.Contains("start.sh"), new CommandResult(1, "", "boom"));
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => Apps().InstallAsync(Recipes().Find("jellyfin")!, null));
        Assert.Contains("boom", ex.Message);
        Assert.DoesNotContain("jellyfin", new LabConfigStore(lab.Paths).Enabled());
    }
}

public sealed class CustomAppTests : IDisposable
{
    readonly TempLab lab = new();
    readonly FakeCommandRunner runner = new();

    public void Dispose() => lab.Dispose();

    CustomAppService Service()
    {
        var recipes = new RecipeStore(lab.Paths, NullLogger<RecipeStore>.Instance);
        return new CustomAppService(lab.Paths, new LabConfigStore(lab.Paths), recipes, new DockerCli(lab.Paths, runner));
    }

    static CustomAppRequest Request(string id = "whoami", string compose = "services:\n  whoami:\n    image: traefik/whoami\n", string? host = "whoami", int? port = 8099) =>
        new(id, "Who am I", null, "tools", port, host, null, compose, null, null, null);

    void ComposeConfigReturns(string json) => runner.WhenDocker(["compose"], json);

    [Fact]
    public async Task Valid_app_is_written_to_catalog_local()
    {
        ComposeConfigReturns("""{"services":{"whoami":{"container_name":"whoami","restart":"unless-stopped"}}}""");
        var (validation, recipe) = await Service().SaveAsync(Request(), isUpdate: false, default);

        Assert.True(validation.Ok, string.Join("; ", validation.Errors));
        Assert.NotNull(recipe);
        Assert.True(File.Exists(Path.Combine(lab.Paths.LocalCatalog, "whoami", "recipe.json")));
        Assert.True(Directory.Exists(Path.Combine(lab.Root, "data", "whoami")));
        var json = JsonNode.Parse(File.ReadAllText(Path.Combine(lab.Paths.LocalCatalog, "whoami", "recipe.json")))!;
        Assert.Equal("catalog.local/whoami/docker-compose.yml", json["compose"]!.GetValue<string>());
        Assert.Equal("whoami", json["proxy"]!["host"]!.GetValue<string>());
        Assert.Null(json["custom"]);
    }

    [Fact]
    public async Task Container_name_must_match_the_id()
    {
        ComposeConfigReturns("""{"services":{"whoami":{"container_name":"something-else","restart":"always"}}}""");
        var validation = await Service().ValidateAsync(Request(), false, default);
        Assert.Contains(validation.Errors, e => e.Contains("container_name"));
    }

    [Fact]
    public async Task Built_in_ids_reserved_names_and_taken_hostnames_are_rejected()
    {
        var builtIn = await Service().ValidateAsync(Request(id: "jellyfin"), false, default);
        Assert.Contains(builtIn.Errors, e => e.Contains("built-in"));
        var reserved = await Service().ValidateAsync(Request(id: "home"), false, default);
        Assert.Contains(reserved.Errors, e => e.Contains("reserved"));
        var host = await Service().ValidateAsync(Request(host: "n8n"), false, default);
        Assert.Contains(host.Errors, e => e.Contains("n8n"));
    }

    [Fact]
    public async Task Relative_bind_mounts_are_rejected()
    {
        ComposeConfigReturns("""{"services":{"whoami":{"container_name":"whoami","restart":"always"}}}""");
        var compose = "services:\n  whoami:\n    image: x\n    volumes:\n      - ./data:/data\n";
        var validation = await Service().ValidateAsync(Request(compose: compose), false, default);
        Assert.Contains(validation.Errors, e => e.Contains("Relative bind mounts"));
    }

    [Fact]
    public async Task Compose_errors_are_reported_without_temp_paths()
    {
        runner.WhenDocker(["compose"], "", exit: 1, stderr: "yaml: line 3: did not find expected key");
        var validation = await Service().ValidateAsync(Request(), false, default);
        Assert.Contains(validation.Errors, e => e.StartsWith("Compose file is invalid: yaml: line 3"));
        Assert.Empty(Directory.GetFiles(lab.Paths.LocalCatalog, ".validate-*"));
    }

    [Fact]
    public async Task Installed_custom_apps_cannot_be_deleted()
    {
        ComposeConfigReturns("""{"services":{"whoami":{"container_name":"whoami","restart":"always"}}}""");
        await Service().SaveAsync(Request(), false, default);
        new LabConfigStore(lab.Paths).Enable("whoami");
        await Assert.ThrowsAsync<InvalidOperationException>(() => Service().DeleteAsync("whoami", default));
        new LabConfigStore(lab.Paths).Disable("whoami");
        await Service().DeleteAsync("whoami", default);
        Assert.False(Directory.Exists(Path.Combine(lab.Paths.LocalCatalog, "whoami")));
    }
}
