# ToAPIs 视频生成模型目录

更新时间：2026-07-18。来源为 [ToAPIs 文档索引](https://docs.toapis.com/llms.txt)及各模型 `generation.md` 页面。

统一接口：

- 提交：`POST https://toapis.com/v1/videos/generations`
- 查询：`GET https://toapis.com/v1/videos/generations/{task_id}`
- 响应：OpenAI 风格 flat `generation.task`，状态为 `queued`、`in_progress`、`completed`、`failed`
- 输入图片/视频必须是公网 URL，不接受裸 base64

## 已注册的生成模型

| 系列 | 精确 model ID |
| --- | --- |
| Doubao Seedance 1.x | `doubao-seedance-1-5-pro`, `doubao-seedance-1-0-pro-fast`, `doubao-seedance-1-0-pro-quality` |
| Gemini Omni Flash | `gemini_omni_flash` |
| Grok Video | `grok-video-1.5-preview`, `grok-video-3` |
| HappyHorse | `happyhorse-1.1` |
| Kling | `kling-v2-6`, `kling-3.0-turbo`, `kling-v3`, `kling-v3-omni`, `kling-video-o1` |
| MiniMax Hailuo | `MiniMax-Hailuo-02`, `MiniMax-Hailuo-2.3`, `MiniMax-Hailuo-2.3-Fast` |
| Seedance 2 | `seedance-2`, `seedance-2-fast`, `seedance-2-mini` |
| Sora 2 | `sora-2-official`, `sora-2-vvip` |
| Veo 3.1 | `Veo3.1-fast-official`, `Veo3.1-quality-official`, `veo3.1-fast`, `veo3.1-lite`, `veo3.1-quality` |
| Vidu Q3 | `viduq3`, `viduq3-pro`, `viduq3-turbo` |
| Wan 2.6 | `wan2.6`, `wan2.6-flash` |

不在本次生成模型目录中的操作型接口：Grok/Sora remix、Grok extend、Sora persona、Seedance avatar。这些接口不是标准 `generation` 任务，不能只靠增加 model ability 接入。

## Kling v3 Omni 重点约束

来源：[Kling v3 Omni 视频生成](https://docs.toapis.com/docs/cn/api-reference/videos/kling-v3-omni/generation)

- 固定模型：`kling-v3-omni`
- `mode=std` 为 720P，`mode=pro` 为 1080P
- `duration`：3–15 秒整数档
- 常用画幅：`16:9`、`9:16`、`1:1`
- `audio=true` 与 `video_list` 互斥
- 参考视频最多一段
- Omni prompt 引用语法：`<<<image_N>>>`、`<<<video_N>>>`、`<<<element_N>>>`
- 图片放 `metadata.image_list`；角色/主体放 `metadata.element_list`；视频放顶层 `video_list`
- 列表顺序必须与 prompt 中占位符编号一致，网关不会自动补占位符

## 代表性时长/分辨率约束

| 模型 | 时长 | 分辨率/模式摘要 |
| --- | --- | --- |
| `kling-v2-6` | 5/10 秒 | std/pro；普通参考图与首尾帧语义分开 |
| `kling-3.0-turbo` | 3–15 秒 | 720p/1080p |
| `kling-v3`, `kling-v3-omni` | 3–15 秒 | std=720P，pro=1080P |
| `kling-video-o1` | 3–10 秒 | 推理增强；支持图片、元素及参考视频语义 |
| `MiniMax-Hailuo-02` | 6/10 秒 | 768P/1080P |
| `MiniMax-Hailuo-2.3*` | 6/10 秒 | 768P/1080P，Fast 为独立 model ID |
| `seedance-2*` | 依模型/输入模式 | 480p/720p；多模态参数以模型页为准 |
| `viduq3*` | 依 Q3 SKU | 540p/720p/1080p；支持首尾帧、参考生成、Subjects |
| `wan2.6*` | 依输入模式 | 720p/1080p；Flash 为独立 model ID |

数据库注册脚本：`patches/2026-07-18/001-add-toapis-video-models.sql`。脚本只为缺失模型写入通用参数定义，已有模型的精细 `params_def` 和价格不会被覆盖。实际开放前仍应在管理后台核对 ToAPIs 账户支持范围与商业价格。
