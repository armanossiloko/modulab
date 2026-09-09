# syntax=docker/dockerfile:1
# Build from repo root:
#   docker build -f control-center/src-backend/Modulab.ControlCenter/Dockerfile .

FROM node:22-bookworm-slim AS ui
WORKDIR /build
COPY control-center/openapi/openapi.json openapi/openapi.json
COPY control-center/ui/package.json control-center/ui/package-lock.json ui/
WORKDIR /build/ui
RUN npm ci
COPY control-center/ui/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends clang zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY control-center/src-backend/Modulab.ControlCenter/Modulab.ControlCenter.csproj control-center/src-backend/Modulab.ControlCenter/
RUN dotnet restore control-center/src-backend/Modulab.ControlCenter/Modulab.ControlCenter.csproj
COPY control-center/src-backend/Modulab.ControlCenter/ control-center/src-backend/Modulab.ControlCenter/
RUN dotnet publish control-center/src-backend/Modulab.ControlCenter/Modulab.ControlCenter.csproj -c Release -r linux-x64 -o /app/publish \
    -p:PublishAot=true \
    -p:StripSymbols=true \
    -p:OptimizationPreference=Size \
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
# Angular SPA + seeded dashboard; services.json is generated at runtime on the mounted lab root
COPY --from=ui /build/ui/dist/control-center/browser/ /app/wwwroot/
COPY control-center/defaults/dashboard.json /app/wwwroot/dashboard.json

ENV LAB_ROOT=/lab \
    HOME_PORT=8888 \
    ASPNETCORE_URLS=http://0.0.0.0:8888 \
    CONTROL_CENTER_WWWROOT=/app/wwwroot \
    DOTNET_gcServer=0 \
    DOTNET_EnableDiagnostics=0

EXPOSE 8888
ENTRYPOINT ["/app/Modulab.ControlCenter"]
