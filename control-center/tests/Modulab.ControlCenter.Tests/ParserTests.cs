using System.Text.Json;
using Modulab.ControlCenter.Apps;
using Modulab.ControlCenter.Feeds;
using Modulab.ControlCenter.Infrastructure;
using Modulab.ControlCenter.Monitoring;
using Modulab.ControlCenter.Updates;

namespace Modulab.ControlCenter.Tests;

public class ImageRefsTests
{
    [Theory]
    [InlineData("jellyfin/jellyfin:latest", "jellyfin/jellyfin")]
    [InlineData("ghcr.io/immich-app/immich-server:v3", "ghcr.io/immich-app/immich-server")]
    [InlineData("localhost:5000/app", "localhost:5000/app")]
    [InlineData("localhost:5000/app:1.2", "localhost:5000/app")]
    [InlineData("repo/app:1@sha256:abc", "repo/app")]
    public void Repository_strips_tag_and_digest(string imageRef, string expected) =>
        Assert.Equal(expected, ImageRefs.Repository(imageRef));

    [Theory]
    [InlineData("jellyfin/jellyfin:10.11.0", "10.11.0")]
    [InlineData("ghcr.io/immich-app/immich-server:v3", "v3")]
    [InlineData("jellyfin/jellyfin:latest", null)]
    [InlineData("caddy:2-alpine", "2-alpine")]
    [InlineData("caddy", null)]
    [InlineData("localhost:5000/app", null)]
    public void VersionFromRef_only_returns_pinned_versions(string imageRef, string? expected) =>
        Assert.Equal(expected, ImageRefs.VersionFromRef(imageRef));

    [Fact]
    public void Digests_compare_case_insensitively_and_ignore_repo_prefix()
    {
        Assert.True(ImageRefs.DigestsEqual("repo@sha256:ABC", "sha256:abc"));
        Assert.False(ImageRefs.DigestsEqual("sha256:abc", "sha256:abd"));
        Assert.False(ImageRefs.DigestsEqual("", "sha256:abc"));
    }

    [Fact]
    public void Local_digest_prefers_the_matching_repository()
    {
        using var doc = JsonDocument.Parse("""
            {"RepoDigests":["other/image@sha256:111","docker.io/jellyfin/jellyfin@sha256:222"]}
            """);
        Assert.Equal("sha256:222", ImageRefs.ExtractLocalDigest(doc.RootElement, "jellyfin/jellyfin:latest"));
    }

    [Theory]
    [InlineData("""{"manifest":{"digest":"sha256:AA"}}""", "sha256:aa")]
    [InlineData("""{"Descriptor":{"digest":"sha256:bb"}}""", "sha256:bb")]
    [InlineData("""{"other":1}""", null)]
    public void Remote_digest_reads_imagetools_shapes(string json, string? expected)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(expected, ImageRefs.ExtractRemoteDigest(doc.RootElement));
    }
}

public class DockerCliParserTests
{
    [Fact]
    public void Container_list_parses_state_and_health()
    {
        var list = DockerCli.ParseContainerList(
            "jellyfin\trunning\tUp 2 hours (healthy)\tjellyfin/jellyfin:latest\n" +
            "n8n\trestarting\tRestarting (1) 5 seconds ago\tn8n\n" +
            "searxng\trunning\tUp 1 minute (health: starting)\tsearxng\n" +
            "bad line\n");
        Assert.Equal(3, list.Count);
        Assert.Equal("healthy", list[0].Health);
        Assert.True(list[1].IsUp);
        Assert.Equal("starting", list[2].Health);
    }

    [Theory]
    [InlineData("immich_server", "immich", true)]
    [InlineData("futo-notes", "futo-notes", true)]
    [InlineData("modulab-db-bootstrap-1", "db-bootstrap", true)]
    [InlineData("immich", "immich-redis", false)]
    [InlineData("n8nx", "n8n", false)]
    public void Recipe_matching(string container, string recipe, bool expected) =>
        Assert.Equal(expected, DockerCli.MatchesRecipe(container, recipe));

    [Theory]
    [InlineData("0B", 0)]
    [InlineData("512kB", 512_000)]
    [InlineData("1.5MiB", 1_572_864)]
    [InlineData("2GiB", 2_147_483_648)]
    [InlineData("1.2GB", 1_200_000_000)]
    [InlineData("", 0)]
    public void Sizes(string text, long expected) => Assert.Equal(expected, DockerCli.ParseSize(text));

    [Fact]
    public void Stats_rows()
    {
        var rows = DockerCli.ParseStats("jellyfin\t12.50%\t512MiB / 7.6GiB\t1kB / 2kB\t0B / 0B\n");
        var row = Assert.Single(rows);
        Assert.Equal(12.5, row.CpuPercent);
        Assert.Equal(512L * 1024 * 1024, row.MemoryBytes);
    }
}

public class ProcParserTests
{
    [Fact]
    public void Cpu_percent_from_two_samples()
    {
        var a = ProcParsers.ParseCpu("cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 1 2 3 4\n")!.Value;
        var b = ProcParsers.ParseCpu("cpu  150 0 150 900 0 0 0 0 0 0\n")!.Value;
        // 100 busy jiffies out of 200 → 50 %.
        Assert.Equal(50, ProcParsers.CpuPercent(a, b), 3);
    }

    [Fact]
    public void Memory_uses_mem_available()
    {
        var mem = ProcParsers.ParseMemory("MemTotal:       8000000 kB\nMemFree:  100 kB\nMemAvailable:   6000000 kB\n");
        Assert.Equal((8_192_000_000L, 2_048_000_000L), mem);
    }

    [Fact]
    public void Load_and_uptime()
    {
        Assert.Equal((0.5, 1.25, 2.0), ProcParsers.ParseLoad("0.50 1.25 2.00 1/123 456"));
        Assert.Equal(12345, ProcParsers.ParseUptime("12345.67 99999.00"));
    }
}

public class HealthAssessmentTests
{
    static ContainerInfo C(string state, string? health = null) => new("x", state, "", "img", health);

    [Fact]
    public void No_containers_means_down() => Assert.Equal("down", HealthMonitor.Assess([]));

    [Fact]
    public void Restarting_wins_over_running() =>
        Assert.Equal("restarting", HealthMonitor.Assess([C("running"), C("restarting")]));

    [Fact]
    public void Unhealthy_is_reported() =>
        Assert.Equal("unhealthy", HealthMonitor.Assess([C("running", "unhealthy")]));

    [Fact]
    public void Healthy_is_null() => Assert.Null(HealthMonitor.Assess([C("running", "healthy"), C("running")]));
}

public class LogParsingTests
{
    [Fact]
    public void Interleaves_stdout_and_stderr_by_timestamp_and_keeps_tail()
    {
        var text =
            "2026-01-01T00:00:01.000000000Z out one\n" +
            "2026-01-01T00:00:03.000000000Z out three\n" +
            "2026-01-01T00:00:02.000000000Z err two\n";
        var lines = AppService.ParseLogLines(text, tail: 2);
        Assert.Equal(["err two", "out three"], lines.Select(l => l.Text));
    }

    [Fact]
    public void Lines_without_timestamps_are_kept()
    {
        var lines = AppService.ParseLogLines("\u001b[32mplain\u001b[0m\n", 10);
        Assert.Equal("plain", Assert.Single(lines).Text);
    }
}

public class FeedParserTests
{
    [Fact]
    public void Reddit_self_posts_link_to_the_discussion()
    {
        using var doc = JsonDocument.Parse("""
            {"data":{"children":[
              {"data":{"title":"Hello","permalink":"/r/x/1","author":"me","score":5,"is_self":true,"domain":"self.x","url":"https://reddit.com/r/x/1"}},
              {"data":{"title":"","permalink":"/r/x/2"}}
            ]}}
            """);
        var item = Assert.Single(FeedParsers.ParseReddit(doc.RootElement, "x", 5));
        Assert.Equal("https://www.reddit.com/r/x/1", item.Url);
        Assert.Equal("u/me · 5", item.Meta);
    }

    [Fact]
    public void Hacker_news_skips_non_stories()
    {
        using var job = JsonDocument.Parse("""{"type":"job","title":"Hiring"}""");
        Assert.Null(FeedParsers.ParseHackerNewsItem(job.RootElement, 1));
        using var story = JsonDocument.Parse("""{"type":"story","title":"Show HN","score":10,"by":"pg"}""");
        var item = FeedParsers.ParseHackerNewsItem(story.RootElement, 42)!;
        Assert.Equal("https://news.ycombinator.com/item?id=42", item.Url);
    }
}
