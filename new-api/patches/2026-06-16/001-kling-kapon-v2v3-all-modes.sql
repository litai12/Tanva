-- 001-kling-kapon-v2v3-all-modes.sql
-- 普通线路 kling 全系列(v2-6 / v3 / o3)全模式走 kapon-kling 渠道(type 50, name='kapon-kling')。
--
-- 配套代码：
--   后端 video-provider.service.ts buildKaponKlingRequest 按历史 working 客户端构造 kapon
--     原生请求写入 payload.metadata.kapon = {suffix, body}，模型名用 kapon 专用名(见下)：
--       kling-v2-6  文生/单图/首尾帧 → kling/v1/videos/{text2video|image2video} model_name=kling-v2-6
--       kling-v2-6  多图            → kling/v1/videos/multi-image2video model_name=kling-v1-6(官方/历史仅此名)
--       kling-v3 / o3               → kling/v1/videos/omni-video  model_name=kling-v3-omni
--     命名元素(element_list)→ 发 kling-v3-omni-apimart 别名(仅 apimart 有 ability)走 apimart。
--   new-api relay/channel/task/kling/adaptor.go：kapon(sk-)分支读 metadata.kapon → 直发对应
--     端点；FetchTask 在 image2video/multi-image2video/omni-video(或 text2video)间探测轮询。
--
-- 路由：#433 服务 kling-v2-6 / kling-v3 / kling-v3-omni，优先级 1200(> apimart 1000，apimart 留回落)。
-- auto_ban=0：多图(kapon 暂无 kling-v1-6 货源会 503)与 element(canonical 别名会先撞 #433 再回落)
--   都会让 #433 偶发失败，关掉自动封禁避免误禁整条 kapon-kling。
-- apimart(type59)/vidu(type52) 不动。
--
-- 幂等：PostgreSQL only，可重复执行。
\set ON_ERROR_STOP on

BEGIN;

UPDATE channels
   SET models = 'kling-v2-6,kling-v3,kling-v3-omni', priority = 1200, auto_ban = 0
 WHERE name = 'kapon-kling' AND type = 50;

INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT g.grp, m.model, c.id, true, 1200, 0, 'kapon-kling'
  FROM channels c
  CROSS JOIN (SELECT unnest(string_to_array(c2.group_csv, ',')) grp
                FROM (SELECT "group" group_csv FROM channels WHERE name='kapon-kling' AND type=50) c2) g
  CROSS JOIN (VALUES ('kling-v2-6'), ('kling-v3'), ('kling-v3-omni')) AS m(model)
 WHERE c.name = 'kapon-kling' AND c.type = 50 AND trim(g.grp) <> ''
ON CONFLICT ("group", model, channel_id)
  DO UPDATE SET enabled = EXCLUDED.enabled, priority = EXCLUDED.priority;

COMMIT;
