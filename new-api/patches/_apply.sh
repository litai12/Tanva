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
deferred=0
for f in $(find . -name '*.sql' | sort); do
  key=${f#./}
  exists=$($PSQL -tA -c "SELECT 1 FROM schema_migrations WHERE filename = '${key}'")
  if [ -n "${exists}" ]; then
    skipped=$((skipped + 1))
    continue
  fi
  case "$key" in
    *xiaot*.sql)
      if [ "$key" != "2026-07-13/001-add-xiaot-agent-channel.sql" ]; then
        xiaot_exists=$($PSQL -tA -c "SELECT 1 FROM channels WHERE name='xiaot-agent' AND type=1 LIMIT 1")
        if [ -z "$xiaot_exists" ]; then
          echo "Deferred ${key}: xiaot-agent channel is not configured"
          deferred=$((deferred + 1))
          continue
        fi
      fi
      ;;
  esac
  if [ "$key" = "2026-07-13/001-add-xiaot-agent-channel.sql" ]; then
    if [ -z "${XIAOT_API_KEY:-}" ] || [ -z "${XIAOT_BASE_URL:-}" ]; then
      echo "Deferred ${key}: XIAOT_API_KEY and XIAOT_BASE_URL are required"
      deferred=$((deferred + 1))
      continue
    fi
    xiaot_key_sql=$(printf '%s' "$XIAOT_API_KEY" | sed "s/'/''/g")
    xiaot_base_sql=$(printf '%s' "$XIAOT_BASE_URL" | sed "s/'/''/g")
    echo "Applying ${key}"
    $PSQL -v "xiaot_key='$xiaot_key_sql'" -v "xiaot_base='$xiaot_base_sql'" -f "${f}"
  else
    echo "Applying ${key}"
    $PSQL -f "${f}"
  fi
  $PSQL -q -c "INSERT INTO schema_migrations (filename) VALUES ('${key}')"
  applied=$((applied + 1))
done
echo "Patches done. applied=${applied}  skipped(already-applied)=${skipped}  deferred(missing-config)=${deferred}"
