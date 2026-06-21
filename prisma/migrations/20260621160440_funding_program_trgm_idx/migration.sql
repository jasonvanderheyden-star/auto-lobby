-- GIN trigram indexes for the G0b disbursement->program fuzzy join (pg_trgm
-- extension already enabled by 20260522175735_enable_pg_trgm).
-- Not required at 366 rows, but future-proofs G2's provincial catalog growth.
CREATE INDEX IF NOT EXISTS "FundingProgram_name_trgm_idx"
  ON "FundingProgram" USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "FundingProgram_funder_trgm_idx"
  ON "FundingProgram" USING GIN (funder gin_trgm_ops);
