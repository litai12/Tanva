#!/bin/sh
# Run only the Wan3.0 patch in an isolated PostgreSQL container; no deployment DB.
set -eu
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_dir=$(mktemp -d)
container="tanva-wan30-patch-test-$$"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$test_dir"
}
trap cleanup EXIT INT TERM
mkdir -p "$test_dir/2026-09-07"
cp "$repo_dir/patches/_apply.sh" "$test_dir/_apply.sh"
cp "$repo_dir/patches/2026-09-07/001-add-wan3-0-video.sql" "$test_dir/2026-09-07/"
docker run -d --name "$container" --add-host new-api-postgres:127.0.0.1 \
  -e POSTGRES_PASSWORD=wan30-isolated-test postgres:16-alpine >/dev/null
docker exec "$container" mkdir -p /patches
docker cp "$test_dir/." "$container:/patches"
ready=0
for attempt in $(seq 1 30); do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] || { echo 'PostgreSQL did not become ready' >&2; exit 1; }
sql() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }
apply() { docker exec -e PG_USER=postgres -e PG_DB=postgres -e PGPASSWORD=wan30-isolated-test "$container" sh /patches/_apply.sh; }
sql <<'SQL'
CREATE TABLE models (id serial PRIMARY KEY, model_name text, description text, tags text,
 endpoints text, kind text, status integer, sync_official integer, created_time bigint,
 updated_time bigint, name_rule integer, capabilities text, params_def text, deleted_at timestamp);
CREATE TABLE channels (id integer PRIMARY KEY, type integer, status integer, models text);
CREATE TABLE abilities ("group" text, model text, channel_id integer, enabled boolean,
 priority bigint, weight integer, tag text, PRIMARY KEY ("group", model, channel_id));
CREATE TABLE options (key text PRIMARY KEY, value text);
INSERT INTO channels VALUES (1,17,1,'wan2.7-i2v'), (2,17,2,'wan2.7-i2v'), (3,67,1,'other');
INSERT INTO options VALUES ('ModelPrice','{"other":7}');
SQL
# A missing source route must fail and must not be marked as applied.
if apply >"$test_dir/missing-route.log" 2>&1; then echo 'Missing source route incorrectly succeeded' >&2; exit 1; fi
grep -q 'Wan3.0 registration requires an enabled' "$test_dir/missing-route.log" || { cat "$test_dir/missing-route.log"; exit 1; }
sql <<'SQL'
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM schema_migrations) OR EXISTS (SELECT 1 FROM models) THEN
  RAISE EXCEPTION 'Failed patch left partial data';
 END IF;
END $$;
INSERT INTO abilities VALUES ('default','wan2.7-i2v',1,true,9,3,'ali'),
 ('vip','wan2.7-i2v',1,true,8,2,'ali'), ('default','wan2.7-i2v',2,true,0,0,''),
 ('default','wan2.7-i2v',3,true,0,0,''), ('disabled','wan2.7-i2v',1,false,0,0,'');
-- Preserve an explicitly disabled target ability.
INSERT INTO abilities VALUES ('vip','wan3.0-video',1,false,4,1,'manual');
SQL
apply
apply | tee "$test_dir/repeat.log"
grep -q 'applied=0  skipped(already-applied)=1' "$test_dir/repeat.log"
# The SQL itself must also remain idempotent if manually retried.
sql -f /patches/2026-09-07/001-add-wan3-0-video.sql
sql <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM models WHERE model_name='wan3.0-video') <> 1 THEN RAISE EXCEPTION 'Duplicate model'; END IF;
 IF (SELECT count(*) FROM abilities WHERE model='wan3.0-video') <> 2 THEN RAISE EXCEPTION 'Wrong channel/group scope'; END IF;
 IF NOT EXISTS (SELECT 1 FROM abilities WHERE model='wan3.0-video' AND "group"='default' AND enabled AND priority=9 AND weight=3 AND tag='ali') THEN RAISE EXCEPTION 'Source settings lost'; END IF;
 IF NOT EXISTS (SELECT 1 FROM abilities WHERE model='wan3.0-video' AND "group"='vip' AND NOT enabled AND tag='manual') THEN RAISE EXCEPTION 'Manual disable overwritten'; END IF;
 IF (SELECT models FROM channels WHERE id=1) <> 'wan2.7-i2v,wan3.0-video' THEN RAISE EXCEPTION 'Model list duplicated'; END IF;
 IF EXISTS (SELECT 1 FROM channels WHERE id IN (2,3) AND models LIKE '%wan3.0%') THEN RAISE EXCEPTION 'Unrelated channel changed'; END IF;
 IF (SELECT value::jsonb FROM options WHERE key='ModelPrice') <> '{"other":7,"wan3.0-video":0.45}'::jsonb THEN RAISE EXCEPTION 'Wrong price merge'; END IF;
 IF (SELECT count(*) FROM schema_migrations) <> 1 THEN RAISE EXCEPTION 'Wrong migration count'; END IF;
END $$;
SQL
echo 'Wan3.0 SQL and Compose patch runner verification passed'
