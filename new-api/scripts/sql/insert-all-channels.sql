-- insert-all-channels.sql
-- One-shot insert of ALL consolidated channels after a hard reset.
-- Run after reset-channels.sql empties the tables.
--
-- Keys with PLACEHOLDER_* → fill in via admin console after apply.
-- Keys from existing patches (yunwu, ark, packy) → copy from patch files or admin console.
--
-- Channel count: 18 channels (deduplicated, tencent-mps/vod + 147ai-veo removed)

BEGIN;

INSERT INTO channels (
  type, name, "group", models, model_mapping, status, base_url, key,
  created_time, test_time, priority, weight, tag, setting, param_override, header_override
) VALUES

-- ── yunwu 系列（同一 key，yunwu.ai）──────────────────────────────────────────
(24, 'yunwu-gemini', 'default',
  'gemini-2.5-flash-image,gemini-3-flash-preview,gemini-3-pro-image-preview,gemini-3.1-flash-image-preview,gemini-3.1-pro-preview',
  NULL, 1, 'https://yunwu.ai', 'PLACEHOLDER_YUNWU_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'yunwu-gemini', NULL, NULL, NULL),

(1, 'yunwu-openai-image', 'default',
  'doubao-seedream-5-0-260128',
  NULL, 1, 'https://yunwu.ai', 'PLACEHOLDER_YUNWU_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'yunwu-openai-image', NULL,
  '{"response_format":"url","watermark":false}', NULL),

(1, 'yunwu-openai-video', 'default',
  'kling-v3,kling-video-o1,veo_3_1,veo_3_1-fast,veo3.1-pro',
  NULL, 1, 'https://yunwu.ai', 'PLACEHOLDER_YUNWU_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'yunwu-openai-video', NULL, NULL, NULL),

(1, 'yunwu-openai', 'default',
  'gpt-5.4',
  NULL, 1, 'https://yunwu.ai', 'PLACEHOLDER_YUNWU_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'yunwu-openai', NULL, NULL, NULL),

-- ── Ark / 火山方舟（doubao）──────────────────────────────────────────────────
(54, 'ark-doubao-video', 'default',
  'doubao-seedance-2-0-260128,doubao-seedance-2-0-fast-260128',
  NULL, 1, 'https://ark.cn-beijing.volces.com', 'PLACEHOLDER_ARK_DOUBAO_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, NULL, NULL, NULL, NULL),

(45, 'ark-doubao-image', 'default',
  'doubao-seedream-5-0,doubao-seedream-5-0-lite,doubao-seedream-5-0-260128,doubao-seedream-5-0-lite-260128',
  '{"doubao-seedream-5-0":"doubao-seedream-5-0-260128","doubao-seedream-5-0-lite":"doubao-seedream-5-0-lite-260128"}',
  1, 'https://ark.cn-beijing.volces.com', 'PLACEHOLDER_ARK_DOUBAO_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 10, 100, 'ark-doubao-image', NULL,
  '{"watermark":false}', NULL),

(45, 'ark-deepseek', 'default',
  'deepseek-v4-flash-260425,deepseek-v4-pro-260425',
  NULL, 1, 'https://ark.cn-beijing.volces.com', 'PLACEHOLDER_ARK_API_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 10, 100, 'ark-deepseek', NULL, NULL, NULL),

-- ── 第三方代理渠道（各自独立 key）────────────────────────────────────────────
(1, 'openai-official', 'default',
  'gpt-image-2-official',
  '{"gpt-image-2-official":"gpt-image-2"}',
  1, 'https://api.openai.com', 'PLACEHOLDER_OPENAI_OFFICIAL_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'openai-official', NULL, NULL, NULL),

(59, 'apimart', 'default',
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
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'apimart', NULL, NULL, NULL),

(62, 'magic666', 'default',
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
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'magic666', NULL, NULL, NULL),

(1, 'packyapi-gpt5x', 'default',
  'gpt-5.2,gpt-5.2-high,gpt-5.2-low,gpt-5.2-medium,gpt-5.2-xhigh,'
  'gpt-5.3-codex,gpt-5.3-codex-high,gpt-5.3-codex-low,gpt-5.3-codex-medium,gpt-5.3-codex-xhigh,'
  'gpt-5.4,gpt-5.4-high,gpt-5.4-mini,gpt-5.5',
  NULL, 1, 'https://www.packyapi.com', 'PLACEHOLDER_PACKYAPI_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'packyapi', NULL, NULL, NULL),

(60, 'rightcodes-draw', 'default',
  'gpt-image-2-rightcodes',
  '{"gpt-image-2-rightcodes":"gpt-image-2"}',
  1, 'https://www.right.codes/draw', 'PLACEHOLDER_RIGHTCODES_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'rightcodes', NULL, NULL, NULL),

(60, 'rightcodes-draw-vip', 'default',
  'gpt-image-2-vip',
  '{"gpt-image-2-vip":"gpt-image-2"}',
  1, 'https://www.right.codes/draw', 'PLACEHOLDER_RIGHTCODES_VIP_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 20, 0, 'rightcodes-vip', NULL, NULL, NULL),

(1, 'rightcodes-codex', 'default',
  'gpt-5.5',
  NULL, 1, 'https://www.right.codes/codex', 'PLACEHOLDER_RIGHTCODES_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'rightcodes', NULL, NULL, NULL),

(58, 'wuyinkeji', 'default',
  'gpt-image-2-suchuang',
  NULL, 1, 'https://api.wuyinkeji.com', 'PLACEHOLDER_WUYINKEJI_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'wuyinkeji', NULL, NULL, NULL),

(1, 'comfly', 'default',
  'gpt-image-2',
  NULL, 1, 'https://api.comfly.chat', 'PLACEHOLDER_COMFLY_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, 'comfly', NULL, NULL, NULL),

-- ── 147AI（image + VEO 合并，同一渠道）────────────────────────────────────────
(63, '147ai', 'default',
  'gemini-3-pro-image-preview,gemini-3.1-flash-image-preview,gpt-image-2,'
  'gemini-3-pro-image-preview-147ai,gemini-3.1-flash-image-preview-147ai,gpt-image-2-147ai,'
  'veo3-fast,veo3-pro,veo3-pro-frames',
  '{"gemini-3-pro-image-preview-147ai":"gemini-3-pro-image-preview",'
  '"gemini-3.1-flash-image-preview-147ai":"gemini-3.1-flash-image-preview",'
  '"gpt-image-2-147ai":"gpt-image-2"}',
  1, 'https://api1.147ai.com', 'PLACEHOLDER_147AI_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 10, 100, '147ai', NULL, NULL, NULL),

-- ── new-api 透传代理渠道（后端 /proxy/:name/* 路由使用）──────────────────────
(35, 'kapon-speech', 'default', '', NULL, 1, 'https://models.kapon.cloud', 'PLACEHOLDER_MINIMAX_API_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, NULL, NULL, NULL, NULL),

(35, 'minimax-music', 'default', '', NULL, 1, 'https://api.minimaxi.com', 'PLACEHOLDER_MINIMAX_MUSIC_API_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, NULL, NULL, NULL, NULL),

(1, 'ark', 'default', '', NULL, 1, 'https://ark.cn-beijing.volces.com/api/v3', 'PLACEHOLDER_ARK_API_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, NULL, NULL, NULL, NULL),

(1, 'watcha', 'default', '', NULL, 1, 'https://tokendance.agent-universe.cn/gateway/ark', 'PLACEHOLDER_WATCHA_SEEDREAM_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, NULL, NULL, NULL, NULL),

(1, 'tencent', 'default', '', NULL, 1, '', 'PLACEHOLDER_TENCENT_SECRET_KEY_PAIR',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, NULL, NULL, NULL, NULL),

(1, 'remove-bg', 'default', '', NULL, 1, 'https://api.remove.bg', 'PLACEHOLDER_REMOVE_BG_API_KEY',
  EXTRACT(EPOCH FROM NOW())::bigint, 0, 0, 0, NULL, NULL, NULL, NULL);

COMMIT;

-- 验证
-- SELECT id, name, type, status, left(key,20) key_preview FROM channels ORDER BY name;
