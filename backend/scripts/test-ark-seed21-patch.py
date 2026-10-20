#!/usr/bin/env python3
"""Exercise the Ark Seed 2.1 SQL against disposable, network-isolated PostgreSQL.

Only synthetic data is used. No existing database, credentials, or inference API
is accessed. Requires the locally available postgres:16-alpine Docker image.
"""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
PATCH = ROOT / 'new-api/patches/2026-10-20/001-upgrade-ark-doubao-seed-2-1.sql'
CONTAINER = 'tanva-ark-seed21-test-' + uuid.uuid4().hex[:10]
PRO = 'doubao-seed-2-1-pro-260915'
LITE = 'doubao-seed-2-1-lite-260915'
TURBO = 'doubao-seed-2-1-turbo-260628'
MODELS = (PRO, LITE, TURBO)
EXPECTED = {
    'ModelRatio': dict(zip(MODELS, (4.5, .6, 2.25))),
    'CompletionRatio': dict(zip(MODELS, (5, 3.375, 5))),
    'CacheRatio': dict.fromkeys(MODELS, .2),
}
SCHEMA = '''
CREATE TABLE channels (id serial PRIMARY KEY, type integer, key text, status integer,
 name text, weight integer, created_time bigint, test_time bigint, response_time bigint,
 base_url text, other text, balance double precision, balance_updated_time bigint,
 models text, "group" text, used_quota bigint, priority bigint, tag text, setting text,
 settings text, model_mapping text);
CREATE TABLE abilities ("group" text, model text, channel_id integer, enabled boolean,
 priority bigint, weight integer, tag text, PRIMARY KEY ("group",model,channel_id));
CREATE TABLE models (id serial PRIMARY KEY, model_name text, description text, icon text,
 tags text, vendor_id integer, endpoints text, kind text, status integer,
 sync_official integer, created_time bigint, updated_time bigint, name_rule integer,
 capabilities text, params_def text, deleted_at timestamp);
CREATE TABLE options (key text PRIMARY KEY, value text);
CREATE TABLE logs (id integer PRIMARY KEY, channel_id integer, model_name text,
 quota bigint, content text);
INSERT INTO channels (id,name,type,key,status,base_url,models,"group",used_quota,
 priority,weight,tag,setting,settings,model_mapping) VALUES
 (10,'ark-doubao',45,'fixture-ark-key',1,'https://ark.example.invalid',
  'doubao-seed-2-0-pro-260215,doubao-seed-2-0-lite-260215,doubao-seed-2-0-mini-260428,doubao-seedance-2-0-260128',
  'default,vip',123,8,20,'ark-fixture','{"proxy":"fixture-ark-proxy"}',
  '{"timeout":123}','{"legacy-alias":"doubao-seed-2-0-pro-260215"}'),
 (20,'lluban-chat',1,'fixture-other-key',1,'https://other.example.invalid',
  'doubao-seed-2-1-turbo-260628,other-model','default',456,9,10,'other-fixture',
  '{"text_price_multiplier":0.4,"text_base_per_million_cny":{"doubao-seed-2-1-turbo-260628":{"input":3,"output":15,"cache_read":0.6}}}',
  '{"timeout":456}',NULL);
INSERT INTO abilities
SELECT g,m,c.id,c.status=1,c.priority,c.weight,c.tag FROM channels c
 CROSS JOIN LATERAL unnest(string_to_array(c.models,',')) m
 CROSS JOIN LATERAL unnest(string_to_array(c."group",',')) g;
INSERT INTO models (model_name,description,endpoints,kind,status,name_rule)
SELECT m,'historic metadata','{"openai":{"path":"/v1/chat/completions","method":"POST"}}',
 'chat',1,0 FROM unnest(ARRAY['doubao-seed-2-0-pro-260215',
 'doubao-seed-2-0-lite-260215','doubao-seed-2-0-mini-260428','other-model']) m;
INSERT INTO models (model_name,description,endpoints,kind,status,name_rule)
 VALUES ('doubao-seedance-2-0-260128','historic video',NULL,'video',1,0);
INSERT INTO options VALUES
 ('ModelRatio','{"doubao-seed-2-0-pro-260215":2,"other-model":9}'),
 ('CompletionRatio','{"doubao-seed-2-0-pro-260215":5,"other-model":4}'),
 ('CacheRatio','{"doubao-seed-2-0-pro-260215":0.2,"other-model":0.4}'),
 ('ModelPrice','{"doubao-seedance-2-0-260128":1.23}'),
 ('ModelRatioTiers','{"doubao-seed-2-0-pro-260215":[{"max_prompt_tokens":32768,"model_ratio":2}]}'),
 ('unrelated-option','keep exactly');
INSERT INTO logs VALUES (1,10,'doubao-seed-2-0-pro-260215',932,'historic bill'),
 (2,20,'doubao-seed-2-1-turbo-260628',732,'historic other-channel bill');
'''


def psql(sql, database='postgres', check=True):
    result = subprocess.run(
        ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', database,
         '-XAt', '-v', 'ON_ERROR_STOP=on'], input=sql, text=True, capture_output=True)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def query(sql, database):
    return psql(sql, database).stdout.strip()


def value(sql, database):
    return json.loads(query(sql, database))


def fingerprint(database):
    return query('''SELECT json_build_object(
      'channels',(SELECT json_agg(c ORDER BY id) FROM channels c),
      'abilities',(SELECT json_agg(a ORDER BY channel_id,model,"group") FROM abilities a),
      'models',(SELECT json_agg(m ORDER BY id) FROM models m),
      'options',(SELECT json_agg(o ORDER BY key) FROM options o),
      'logs',(SELECT json_agg(l ORDER BY id) FROM logs l));''', database)


def fixture(name, extra=''):
    psql('CREATE DATABASE ' + name + ';')
    psql(SCHEMA + extra, name)
    return name


def apply(database, check=True):
    return psql(PATCH.read_text(), database, check=check)


def reject_unchanged(database):
    before = fingerprint(database)
    assert apply(database, check=False).returncode != 0, 'Expected SQL rejection'
    assert fingerprint(database) == before, 'Rejected patch must roll back all changes'


def preserved(database):
    return value('''SELECT json_build_object(
      'other_channels',(SELECT json_agg(c ORDER BY id) FROM channels c WHERE id<>10),
      'other_abilities',(SELECT json_agg(a ORDER BY channel_id,model,"group") FROM abilities a WHERE channel_id<>10),
      'old_abilities',(SELECT json_agg(a ORDER BY model,"group") FROM abilities a WHERE channel_id=10 AND model NOT LIKE 'doubao-seed-2-1-%'),
      'old_models',(SELECT json_agg(m ORDER BY id) FROM models m WHERE model_name NOT LIKE 'doubao-seed-2-1-%'),
      'ark_channel',(SELECT to_jsonb(c)-'models' FROM channels c WHERE id=10),
      'logs',(SELECT json_agg(l ORDER BY id) FROM logs l));''', database)


def run_tests():
    db = fixture('fresh')
    old = preserved(db)
    old_options = value('SELECT json_object_agg(key,value::jsonb) FROM options WHERE key<>\'unrelated-option\';', db)
    apply(db)
    assert preserved(db) == old, 'Other channels, old routes/models and billing history must stay unchanged'
    new_options = value('SELECT json_object_agg(key,value::jsonb) FROM options WHERE key<>\'unrelated-option\';', db)
    for key, mapping in old_options.items():
        for model, price in mapping.items():
            assert new_options[key][model] == price, (key, model, 'legacy price changed')
    for key, expected in EXPECTED.items():
        for model, rate in expected.items():
            assert new_options[key][model] == rate, (key, model, 'incorrect retail ratio')
    assert new_options['ModelRatioTiers'] == old_options['ModelRatioTiers'], 'No new context tiers'
    assert query('SELECT count(*) FROM abilities WHERE channel_id=10 AND model LIKE \'doubao-seed-2-1-%\' AND enabled;', db) == '6'
    rows = value('SELECT json_agg(m ORDER BY model_name) FROM models m WHERE model_name LIKE \'doubao-seed-2-1-%\';', db)
    endpoints = set(re.findall(r'EndpointType\s*=\s*"([^"]+)"', (ROOT / 'new-api/constant/endpoint_type.go').read_text()))
    for row in rows:
        eps = json.loads(row['endpoints'])
        assert set(eps).issubset(endpoints), 'Endpoint key must be recognized by the gateway'
        assert eps['openai'] == {'path': '/v1/chat/completions', 'method': 'POST'}
        assert eps['openai-response'] == {'path': '/v1/responses', 'method': 'POST'}
        assert row['status'] == 1 and row['kind'] == 'chat'
    once = fingerprint(db)
    apply(db)
    assert fingerprint(db) == once, 'Replay must be idempotent'
    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(lambda _: apply(db), range(2)))
    assert fingerprint(db) == once, 'Concurrent replay must be idempotent'

    # Operator disables/pricing adjustments are authoritative on a manual replay.
    psql("""UPDATE models SET status=2,description='operator description' WHERE model_name='""" + PRO + """';
      UPDATE channels SET status=2 WHERE id=10;
      UPDATE abilities SET enabled=false,priority=42,weight=77 WHERE channel_id=10 AND model='""" + LITE + """';
      UPDATE options SET value=jsonb_set(value::jsonb,ARRAY['""" + PRO + """'],'99')::text WHERE key='ModelRatio';""", db)
    customized = fingerprint(db)
    apply(db)
    assert fingerprint(db) == customized, 'Replay must retain administrator disable, priorities and price override'

    # Shared Turbo already belongs to another provider; do not overwrite its
    # existing metadata or operator endpoint configuration while adding Responses.
    shared = fixture('shared', """INSERT INTO models (model_name,description,tags,kind,status,sync_official,name_rule,endpoints)
      VALUES ('""" + TURBO + """','existing Turbo','operator tags','chat',2,1,0,
      '{"openai":{"path":"/operator/chat","method":"POST"},"gemini":{"path":"/custom","method":"POST"}}');""")
    shared_before = value("SELECT to_jsonb(m)-'endpoints' FROM models m WHERE model_name='" + TURBO + "';", shared)
    other_before = preserved(shared)
    apply(shared)
    assert preserved(shared) == other_before
    assert value("SELECT to_jsonb(m)-'endpoints' FROM models m WHERE model_name='" + TURBO + "';", shared) == shared_before
    shared_eps = value("SELECT endpoints FROM models WHERE model_name='" + TURBO + "';", shared)
    assert shared_eps['openai']['path'] == '/operator/chat', 'Preserve existing endpoint configuration'
    assert shared_eps['gemini']['path'] == '/custom'
    assert 'openai-response' in shared_eps

    disabled = fixture('disabled', 'UPDATE channels SET status=3 WHERE id=10;')
    apply(disabled)
    assert query("SELECT count(*) FROM abilities WHERE channel_id=10 AND model LIKE 'doubao-seed-2-1-%' AND enabled;", disabled) == '0'
    assert query('SELECT status FROM channels WHERE id=10;', disabled) == '3'

    for name, sql in (
        ('missing', 'DELETE FROM channels WHERE id=10;'),
        ('wrong_type', 'UPDATE channels SET type=1 WHERE id=10;'),
        ('duplicate', "INSERT INTO channels (name,type) VALUES ('ark-doubao',45);"),
    ):
        reject_unchanged(fixture(name, sql))
    for i, model in enumerate(MODELS):
        reject_unchanged(fixture('fixed_' + str(i), "UPDATE options SET value=jsonb_set(value::jsonb,ARRAY['" + model + "'],'0.01')::text WHERE key='ModelPrice';"))
    print('PASS: exact Pro/Lite/Turbo retail ratios; recognized Chat/Responses endpoints; '
          'legacy 2.0/media routes, prices, history and other-channel Turbo preserved; '
          'administrator disable/price/endpoint preservation; sequential/concurrent replay; '
          'missing/ambiguous Ark and fixed-price conflicts roll back atomically.')


try:
    subprocess.run(['docker', 'run', '--rm', '-d', '--pull', 'never', '--name', CONTAINER,
                    '--network', 'none', '--tmpfs', '/var/lib/postgresql/data',
                    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16-alpine'],
                   check=True, capture_output=True)
    for _ in range(150):
        if subprocess.run(['docker', 'exec', CONTAINER, 'pg_isready', '-U', 'postgres'],
                          capture_output=True).returncode == 0:
            break
        time.sleep(.1)
    else:
        raise AssertionError('Disposable PostgreSQL did not become ready')
    run_tests()
finally:
    subprocess.run(['docker', 'stop', CONTAINER], capture_output=True)
