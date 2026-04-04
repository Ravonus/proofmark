-- Server-Side AI Runtime: install tracking, pipe sessions, free tier daily limits

-- New enum: runtime_tool
DO $$ BEGIN
  CREATE TYPE "runtime_tool" AS ENUM('claude-code', 'codex', 'openclaw');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- New enum: runtime_install_status
DO $$ BEGIN
  CREATE TYPE "runtime_install_status" AS ENUM('not_installed', 'installing', 'installed', 'auth_pending', 'ready', 'error');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- New enum: runtime_auth_status
DO $$ BEGIN
  CREATE TYPE "runtime_auth_status" AS ENUM('none', 'pending', 'authorized', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- New enum: runtime_session_status
DO $$ BEGIN
  CREATE TYPE "runtime_session_status" AS ENUM('starting', 'active', 'idle', 'dead');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Extend ai_key_source enum with server_runtime
ALTER TYPE "ai_key_source" ADD VALUE IF NOT EXISTS 'server_runtime';

-- Add daily request cap to rate limits (free tier: 3 requests/day)
ALTER TABLE "ai_rate_limits" ADD COLUMN IF NOT EXISTS "requests_per_day" integer;

-- Server-side AI CLI installations
CREATE TABLE IF NOT EXISTS "ai_runtime_installs" (
  "id" text PRIMARY KEY,
  "tool" "runtime_tool" NOT NULL UNIQUE,
  "status" "runtime_install_status" NOT NULL DEFAULT 'not_installed',
  "binary_path" text,
  "version" text,
  "auth_status" "runtime_auth_status" NOT NULL DEFAULT 'none',
  "auth_credentials" jsonb,
  "install_method" text,
  "last_health_check_at" timestamp,
  "error_message" text,
  "config" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Persistent CLI pipe sessions
CREATE TABLE IF NOT EXISTS "ai_runtime_sessions" (
  "id" text PRIMARY KEY,
  "tool" "runtime_tool" NOT NULL,
  "pid" integer,
  "status" "runtime_session_status" NOT NULL DEFAULT 'starting',
  "started_at" timestamp NOT NULL DEFAULT now(),
  "last_activity_at" timestamp,
  "request_count" integer NOT NULL DEFAULT 0,
  "error_count" integer NOT NULL DEFAULT 0,
  "metadata" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ai_runtime_sessions_tool_status_idx" ON "ai_runtime_sessions" ("tool", "status");
