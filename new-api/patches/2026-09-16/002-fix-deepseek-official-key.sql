-- Repair the channel key written by the first version of the official
-- DeepSeek patch. The runner passes this value as a quoted psql variable.

BEGIN;

UPDATE channels
SET key = :deepseek_key,
    status = 1,
    base_url = 'https://api.deepseek.com',
    priority = 1000,
    weight = 100,
    tag = 'deepseek-official'
WHERE name = 'deepseek-official'
  AND type = 43
  AND "group" = 'default';

COMMIT;
