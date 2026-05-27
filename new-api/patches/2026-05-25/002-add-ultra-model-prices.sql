-- 002-add-ultra-model-prices.sql
-- Purpose: 为 beqlee 极速渠道的 ultra 模型补充 ModelPrice，消除 relay 层
--   "模型价格未配置" 400 错误。
--
-- 定价基准（人民币:美元 = 1:1，仅用于 new-api 内部 quota 扣减）：
--   gemini-3-pro-image-preview-ultra   1K = 1.0 元/USD  （官方 0.91 × 1.1 ≈ 1.001）
--   gemini-3.1-flash-image-preview-ultra 1K = 0.5 元/USD （官方 0.455 × 1.1 ≈ 0.50）
--
-- 用法：仅补充缺失 key（新 key 优先），已有自定义价格不被覆盖。
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

UPDATE options
SET value = (
  '{"gemini-3-pro-image-preview-ultra": 1.0, "gemini-3.1-flash-image-preview-ultra": 0.5}'::jsonb
  || COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb)
)::text
WHERE key = 'ModelPrice';

\echo '----- ModelPrice: ultra 模型补齐结果 -----'
SELECT
  value::jsonb -> 'gemini-3-pro-image-preview-ultra'      AS pro_ultra,
  value::jsonb -> 'gemini-3.1-flash-image-preview-ultra'  AS flash_ultra,
  value::jsonb -> 'nano-banana-pro'                        AS nano_pro_ref,
  value::jsonb -> 'nanobanana2'                            AS nano2_ref
FROM options WHERE key = 'ModelPrice';

COMMIT;
