-- 006-add-missing-chat-model-pricing.sql
-- Purpose: 后端文本/分析链路（providerDefaultTextModels）会经 new-api 调用
--   gemini-3.1-pro 与 gemini-2.5-flash，但 new-api 的 ModelRatio / ModelPrice
--   都没有这两个模型 → relay 报「模型价格未配置」400 → 视频分析的总结步整体失败。
--
-- Fix: 按 new-api 里已配置的同系同档模型补齐 ModelRatio：
--   gemini-2.5-flash ← 对齐 flash 档 gemini-3-flash-preview (0.075)
--   gemini-3.1-pro   ← 对齐 pro 档 gemini-3.1-pro-preview (0.625)
-- 后端按「积分/功能」单独计费、与上游 1:1（1 元≈1 美元），这里只需让 new-api
-- 不再判定「未配置」。仅补缺失键（existing wins），不覆盖任何已有定价。
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

UPDATE options
SET value = (
  '{"gemini-2.5-flash": 0.075, "gemini-3.1-pro": 0.625}'::jsonb
  || COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb)
)::text
WHERE key = 'ModelRatio';

\echo ''
\echo '----- ModelRatio: 缺失模型补齐结果 -----'
SELECT
  value::jsonb -> 'gemini-2.5-flash'      AS gemini_2_5_flash,
  value::jsonb -> 'gemini-3.1-pro'        AS gemini_3_1_pro,
  value::jsonb -> 'gemini-3-flash-preview' AS sibling_flash,
  value::jsonb -> 'gemini-3.1-pro-preview' AS sibling_pro
FROM options WHERE key = 'ModelRatio';

COMMIT;
