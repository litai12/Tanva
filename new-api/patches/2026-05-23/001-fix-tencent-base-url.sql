-- 001-fix-tencent-base-url.sql
-- Purpose: correct the tencent channel base_url to the VOD AIGC endpoint.
--
-- Background: the tencent channel (id=22) was provisioned with
-- base_url='https://hunyuan.tencentcloudapi.com' (Tencent Hunyuan AI),
-- but the models it serves (tencent-vod-os, tencent-vod-seedance,
-- tencent-vod-vidu, and the VOD-proxied gemini/gpt-image-2 variants) all
-- go through the Tencent VOD AIGC gateway at vod.tencentcloudapi.com.
-- The wrong endpoint caused every request to fail silently, so new-api
-- always fell back to apimart even though tencent had priority=99999 in
-- the vip group.
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

UPDATE channels
SET base_url = 'https://vod.tencentcloudapi.com'
WHERE name = 'tencent'
  AND base_url = 'https://hunyuan.tencentcloudapi.com';

\echo ''
\echo '----- tencent channel base_url after patch -----'
SELECT id, name, base_url, status, "group", priority
FROM channels
WHERE name = 'tencent';

COMMIT;
