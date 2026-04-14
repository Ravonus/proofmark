-- Sync sessions table with Better Auth 1.5.x expectations
-- Adds columns that newer Better Auth versions expect on the sessions table

ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "address" text;
