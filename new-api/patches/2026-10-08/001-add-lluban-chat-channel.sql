-- PostgreSQL data-only patch. Requires the accompanying channel text pricing code.
-- Upstream: https://tt-api.lluban.com ; docs: https://tt-api.lluban.com/docs
-- 22 explicitly classified chat models from the 2026-10-08 public catalog.
-- Per user policy: upstream CNY base x 0.2 is cost; cost x 2 is retail.
-- Published model_ratio x 2 is already CNY/M: do NOT multiply an exchange rate again.
-- Only this channel owns this contract; no global pricing options are overwritten.
-- Credentials are supplied by new-api-patch environment, never SQL literals in Git.
\set ON_ERROR_STOP on
\getenv lluban_key LLUBAN_API_KEY
\if :{?lluban_key}
SELECT length(btrim(:'lluban_key')) > 0 AS lluban_key_present \gset
\else
\set lluban_key_present false
\endif
\if :lluban_key_present
\else
DO $$ BEGIN RAISE EXCEPTION 'LLUBAN_API_KEY is required'; END $$;
\endif

BEGIN;
-- Serialize this business-key insert even if the patch service is started twice.
SELECT pg_advisory_xact_lock(hashtext('tanva:lluban-chat-channel'));
DO $$
BEGIN
  IF (SELECT count(*) FROM channels WHERE name = 'lluban-chat') > 1 THEN
    RAISE EXCEPTION 'Duplicate lluban-chat channels; review before applying';
  END IF;
  IF EXISTS (SELECT 1 FROM channels WHERE name = 'lluban-chat'
      AND (type <> 1 OR base_url IS DISTINCT FROM 'https://tt-api.lluban.com')) THEN
    RAISE EXCEPTION 'lluban-chat already identifies a different upstream';
  END IF;
END $$;

INSERT INTO channels (type, key, status, name, weight, created_time, test_time,
  response_time, base_url, other, balance, balance_updated_time, models, "group", used_quota, priority, tag)
SELECT 1, :'lluban_key', 1, 'lluban-chat', 1, extract(epoch from now())::bigint, 0,
  0, 'https://tt-api.lluban.com', '', 0, 0, '', 'default,vip,svip', 0, 0, 'lluban-chat'
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'lluban-chat');

-- Preserve existing channel status, counters and administrator key changes on replay.
DO $lluban$
DECLARE
  contract jsonb := $contract${
  "text_sale_multiplier": 2,
  "text_cost_per_million_cny": {
    "claude-fable-5.1": {
      "input": 14.6,
      "output": 73.0,
      "cache_read": 0.365,
      "cache_write": 18.25,
      "image_input": 14.6,
      "cache_write_1h": 29.2,
      "cache_write_5m": 18.25
    },
    "claude-opus-5": {
      "input": 7.3,
      "output": 36.5,
      "cache_read": 0.73,
      "cache_write": 9.125,
      "image_input": 7.3,
      "cache_write_1h": 14.6,
      "cache_write_5m": 9.125
    },
    "claude-opus-5-5": {
      "input": 5.84,
      "output": 29.2,
      "cache_read": 0.292,
      "cache_write": 7.3,
      "image_input": 5.84,
      "cache_write_1h": 11.68,
      "cache_write_5m": 7.3
    },
    "claude-sonnet-5-5": {
      "input": 2.92,
      "output": 14.6,
      "cache_read": 0.146,
      "cache_write": 3.65,
      "image_input": 2.92,
      "cache_write_1h": 5.84,
      "cache_write_5m": 3.65
    },
    "deepseek-v4.1-flash": {
      "input": 0.438,
      "output": 1.752,
      "cache_read": 0.00876,
      "cache_write": 0.438,
      "image_input": 0.438
    },
    "doubao-seed-2-0-lite-260428": {
      "input": 0.18,
      "output": 1.08,
      "cache_read": 0.036,
      "cache_write": 0.0
    },
    "doubao-seed-2-1-turbo-260628": {
      "input": 0.9,
      "output": 4.5,
      "cache_read": 0.9,
      "cache_write": 0.9
    },
    "gemini-3.6-flash": {
      "input": 1.095,
      "output": 5.475,
      "cache_read": 0.1095,
      "cache_write": 1.095,
      "image_input": 1.095,
      "audio_input": 1.095
    },
    "gemini-3.7-flash": {
      "input": 1.095,
      "output": 5.475,
      "cache_read": 0.1095,
      "cache_write": 1.095,
      "image_input": 1.095,
      "audio_input": 1.095
    },
    "gemini-3.8-flash": {
      "input": 1.095,
      "output": 5.475,
      "cache_read": 0.1095,
      "cache_write": 1.095,
      "image_input": 1.095,
      "audio_input": 1.095
    },
    "glm-5.3": {
      "input": 2.0439999999999996,
      "output": 6.424,
      "cache_read": 0.37959999999999994,
      "cache_write": 2.0439999999999996,
      "image_input": 2.0439999999999996
    },
    "glm-5.3-flash": {
      "input": 0.219,
      "output": 0.73,
      "cache_read": 0.0438,
      "cache_write": 0.219,
      "image_input": 0.219
    },
    "gpt-5.6-luna": {
      "input": 0.292,
      "output": 1.752,
      "cache_read": 0.029199999999999997,
      "cache_write": 0.365,
      "image_input": 0.292,
      "tiers": [
        {
          "max_prompt_tokens": 272000,
          "cache_read": 0.0292,
          "cache_write": 0.365,
          "input": 0.292,
          "output": 1.752,
          "image_input": 0.292
        },
        {
          "max_prompt_tokens": 0,
          "cache_read": 0.0584,
          "cache_write": 0.73,
          "input": 0.584,
          "output": 2.6279999999999997,
          "image_input": 0.584
        }
      ]
    },
    "gpt-5.6-sol": {
      "input": 5.84,
      "output": 29.2,
      "cache_read": 0.584,
      "cache_write": 7.3,
      "image_input": 5.84,
      "tiers": [
        {
          "max_prompt_tokens": 272000,
          "cache_read": 0.584,
          "cache_write": 7.3,
          "input": 5.84,
          "output": 29.2,
          "image_input": 5.84
        },
        {
          "max_prompt_tokens": 0,
          "cache_read": 1.168,
          "cache_write": 14.6,
          "input": 11.68,
          "output": 43.8,
          "image_input": 11.68
        }
      ]
    },
    "gpt-5.6-terra": {
      "input": 2.92,
      "output": 17.52,
      "cache_read": 0.292,
      "cache_write": 3.65,
      "image_input": 2.92,
      "tiers": [
        {
          "max_prompt_tokens": 272000,
          "cache_read": 0.292,
          "cache_write": 3.65,
          "input": 2.92,
          "output": 17.52,
          "image_input": 2.92
        },
        {
          "max_prompt_tokens": 0,
          "cache_read": 0.584,
          "cache_write": 7.3,
          "input": 5.84,
          "output": 26.28,
          "image_input": 5.84
        }
      ]
    },
    "gpt-6-astra": {
      "input": 14.6,
      "output": 73.0,
      "cache_read": 1.46,
      "cache_write": 18.25,
      "image_input": 14.6,
      "tiers": [
        {
          "max_prompt_tokens": 272000,
          "cache_read": 1.46,
          "cache_write": 18.25,
          "input": 14.6,
          "output": 73.0,
          "image_input": 14.6
        },
        {
          "max_prompt_tokens": 0,
          "cache_read": 2.92,
          "cache_write": 36.5,
          "input": 29.2,
          "output": 109.5,
          "image_input": 29.2
        }
      ]
    },
    "gpt-6-luna": {
      "input": 0.146,
      "output": 0.73,
      "cache_read": 0.014599999999999998,
      "cache_write": 0.1825,
      "image_input": 0.146,
      "tiers": [
        {
          "max_prompt_tokens": 272000,
          "cache_read": 0.0146,
          "cache_write": 0.1825,
          "input": 0.146,
          "output": 0.73,
          "image_input": 0.146
        },
        {
          "max_prompt_tokens": 0,
          "cache_read": 0.0292,
          "cache_write": 0.365,
          "input": 0.292,
          "output": 1.095,
          "image_input": 0.292
        }
      ]
    },
    "gpt-6-sol": {
      "input": 2.92,
      "output": 14.6,
      "cache_read": 0.292,
      "cache_write": 3.65,
      "image_input": 2.92,
      "tiers": [
        {
          "max_prompt_tokens": 272000,
          "cache_read": 0.292,
          "cache_write": 3.65,
          "input": 2.92,
          "output": 14.6,
          "image_input": 2.92
        },
        {
          "max_prompt_tokens": 0,
          "cache_read": 0.584,
          "cache_write": 7.3,
          "input": 5.84,
          "output": 21.9,
          "image_input": 5.84
        }
      ]
    },
    "grok-4.6": {
      "input": 2.92,
      "output": 8.76,
      "cache_read": 0.73,
      "cache_write": 2.92,
      "image_input": 2.92,
      "tiers": [
        {
          "max_prompt_tokens": 199999,
          "cache_read": 0.73,
          "cache_write": 2.92,
          "input": 2.92,
          "output": 8.76,
          "image_input": 2.92
        },
        {
          "max_prompt_tokens": 0,
          "cache_read": 1.46,
          "cache_write": 5.84,
          "input": 5.84,
          "output": 17.52,
          "image_input": 5.84
        }
      ]
    },
    "grok-4.7": {
      "input": 2.92,
      "output": 8.76,
      "cache_read": 0.73,
      "cache_write": 2.92,
      "image_input": 2.92,
      "tiers": [
        {
          "max_prompt_tokens": 199999,
          "cache_read": 0.73,
          "cache_write": 2.92,
          "input": 2.92,
          "output": 8.76,
          "image_input": 2.92
        },
        {
          "max_prompt_tokens": 0,
          "cache_read": 1.46,
          "cache_write": 5.84,
          "input": 5.84,
          "output": 17.52,
          "image_input": 5.84
        }
      ]
    },
    "kimi-k3": {
      "input": 4.38,
      "output": 21.9,
      "cache_read": 0.438,
      "cache_write": 4.38,
      "image_input": 4.38,
      "cache_write_1h": 8.76,
      "cache_write_5m": 4.38
    },
    "qwen3.8-max": {
      "input": 2.92,
      "output": 8.76,
      "cache_read": 0.365,
      "cache_write": 3.65,
      "image_input": 2.92
    }
  }
}$contract$::jsonb;
  channel_id_value integer;
  vendor_id_value integer;
  model_list text;
BEGIN
  SELECT id INTO STRICT channel_id_value FROM channels WHERE name = 'lluban-chat';
  SELECT string_agg(name, ',' ORDER BY name) INTO model_list
    FROM jsonb_object_keys(contract->'text_cost_per_million_cny') AS name;
  UPDATE channels SET
    setting = (COALESCE(NULLIF(setting, ''), '{}')::jsonb || contract)::text,
    models = model_list
  WHERE id = channel_id_value;

  IF (SELECT count(*) FROM vendors WHERE name='Luban Chat' AND deleted_at IS NULL) > 1 THEN
    RAISE EXCEPTION 'Duplicate Luban Chat vendors; review before applying';
  END IF;
  INSERT INTO vendors (name, description, icon, status, created_time, updated_time)
  SELECT 'Luban Chat', 'Luban OpenAI-compatible chat gateway; CNY token billing', '', 1,
    extract(epoch from now())::bigint, extract(epoch from now())::bigint
  WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE name='Luban Chat' AND deleted_at IS NULL);
  SELECT id INTO STRICT vendor_id_value FROM vendors WHERE name='Luban Chat' AND deleted_at IS NULL;

  -- Shared existing metadata, including deliberate disabled/soft-deleted entries,
  -- is left intact. New entries expose only the verified Chat Completions protocol.
  INSERT INTO models (model_name, description, icon, tags, vendor_id, endpoints, kind,
    status, sync_official, created_time, updated_time, name_rule)
  SELECT name, name || ' · Luban Chat', '', 'chat,text', vendor_id_value,
    '{"openai":{"path":"/v1/chat/completions","method":"POST"}}', 'chat', 1, 0,
    extract(epoch from now())::bigint, extract(epoch from now())::bigint, 0
  FROM jsonb_object_keys(contract->'text_cost_per_million_cny') AS name
  WHERE NOT EXISTS (SELECT 1 FROM models m WHERE m.model_name=name);

  INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
  SELECT btrim(g), model_names.model_name, c.id, (c.status=1), COALESCE(c.priority,0), COALESCE(c.weight,0), c.tag
  FROM channels c
  CROSS JOIN LATERAL regexp_split_to_table(c."group", ',') AS g
  CROSS JOIN jsonb_object_keys(contract->'text_cost_per_million_cny') AS model_names(model_name)
  WHERE c.id=channel_id_value AND btrim(g)<>''
  ON CONFLICT ("group",model,channel_id) DO UPDATE SET
    enabled=EXCLUDED.enabled, priority=EXCLUDED.priority, weight=EXCLUDED.weight, tag=EXCLUDED.tag;
END $lluban$;
COMMIT;

-- Secret-free verification; runtime caches normally refresh within 120 seconds.
SELECT id,name,type,status,base_url,"group",models FROM channels WHERE name='lluban-chat';
SELECT count(*) AS lluban_model_routes FROM abilities
WHERE channel_id=(SELECT id FROM channels WHERE name='lluban-chat');
