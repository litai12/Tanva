#!/usr/bin/env python3
"""Run the real patch twice/concurrently in an isolated PostgreSQL 16 container.

No production connections, supplier requests, real credentials or persistent volumes.
"""
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
PATCH = ROOT / 'new-api/patches/2026-10-08/001-add-lluban-chat-channel.sql'
SNAPSHOT = PATCH.with_name('lluban-chat-pricing-snapshot.json')
CONTAINER = 'tanva-lluban-patch-test-' + uuid.uuid4().hex[:10]


def run(args, **kwargs):
    return subprocess.run(args, text=True, capture_output=True, check=True, **kwargs)


def psql(sql, secret=None, check=True):
    cmd = ['docker', 'exec', '-i']
    if secret is not None:
        cmd += ['-e', 'LLUBAN_API_KEY=' + secret]  # fake fixture only
    cmd += [CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAt', '-v', 'ON_ERROR_STOP=on']
    result = subprocess.run(cmd, input=sql, text=True, capture_output=True)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def query(sql):
    return psql(sql).stdout.strip()


schema = '''
CREATE TABLE channels (id serial PRIMARY KEY, type integer, key text, status integer, name text,
 weight integer, created_time bigint, test_time bigint, response_time bigint, base_url text,
 other text, balance double precision, balance_updated_time bigint, models text, "group" text,
 used_quota bigint, priority bigint, tag text, setting text, model_mapping text);
CREATE TABLE abilities ("group" text, model text, channel_id integer, enabled boolean,
 priority bigint, weight integer, tag text, PRIMARY KEY ("group",model,channel_id));
CREATE TABLE vendors (id serial PRIMARY KEY, name text, description text, icon text, status integer,
 created_time bigint, updated_time bigint, deleted_at timestamp);
CREATE TABLE models (id serial PRIMARY KEY, model_name text, description text, icon text, tags text,
 vendor_id integer, endpoints text, kind text, status integer, sync_official integer,
 created_time bigint, updated_time bigint, name_rule integer, deleted_at timestamp);
CREATE TABLE options (key text PRIMARY KEY, value text);
INSERT INTO channels (name,type,key,status,base_url,models,setting)
VALUES ('existing',1,'fixture-existing',1,'https://example.invalid','deepseek-v4.1-flash','{"proxy":"existing"}');
INSERT INTO models (model_name,description,status,kind)
VALUES ('deepseek-v4.1-flash','existing metadata',1,'chat'), ('gpt-5.6-luna','disabled stays disabled',2,'chat');
INSERT INTO options VALUES ('ModelRatio','{"deepseek-v4.1-flash":1}'), ('ModelPrice','{"gpt-5.6-luna":0.7}');
'''


def fingerprint():
    return query("""SELECT json_build_object(
      'channels',(SELECT json_agg(c ORDER BY id) FROM channels c),
      'abilities',(SELECT json_agg(a ORDER BY model,\"group\",channel_id) FROM abilities a),
      'models',(SELECT json_agg(m ORDER BY id) FROM models m),
      'vendors',(SELECT json_agg(v ORDER BY id) FROM vendors v),
      'options',(SELECT json_agg(o ORDER BY key) FROM options o));""")


try:
    run(['docker', 'run', '--rm', '-d', '--name', CONTAINER, '--network', 'none',
         '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16-alpine'])
    for _ in range(100):
        result = subprocess.run(['docker', 'exec', CONTAINER, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], capture_output=True)
        if result.returncode == 0:
            break
        time.sleep(.1)
    else:
        raise AssertionError('Isolated PostgreSQL did not become ready')
    psql(schema)
    original_options = query('SELECT json_agg(o ORDER BY key) FROM options o;')
    original_channel = query("SELECT row_to_json(c) FROM channels c WHERE name='existing';")
    original_models = query('SELECT json_agg(m ORDER BY id) FROM models m;')
    before = fingerprint()
    assert psql(PATCH.read_text(), check=False).returncode != 0
    assert psql(PATCH.read_text(), secret=' ', check=False).returncode != 0
    assert fingerprint() == before, 'Missing credentials must not change data'
    fixture_secret = "fixture-'quoted-$value\\-key"
    psql(PATCH.read_text(), secret=fixture_secret)
    settings = json.loads(query("SELECT setting FROM channels WHERE name='lluban-chat';"))
    snapshot = json.loads(SNAPSHOT.read_text())
    assert settings['text_cost_per_million_cny'] == snapshot['channel_costs']
    assert settings['text_sale_multiplier'] == 2
    assert len(settings['text_cost_per_million_cny']) == 22
    assert query("SELECT count(*) FROM abilities WHERE channel_id=(SELECT id FROM channels WHERE name='lluban-chat');") == '66'
    assert query("SELECT key FROM channels WHERE name='lluban-chat';") == fixture_secret
    assert query('SELECT json_agg(o ORDER BY key) FROM options o;') == original_options
    assert query("SELECT row_to_json(c) FROM channels c WHERE name='existing';") == original_channel
    assert query('SELECT json_agg(m ORDER BY id) FROM models m WHERE id<=2;') == original_models
    once = fingerprint()
    # Replays do not rotate an operator-managed key or change counters/metadata.
    psql(PATCH.read_text(), secret='fixture-replay-key')
    assert fingerprint() == once, 'SQL must be idempotent'
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: psql(PATCH.read_text(), secret='fixture-concurrent-key'), range(2)))
    assert all(result.returncode == 0 for result in results) and fingerprint() == once
    psql("UPDATE channels SET base_url='https://conflict.invalid' WHERE name='lluban-chat';")
    conflict = fingerprint()
    assert psql(PATCH.read_text(), secret='fixture-key', check=False).returncode != 0
    assert fingerprint() == conflict, 'Conflicting upstream must fail atomically'
    print('PASS: 22 models, 66 routes, exact snapshot pricing, missing key, SQL quoting, '
          'idempotency, concurrent replay, conflict rollback, existing data unchanged.')
finally:
    subprocess.run(['docker', 'stop', CONTAINER], capture_output=True)
