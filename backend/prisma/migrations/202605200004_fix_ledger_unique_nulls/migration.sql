-- Fix NULL-unsafe unique constraint on TeamCreditLedger
-- PostgreSQL 14 treats each NULL as distinct, breaking idempotency for entries without taskId.
-- NULLS NOT DISTINCT (PG15+) is unavailable here, so we use two partial unique indexes:
--   1. When taskId IS NOT NULL  → standard unique on all three columns
--   2. When taskId IS NULL      → unique on (teamAccId, entryType) only,
--      ensuring at most one null-taskId entry per (account, entryType) pair.
DROP INDEX IF EXISTS "TeamCreditLedger_teamAccId_entryType_taskId_key";
CREATE UNIQUE INDEX "TeamCreditLedger_teamAccId_entryType_taskId_key"
  ON "TeamCreditLedger"("teamAccId", "entryType", "taskId")
  WHERE "taskId" IS NOT NULL;
CREATE UNIQUE INDEX "TeamCreditLedger_teamAccId_entryType_null_taskId_key"
  ON "TeamCreditLedger"("teamAccId", "entryType")
  WHERE "taskId" IS NULL;
