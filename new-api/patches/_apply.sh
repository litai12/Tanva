#!/bin/sh
# Migration runner — applies each .sql file at most once.
#
# Tracking table:
#   schema_migrations (filename TEXT PK, applied_at TIMESTAMPTZ DEFAULT NOW())
#
# Flow:
#   1. CREATE TABLE IF NOT EXISTS schema_migrations
#   2. For each *.sql under /patches (sorted): skip if recorded; else psql -f then INSERT
#
# Env (provided by docker-compose):
#   PGPASSWORD, PG_USER, PG_DB
set -e

PSQL="psql -h new-api-postgres -U ${PG_USER} -d ${PG_DB} -v ON_ERROR_STOP=on"

$PSQL -q -c "
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
"

cd /patches
applied=0
skipped=0
for f in $(find . -name '*.sql' | sort); do
  key=${f#./}
  exists=$($PSQL -tA -c "SELECT 1 FROM schema_migrations WHERE filename = '${key}'")
  if [ -n "${exists}" ]; then
    skipped=$((skipped + 1))
    continue
  fi
  echo "Applying ${key}"
  $PSQL -f "${f}"
  $PSQL -q -c "INSERT INTO schema_migrations (filename) VALUES ('${key}')"
  applied=$((applied + 1))
done
echo "Patches done. applied=${applied}  skipped(already-applied)=${skipped}"
