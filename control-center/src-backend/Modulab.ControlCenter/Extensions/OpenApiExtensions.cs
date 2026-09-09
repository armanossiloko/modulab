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

                document.Components ??= new OpenApiComponents();
                document.Components.SecuritySchemes ??= new Dictionary<string, IOpenApiSecurityScheme>();
                document.Components.SecuritySchemes["LabKey"] = new OpenApiSecurityScheme
                {
                    Type = SecuritySchemeType.ApiKey,
                    In = ParameterLocation.Header,
                    Name = "X-Lab-Key",
                    Description = "Optional shared secret from lab.controlCenterApiKey / CONTROL_CENTER_API_KEY.",
                };

                return Task.CompletedTask;
            });

            options.AddOperationTransformer((operation, _, _) =>
            {
                // Mutating /api routes require the key when configured; document it for all /api ops.
                operation.Security ??= [];
                operation.Security.Add(new OpenApiSecurityRequirement
                {
                    [new OpenApiSecuritySchemeReference("LabKey")] = [],
                });
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
