# 2026-11-03 101：远程参考图像素上限 / DeepSeek 官方渠道繁忙

## 1. 「无法准备远程参考图…不超过 64MiB」

- 现象：用户 e0e6a785 的 Nano 2.1 官方（stable 线路，10 MB 参考图限额）三次 `POST /api/ai/generate-image` 都在 1.1–1.4s 内失败，积分已退回。
- 根因：参考图 1 为 9999×5005 JPEG（12.9 MB），即 50.0M 像素，超过 `image-reference-preparation.service.ts` 的 `MAX_INPUT_PIXELS=40_000_000`。sharp 报 `Input image exceeds pixel limit`，被 catch 统一包装为「64MiB」提示，误导排查。图 2 为 6000×3000（19.2 MB），本身可以处理。
- 修复：
  - 参考图准备的像素上限改为 100M（约 10000×10000；sharp 默认上限为 268M）。`watermark.util` 和 PM2 的 `SHARP_LIMIT_INPUT_PIXELS=40000000` 不受影响。
  - 超过像素上限时提示「参考图像素过大（超过 100 MP）」，不再提示 64MiB。
  - 超过字节限额的 JPEG 源不再先做整幅无损 PNG（体积只会更大），直接走 JPEG/等比缩小。PNG/透明图逻辑不变。
- 101 实测（单进程）：峰值 RSS 约 13 B/像素，50MP 约 660 MiB、18MP 约 290 MiB；仍受 `withSlot` 并发 2 约束。50MP 图从 4.9s 降到 0.7s，原尺寸输出 JPEG 5.7 MB，保持 9999×5005。
- 部署：本地 build 后与线上 dist 对比，差异只有本次改动，单文件替换 `dist/ai/services/image-reference-preparation.service.js`（sha256 `a74fefb6…7e2f`）。旧文件备份在 `/opt/tanva-backups/ref-pixel-limit-20261103/`。在 ImageTask 无 queued/processing 时执行 `pm2 reload tanvas-api` 和 `pm2 save`，内外网 health 200。用线上 dist 对用户的两张原图做 prepare（OSS 上传打桩）：12.9 MB→5.7 MB，19.2 MB→8.4 MB，均为原尺寸。
- 测试：`npm run test:image-reference-preparation` 新增 50MP 通过、>100MP 明确报错、超限 JPEG 不走 PNG 三项。

## 2. Prompt Optimizer「文本请求超时（120秒）」

- 链路：`/api/ai/text-chat` → new-api（`localhost:4458`）→ `deepseek-v4.1-flash`。渠道 49 `deepseek-official`（priority 1000）优先，渠道 51 `lluban-chat`（priority 0）作为回退。
- 17:49–17:58（北京时间）渠道 49 过载：
  - 部分请求直接返回 `503 Service is too busy`，new-api 自动重试到渠道 51，3–5s 成功。
  - 已接受的请求则很慢：约 200 个输出 token 分别耗时 147s 和 32s。new-api 的 `RELAY_TIMEOUT=1200`，不会提前切换渠道，前端 120s 超时；后端 152s 后回包，出现 `ERR_STREAM_PREMATURE_CLOSE`。
- 平时渠道 49 为 1–4s；10:07 UTC 复测 0.8s，已恢复。未修改网关渠道配置。
