using System.Net;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Modulab.ControlCenter.Infrastructure;

namespace Modulab.ControlCenter.Tests.Support;

/// <summary>A throwaway lab state directory with a config and a small catalog.</summary>
public sealed class TempLab : IDisposable
{
    public TempLab()
    {
        Root = Path.Combine(Path.GetTempPath(), "modulab-tests", Guid.NewGuid().ToString("n"));
        Directory.CreateDirectory(Root);
        Paths = new LabPaths(Root);
        WriteConfig("""
            {
              "lab": { "domain": "network.lan", "hostIp": "192.168.1.50", "timezone": "UTC",
                       "postgresUser": "modulab", "postgresPassword": "modulab", "postgresDb": "modulab" },
              "caddy": { "ENABLE_LAN_PROXY": true },
              "enabled": ["control-center", "postgres", "caddy"]
            }
            """);
        AddRecipe("postgres", """{"id":"postgres","name":"Postgres","category":"infrastructure","installable":false,"core":true}""");
        AddRecipe("jellyfin", """
            {"id":"jellyfin","name":"Jellyfin","category":"media","port":8096,
             "proxy":{"host":"jellyfin","port":8096},"data":["data/jellyfin"],
             "fields":[{"key":"JELLYFIN_TAG","label":"Image tag","default":"latest"}]}
            """);
        AddRecipe("n8n", """
            {"id":"n8n","name":"n8n","category":"productivity","port":5678,"dependsOn":["postgres"],
             "database":"n8n","proxy":{"host":"n8n","port":5678},"data":["data/n8n"]}
            """);
        File.WriteAllText(Path.Combine(Root, "docker-compose.jellyfin.yml"), "services: {}\n");
        Directory.CreateDirectory(Paths.Scripts);
        File.WriteAllText(Path.Combine(Paths.Scripts, "run_bash.py"), "# test stub\n");
        foreach (var script in new[] { "render-config.sh", "start.sh", "stop.sh", "refresh-edge.sh", "update.sh", "rollback.sh" })
            File.WriteAllText(Path.Combine(Paths.Scripts, script), "# test stub\n");
    }

    public string Root { get; }
    public LabPaths Paths { get; }

    public void WriteConfig(string json) => File.WriteAllText(Paths.Config, json);

    public JsonObject ReadConfig() => JsonNode.Parse(File.ReadAllText(Paths.Config))!.AsObject();

    public void AddRecipe(string id, string json, bool local = false)
    {
        var dir = Path.Combine(local ? Paths.LocalCatalog : Paths.Catalog, id);
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "recipe.json"), json);
    }

    public void Dispose()
    {
        try { Directory.Delete(Root, recursive: true); } catch (IOException) { /* best-effort */ }
    }
}

/// <summary>Records every process the app starts; answers from a list of rules (first match wins).</summary>
public sealed class FakeCommandRunner : ICommandRunner
{
    readonly List<(Func<string, IReadOnlyList<string>, bool> Match, CommandResult Result)> rules = [];

    public List<string> Calls { get; } = [];

    public FakeCommandRunner When(Func<string, IReadOnlyList<string>, bool> match, CommandResult result)
    {
        rules.Add((match, result));
        return this;
    }

    /// <summary>Respond to `docker &lt;args...&gt;` whose arguments start with the given prefix.</summary>
    public FakeCommandRunner WhenDocker(string[] prefix, string stdout, int exit = 0, string stderr = "") =>
        When((file, args) => file == "docker" && args.Take(prefix.Length).SequenceEqual(prefix),
            new CommandResult(exit, stdout, stderr));

    CommandResult Resolve(string file, IReadOnlyList<string> args)
    {
        lock (Calls)
            Calls.Add($"{file} {string.Join(' ', args)}");
        foreach (var (match, result) in rules)
        {
            if (match(file, args))
                return result;
        }
        // Default: success with no output (docker ps → no containers, scripts → ok).
        return new CommandResult(0, "", "");
    }

    public Task<CommandResult> RunAsync(string file, IReadOnlyList<string> args, string cwd, TimeSpan? timeout = null,
        CancellationToken ct = default, IReadOnlyDictionary<string, string>? env = null) =>
        Task.FromResult(Resolve(file, args));

    public Task<int> StreamAsync(string file, IReadOnlyList<string> args, string cwd, Action<string> onLine,
        CancellationToken ct = default, IReadOnlyDictionary<string, string>? env = null)
    {
        var result = Resolve(file, args);
        foreach (var line in (result.StdOut + result.StdErr).Split('\n', StringSplitOptions.RemoveEmptyEntries))
            onLine(line);
        return Task.FromResult(result.Exit);
    }

    public bool Ran(string fragment)
    {
        lock (Calls)
            return Calls.Any(c => c.Contains(fragment, StringComparison.Ordinal));
    }
}

/// <summary>Hosts the real app against a <see cref="TempLab"/> with a fake process runner and no background workers.</summary>
public sealed class LabFactory(TempLab lab, FakeCommandRunner runner) : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("MODULAB_ROOT", lab.Root);
        builder.UseEnvironment("Testing");
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ICommandRunner>();
            services.AddSingleton<ICommandRunner>(runner);
            // Drop Modulab's background workers (metrics, health, scheduler) but keep the web host.
            var workers = services
                .Where(d => d.ServiceType == typeof(IHostedService)
                    && (d.ImplementationFactory is not null
                        || d.ImplementationType?.Namespace?.StartsWith("Modulab", StringComparison.Ordinal) == true))
                .ToList();
            foreach (var worker in workers)
                services.Remove(worker);
        });
    }

    /// <summary>Client that keeps cookies and does not follow redirects (so forward_auth redirects are visible).</summary>
    public HttpClient Browser() => CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        HandleCookies = true,
        BaseAddress = new Uri("http://localhost"),
    });

    public static async Task<HttpClient> SignedInAsync(LabFactory factory, string password = "correct horse battery")
    {
        var client = factory.Browser();
        var res = await client.PostAsync("/api/auth/setup", Json(new { password }));
        if (res.StatusCode != HttpStatusCode.OK)
            throw new InvalidOperationException($"setup failed: {res.StatusCode} {await res.Content.ReadAsStringAsync()}");
        return client;
    }

    public static StringContent Json(object value) =>
        new(System.Text.Json.JsonSerializer.Serialize(value), System.Text.Encoding.UTF8, "application/json");
}
