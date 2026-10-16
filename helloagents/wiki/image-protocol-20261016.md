# 101 ToAPIs 图片协议与格式修复（2026-10-16）

## 生产证据

UTC 2026-10-14 15:36:30 起的 48 小时快照，渠道 31 共 1409 个唯一图片请求，1208 成功、201 失败：参数错误 116（103 个受理后 invalid_input、13 个直接 400）、审核 29、处理失败 21、繁忙 17、超时 7、轮询中断 8、参考图超限 2、提交核账中 1。

103 个 invalid_input 均有同规格成功记录，其中 56 个存在完全相同上游 JSON 的成功记录。不能将其全部认定为固定参数错误，也不能承诺代码补丁消除供应商失败。日志没有明确 unsupported/dimensions 原文；ToAPIs 返回泛化中文错误，按原 task ID 查询两例也没有更细原因。

明确本地缺口：VIP 按统一长边生成部分过大/过小尺寸；Gemini 3 Pro 参考图未进入准备服务；参考图只按字节门限判断、未知格式可能直接透传；Gemini 部分型号 metadata 被摊平；状态查询遇到单次临时错误过早结束。

## 修复合同

- VIP 的比例和 1K/2K/4K 输入按 ToAPIs 标准 GPT 尺寸表转换，替代统一 4096 长边推算。覆盖十种比例和三档分辨率，包含官方舍入像素；重复归一化保持分辨率与价格。显式像素不重采样。这是 Tanva 的规格映射，不是供应商自定义像素范围保证。
- 标准表决定标准像素的零售档位（如 2880×2880 为 4K、2016×864 为 1K）；自定义像素保留原长边分档，显式档位与像素冲突仍明确返回参数错误，不改写历史账本。
- ToAPIs Gemini 按各型号文档保留嵌套 metadata，保留显式 false 和原生扩展；普通 GPT 2.5 明确 high，移除通用 APIMart 的重复 aspect_ratio。其他 APIMart 渠道不改变合同，official_fallback 的显式语义保留。
- Gemini 普通 2.5/3 Pro/3.1、Nano 2.1 普通及 official 的已知输入合同采用 10,000,000 字节及 JPEG/PNG/WebP。这覆盖 10/14 依赖服务端 20MiB 拒绝阈值的旧约定，腾讯旧 stable/ultra 路线继续隔离。
- 合规 HEAD 保留原 URL；未知/不支持格式有界下载并检查真实格式，能解码的单帧 AVIF/TIFF/GIF 转为远程 PNG/JPEG 派生资产，保留透明度、方向与当前渲染资源含义。无法无歧义转换的多帧明确失败，不静默取首帧。原素材不覆盖，不持久化 base64，不进入图片识别链路。GPT 2.5 没有公开格式/大小合同，不为其臆造限制；GPT 2 保留既有 50MB 字节合同。
- ToAPIs 初始状态查询间隔至少 5 秒并加抖动；网络错误、429、5xx 可继续 GET 原 task ID，遵循 Retry-After 秒数或 HTTP-date。等待与请求均受原取消信号和总截止时间约束，不重 POST；超时保留未确认回执及原计费核账语义。

## 官方来源（本轮实际读取 Markdown）

- [GPT 标准尺寸表](https://docs.toapis.com/docs/cn/api-reference/images/gpt-image-2/generation.md)、[GPT Image 2.5 普通](https://docs.toapis.com/docs/cn/api-reference/images/gpt-image-2.5/generation.md)、[VIP](https://docs.toapis.com/docs/cn/api-reference/images/gpt-image-2.5-vip/generation.md)。
- [Gemini 3.1](https://docs.toapis.com/docs/cn/api-reference/images/gemini-3.1-flash/generation.md)、[3 Pro](https://docs.toapis.com/docs/cn/api-reference/images/gemini-3-pro-image/generation.md)、[2.5](https://docs.toapis.com/docs/cn/api-reference/images/gemini-2.5-flash/generation.md)。
- [Nano 2.1](https://docs.toapis.com/docs/cn/api-reference/images/gemini-nano-banana-2.1/generation.md)、[Nano 2.1 official](https://docs.toapis.com/docs/cn/api-reference/images/gemini-nano-banana-2.1-official/generation.md)、[任务状态](https://docs.toapis.com/docs/cn/api-reference/tasks/image-status.md)。

## 验证

后端生产构建、真实参考图格式/大小测试、Provider 三入口参数回归通过；网关 DTO/APIMart/task 相关完整测试及 8 包定向回归通过（types/service 在定向表达式下只完成编译）。300 组比例/质量/档位连续三遍归一化与价格一致性，429/503/截断响应、Retry-After 两种形式及溢出、取消和慢 HTTP 截止时间回归通过。

六次独立中性文本直连验证均完成，质量 high，实际 PNG 文件头尺寸与请求一致：Sunburst VIP 3840×2160、2160×3840、3312×2480；Flare VIP 2880×2880、864×1536、3520×2336。上游总成本 USD 0.529032，无用户素材、无用户钱包扣款、无历史任务重投。这不代表每个比例/质量组合都实测通过。

真实 Gemini 3 Pro 两条失败的同一张 22,685,696 字节 PNG，在无上传/无生成的预检中转为 3,628,589 字节 JPEG，4096×4096 保持，原图全不透明；每条请求另一张合规参考图直接保留 URL。

证据目录：101 `/opt/tanva-releases/image-protocol-20261016/`，审计安全摘要在 `audit/safe-final-audit.json`，样例实图验收在 `probes/acceptance.json`，真实参考图预检在 `precheck/real-reference-evidence.json`。原始材料受保护，不复制到代码仓库。

## 101 发布

代码提交 `2266da29da5475423fa938735ccf8dc00bca07ea` 已推送并同步 101。按该提交隔离编译后端与 Linux amd64 网关，网关内嵌管理页面的 141 个文件与上一版哈希一致；没有发布前端或运行数据库迁移。

UTC 2026-10-16 15:50:15 完成发布：暂停图片队列时 active=0、近期网关未结请求=0，备份并只替换后端参考图准备服务的 JS/声明两个文件及网关镜像。镜像为 `backend-new-api:image-protocol-20261016`，二进制 SHA256 `8b525b5d6bbf4a345a338517423075f923e6ce8c7d54fedcb028c301c8b03c86`；环境变量与旧容器完全一致。后端 PM2 reload、内网网关/后端及公网后端健康检查通过，产物哈希一致，图片队列已恢复。

回退模块：`/opt/tanva-backups/image-protocol-20261016/backend/dist`；旧镜像 `backend-new-api:image-rootfix-20261014`。发布前校验原产物哈希和干净源码，持有部署锁，脚本含健康失败回退。发布回执 `deployment.json`。

## 上线后的真实链路验收

通过生产已部署的 NewApiProvider 和参考图准备服务发起两笔独立中性样例，不走用户钱包、不重跑历史节点：

| 用例 | 实际结果 | 网关 request ID |
| --- | --- | --- |
| Gemini 3 Pro 1K + 单帧 GIF | GIF 392 字节 → 687 字节托管 PNG，参考图仍 256×256；生成 1024×1024 PNG，约 92 秒 | `202610161550237425959858268d9d6j1aWEw9H` |
| Sunburst VIP high / 4K / 9:16 | 转为 2160×3840 像素请求，实际输出 2160×3840 PNG，约 46 秒 | `20261016155023182502118268d9d687tkqWOO` |

两笔均 channel 31、唯一 type=2 消费日志；网关记账分别 CNY 0.4 / 0.8，未修改用户业务钱包。真实 trace 确认 Gemini 只有 `metadata.resolution=1K`，VIP 使用像素 size、无 resolution/aspect_ratio，保留 `official_fallback=false`。`gateway-acceptance/acceptance.json` 的 allPassed=true，`gateway-receipts.json` 的 allSettled=true。上线后容器 healthy、重启次数 0，内外网健康及后端产物哈希再次通过。
