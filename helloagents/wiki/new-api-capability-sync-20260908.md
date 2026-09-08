# new-api 兼容能力同步（2026-09-08）

## 来源与设计

来源：`/Users/libiqiang/workspace/TapCanvas-pro/apps/new-api`。继 token 按量计费修复后，定向迁移独立的协议兼容与流式处理能力，避免覆盖 Tanva 已有渠道编号、部署配置、媒体适配与业务积分合同。

## 已迁入

1. Chat → Responses 保留 `reasoning`/`reasoning_effort`、service tier、prompt cache key/retention、verbosity、工具 strict。显式 false 保留；reasoning effort 冲突时报错，不擅自追加 detailed summary。reasoning context 补齐 DTO。
2. Responses → Chat 允许正文与工具调用同时返回，不再因有正文而丢弃工具。缺少 tool_call_id 的工具结果明确拒绝，避免伪装成用户消息。
3. Responses SSE 识别 failed/error/cancelled 等终态及其真实错误；缺少终态时不作为成功结算。明确的 incomplete 终态保留真实 usage，允许部分输出按实际用量计费。
4. Responses SSE → JSON 聚合保留加密 reasoning、custom tool、未来字段及整数精度；合并已完成 output item 并去重。Tanva 的 Responses 与 Chat-via-Responses 入口在把上游 Content-Type 写入 IsStream 前执行聚合，使客户端 stream=false 不被上游 SSE 改写。
5. StreamScanner 保留调用前已有 StreamStatus，修复预先错误记录被清空的问题。
6. 远程媒体 token 估算不下载资源。已知图片仍用 520 token 估值，未知文件用现有 4096 估值；不改变原始远程引用。保留 Tanva 本地媒体读取失败的错误语义，不复制来源的静默降级行为。

## 验证

- `go test ./service/... ./relay/... ./dto ./common ./setting/ratio_setting`：service、openaicompat、relay、OpenAI、DTO、计费及现有图片/视频渠道测试通过；以下旧测试问题仍存在。
- Claude 三项旧文件转换测试失败：IgnoresUnsupportedFileContent / SupportsPDFFileContent / ConvertsTextFileContentToText。通过 Go overlay 恢复本次修改前的 DTO 后仍复现；本次未修改 Claude 文件转换。
- helper 并行测试存在共享 StreamingTimeout 配置互相覆盖，可能导致 non-positive interval for NewTicker。`go test ./relay/helper -parallel 1` 全部通过，含本次修复的 PreInitialized。
- 新增适配器集成回归验证 SSE 转 JSON 后 usage=18、未来字段及 JSON 响应类型均保留；OpenAI 包复测通过。
- `go build ./...` 通过；`git diff --check` 通过。
- 无付费上游调用、无数据库变更、无部署。

## 尚未迁移的大型模块

上游还包含账户池调度、Claude/Gemini OAuth、渠道协议抽象、用户/渠道折扣、管理台与图片交付计费重构。这些依赖账户表、协议字段、页面与迁移脚本，不适合直接覆盖。图片 SSE 源实现还会仅重序列化 created/model/data，迁入前应补充 usage 和错误终态保留，避免破坏按量计费证据。本次不声称已支持这些模块。
