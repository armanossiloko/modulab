using Modulab.ControlCenter.Apps;
using Modulab.ControlCenter.Auth;
using Modulab.ControlCenter.Backups;
using Modulab.ControlCenter.Catalog;
using Modulab.ControlCenter.Dashboard;
using Modulab.ControlCenter.Infrastructure;
using Modulab.ControlCenter.Lab;
using Modulab.ControlCenter.Monitoring;
using Modulab.ControlCenter.Tasks;
using Modulab.ControlCenter.Updates;

namespace Modulab.ControlCenter;

public static class ServiceRegistration
{
    public static IServiceCollection AddControlCenter(this IServiceCollection services, LabPaths paths)
    {
        services.AddSingleton(paths);
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton(_ =>
        {
            var http = new HttpClient(new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(5) })
            {
                Timeout = TimeSpan.FromSeconds(10),
            };
            http.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "ModulabControlCenter/1.0");
            return http;
        });

        services.AddSingleton<ICommandRunner, CommandRunner>();
        services.AddSingleton<LabScripts>();
        services.AddSingleton<DockerCli>();
        services.AddSingleton<LabConfigStore>();
        services.AddSingleton<ControlCenterSettingsStore>();
        services.AddSingleton<RecipeStore>();
        services.AddSingleton<CustomAppService>();
        services.AddSingleton<TaskBoard>();
        services.AddSingleton<UpdateService>();
        services.AddSingleton<AppService>();
        services.AddSingleton<LabSettingsService>();
        services.AddSingleton<DashboardStore>();
        services.AddSingleton<AuthService>();
        services.AddSingleton<BackupService>();
        services.AddSingleton<EventLog>();
        services.AddSingleton<ContainerService>();

        // Background workers that are also queried by endpoints.
        services.AddSingleton<Notifier>();
        services.AddHostedService(sp => sp.GetRequiredService<Notifier>());
        services.AddSingleton<MetricsSampler>();
        services.AddHostedService(sp => sp.GetRequiredService<MetricsSampler>());
        services.AddHostedService<HealthMonitor>();
        services.AddHostedService<BackupScheduler>();
        return services;
    }
}
