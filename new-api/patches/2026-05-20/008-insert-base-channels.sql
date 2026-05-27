-- 008-insert-base-channels.sql
-- Purpose: idempotent insert of all consolidated channels.
-- Runs after 007-cleanup-redundant-channels.sql.
-- Keys are PLACEHOLDER_* — fill in via admin console.
-- Scope: PostgreSQL only, data-only, idempotent.

BEGIN;

-- yunwu-gemini
INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 24, 'yunwu-gemini', 'default',
  'gemini-2.5-flash-image,gemini-3-flash-preview,gemini-3-pro-image-preview,gemini-3.1-flash-image-preview,gemini-3.1-pro-preview',
  NULL, 1, 'https://yunwu.ai', 'PLACEHOLDER_YUNWU_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'yunwu-gemini', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'yunwu-gemini' AND type = 24 AND "group" = 'default');

-- yunwu-openai-image
INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 1, 'yunwu-openai-image', 'default',
  'doubao-seedream-5-0-260128',
  NULL, 1, 'https://yunwu.ai', 'PLACEHOLDER_YUNWU_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'yunwu-openai-image', NULL,
  '{"response_format":"url","watermark":false}', NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'yunwu-openai-image' AND type = 1 AND "group" = 'default');

-- yunwu-openai-video
INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 1, 'yunwu-openai-video', 'default',
  'kling-v3,kling-video-o1,veo_3_1,veo_3_1-fast,veo3.1-pro',
  NULL, 1, 'https://yunwu.ai', 'PLACEHOLDER_YUNWU_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'yunwu-openai-video', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'yunwu-openai-video' AND type = 1 AND "group" = 'default');

-- yunwu-openai
INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 1, 'yunwu-openai', 'default',
  'gpt-5.4',
  NULL, 1, 'https://yunwu.ai', 'PLACEHOLDER_YUNWU_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'yunwu-openai', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'yunwu-openai' AND type = 1 AND "group" = 'default');

-- yunwu-deepseek
INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 1, 'yunwu-deepseek', 'default',
  'deepseek-v3.2',
  NULL, 1, 'https://yunwu.ai', 'PLACEHOLDER_YUNWU_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'yunwu-deepseek', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'yunwu-deepseek' AND type = 1 AND "group" = 'default');

-- ark-doubao (image + video unified — both types 45/54 use the same volcengine adaptor)
INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 45, 'ark-doubao', 'default',
  'doubao-seedream-5-0,doubao-seedream-5-0-lite,doubao-seedream-5-0-260128,doubao-seedream-5-0-lite-260128,'
  'doubao-seedance-2-0-260128,doubao-seedance-2-0-fast-260128',
  '{"doubao-seedream-5-0":"doubao-seedream-5-0-260128","doubao-seedream-5-0-lite":"doubao-seedream-5-0-lite-260128"}',
  1, 'https://ark.cn-beijing.volces.com', 'PLACEHOLDER_ARK_DOUBAO_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 10, 100, 'ark-doubao', NULL,
  '{"watermark":false}', NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'ark-doubao' AND type = 45 AND "group" = 'default');

-- openai-official
INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 1, 'openai-official', 'default',
  'gpt-image-2-official',
  '{"gpt-image-2-official":"gpt-image-2"}',
  1, 'https://api.openai.com', 'PLACEHOLDER_OPENAI_OFFICIAL_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'openai-official', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'openai-official' AND type = 1 AND "group" = 'default');

-- apimart
INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 59, 'apimart', 'default',
  'gpt-image-2,gpt-image-2-official,gemini-3-pro-image-preview,gemini-3-pro-image-preview-official,'
  'doubao-seedance-2.0,doubao-seedance-2.0-apimart,doubao-seedance-2.0-face,doubao-seedance-2.0-face-apimart,'
  'doubao-seedance-2.0-fast,doubao-seedance-2.0-fast-apimart,doubao-seedance-2.0-fast-face,doubao-seedance-2.0-fast-face-apimart,'
  'gemini-2.5-flash-image-preview,gemini-2.5-flash-image-preview-apimart,gemini-2.5-flash-image-preview-official,'
  'gemini-2.5-pro,gemini-2.5-pro-apimart,gemini-3-pro-image-preview-apimart,'
  'gemini-3.1-flash-image-preview,gemini-3.1-flash-image-preview-apimart,gemini-3.1-flash-image-preview-official,'
  'kling-v2-6-motion-control,kling-v2-6-motion-control-apimart,kling-v3,kling-v3-apimart,'
  'kling-v3-motion-control,kling-v3-motion-control-apimart,kling-v3-omni,kling-v3-omni-apimart,'
  'veo3.1-fast,veo3.1-fast-apimart,wan2.7-videoedit,wan2.7-videoedit-apimart',
  '{"gpt-image-2-apimart":"gpt-image-2","gemini-2.5-pro-apimart":"gemini-2.5-pro",'
  '"gemini-2.5-flash-image-preview-apimart":"gemini-2.5-flash-image-preview",'
  '"gemini-3-pro-image-preview-apimart":"gemini-3-pro-image-preview",'
  '"gemini-3.1-flash-image-preview-apimart":"gemini-3.1-flash-image-preview",'
  '"veo3.1-fast-apimart":"veo3.1-fast","kling-v3-apimart":"kling-v3",'
  '"kling-v2-6-motion-control-apimart":"kling-v2-6-motion-control",'
  '"kling-v3-motion-control-apimart":"kling-v3-motion-control",'
  '"kling-v3-omni-apimart":"kling-v3-omni",'
  '"doubao-seedance-2.0-apimart":"doubao-seedance-2.0",'
  '"doubao-seedance-2.0-face-apimart":"doubao-seedance-2.0-face",'
  '"doubao-seedance-2.0-fast-apimart":"doubao-seedance-2.0-fast",'
  '"doubao-seedance-2.0-fast-face-apimart":"doubao-seedance-2.0-fast-face",'
  '"wan2.7-videoedit-apimart":"wan2.7-videoedit"}',
  1, 'https://api.apimart.ai', 'PLACEHOLDER_APIMART_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'apimart', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'apimart' AND type = 59 AND "group" = 'default');

-- magic666
INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 62, 'magic666', 'default',
  'gemini-2.5-flash-image,gemini-2.5-flash-image-magic666,'
  'gemini-2.5-flash-image-preview,gemini-2.5-flash-image-preview-magic666,'
  'gemini-3-pro-image-preview,gemini-3-pro-image-preview-magic666,'
  'gemini-3.1-flash-image-preview,gemini-3.1-flash-image-preview-magic666,'
  'gpt-5.5,gpt-image-2,gpt-image-2-pro',
  '{"gpt-image-2":"gpt-image-2-pro",'
  '"gemini-2.5-flash-image-magic666":"gemini-2.5-flash-image",'
  '"gemini-2.5-flash-image-preview-magic666":"gemini-2.5-flash-image-preview",'
  '"gemini-3-pro-image-preview-magic666":"gemini-3-pro-image-preview",'
  '"gemini-3.1-flash-image-preview-magic666":"gemini-3.1-flash-image-preview"}',
  1, 'http://152.53.38.70:3001', 'PLACEHOLDER_MAGIC666_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'magic666', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'magic666' AND type = 62 AND "group" = 'default');

-- packyapi-gpt5x
INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 1, 'packyapi-gpt5x', 'default',
  'gpt-5.2,gpt-5.2-high,gpt-5.2-low,gpt-5.2-medium,gpt-5.2-xhigh,'
  'gpt-5.3-codex,gpt-5.3-codex-high,gpt-5.3-codex-low,gpt-5.3-codex-medium,gpt-5.3-codex-xhigh,'
  'gpt-5.4,gpt-5.4-high,gpt-5.4-mini,gpt-5.5',
  NULL, 1, 'https://www.packyapi.com', 'PLACEHOLDER_PACKYAPI_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'packyapi', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'packyapi-gpt5x' AND type = 1 AND "group" = 'default');

-- rightcodes-draw
INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 60, 'rightcodes-draw', 'default',
  'gpt-image-2-rightcodes',
  '{"gpt-image-2-rightcodes":"gpt-image-2"}',
  1, 'https://www.right.codes/draw', 'PLACEHOLDER_RIGHTCODES_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'rightcodes', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'rightcodes-draw' AND type = 60 AND "group" = 'default');

-- rightcodes-draw-vip
INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 60, 'rightcodes-draw-vip', 'default',
  'gpt-image-2-vip',
  '{"gpt-image-2-vip":"gpt-image-2"}',
  1, 'https://www.right.codes/draw', 'PLACEHOLDER_RIGHTCODES_VIP_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 20, 0, 'rightcodes-vip', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'rightcodes-draw-vip' AND type = 60 AND "group" = 'default');

-- rightcodes-codex
INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 1, 'rightcodes-codex', 'default',
  'gpt-5.5',
  NULL, 1, 'https://www.right.codes/codex', 'PLACEHOLDER_RIGHTCODES_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'rightcodes', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'rightcodes-codex' AND type = 1 AND "group" = 'default');

-- wuyinkeji
INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 58, 'wuyinkeji', 'default',
  'gpt-image-2-suchuang',
  NULL, 1, 'https://api.wuyinkeji.com', 'PLACEHOLDER_WUYINKEJI_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'wuyinkeji', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'wuyinkeji' AND type = 58 AND "group" = 'default');

-- comfly
INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 1, 'comfly', 'default',
  'gpt-image-2',
  NULL, 1, 'https://api.comfly.chat', 'PLACEHOLDER_COMFLY_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'comfly', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'comfly' AND type = 1 AND "group" = 'default');

-- 147ai (image + VEO unified)
INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 63, '147ai', 'default',
  'gemini-3-pro-image-preview,gemini-3.1-flash-image-preview,gpt-image-2,'
  'gemini-3-pro-image-preview-147ai,gemini-3.1-flash-image-preview-147ai,gpt-image-2-147ai,'
  'veo3-fast,veo3-pro,veo3-pro-frames',
  '{"gemini-3-pro-image-preview-147ai":"gemini-3-pro-image-preview",'
  '"gemini-3.1-flash-image-preview-147ai":"gemini-3.1-flash-image-preview",'
  '"gpt-image-2-147ai":"gpt-image-2"}',
  1, 'https://api1.147ai.com', 'PLACEHOLDER_147AI_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 10, 100, '147ai', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = '147ai' AND type = 63 AND "group" = 'default');

-- kapon-speech (proxy)
INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 35, 'kapon-speech', 'default', '', NULL, 1, 'https://models.kapon.cloud', 'PLACEHOLDER_MINIMAX_API_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, NULL, NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'kapon-speech' AND type = 35 AND "group" = 'default');

-- minimax-music (proxy)
INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 35, 'minimax-music', 'default', '', NULL, 1, 'https://api.minimaxi.com', 'PLACEHOLDER_MINIMAX_MUSIC_API_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, NULL, NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'minimax-music' AND type = 35 AND "group" = 'default');

-- ark (proxy — seedream image + seed3d)
INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 1, 'ark', 'default',
  'doubao-seedream-5-0-260128,doubao-seedream-4-5-251128,doubao-seedream-4-0-250828,doubao-seed3d-2-0-260328',
  NULL, 1, 'https://ark.cn-beijing.volces.com/api/v3', 'PLACEHOLDER_ARK_API_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, NULL, NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'ark' AND type = 1 AND "group" = 'default');

-- watcha (proxy)
INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 1, 'watcha', 'default', '', NULL, 1, 'https://tokendance.agent-universe.cn/gateway/ark', 'PLACEHOLDER_WATCHA_SEEDREAM_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, NULL, NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'watcha' AND type = 1 AND "group" = 'default');

-- tencent (proxy)
INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 1, 'tencent', 'default', '', NULL, 1, '', 'PLACEHOLDER_TENCENT_SECRET_KEY_PAIR',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, NULL, NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'tencent' AND type = 1 AND "group" = 'default');

-- remove-bg (proxy)
INSERT INTO channels (type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override)
SELECT 1, 'remove-bg', 'default', '', NULL, 1, 'https://api.remove.bg', 'PLACEHOLDER_REMOVE_BG_API_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, NULL, NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'remove-bg' AND type = 1 AND "group" = 'default');

COMMIT;
