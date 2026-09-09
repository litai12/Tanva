"""Run on 101: copy only TapCanvas's jichuan image channel, without source pricing.
Credentials stay in subprocess memory and are never logged. Requires local Docker.
"""
import json, subprocess
from pathlib import Path

def source(sql):
    cmd=['docker','exec','-i','hono-api-postgres-1','sh','-c','exec psql -U "$POSTGRES_USER" -d tapcanvas_new_api -At -v ON_ERROR_STOP=on']
    return subprocess.check_output(cmd, input=sql.encode()).decode().strip()

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

channel=json.loads(source("SELECT json_build_object('key',key,'base_url',base_url,'type',type,'models',models) FROM channels WHERE name='jichuan-image' AND status=1;"))
assert channel['type']==1 and channel['models']=='gpt-image-2.5'
assert channel['base_url']=='https://jichuan.pro'
params=source("SELECT params_def FROM models WHERE model_name='gpt-image-2.5' AND deleted_at IS NULL;")
parameters = json.loads(params)
for param in parameters:
    if param.get('key') == 'quality':
        param['default'] = 'max'
        param['options'] = [option for option in param.get('options', []) if option.get('value') in ('high', 'xhigh', 'max')]
params = json.dumps(parameters)
backup=Path('/opt/tanva-backups/jichuan-image25-20260909');backup.mkdir(mode=0o700,parents=True,exist_ok=True)
with (backup/'gateway-before.sql').open('wb') as out:
    subprocess.run(['docker','exec','tanva-new-api-postgres','pg_dump','-U','new_api','-d','new_api','-t','channels','-t','models','-t','abilities','-t','options'],stdout=out,check=True)
# Keep our resolution-only fixed prices. Do not copy TapCanvas pricing_config.
sql=f"""BEGIN;
INSERT INTO channels (name,type,key,status,models,\"group\",base_url,model_mapping,priority,weight,tag,created_time)
SELECT 'jichuan-image',1,{quote(channel['key'])},1,'gpt-image-2.5','default,vip',{quote(channel['base_url'])},'{{}}',0,1,'jichuan',EXTRACT(EPOCH FROM NOW())::bigint
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name='jichuan-image');
INSERT INTO models (model_name,description,kind,status,sync_official,created_time,updated_time,name_rule,capabilities,params_def)
SELECT 'gpt-image-2.5','GPT Image 2.5 - Jichuan','image',1,0,EXTRACT(EPOCH FROM NOW())::bigint,EXTRACT(EPOCH FROM NOW())::bigint,0,'["text_to_image","image_to_image"]',{quote(params)}
WHERE NOT EXISTS (SELECT 1 FROM models WHERE model_name='gpt-image-2.5' AND deleted_at IS NULL);
UPDATE models SET params_def={quote(params)} WHERE model_name='gpt-image-2.5' AND deleted_at IS NULL;
INSERT INTO abilities (\"group\",model,channel_id,enabled,priority,weight,tag)
SELECT g,'gpt-image-2.5',id,status=1,0,1,'jichuan' FROM channels CROSS JOIN unnest(string_to_array(\"group\",',')) g WHERE name='jichuan-image'
ON CONFLICT (\"group\",model,channel_id) DO NOTHING;
UPDATE options SET value=(value::jsonb || jsonb_build_object('gpt-image-2.5',value::jsonb->'gpt-image-2.5-flare'))::text WHERE key='ModelPrice';
COMMIT;
"""
result=subprocess.run(['docker','exec','-i','tanva-new-api-postgres','psql','-U','new_api','-d','new_api','-v','ON_ERROR_STOP=on'],input=sql.encode(),capture_output=True)
if result.returncode: raise RuntimeError('Target registration failed; credentials withheld from error output')
print('Jichuan image model/channel/abilities registered; retained Tanva resolution-only pricing.')
