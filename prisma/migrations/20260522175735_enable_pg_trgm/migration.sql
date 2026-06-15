CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "PublicOfficial_name_trgm_idx"
  ON "PublicOfficial" USING GIN (name gin_trgm_ops);
