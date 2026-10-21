# APIMart 与 ToAPIs 图片档位对齐（2026-10-21）

用户明确指定补充 9「apimart」渠道，以 31「toapis」现有图片档位为对照，不是把 ToAPIs 官网所有新模型导入 APIMart。生产渠道 9 使用 APIMart 国内地址 `https://api.aishuch.com`；本轮真实 `/v1/models` 已确认以下上游型号存在。

| 现有公共型号／计费身份 | APIMart 实际上游型号 | 附加参数 |
| --- | --- | --- |
| `gpt-image-2.5-flare` | `gpt-image-2.5-ext` | `version=flare` |
| `gpt-image-2.5-sunburst` | `gpt-image-2.5-ext` | `version=sunburst` |
| `gpt-image-2.5-flare-vip` | `gpt-image-2.5-flare` | 保留质量、像素尺寸 |
| `gpt-image-2.5-sunburst-vip` | `gpt-image-2.5-sunburst` | 保留质量、像素尺寸 |
| `gemini-nano-banana-2.1` | `gemini-nano-banana-2.1-ext` | 顶层 resolution |
| `gemini-nano-banana-2.1-official` | `gemini-nano-banana-2.1` | 顶层 resolution |

此对应基于官方版／Ext 版能力与供应商计费模式，不保证两家供应商的输出质量完全相同。APIMart 原生 GPT 2.5 和 Nano 2.1 按实际 token 计费，Ext 按分辨率／成功张数计费；Tanva 继续按已存在的公共 SKU 零售价收费，本次不修改 ModelPrice、分组倍率或历史账单。

## 官网核对

本轮实际读取的第一方来源：

- [APIMart GPT 2.5 Ext](https://docs.apimart.ai/cn/api-reference/images/gpt-image-2.5-ext/generation)
- [APIMart GPT 2.5](https://docs.apimart.ai/cn/api-reference/images/gpt-image-2.5/generation)
- [APIMart Nano Banana 2.1](https://docs.apimart.ai/cn/api-reference/images/gemini-nano-banana-2.1/generation)
- [ToAPIs 文档目录](https://docs.toapis.com/llms.txt)

APIMart 官方公开价格接口 `/api/pricing/model?model=...` 与国内地址返回一致。Ext GPT 两版本 paid prices 为 USD 0.0085/0.03/0.04（1K/2K/4K），Nano Ext 为 0.012/0.014/0.018；这些是供应商当时公开成本快照，不替换 Tanva 售价，也不能从原价统一乘 0.8 推算。官方档实际费用依 token 用量，本次不能以分辨率预估价冒充实际采购成本。

## 实现边界

- 六项渠道映射只解释一跳：公共 VIP → 原生型号后不能再次沿普通型号映射到 Ext；公共 official 与普通计费身份保持独立。仅对已核验的 APIMart 官方／国内地址及精确对应关系放行，ToAPIs 原有防误降档检查保留。
- APIMart Nano 使用顶层 resolution，不套 ToAPIs 嵌套 metadata；GPT Ext 根据原始公共型号锁定 version，官方档保留质量和尺寸。普通请求不自动开官方回退。
- 管理台候选同时合并数据库已配置的渠道模型，禁用渠道仍可编辑；不再仅依赖启动时的六款对话模型静态清单。候选展示不改变实际路由资格。
- 增量 SQL `new-api/patches/2026-10-21/001-apimart-image-tier-parity.sql` 仅补渠道 9 的六个公共型号、映射和现有分组能力，保留渠道状态、优先级、已有禁用记录、渠道 31 与所有价格；有冲突映射、缺失目录或价格时事务回滚。
- 不自动重跑用户任务；图片 POST 仍不重试。发布只涉及 new-api 网关和该增量配置，无 Tanva 前后端发布或业务数据库迁移。

## 验证与发布

本地两个适配包及 DTO 完整回归通过；relay/helper/controller/model 定向回归通过，覆盖一跳映射、计费身份、参数覆盖、元数据规格保留、HTTP 200/202 回执与管理台候选。真实隔离 PostgreSQL 补丁测试通过，覆盖首次并发、重复幂等、禁用保持、空身份、冲突映射及缺失目录/价格原子回滚。生产发布与实际生成回执待上线后补记。


### 101 实际发布

代码 `d3eb3bf9d7c1d3d26ff6c2c9ee4867a9b03a9d51` 已提交推送并同步101。UTC 2026-10-21 07:01:18 上线镜像 `backend-new-api:apimart-parity-20261021`；二进制 SHA256 `a953d25189d9a4c82cf3cc11f63e07f19a6dc2e36b8621edd1aa8f0c154b164f`。沿用已部署管理台静态产物，未发布 Tanva 前后端。

配置原生dump与目标字段快照保存于 `/opt/tanva-backups/apimart-parity-20261021/`。SQL先ROLLBACK预演再事务提交，仅新增9渠道六SKU对应的12条default/vip能力；其他渠道、完整价格选项和模型目录逐字段保持。等待active图片及近期未结网关请求均为0后切换，环境变量完全一致，队列已恢复，内外网健康及二进制哈希通过。

六次独立中性文本curl按管理员渠道9定向验收，均HTTP200并返回可访问PNG/JPEG。未重跑用户素材或节点，未扣Tanva用户业务钱包；网关测试账户正常产生各一笔账单。原公共model_name、真实上游型号、version、渠道9、唯一attempt和预期quota逐笔一致。

| 公共SKU | 秒 | 实际上游 | 网关quota |
| --- | ---: | --- | ---: |
| Flare普通 | 54.35 | gpt-image-2.5-ext / flare | 200000 |
| Sunburst普通 | 33.53 | gpt-image-2.5-ext / sunburst | 200000 |
| Flare VIP | 10.85 | gpt-image-2.5-flare | 100000 |
| Sunburst VIP | 10.99 | gpt-image-2.5-sunburst | 100000 |
| Nano2.1普通 | 18.92 | gemini-nano-banana-2.1-ext | 100000 |
| Nano2.1官方 | 23.66 | gemini-nano-banana-2.1 | 150000 |

均请求1K/1:1/n=1，VIP测试low；实际Ext PNG为1254×1254、VIP为1024×1024，Nano为JPEG。实测只覆盖这些规格，4K/质量及metadata差异由回归覆盖，不声称所有规格均实际生成。完整回执 `/opt/tanva-releases/apimart-parity-20261021/gateway-acceptance.json`，all_passed=true。
