#!/usr/bin/env python3
"""Run the APIMart tier SQL against disposable, network-isolated PostgreSQL.

Uses synthetic fixtures only; never connects to production or generates media.
Requires the locally available postgres:16-alpine Docker image.
"""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
PATCH = ROOT / 'new-api/patches/2026-10-21/001-apimart-image-tier-parity.sql'
CONTAINER = 'tanva-apimart-image-test-' + uuid.uuid4().hex[:10]
PAIRS = {
    'gpt-image-2.5-flare': 'gpt-image-2.5-ext',
    'gpt-image-2.5-sunburst': 'gpt-image-2.5-ext',
    'gpt-image-2.5-flare-vip': 'gpt-image-2.5-flare',
    'gpt-image-2.5-sunburst-vip': 'gpt-image-2.5-sunburst',
    'gemini-nano-banana-2.1': 'gemini-nano-banana-2.1-ext',
    'gemini-nano-banana-2.1-official': 'gemini-nano-banana-2.1',
}
SCHEMA = '''
CREATE TABLE channels (id integer PRIMARY KEY, type integer, name text,
 status integer, base_url text, models text, "group" text, model_mapping text,
 priority bigint, weight integer, tag text, key text, settings text, used_quota bigint);
CREATE TABLE abilities ("group" text, model text, channel_id integer, enabled boolean,
 priority bigint, weight integer, tag text, PRIMARY KEY ("group",model,channel_id));
CREATE TABLE models (id serial PRIMARY KEY, model_name text, kind text,
 status integer, description text, params_def text, deleted_at timestamp);
CREATE TABLE options (key text PRIMARY KEY, value text);
CREATE TABLE logs (id integer PRIMARY KEY, channel_id integer, model_name text,
 quota bigint, content text);
INSERT INTO channels VALUES
 (9,59,'apimart',1,'https://api.aishuch.com',
 'legacy-image,gpt-image-2.5-flare,existing-alias','default, vip,,default',
 '{"existing-alias":"legacy-image","gpt-image-2.5-flare":"gpt-image-2.5-ext"}',
 17,23,'operator-tag','synthetic-key','{"timeout":123}',567),
 (31,59,'toApi',2,'https://toapis.com','gpt-image-2.5-flare,legacy-image','default,vip',
 '{"legacy-image":"upstream-legacy"}',31,7,'toapi-disabled','synthetic-other-key','{}',890),
 (51,1,'other',1,'https://other.invalid','legacy-image','default','{}',9,8,'other','fixture','{}',321);
INSERT INTO abilities VALUES
 ('default','legacy-image',9,true,17,23,'operator-tag'),
 ('vip','legacy-image',9,false,42,77,'operator-disabled'),
 ('default','gpt-image-2.5-flare',9,false,99,88,'keep-disabled'),
 ('default','gpt-image-2.5-flare',31,false,31,7,'toapi-disabled'),
 ('vip','gpt-image-2.5-flare',31,false,31,7,'toapi-disabled'),
 ('default','legacy-image',51,true,9,8,'other');
INSERT INTO models (model_name,kind,status,description,params_def)
SELECT model,'image',1,'operator catalog','{"keep":"exactly"}'
FROM unnest(ARRAY['gpt-image-2.5-flare','gpt-image-2.5-sunburst',
 'gpt-image-2.5-flare-vip','gpt-image-2.5-sunburst-vip',
 'gemini-nano-banana-2.1','gemini-nano-banana-2.1-official','legacy-image']) model;
INSERT INTO options VALUES
 ('ModelPrice','{"gpt-image-2.5-flare":0.123,"gpt-image-2.5-sunburst":0.234,
 "gpt-image-2.5-flare-vip":0.345,"gpt-image-2.5-sunburst-vip":0.456,
 "gemini-nano-banana-2.1":0.567,"gemini-nano-banana-2.1-official":0.678,"legacy-image":42}'),
 ('ModelRatio','{"legacy-image":37}'),
 ('CompletionRatio','{"legacy-image":19}'),
 ('unrelated-option','operator literal');
INSERT INTO logs VALUES
 (1,9,'legacy-image',123,'historic APIMart bill'),
 (2,31,'gpt-image-2.5-flare',456,'historic ToAPIs bill');
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


def preserved(database):
    return value('''SELECT json_build_object(
      'other_channels',(SELECT json_agg(c ORDER BY id) FROM channels c WHERE id<>9),
      'other_abilities',(SELECT json_agg(a ORDER BY channel_id,model,"group") FROM abilities a WHERE channel_id<>9),
      'channel_settings',(SELECT to_jsonb(c)-'models'-'model_mapping' FROM channels c WHERE id=9),
      'legacy_abilities',(SELECT json_agg(a ORDER BY model,"group") FROM abilities a WHERE channel_id=9 AND model='legacy-image'),
      'disabled_ability',(SELECT to_jsonb(a) FROM abilities a WHERE channel_id=9 AND model='gpt-image-2.5-flare' AND "group"='default'),
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
    result = apply(database, check=False)
    assert result.returncode != 0, 'Expected SQL rejection: ' + database
    assert fingerprint(database) == before, 'Rejected patch changed state: ' + database


def assert_routes(database, enabled=True):
    channel = value('SELECT row_to_json(c) FROM channels c WHERE id=9;', database)
    models = channel['models'].split(',')
    assert models[:3] == ['legacy-image', 'gpt-image-2.5-flare', 'existing-alias']
    assert len(models) == len(set(models)) == 8
    mapping = json.loads(channel['model_mapping'])
    assert mapping == {'existing-alias': 'legacy-image', **PAIRS}
    abilities = value('SELECT json_agg(a ORDER BY model,"group") FROM abilities a WHERE channel_id=9;', database)
    routes = {(row['model'], row['group']): row for row in abilities}
    for model in PAIRS:
        for group in ('default', 'vip'):
            row = routes[(model, group)]
            if model == 'gpt-image-2.5-flare' and group == 'default':
                assert row['enabled'] is False
                assert (row['priority'], row['weight'], row['tag']) == (99, 88, 'keep-disabled')
            else:
                assert row['enabled'] is enabled, row
                assert (row['priority'], row['weight'], row['tag']) == (17, 23, 'operator-tag')
    assert len(routes) == 14


def run_tests():
    fresh = fixture('fresh')
    before = preserved(fresh)
    apply(fresh)
    assert preserved(fresh) == before, 'Unrelated channel/catalog/pricing/history changed'
    assert_routes(fresh)
    once = fingerprint(fresh)
    apply(fresh)
    assert fingerprint(fresh) == once, 'Sequential replay changed state'
    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(lambda _: apply(fresh), range(2)))
    assert fingerprint(fresh) == once, 'Concurrent replay changed state'

    concurrent = fixture('concurrent_fresh')
    untouched = preserved(concurrent)
    with ThreadPoolExecutor(max_workers=3) as executor:
        list(executor.map(lambda _: apply(concurrent), range(3)))
    assert preserved(concurrent) == untouched
    assert_routes(concurrent)

    for status in (2, 3):
        db = fixture('disabled_' + str(status), 'UPDATE channels SET status=' + str(status) + ' WHERE id=9;')
        old = preserved(db)
        apply(db)
        assert preserved(db) == old
        assert_routes(db, enabled=False)
        once = fingerprint(db)
        apply(db)
        assert fingerprint(db) == once

    disabled_catalog = fixture('disabled_catalog', "UPDATE models SET status=2 WHERE model_name='gemini-nano-banana-2.1';")
    old = preserved(disabled_catalog)
    apply(disabled_catalog)
    assert preserved(disabled_catalog) == old
    assert query("SELECT count(*) FROM abilities WHERE channel_id=9 AND model='gemini-nano-banana-2.1' AND enabled;", disabled_catalog) == '0'

    # Explicit operator customizations remain authoritative after first apply.
    psql("""UPDATE abilities SET enabled=false,priority=123,weight=456,tag='operator replay'
      WHERE channel_id=9 AND model='gpt-image-2.5-sunburst';
      UPDATE channels SET status=2 WHERE id=9;
      UPDATE options SET value=jsonb_set(value::jsonb,ARRAY['gpt-image-2.5-flare'],'99')::text
      WHERE key='ModelPrice';""", fresh)
    operator = fingerprint(fresh)
    apply(fresh)
    assert fingerprint(fresh) == operator, 'Replay changed operator disable or retail price'

    for name, sql in (
        ('conflict', "UPDATE channels SET model_mapping='{\"gpt-image-2.5-flare\":\"operator-upstream\"}' WHERE id=9;"),
        ('wrong_base', "UPDATE channels SET base_url='https://toapis.com' WHERE id=9;"),
        ('null_base', 'UPDATE channels SET base_url=NULL WHERE id=9;'),
        ('wrong_type', 'UPDATE channels SET type=1 WHERE id=9;'),
        ('null_type', 'UPDATE channels SET type=NULL WHERE id=9;'),
        ('wrong_name', "UPDATE channels SET name='another-provider' WHERE id=9;"),
        ('null_name', 'UPDATE channels SET name=NULL WHERE id=9;'),
        ('missing_channel', 'DELETE FROM channels WHERE id=9;'),
        ('missing_groups', "UPDATE channels SET \"group\"=' , ' WHERE id=9;"),
        ('invalid_mapping', "UPDATE channels SET model_mapping='not json' WHERE id=9;"),
        ('missing_price_option', "DELETE FROM options WHERE key='ModelPrice';"),
    ):
        reject_unchanged(fixture(name, sql))
    for index, model in enumerate(PAIRS):
        reject_unchanged(fixture('missing_price_' + str(index),
            "UPDATE options SET value=(value::jsonb-'" + model + "')::text WHERE key='ModelPrice';"))
        reject_unchanged(fixture('missing_catalog_' + str(index),
            "DELETE FROM models WHERE model_name='" + model + "';"))
    for name, expression in (('zero', '0'), ('negative', '-1'), ('string', '"0.1"'), ('null', 'null')):
        reject_unchanged(fixture('invalid_price_' + name,
            "UPDATE options SET value=jsonb_set(value::jsonb,ARRAY['gpt-image-2.5-flare'],'" + expression + "')::text WHERE key='ModelPrice';"))
    for name, sql in (
        ('deleted_catalog', "UPDATE models SET deleted_at=now() WHERE model_name='gpt-image-2.5-flare';"),
        ('wrong_catalog_kind', "UPDATE models SET kind='video' WHERE model_name='gpt-image-2.5-flare';"),
    ):
        reject_unchanged(fixture(name, sql))
    print('PASS: six exact tier mappings and ordered model append; fresh/concurrent/sequential '
          'idempotency; channel/catalog/ability disables and operator settings preserved; '
          'prices, channel 31, other channels, catalogs and history unchanged; mapping/base/type/name/'
          'groups/catalog/price failures roll back atomically.')


if __name__ == '__main__':
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
