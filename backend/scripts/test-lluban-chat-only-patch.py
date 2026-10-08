#!/usr/bin/env python3
"""Verify the real chat-only SQL in a disposable, network-isolated PostgreSQL.

Only fake fixture credentials; no supplier calls or business database access.
"""
import ast
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
PATCH_DIR = ROOT / 'new-api/patches/2026-10-08'
SEED = (PATCH_DIR / '001-add-lluban-chat-channel.sql').read_text()
PATCH = (PATCH_DIR / '002-use-only-lluban-chat-channel.sql').read_text()
CONTAINER = 'tanva-lluban-chat-only-test-' + uuid.uuid4().hex[:10]
# Reuse the seed patch's minimal database schema without importing/executing its test.
seed_test = ast.parse((ROOT / 'backend/scripts/test-lluban-channel-patch.py').read_text())
SCHEMA = next(ast.literal_eval(n.value) for n in seed_test.body
              if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'schema' for t in n.targets))


def psql(sql, check=True, check_only=False):
    cmd = ['docker', 'exec', '-i', '-e', 'LLUBAN_API_KEY=fixture-only-key', CONTAINER,
           'psql', '-U', 'postgres', '-d', 'postgres', '-XAt', '-v', 'ON_ERROR_STOP=on']
    if check_only:
        cmd += ['-v', 'lluban_scope_check_only=on']
    result = subprocess.run(cmd, input=sql, text=True, capture_output=True)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def query(sql):
    return psql(sql).stdout.strip()


def fingerprint():
    return query('''SELECT json_build_object(
      'channels',(SELECT json_agg(c ORDER BY id) FROM channels c),
      'abilities',(SELECT json_agg(a ORDER BY channel_id,model,"group") FROM abilities a),
      'models',(SELECT json_agg(m ORDER BY id) FROM models m),
      'vendors',(SELECT json_agg(v ORDER BY id) FROM vendors v),
      'options',(SELECT json_agg(o ORDER BY key) FROM options o),
      'logs',(SELECT json_agg(l ORDER BY id) FROM logs l));''')


FIXTURES = '''
CREATE TABLE logs (id integer, channel_id integer, content text);
INSERT INTO logs VALUES (1,10,'historic request and bill are preserved');
INSERT INTO models (model_name,kind,tags,name_rule,status) VALUES
 ('local-chat','chat',NULL,0,1), ('legacy-text','','text',0,1), ('explicit-text','text',NULL,0,1),
 ('media-chat-endpoint','','image',0,1), ('video-model','video',NULL,0,1),
 ('audio-model','audio',NULL,0,1), ('embedding-model','embedding',NULL,0,1),
 ('three-d-model','3d',NULL,0,1), ('gpt-5.4-official','image',NULL,0,1),
 ('mapping-media','image',NULL,0,1), ('pattern-chat-','chat',NULL,1,1),
 ('pattern-chat-image','image',NULL,0,1), ('kind-beats-tag','video','chat',0,1),
 ('tag-media-beats-name','','tapcanvas:kind=image',0,1),
 ('legacy-tag-chat','','tapcanvas:kind=chat',0,1);
INSERT INTO channels (id,name,type,key,status,base_url,models,"group",used_quota,setting,model_mapping) VALUES
 (10,'old-chat',1,'fixture-old-chat-key',1,'https://old.invalid',
  'local-chat,gpt-5.4-apimart,legacy-text,xiaot-agent,legacy-tag-chat,explicit-text,deepseek-chat,deepseek-reasoner,deepseek-v4-flash-vision-exp,deepseek-v4-pro,doubao-seed-2-0-mini-260428,tanvas-right-gpt-5.6-luna,tanvas-right-gpt-5.6-terra','default,vip',19,
  '{"old_price":17}',NULL),
 (20,'mixed',1,'fixture-mixed-key',1,'https://mixed.invalid',
  'local-chat,media-chat-endpoint,video-model,audio-model,embedding-model,three-d-model,gpt-5.4-official,mapped-chat,mapped-image,cycle-a,cycle-b,mapping-media,pattern-chat-text,pattern-chat-image,kind-beats-tag,tag-media-beats-name',
  'default,vip',27,'{"custom_price":123}',
  '{"mapped-chat":"hop-2","hop-2":"local-chat","mapped-image":"media-chat-endpoint","cycle-a":"cycle-b","cycle-b":"cycle-a","mapping-media":"local-chat"}'),
 (30,'orphan-media',1,'fixture-orphan-key',1,'https://orphan.invalid',
  'local-chat','default',31,'{}',NULL),
 (40,'already-disabled',1,'fixture-disabled-key',3,'https://disabled.invalid',
  'local-chat','default',34,'{}',NULL),
 (50,NULL,1,'fixture-null-name',1,'https://null.invalid',
  'local-chat,audio-model','default',35,'{}',NULL);
INSERT INTO abilities ("group",model,channel_id,enabled,priority,weight,tag)
SELECT g,n,c.id,c.status=1,0,1,'fixture-route' FROM channels c
 CROSS JOIN LATERAL regexp_split_to_table(c.models,',') n
 CROSS JOIN LATERAL regexp_split_to_table(c."group",',') g
WHERE c.id>=10;
-- Stale enabled routes not in channels.models also need to be cleaned.
INSERT INTO abilities VALUES ('default','local-chat',1,true,0,1,'stale-chat'),
 ('default','audio-model',30,true,0,1,'orphan-media'),
 ('default','gpt-5.4-rightcodes',20,true,0,1,'stale-alias');
'''

try:
    subprocess.run(['docker', 'run', '--rm', '-d', '--name', CONTAINER, '--network', 'none',
                    '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
                    'postgres:16-alpine'], check=True, capture_output=True)
    for _ in range(100):
        ready = subprocess.run(['docker', 'exec', CONTAINER, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], capture_output=True)
        if ready.returncode == 0:
            break
        time.sleep(.1)
    else:
        raise AssertionError('Isolated PostgreSQL did not become ready')
    psql(SCHEMA)
    psql(FIXTURES)
    before = fingerprint()
    assert psql(PATCH, check=False).returncode != 0, 'Missing Lluban must fail before changing other routes'
    assert fingerprint() == before
    psql(SEED)
    for mutation, repair in [
        ("UPDATE channels SET status=2 WHERE name='lluban-chat'", "UPDATE channels SET status=1 WHERE name='lluban-chat'"),
        ("UPDATE channels SET key='' WHERE name='lluban-chat'", "UPDATE channels SET key='fixture-only-key' WHERE name='lluban-chat'"),
        ("UPDATE channels SET base_url='https://wrong.invalid' WHERE name='lluban-chat'", "UPDATE channels SET base_url='https://tt-api.lluban.com' WHERE name='lluban-chat'"),
        ("UPDATE channels SET models='' WHERE name='lluban-chat'", None),
        ("UPDATE channels SET setting='{}' WHERE name='lluban-chat'", None),
        ("UPDATE channels SET setting=jsonb_set(setting::jsonb,'{text_cost_per_million_cny,deepseek-v4.1-flash,input}','0')::text WHERE name='lluban-chat'", None),
        ("UPDATE abilities SET enabled=false WHERE channel_id=(SELECT id FROM channels WHERE name='lluban-chat') AND model='deepseek-v4.1-flash' AND \"group\"='vip'", None),
    ]:
        psql(mutation + ';')
        invalid = fingerprint()
        assert psql(PATCH, check=False, check_only=True).returncode != 0
        assert psql(PATCH, check=False).returncode != 0
        assert fingerprint() == invalid, 'Invalid Lluban contract must roll back atomically'
        psql(repair + ';' if repair else SEED)
    psql("UPDATE models SET kind='image' WHERE model_name='gpt-5.6-luna';")
    conflict = fingerprint()
    assert psql(PATCH, check=False).returncode != 0
    assert psql(PATCH, check=False, check_only=True).returncode != 0
    assert fingerprint() == conflict, 'Media conflict must be rejected before other chat is disabled'
    psql("UPDATE models SET kind='chat' WHERE model_name='gpt-5.6-luna';")
    original_models = query('SELECT json_agg(m ORDER BY id) FROM models m;')
    original_options = query('SELECT json_agg(o ORDER BY key) FROM options o;')
    original_logs = query('SELECT json_agg(l ORDER BY id) FROM logs l;')
    preserved_channel_data = query("SELECT json_agg(to_jsonb(c)-'models'-'status' ORDER BY id) FROM channels c;")
    lluban_before = query("SELECT row_to_json(c) FROM channels c WHERE name='lluban-chat';")
    valid = fingerprint()
    psql(PATCH, check_only=True)
    assert fingerprint() == valid, 'Runner check-only mode must not mutate data'
    psql(PATCH)
    assert query("SELECT models || ':' || status FROM channels WHERE id=10;") == ':2'
    assert query("SELECT models || ':' || status FROM channels WHERE id=40;") == ':3'
    assert query("SELECT status FROM channels WHERE id IN (20,30,50) ORDER BY id;") == '1\n1\n1'
    expected_media = ['media-chat-endpoint','video-model','audio-model','embedding-model','three-d-model',
                      'gpt-5.4-official','mapped-image','cycle-a','cycle-b','mapping-media',
                      'pattern-chat-image','kind-beats-tag','tag-media-beats-name']
    assert query('SELECT models FROM channels WHERE id=20;') == ','.join(expected_media)
    assert query('SELECT models FROM channels WHERE id=50;') == 'audio-model'
    assert query('SELECT count(*) FROM abilities WHERE channel_id=20 AND enabled;') == str(len(expected_media)*2)
    assert query("SELECT count(*) FROM abilities WHERE channel_id=(SELECT id FROM channels WHERE name='lluban-chat') AND enabled;") == '66'
    assert query("SELECT row_to_json(c) FROM channels c WHERE name='lluban-chat';") == lluban_before
    assert query('SELECT json_agg(m ORDER BY id) FROM models m;') == original_models
    assert query('SELECT json_agg(o ORDER BY key) FROM options o;') == original_options
    assert query('SELECT json_agg(l ORDER BY id) FROM logs l;') == original_logs
    assert query("SELECT json_agg(to_jsonb(c)-'models'-'status' ORDER BY id) FROM channels c;") == preserved_channel_data
    once = fingerprint()
    psql(PATCH)
    assert fingerprint() == once, 'Replay must be idempotent'
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: psql(PATCH), range(2)))
    assert all(r.returncode == 0 for r in results) and fingerprint() == once
    # Mirror Channel.UpdateAbilities: delete abilities and rebuild from saved CSV.
    psql('''DELETE FROM abilities WHERE channel_id IN (10,20,40,50);
      INSERT INTO abilities ("group",model,channel_id,enabled,priority,weight,tag)
      SELECT g,n,c.id,c.status=1,0,1,'fixture-route' FROM channels c
        CROSS JOIN LATERAL regexp_split_to_table(c.models,',') n
        CROSS JOIN LATERAL regexp_split_to_table(c."group",',') g
      WHERE c.id IN (10,20,40,50);''')
    assert query("SELECT count(*) FROM abilities WHERE channel_id IN (10,20,40,50) AND enabled AND model IN ('local-chat','mapped-chat','pattern-chat-text','gpt-5.4-apimart');") == '0'
    migration = (PATCH_DIR / '003-sync-lluban-official-prices.sql').read_text()
    psql(migration)
    assert query("SELECT setting::jsonb->>'text_price_multiplier' FROM channels WHERE name='lluban-chat';") == '0.4'
    migrated = fingerprint()
    psql(PATCH, check_only=True)
    psql(PATCH)
    assert fingerprint() == migrated, '002 must replay against the real 003 contract'
    psql("UPDATE channels SET setting=jsonb_set(setting::jsonb,'{text_price_multiplier}','0.63')::text WHERE name='lluban-chat';")
    operator_override = fingerprint()
    psql(migration)
    assert fingerprint() == operator_override, '003 replay must preserve administrator multiplier'
    psql(SEED)
    assert fingerprint() == operator_override, '001 replay must not restore legacy pricing after migration'
    # New base/multiplier contract and an administrator's enabled subset are valid.
    psql('''UPDATE channels SET models='deepseek-v4.1-flash' WHERE name='lluban-chat';
      UPDATE abilities SET enabled=false WHERE channel_id=(SELECT id FROM channels WHERE name='lluban-chat') AND model<>'deepseek-v4.1-flash';''')
    subset = fingerprint()
    psql(PATCH, check_only=True)
    psql(PATCH)
    assert fingerprint() == subset
    # Preserve both disabled and removed abilities in manual 001 replay.
    psql("DELETE FROM abilities WHERE channel_id=(SELECT id FROM channels WHERE name='lluban-chat') AND model='gpt-6-astra';")
    subset = fingerprint()
    psql(SEED)
    psql(migration)
    assert fingerprint() == subset, '001/003 replay must preserve enabled model subset and ability edits'
    print('PASS: missing/disabled/unpriced/unroutable Lluban rollback; 22 models/66 routes; '
          'pure-chat disable, mixed media/kinds/tags, canonical aliases, mapping chains/cycles, '
          'stale routes, preserved secrets/prices/history, check-only, replay/concurrency, '
          'ability rebuild, real 001/002/003 sequence, multiplier/subset/ability-edit replay preservation.')
finally:
    subprocess.run(['docker', 'stop', CONTAINER], capture_output=True)
