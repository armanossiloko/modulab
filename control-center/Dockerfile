# syntax=docker/dockerfile:1
# Build from repo root:
#   docker build -f control-center/Dockerfile -t ghcr.io/armanossiloko/modulab:local .

FROM node:22-bookworm-slim AS ui
WORKDIR /build
COPY control-center/package.json control-center/package-lock.json ./
RUN npm ci
COPY control-center/angular.json control-center/tsconfig.json control-center/tsconfig.app.json \
     control-center/proxy.conf.json control-center/openapi-ts.config.ts ./
COPY control-center/openapi/openapi.json openapi/openapi.json
COPY control-center/public/ public/
COPY control-center/src/ src/
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends clang zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY control-center/src-backend/Modulab.ControlCenter/Modulab.ControlCenter.csproj control-center/src-backend/Modulab.ControlCenter/
RUN dotnet restore control-center/src-backend/Modulab.ControlCenter/Modulab.ControlCenter.csproj
COPY control-center/src-backend/Modulab.ControlCenter/ control-center/src-backend/Modulab.ControlCenter/
# Skip OpenAPI regen in image builds — committed openapi/openapi.json is used by the UI stage.
RUN dotnet publish control-center/src-backend/Modulab.ControlCenter/Modulab.ControlCenter.csproj -c Release -r linux-x64 -o /app/publish \
    -p:PublishAot=true \
    -p:StripSymbols=true \
    -p:OptimizationPreference=Size \
    -p:OpenApiGenerateDocuments=false \
    -p:OpenApiGenerateDocumentsOnBuild=false \
    --self-contained true

FROM docker:27-cli AS dockercli

FROM debian:bookworm-slim AS final
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates python3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins

WORKDIR /app
COPY --from=build /app/publish/Modulab.ControlCenter /app/Modulab.ControlCenter
# Angular SPA + seeded default dashboard
COPY --from=ui /build/dist/control-center/browser/ /app/wwwroot/
COPY control-center/defaults/dashboard.json /app/wwwroot/dashboard.json

# Baked lab kit (catalog, scripts, compose templates) — seeded into MODULAB_ROOT on start.
WORKDIR /opt/modulab
COPY catalog/ catalog/
COPY scripts/ scripts/
COPY caddy/ caddy/
COPY postgres/ postgres/
COPY pihole/ pihole/
COPY lab.config.example.json lab.config.example.json
COPY docker-compose*.yml ./
COPY control-center/defaults/ control-center/defaults/
# Optional app templates used by start.sh
COPY searxng/ searxng/

RUN chmod +x /opt/modulab/scripts/*.sh /opt/modulab/scripts/*.py \
    && find /opt/modulab/scripts -name '*.sh' -exec sed -i 's/\r$//' {} \; \
    && sed -i 's/\r$//' /opt/modulab/scripts/entrypoint.sh

ENV MODULAB_ROOT=/lab \
    MODULAB_KIT=/opt/modulab \
    MODULAB_SCRIPTS=/opt/modulab/scripts \
    HOME_PORT=8888 \
    ASPNETCORE_URLS=http://0.0.0.0:8888 \
    CONTROL_CENTER_WWWROOT=/app/wwwroot \
    DOTNET_gcServer=0 \
    DOTNET_EnableDiagnostics=0 \
    COMPOSE_PROJECT_NAME=modulab \
    COMPOSE_IGNORE_ORPHANS=true

EXPOSE 8888
ENTRYPOINT ["/opt/modulab/scripts/entrypoint.sh"]
