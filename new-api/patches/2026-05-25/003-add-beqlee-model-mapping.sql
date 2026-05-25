-- 003-add-beqlee-model-mapping.sql
-- Purpose: 为 beqlee-gemini 渠道补充 model_mapping，将 -ultra 后缀模型名
--   映射回 Gemini API 实际支持的模型名，消除 "not supported model" 500 错误。
--
-- Root cause: NestJS 在极速线路下给模型名追加 -ultra 后缀（用于 new-api 路由
--   隔离），但 beqlee 代理透传给 Google Gemini API 时需要使用原始模型名。
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

UPDATE channels
SET model_mapping = '{"gemini-3-pro-image-preview-ultra": "gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview-ultra": "gemini-3.1-flash-image-preview"}'
WHERE name = 'beqlee-gemini' AND type = 24;

\echo '----- beqlee-gemini model_mapping after patch -----'
SELECT id, name, type, left(model_mapping, 120) AS model_mapping
FROM channels
WHERE name = 'beqlee-gemini' AND type = 24;

COMMIT;
