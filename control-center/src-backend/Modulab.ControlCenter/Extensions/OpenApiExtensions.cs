using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;

namespace Modulab.ControlCenter.Extensions;

public static class OpenApiExtensions
{
    public static WebApplicationBuilder AddControlCenterOpenApi(this WebApplicationBuilder builder)
    {
        builder.Services.AddOpenApi(options =>
        {
            options.AddDocumentTransformer((document, _, _) =>
            {
                document.Info = new OpenApiInfo
                {
                    Title = "Modulab Control Center API",
                    Version = "v1",
                    Description = "Lab install/control API and dashboard config.",
                };

                return Task.CompletedTask;
            });
        });

        return builder;
    }

    public static WebApplication MapControlCenterOpenApi(this WebApplication app)
    {
        app.MapOpenApi();
        return app;
    }

    public static RouteHandlerBuilder ProducesApiMessage(
        this RouteHandlerBuilder builder,
        params int[] statusCodes)
    {
        foreach (var code in statusCodes)
            builder.Produces<ApiMessage>(code);
        return builder;
    }
}
