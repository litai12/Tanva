# GPT-Image-2.5 ToAPIs 接入

- 新增独立型号 `gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`，共用节点键 `gptImage25`，名称 `GPT-Image-2.5`，默认 Flare，节点内下拉切换 Flare/Sunburst；渲染与执行复用 `gptImage2`，保留用户选择的真实型号。
- 后端托管模型目录与节点默认配置均注册两个型号，启动时补建缺失节点；前端离线目录同步提供兜底配置。
- 定价复用 GPT-Image-2 普通线路：1K 20 积分、2K 30 积分、4K 40 积分/张；参考图不额外计费。即使请求携带历史 stable/ultra 线路提示，ToAPIs 型号仍使用普通价格和普通网关 token，不使用 Tencent 质量档。
- 生成和参考图输入复用现有 New API → APIMart-compatible ToAPIs 链路，型号原样透传；图片输入只接受远程 URL。
- 网关数据库执行 `new-api/patches/2026-09-09/001-add-toapis-gpt-image-2-5.sql`：从 GPT-Image-2 克隆能力目录，追加到现有 type=59 且 Base URL 为 `https://toapis.com` / `https://toapis.xyz` 的渠道和分组。禁用渠道不会被启用。固定基础价格复制当前 `ModelPrice.gpt-image-2`，分辨率倍率使用已有 1/1.5/2 合同。
- 迁移是事务内幂等操作，缺少基础模型、ToAPIs 渠道或基础价格时明确失败。部署需要更新前后端和 new-api，并执行该 SQL、刷新/重启网关缓存。代码变更本身不代表生产数据库已迁移或已完成上游实测。

## 本地验证

- 前后端生产构建通过；GPT 生图参数/ToAPIs token 选择、各分辨率计价回归通过。
- new-api `model`、`dto`、`relay/channel/apimart`、`relay/channel/task/apimart` 测试通过，含两个型号独立路由身份及与 GPT-Image-2 相同的分辨率价格。
- 小T图片补丁合同 8 项通过；节点 schema 声明三个真实 model 枚举。GPT-Image-2.5 使用独立 `paletteVariantKey`，避免同属 gptImage2 渲染类型时被节点面板去重合并。
- 全量前端 lint 存量 2563 errors / 199 warnings；改动文件与 HEAD 对比未增加 lint 问题。
- 知识库与 Changelog 已同步；项目要求的 AI Metadata 同步脚本在本机缺失，未能执行。未运行生产数据库迁移或收费上游生成。

- 统一节点入口复用 GPT-Image-2 的画布组件、参数和图片历史；切换型号同时更新 model/managedModelKey，生成期间禁止切换。启动时隐藏早期 Flare/Sunburst 独立目录入口，已有画布节点保留原型号并显示统一标题与切换器。

- 运行时目录对 GPT 节点按 nodeConfigKey 隔离元数据；GPT-Image-2.5 不能覆盖 GPT-Image-2 的默认型号。统一目录、共享渲染类型、Flare 默认值、仅 Sunburst 启用时的选项与默认值检查通过。
