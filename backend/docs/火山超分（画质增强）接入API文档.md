#火山超分 画质增强快速接入
curl -X POST 'https://mediakit.cn-beijing.volces.com/api/v1/tools/enhance-video' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer {Your_API_Key}' \
--data '{
  "video_url": "https://example.com/source_video.mp4",
  "tool_version": "standard"
}'

#火山超分，也就是画质增强接入教程
AI MediaKit 画质增强工具内置包含智能超分、智能插帧、画面增强、自适应锐化、色彩增强等 30+ 高质量原子算法的完备算子库，搭配视频内容理解与智能画质决策能力，为 AIGC、UGC、短剧、老片修复等场景提供一站式视觉质量提升方案。
本篇开发指南将引导您：

* 快速体验将一段 AI 生成的 720p 视频提升至 1080p。
* 通过轮询或事件回调两种方式获取处理结果。
* 理解画质增强工具的核心能力与应用场景。

<span id="ee813018"></span>
## 快速体验：将 AI 生成的 720p 视频提升至 1080p
本节演示如何将一段 AI 生成的低分辨率（720p）视频通过“标准版”工具提升至 1080p 高清画质。
<span id="a4617b8a"></span>
### 准备工作

1. **获取访问凭证**：在开始之前，访问 AI MediaKit 控制台 [API Key 管理页面](https://console.volcengine.com/imp/ai-mediakit/settings)，创建并获取 **MediaKit API Key**（用于媒体处理功能鉴权）。
2. **准备视频文件**：准备一个待增强的视频文件，并将其上传至公网可访问的服务器或[视频点播服务](https://www.volcengine.com/docs/4/2834?lang=zh)中，以获取可供 API 调用的 URL。若您尚未生成视频，请参考[火山方舟视频生成文档](https://www.volcengine.com/docs/82379/1366799?lang=zh)完成视频生成并获取视频地址。

<span id="a3dbe846"></span>
### 操作流程
画质增强是一个异步任务：

* 成功调用 `POST /api/v1/tools/enhance-video` 后，API 将返回一个任务 ID 。
* 您可以轮询 `GET /api/v1/tasks/{task_id}` ，直到任务状态`status` 变为 `completed`；或者使用[事件回调](/docs/6448/2288701)自动接收任务状态变化。
* 任务完成后，您可解析 `result` 字段，在 `video_url` 字段处获取最终生成的视频文件下载地址。

<span id="ab43d0c8"></span>
#### 第 1 步：提交任务
您需要调用[提交画质增强任务 API](/docs/6448/2279230) 提交画质增强任务。可直接复制以下 cURL 命令提交。
```Bash
curl -X POST 'https://mediakit.cn-beijing.volces.com/api/v1/tools/enhance-video' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer {Your_API_Key}' \
--data '{
  "video_url": "https://example.com/ai_720p.mp4",
  "scene": "aigc",
  "resolution": "1080p"
}'
```

:::tip
需替换参数：

* 将 `{Your_API_Key}` 替换为您的有效 API Key。
* `-d` 部分是 JSON 请求体，您可以直接修改其中的关键参数来自定义您的视频：
   * `video_url`：替换为您真实的 720p 视频地址。
   * `scene`：指定场景为 `"aigc"` 以获得该场景的最佳效果。

:::
请求成功后，您会收到如下包含 `task_id` 的响应，请保存此 ID 用于后续查询。
```JSON
{
  "success": true,
  "task_id": "amk-tool-enhance-video-1703200",
  "request_id": "20260415150000F6DE4C24A6A0D94B7FF1"
}
```

<span id="78fb605b"></span>
#### 第 2 步：获取结果
画质增强属于高计算量任务，需要一定处理时间（可参考[任务耗时预估](/docs/6448/2279961#917d68df)）。您需要轮询[查询任务信息 API](/docs/6448/2278532)，直到任务状态 `status` 变为 `completed`。
```Bash
curl -X GET 'https://mediakit.cn-beijing.volces.com/api/v1/tasks/{task_id}' \
--header 'Authorization: Bearer {Your_API_Key}'
```

:::tip
需替换参数：将 URL 末尾的 `{task_id}` 替换为第 1 步返回的任务 ID。
:::
当任务成功完成后，您将收到如下响应。`result` 字段是一个 JSON 对象，您可以直接从其下的 `video_url` 字段获取增强后视频的下载地址（默认输出为 **MP4** 格式，有效期为 **48** 小时）。
```JSON
{
    "success": true,
    "task_id": "amk-tool-enhance-video-1755136",
    "task_type": "enhance-video",
    "status": "completed",
    "result": {
        "duration": 5.967,
        "fps": 30.168,
        "resolution": "1080p",
        "tool_version": "standard",
        "video_url": "https://example.volcvideo.com/enhanced_video.mp4?auth_key=..."
    },
    "expires_at": 1775960452,
    "created_at": 1775787510,
    "finished_at": 1775787652,
    "request_id": "20260410102611A2F6BCCB40A5B534A302"
}
```

<span id="9c960d69"></span>
## 进阶使用
在完成快速体验后，您可以利用更多参数来定制画质增强的效果，以满足更复杂的业务需求。
<span id="e7831876"></span>
### 工作原理
AI MediaKit 画质增强工具的工作流程是一个“分析\-决策\-执行”的闭环智能系统，不仅应用一系列独立的算法，更通过对视频内容的深度理解来动态选择合适的增强策略。
<span>![图片](https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/f3c635cf1bf14d82a41e03079aae6717 =800x) </span>
其核心流程包含以下四个关键阶段：

1. **智能分析**：系统首先会对视频进行镜头级分割，然后对每个镜头进行深度内容理解和技术诊断。此阶段会提取数十种特征，包括：
   * **内容特征**：识别视频中的人脸、主体物、场景类型（室内/室外、白天/黑夜）等。
   * **画质特征**：检测视频的清晰度、色彩饱和度、噪声水平、压缩失真程度等。
2. **策略生成**：基于上一步的分析结果，并结合您通过 `scene` 或 `tool_version` 参数指定的业务意图，系统会从其包含 30+ 原子算法的算子库中，动态生成合适的算子组合。
3. **画质增强**：在此阶段，系统执行生成的策略，对视频进行像素级的精细化处理。这包括但不限于智能超分、智能插帧、画面降噪、色彩增强、自适应锐化等一系列操作。
4. **质量监控与编码**：增强处理并非终点。系统会内置智能检测模块，通过画质评分算法评估增强效果，确保输出的视频在主观体验上达到最佳。最后，在不损失画质的前提下，对视频进行高效压缩编码，以生成最终的视频文件。

<span id="e950d319"></span>
### 版本与场景
您可以在提交任务时通过 `tool_version` 和 `scene` 指定对应的场景，以选择预设的画质增强策略。
<span id="162abb6b"></span>
#### 版本说明及示例
画质增强提供两个版本。专业版相比标准版，投入的算力资源多出数倍，请务必根据画质需求与预算谨慎选择。

|特性 |标准版 (`standard`) |专业版 (`professional`) |
|---|---|---|
|定位 |平衡速度与画质（性价比优先），覆盖主流播放平台画质要求。 |极致增强（效果优先），保障镜头级画质效果。 |
|算法密度 |内置 10+ 常用算法 |内置 30+ 深度 AI 算法 |
|RTF 耗时 |1 分钟视频预计处理需 6 ～ 10 分钟 |1 分钟视频预计处理需 30 分钟以上 |
|成本（计费） |价格较低 |价格是标准版的 10\-20 倍 |

效果示例：
<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/ab669b319ae245c8b1a164596f3cf3de" controls></video>

选型案例：处理一段 1 分钟的视频，输出规格为 1080p、30fps。

* 选择标准版：
   * 耗时：预计等待 6\-10 分钟。
   * 费用：1 分钟 × 2（系数） × 0.75 = 1.5 元。
* 选择专业版：
   * 耗时：预计等待 30 分钟以上。
   * 费用：1 分钟 × 20（系数） × 0.75 = 15 元。

<span id="f9d9b44b"></span>
#### 场景说明及示例
画质增强工具针对不同的业务场景（如AIGC、短剧、UGC 短视频、老片修复等）提供了预设的优化模板。您可以在提交任务时通过 `scene` 参数指定对应的场景，以获取最佳的增强效果。

|**场景** |**`scene`** ** 值** |**效果说明与示例** |
|---|---|---|
|**AIGC 场景** |`aigc` |对大模型生成的低分辨率视频进行超分处理，使其达到 2K 或 4K 分辨率，同时对生成视频的细节进行重绘。|\
| | |<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/531067fa6e8b4e14a7c975dd6cd878ad" controls></video>|\
| | | |
|**短剧场景** |`short_series` |对剧中人像进行增强、细节强化，全面提升短剧的视觉表现力与沉浸感。|\
| | |<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/7411cbf1f4fd4368ab572183d6c7db52" controls></video>|\
| | | |
|**UGC 短视频场景** |`ugc` |修复短视频在多次压缩与传输过程中出现的模糊、块效应与色带失真等画质损伤。|\
| | |<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/d419cdbbdd8449d1885bcd970726b7f3" controls></video>|\
| | | |
|**老片修复场景** |`old_film` |针对老旧影片的各类瑕疵进行修复，涵盖基于运动补偿的时域去噪、划痕去除、消除闪烁、修正色偏等操作。|\
| | |<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/e76e92d257984781b54ad41ceb07a675" controls></video>|\
| | | |

<span id="2c00b2e4"></span>
#### 示例：使用专业版修复一部老电影
```JSON
{
  "video_url": "https://example.com/old_film.mp4",
  "scene": "old_film",
  "tool_version": "professional",
  "resolution": "4k"
}
```

<span id="14ceff34"></span>
### 配置输出分辨率
AI MediaKit 提供两种方式定义输出分辨率，两者互斥，不可同时配置。

|方式 |参数 |说明 |
|---|---|---|
|预设值 |`resolution` |适用于标准分发场景（如 `720p`、`1080p`、`4k`，最高支持 `4k`）。系统会自动将视频对齐到该预设规格。 |
|短边像素限制 |`resolution_limit` |适用于对产物尺寸有精确要求的工程场景。系统将锁定视频的**短边像素值**为设定值（范围 `[64, 2160]`），并在保持原视频宽高比的前提下，等比缩放至该限制值。示例：若原视频为 640x480 (4:3)，设置 `resolution_limit` 为 720，则输出视频的短边将提升至 720，宽度等比缩放至 960。 |

<span id="bd140419"></span>
#### 示例：锁定短边为 720 像素
```JSON
{
    "video_url": "https://example.com/source.mp4",
    "resolution_limit": 720 
}
```

<span id="356917e3"></span>
### 配置输出帧率（流畅度）
通过 `fps` 参数可以调整视频的帧率（最高支持 120 fps），实现智能插帧，使画面运动更加丝滑。

* 默认行为：若未指定 `fps` 参数，输出视频将保持与原始片源一致的帧率。
* 配置建议：帧率设置若设定的目标帧率高于原视频，系统将自动触发 AI 智能插帧算法。为了保持画面自然度并兼顾处理成本，建议输出帧率不超过原始帧率的 4 倍。

<span id="a87ff542"></span>
#### 示例：将视频智能插帧至 60fps
```JSON
{
    "video_url": "https://example.com/source.mp4",
    "fps": 60 
}
```

<span id="ba750d98"></span>
## 参考信息
<span id="917d68df"></span>
### 任务耗时预估
由于画质增强涉及深度学习模型推理，处理时长通常长于原片时长。您可以根据 **RTF (Real\-Time Factor)**  系数估算等待时间。计算公式为：预估处理耗时 = 视频时长 × RTF 系数

|工具版本 |RTF 具体数值参考 |耗时举例（以 1 分钟视频为例） |
|---|---|---|
|标准版 (standard) |6 ～ 10 |预计处理需 6 ～ 10 分钟 |
|专业版 (professional) |30 以上 |预计处理需 30 分钟以上 |

:::tip
实际耗时还受输入视频的分辨率、码率及当前系统排队情况影响。建议在生产环境配置[事件回调](/docs/6448/2288701)以实时接收完成通知。
:::
<span id="2135feb9"></span>
### 使用限制与性能

|**限制项** |**说明** |
|---|---|
|**输入视频限制** |* **视频来源**：仅支持公网可访问的 HTTP/HTTPS URL。|\
| |* **支持格式**：`mp4`, `flv`, `ts`, `avi`, `mov`, `wmv`, `mkv` 等主流视频格式。|\
| |* **文件大小**：建议单个输入文件大小不超过 10 GB。|\
| |* **输入视频分辨率**：最高支持 2K。 |
|**并发限制** |默认情况下，每个账户的并发处理任务数上限为 **20**。超出并发限制的新任务将自动进入队列等待。 |

<span id="3e559dc0"></span>
## 相关 API 文档

* [提交画质增强任务 API](/docs/6448/2279230)
* [查询任务信息 API](/docs/6448/2278532)
* [单任务执行完成事件](/docs/6448/2288701#98c8bf81)

