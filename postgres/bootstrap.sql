-- GENERATED from lab.config.json + catalog recipes — do not edit.
-- Regenerate: bash scripts/render-config.sh
-- Idempotent: safe to re-run on every postgres up.


DO $$ BEGIN
  CREATE DATABASE immich OWNER modulab ENCODING 'UTF8';
EXCEPTION WHEN duplicate_database THEN NULL;
END $$;

DO $$ BEGIN
  CREATE DATABASE n8n OWNER modulab ENCODING 'UTF8';
EXCEPTION WHEN duplicate_database THEN NULL;
END $$;
