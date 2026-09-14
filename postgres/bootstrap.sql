-- GENERATED from lab.config.json + catalog recipes — do not edit.
-- Regenerate: bash scripts/render-config.sh
-- Idempotent: safe to re-run on every postgres up.


SELECT format('CREATE DATABASE %I OWNER %I ENCODING %L', 'immich', 'modulab', 'UTF8')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'immich')\gexec

\c immich
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS vectors;

SELECT format('CREATE DATABASE %I OWNER %I ENCODING %L', 'n8n', 'modulab', 'UTF8')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'n8n')\gexec
