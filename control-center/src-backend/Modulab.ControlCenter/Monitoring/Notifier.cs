using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Threading.Channels;
using Modulab.ControlCenter.Infrastructure;
using Modulab.ControlCenter.Models;

namespace Modulab.ControlCenter.Monitoring;

/// <summary>Pushes events to ntfy and/or a generic JSON webhook. Delivery runs off the request path.</summary>
public sealed class Notifier(ControlCenterSettingsStore settings, HttpClient http, ILogger<Notifier> log) : BackgroundService
{
    readonly Channel<LabEvent> queue = Channel.CreateBounded<LabEvent>(
        new BoundedChannelOptions(100) { FullMode = BoundedChannelFullMode.DropOldest });

    public void Enqueue(LabEvent e) => queue.Writer.TryWrite(e);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var e in queue.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                await SendAsync(e, settings.Load().Notifications, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning("Notification for {Kind} failed: {Message}", e.Kind, ex.Message);
            }
        }
    }

    /// <summary>Send one event now. Throws when a configured channel rejects it (used by "Send test").</summary>
    public async Task SendAsync(LabEvent e, NotificationConfig config, CancellationToken ct)
    {
        var errors = new List<string>();

        if (!string.IsNullOrWhiteSpace(config.NtfyUrl))
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, config.NtfyUrl.Trim())
            {
                Content = new StringContent(e.Message, Encoding.UTF8, "text/plain"),
            };
            req.Headers.TryAddWithoutValidation("Title", $"Modulab: {e.Source}");
            req.Headers.TryAddWithoutValidation("Tags", e.Level switch
            {
                "error" => "rotating_light",
                "warning" => "warning",
                _ => "white_check_mark",
            });
            req.Headers.TryAddWithoutValidation("Priority", e.Level == "error" ? "high" : "default");
            if (!string.IsNullOrWhiteSpace(config.NtfyToken))
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config.NtfyToken.Trim());
            using var res = await http.SendAsync(req, ct);
            if (!res.IsSuccessStatusCode)
                errors.Add($"ntfy returned {(int)res.StatusCode}");
        }

        if (!string.IsNullOrWhiteSpace(config.WebhookUrl))
        {
            using var res = await http.PostAsJsonAsync(config.WebhookUrl.Trim(), e, LabJsonContext.Default.LabEvent, ct);
            if (!res.IsSuccessStatusCode)
                errors.Add($"webhook returned {(int)res.StatusCode}");
        }

        if (errors.Count > 0)
            throw new InvalidOperationException(string.Join("; ", errors));
    }
}
