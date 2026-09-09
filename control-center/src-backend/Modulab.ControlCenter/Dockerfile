# syntax=docker/dockerfile:1
# Build from repo root:
#   docker build -f control-center/src-backend/Modulab.ControlCenter/Dockerfile .

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
COPY control-center/wwwroot/ /app/wwwroot/

ENV LAB_ROOT=/lab \
    HOME_PORT=8888 \
    ASPNETCORE_URLS=http://0.0.0.0:8888 \
    CONTROL_CENTER_WWWROOT=/app/wwwroot \
    DOTNET_gcServer=0 \
    DOTNET_EnableDiagnostics=0

EXPOSE 8888
ENTRYPOINT ["/app/Modulab.ControlCenter"]
