-- 003-set-seed3d-model-price.sql
-- Purpose: 为 doubao-seed3d-2-0-260328 配置 ModelPrice，修复 400 "价格未配置" 报错。
--
-- 定价依据: backend credits.config.ts convert-2d-to-3d = 300 积分 = ¥3.00
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

UPDATE options
SET value = (
  COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb)
  || '{"doubao-seed3d-2-0-260328": 3.0}'::jsonb
)::text
WHERE key = 'ModelPrice';

-- Verify
\echo '----- ModelPrice: doubao-seed3d-2-0-260328 -----'
SELECT value::jsonb -> 'doubao-seed3d-2-0-260328' AS price
FROM options WHERE key = 'ModelPrice';

COMMIT;
