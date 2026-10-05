-- PostgreSQL, data-only, idempotent. Requires the accompanying Go dynamic
-- peak/off-peak patch; do not apply alone to an old gateway binary.
-- Official CNY peak rates per million: input 2, output 8, cache hit .04.
-- ModelRatio uses input price / 2, therefore peak=1, off-peak=.5 in code.
-- These gateway numeric currency values are RMB. The accompanying display
-- patch uses the yuan symbol. Tanva adds the retail 1.5 markup separately.
-- Scope: three public Flash names only; XiaoT fixed billing is preserved. No channel,
-- key, model mapping, other model, group ratio or global currency changes.

BEGIN;

INSERT INTO options (key, value)
VALUES
  ('ModelRatio', '{"deepseek-v4.1-flash":1,"deepseek-flash":1,"deepseek-v4-flash":1}'),
  ('CompletionRatio', '{"deepseek-v4.1-flash":4,"deepseek-flash":4,"deepseek-v4-flash":4}'),
  ('CacheRatio', '{"deepseek-v4.1-flash":0.02,"deepseek-flash":0.02,"deepseek-v4-flash":0.02}')
ON CONFLICT (key) DO UPDATE
SET value = (COALESCE(NULLIF(options.value, ''), '{}')::jsonb || EXCLUDED.value::jsonb)::text;

-- Token billing is bypassed whenever ModelPrice contains the model. Remove
-- only these three obsolete fixed-price keys, preserving every unrelated key.
UPDATE options
SET value = (COALESCE(NULLIF(value, ''), '{}')::jsonb
  - 'deepseek-v4.1-flash' - 'deepseek-flash' - 'deepseek-v4-flash')::text
WHERE key = 'ModelPrice';

COMMIT;
