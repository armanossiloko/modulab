# Control Center OpenAPI

`openapi.json` is **generated at `dotnet build`** by `Microsoft.Extensions.ApiDescription.Server`
(see `Modulab.ControlCenter.csproj`).

Do not edit by hand. Refresh with:

```bash
bash scripts/generate-api.sh
```

That also regenerates the Angular client under `ui/src/app/api/generated/` via `@hey-api/openapi-ts`.
Angular `npm run build` runs `generate:api` automatically from this file.
