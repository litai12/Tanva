-- 001-xiaot-agent-switch-online-domain.sql
-- Purpose: 把小T画布智能体渠道（name='xiaot-agent', type=1 OpenAI）切到线上域
--          https://tc.tanvas.cn/public，并（可选）换线上签发的 tc_sk key。
--
-- 背景:
--   小T线上 API 从 t-api.neospark.cn/public 迁到 tc.tanvas.cn/public
--   （studio 前端 = https://tc.tanvas.cn/studio?projectId=...）。
--   注意 t-api.tanvas.cn / tc-api.tanvas.cn 返回的是 mart 网关首页 HTML，
--   不是小T facade——实测只有 tc.tanvas.cn/public 返回真实 chat/completion。
--
-- 为什么不重跑 2026-07-13/001:
--   那个 patch 的 UPDATE 会把 models 冲成单个 'xiaot-agent'，而渠道现已扩到
--   4 个模型（xiaot-agent + 门面名 xiaot-agent-claude-4-8/-4-7/-4-6，见 P3/P5）。
--   本 patch 只改 base_url（+ 可选 key），**绝不触碰 models**。
--
-- 用法:
--   ① 手动切 key + base_url（推荐，key 不落文件经 psql 变量传入；值不带内层引号）:
--       docker exec -i tanva-new-api-postgres psql -U new_api -d new_api \
--         -v xiaot_key='tc_sk_xxx' \
--         -f - < patches/2026-07-15/001-xiaot-agent-switch-online-domain.sql
--     （可选覆盖域: 追加 -v xiaot_base='https://tc.tanvas.cn/public'）
--   ② 只刷 base_url、不改 key（例如 _apply.sh 无变量自动执行时）:
--       不传 xiaot_key → 自动跳过 key 更新，仅把 base_url 归位到线上域。
--
--   改完须 `docker restart tanva-new-api` 重载渠道内存缓存。
--   DB user/db = 容器 env new_api/new_api（非 root/oneapi）。
--
-- Scope: PostgreSQL only, data-only, 幂等（可重复执行，结果稳定）。不建表/不删数据。
-- 参照: patches/2026-07-13/001（同渠道的初始建立）。

\set ON_ERROR_STOP on

-- base_url 默认线上域；未显式传 -v xiaot_base 时用默认值。
\if :{?xiaot_base}
\else
  \set xiaot_base 'https://tc.tanvas.cn/public'
\endif

BEGIN;

-- ── Step 1: base_url（非机密，无条件归位到线上域）+ 确保启用 ──────────────────────
UPDATE channels
SET base_url = :'xiaot_base',
    status   = 1
WHERE name = 'xiaot-agent' AND type = 1;

-- ── Step 2: key（仅在通过 -v xiaot_key 传入时更新；models 一律不动）──────────────
\if :{?xiaot_key}
  UPDATE channels
  SET key = :'xiaot_key'
  WHERE name = 'xiaot-agent' AND type = 1;
  \echo '[xiaot-agent] key updated from -v xiaot_key'
\else
  \echo '[xiaot-agent] xiaot_key not provided — base_url refreshed only, key left unchanged'
\endif

-- ── Step 3: abilities 与渠道状态对齐（enabled 跟随 status=1）─────────────────────
UPDATE abilities a
SET enabled = (c.status = 1)
FROM channels c
WHERE c.name = 'xiaot-agent' AND c.type = 1 AND a.channel_id = c.id;

-- ── Verify ──────────────────────────────────────────────────────────────────────
\echo '----- xiaot-agent 渠道（models 应保持 4 个不变）-----'
SELECT id, name, type, status, base_url, left(key, 12) AS key_prefix, models
FROM channels WHERE name = 'xiaot-agent' AND type = 1;

\echo '----- abilities: xiaot-agent -----'
SELECT a."group", a.model, a.channel_id, a.enabled
FROM abilities a JOIN channels c ON c.id = a.channel_id
WHERE c.name = 'xiaot-agent' AND c.type = 1
ORDER BY a.model;

COMMIT;
