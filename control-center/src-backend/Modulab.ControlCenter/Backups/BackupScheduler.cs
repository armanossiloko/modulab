using Modulab.ControlCenter.Infrastructure;

namespace Modulab.ControlCenter.Backups;

/// <summary>Runs the nightly backup at the configured local time. Re-reads settings every minute.</summary>
public sealed class BackupScheduler(
    BackupService backups,
    ControlCenterSettingsStore settings,
    TimeProvider clock,
    ILogger<BackupScheduler> log) : BackgroundService
{
    static readonly TimeSpan Tick = TimeSpan.FromMinutes(1);
    static readonly TimeSpan RetryWindow = TimeSpan.FromHours(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        DateTimeOffset? due = null;
        using var timer = new PeriodicTimer(Tick, clock);
        do
        {
            try
            {
                var cfg = settings.Load().Backup;
                var now = clock.GetUtcNow();
                if (!cfg.Enabled)
                {
                    due = null;
                    continue;
                }

                // Until it is time, follow the settings (the time may have been edited).
                if (due is null || now < due)
                    due = backups.NextRun(cfg, now);

                if (now < due)
                    continue;

                if (backups.TryStartBackup("scheduled", out _))
                {
                    due = backups.NextRun(cfg, now.AddMinutes(1));
                }
                else if (now - due > RetryWindow)
                {
                    log.LogWarning("Skipped scheduled backup: another task was running for over an hour");
                    due = backups.NextRun(cfg, now);
                }
                // else: another task is running — try again next tick.
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning("Backup scheduler: {Message}", ex.Message);
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
