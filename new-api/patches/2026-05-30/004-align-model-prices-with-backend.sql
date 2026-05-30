-- 004-align-model-prices-with-backend.sql
-- Purpose: 让 new-api 受管模型的 ModelPrice 与 backend 计费一致。
--          换算: 1元 = 100积分 = 1刀  →  ModelPrice(刀) = backend creditsPerCall / 100。
--
-- 对齐项(canonical 模型，backend 实际请求并计费的那个名字)：
--   - doubao-seedream-4-0-250828 / 4-5-251128 : backend seedream 30积分 → 0.3
--       (003-* 早先误设为 0.5，这里更正；与 doubao-seedream-5-0 的 0.3 对齐)
--   - midjourney-v7 / niji-7 / midjourney-niji-7 : backend midjourney-imagine 50积分 → 0.5
--       (优创 V7/Niji 受管模型预置价；适配器接好后即用)
--
-- 不动的：*-magic666 / *-147ai / *-official / *-apimart / *-ultra 等渠道变体价 ——
--   那是各上游真实成本的成本核算价，不参与"与 backend 一致"，保持原样。
--
-- 备注(需人工确认，未在本 patch 改)：doubao-seed3d-2-0-260328 现为 3.0，但 backend
--   convert-2d-to-3d 现为 200积分(应 2.0)。其 patch 写就时是 300积分。是否下调到 2.0
--   待确认，故本 patch 不动 seed3d。
--
-- Scope: PostgreSQL only, data-only, idempotent.

\set ON_ERROR_STOP on

BEGIN;

UPDATE options
SET value = (
  COALESCE(NULLIF(value, '')::jsonb, '{}'::jsonb)
  || '{
        "doubao-seedream-4-0-250828": 0.3,
        "doubao-seedream-4-5-251128": 0.3,
        "midjourney-v7": 0.5,
        "niji-7": 0.5,
        "midjourney-niji-7": 0.5
      }'::jsonb
)::text
WHERE key = 'ModelPrice';

-- ── Verify ────────────────────────────────────────────────────────────────────
\echo '----- 对齐后的 ModelPrice -----'
SELECT k AS model, (value::jsonb ->> k) AS price
FROM options,
     LATERAL (VALUES
       ('doubao-seedream-4-0-250828'), ('doubao-seedream-4-5-251128'),
       ('doubao-seedream-5-0-260128'),
       ('midjourney-v7'), ('niji-7'), ('midjourney-niji-7')
     ) AS m(k)
WHERE key = 'ModelPrice'
ORDER BY model;

COMMIT;
