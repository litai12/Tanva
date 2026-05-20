-- reset-channels.sql
-- One-time manual reset: hard-delete all channels and their abilities,
-- then let the patch container re-apply all patches cleanly.
--
-- Run ONCE manually before restarting the patch container:
--   psql $DATABASE_URL -f patches/reset-channels.sql
--
-- DO NOT place this file inside a date subdirectory — it must not be
-- picked up by the automatic patch runner.

BEGIN;

DELETE FROM abilities;
DELETE FROM channels;

-- Reset the sequence so IDs start from 1 again (optional, cosmetic).
-- ALTER SEQUENCE channels_id_seq RESTART WITH 1;
-- ALTER SEQUENCE abilities_id_seq RESTART WITH 1;

COMMIT;
