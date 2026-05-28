# Image Task Async (Task API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 gemini 系列图片生成模型从同步轮询改为异步 Task API，new-api 在收到 APIMart task_id 后立即释放内存，Tanva backend 独立轮询任务状态。

**Architecture:** Tanva 调 new-api `/v1/image-tasks/generations` 提交任务，new-api 提交给 APIMart 后立即返回 task_id（< 1s），后台 task poller 轮询 APIMart 状态。Tanva 每 3s 调 `/v1/image-tasks/:task_id` 拿结果。整个过程 new-api 不再为图片任务持有 goroutine + buffer 长达 232 秒。

**Tech Stack:** Go (new-api task relay), TypeScript/NestJS (Tanva backend), APIMart Task API

---

## 改动文件一览

| 文件 | 类型 | 说明 |
|------|------|------|
| `new-api/router/video-router.go` | Modify | 新增 image task 路由 |
| `new-api/relay/channel/task/apimart/adaptor.go` | Modify | 支持 image action（提交 URL、JSON body） |
| `backend/src/ai/providers/new-api.provider.ts` | Modify | 新增 `submitImageTask` + `getImageTaskStatus` |
| `backend/src/ai/services/image-task.service.ts` | Modify | `executeTaskInner` 对 gemini image 走 submit+poll |

---

## Task 1：new-api 新增 image task 路由

**Files:**
- Modify: `new-api/router/video-router.go`

- [ ] **Step 1: 在 `video-router.go` 末尾追加 image task 路由组**

在 `SetVideoRouter` 函数的 `videoV1Router` 块之后添加：

```go
// Image task async routes (APIMart image models: gemini-*-image-preview, etc.)
imageTaskRouter := router.Group("/v1")
imageTaskRouter.Use(middleware.RouteTag("relay"))
imageTaskRouter.Use(middleware.TokenAuth(), middleware.Distribute())
{
    imageTaskRouter.POST("/image-tasks/generations", controller.RelayTask)
    imageTaskRouter.GET("/image-tasks/:task_id", controller.RelayTaskFetch)
}
```

- [ ] **Step 2: 编译验证**

```bash
cd /Users/libiqiang/business/Tanva/new-api
go build ./... 2>&1
```

Expected: 无错误输出

- [ ] **Step 3: Commit**

```bash
git -C /Users/libiqiang/business/Tanva/new-api add router/video-router.go
git -C /Users/libiqiang/business/Tanva/new-api commit -m "feat(router): add /v1/image-tasks routes for async image generation"
```

---

## Task 2：APIMart task adaptor 支持 image action

**Files:**
- Modify: `new-api/relay/channel/task/apimart/adaptor.go`

- [ ] **Step 1: 在文件顶部 import 块之后添加 image model 检测函数**

在 `type TaskAdaptor struct` 之前插入：

```go
// isApimartImageModel 判断是否为 APIMart 图片生成模型（非视频）
func isApimartImageModel(model string) bool {
	m := strings.ToLower(strings.TrimSpace(model))
	return strings.Contains(m, "image-preview") ||
		strings.Contains(m, "image-flash") ||
		strings.Contains(m, "gpt-image")
}
```

- [ ] **Step 2: 修改 `ValidateRequestAndSetAction`，跳过视频专属校验**

找到 `ValidateRequestAndSetAction` 函数，在 `relaycommon.ValidateBasicTaskRequest` 调用之后、获取 req 之前，添加 image 分支：

```go
func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) *dto.TaskError {
	taskErr := relaycommon.ValidateBasicTaskRequest(c, info, constant.TaskActionGenerate)
	if taskErr != nil {
		return taskErr
	}
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}

	// Image models: no video-specific validation needed
	if isApimartImageModel(req.Model) || isApimartImageModel(info.UpstreamModelName) {
		c.Set("task_request", req)
		return nil
	}

	// 以下为原有视频校验逻辑（保持不变）
```

> 注意：将原函数体中 `req, err := relaycommon.GetTaskRequest(c)` 之后的代码保留，不删除，只是在它前面加上 image 分支的 early return。

- [ ] **Step 3: 修改 `BuildRequestURL` 对 image 模型使用 `/v1/images/generations`**

找到 `BuildRequestURL` 函数，修改为：

```go
func (a *TaskAdaptor) BuildRequestURL(info *relaycommon.RelayInfo) (string, error) {
	if isApimartImageModel(info.OriginModelName) || isApimartImageModel(info.UpstreamModelName) {
		return a.baseURL + "/v1/images/generations", nil
	}
	return a.baseURL + "/v1/videos", nil
}
```

- [ ] **Step 4: 修改 `BuildRequestHeader` 对 image 模型使用 JSON Content-Type**

找到 `BuildRequestHeader` 函数，修改为：

```go
func (a *TaskAdaptor) BuildRequestHeader(c *gin.Context, req *http.Request, info *relaycommon.RelayInfo) error {
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
	if isApimartImageModel(info.OriginModelName) || isApimartImageModel(info.UpstreamModelName) {
		req.Header.Set("Content-Type", "application/json")
	} else {
		req.Header.Set("Content-Type", c.Request.Header.Get("Content-Type"))
	}
	return nil
}
```

- [ ] **Step 5: 修改 `BuildRequestBody` 对 image 模型构建 JSON body**

找到 `BuildRequestBody` 函数，在函数开头加 image 分支：

```go
func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil, err
	}

	// Image models: send JSON body compatible with APIMart /v1/images/generations
	if isApimartImageModel(req.Model) || isApimartImageModel(info.UpstreamModelName) {
		payload := map[string]interface{}{
			"model":  info.UpstreamModelName,
			"prompt": req.Prompt,
			"n":      1,
		}
		if req.Size != "" {
			payload["size"] = req.Size
		}
		if req.Resolution != "" {
			payload["resolution"] = req.Resolution
		}
		imageURLs := append(req.Urls, req.Images...)
		if req.Image != "" {
			imageURLs = append([]string{req.Image}, imageURLs...)
		}
		if len(imageURLs) > 0 {
			payload["image_urls"] = imageURLs
		}
		data, err := common.Marshal(payload)
		if err != nil {
			return nil, fmt.Errorf("apimart image task: marshal body failed: %w", err)
		}
		return bytes.NewReader(data), nil
	}

	// 以下为原有视频 body 构建逻辑（保持不变）
```

> 确保在函数开头 import 中有 `"bytes"` 和 `"fmt"`，检查 adaptor.go 顶部 import。

- [ ] **Step 6: 编译验证**

```bash
cd /Users/libiqiang/business/Tanva/new-api
go build ./... 2>&1
```

Expected: 无错误输出

- [ ] **Step 7: Commit**

```bash
git -C /Users/libiqiang/business/Tanva/new-api add relay/channel/task/apimart/adaptor.go
git -C /Users/libiqiang/business/Tanva/new-api commit -m "feat(apimart-task): support image model async submit via /v1/images/generations"
```

---

## Task 3：Tanva backend — new-api provider 新增 submit+poll 方法

**Files:**
- Modify: `backend/src/ai/providers/new-api.provider.ts`

- [ ] **Step 1: 新增 `submitImageTask` 方法**

在 `callImageEndpoint` 方法之后（约第 417 行之后）插入：

```typescript
/** 提交图片生成任务，立即返回 new-api task_id（< 1s），不等待结果 */
async submitImageTask(
  request: ImageGenerationRequest,
): Promise<string> {
  const resolvedModel = this.resolveUltraModel(
    request.model || 'gemini-2.5-flash-image-preview',
    request.providerOptions,
  );
  const payload = this.stripUndefined({
    model: resolvedModel,
    prompt: request.prompt,
    urls: request.imageUrls,
    size: request.aspectRatio || '1:1',
    resolution: this.normalizeResolution(request.imageSize),
    n: this.resolveImageCount(request),
    output_format: request.outputFormat,
    moderation: request.moderation,
  });
  const apiKey = this.resolveApiKey(request.providerOptions, resolvedModel);
  const result = await this.requestJson('/v1/image-tasks/generations', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, apiKey);
  const taskId = result?.id || result?.task_id;
  if (!taskId) {
    throw new Error(`submitImageTask: no task_id in response: ${JSON.stringify(result)}`);
  }
  return String(taskId);
}

/** 查询 new-api 图片任务状态 */
async getImageTaskStatus(
  taskId: string,
  apiKey?: string,
): Promise<{ status: string; imageUrl?: string; failReason?: string }> {
  const result = await this.requestJson(`/v1/image-tasks/${taskId}`, {
    method: 'GET',
  }, apiKey || this.apiKey);

  // new-api task fetch returns TaskDto format
  const data = result?.data ?? result;
  const status: string = data?.status ?? 'unknown';
  const resultURL: string | undefined = data?.result_url || data?.resultUrl;
  const failReason: string | undefined = data?.fail_reason || data?.failReason;
  return { status, imageUrl: resultURL, failReason };
}
```

- [ ] **Step 2: 新增 image model 检测 helper**

在文件顶部 static 区域（`ULTRA_CAPABLE_MODELS` 附近）添加：

```typescript
/** 支持异步 Task API 路径的 gemini 图片模型 */
private static readonly ASYNC_IMAGE_MODELS = new Set([
  'gemini-3-pro-image-preview',
  'gemini-3.1-flash-image-preview',
  'gemini-2.5-flash-image-preview',
]);

static isAsyncImageModel(model: string): boolean {
  return NewApiProvider.ASYNC_IMAGE_MODELS.has(model);
}
```

- [ ] **Step 3: TypeScript 编译验证**

```bash
cd /Users/libiqiang/business/Tanva/backend
npx tsc --noEmit 2>&1 | grep "new-api.provider" | head -10
```

Expected: 无输出（无错误）

- [ ] **Step 4: Commit**

```bash
git -C /Users/libiqiang/business/Tanva/backend add src/ai/providers/new-api.provider.ts
git -C /Users/libiqiang/business/Tanva/backend commit -m "feat(new-api-provider): add submitImageTask + getImageTaskStatus for async image flow"
```

---

## Task 4：Tanva backend — executeTaskInner 改为 submit+poll

**Files:**
- Modify: `backend/src/ai/services/image-task.service.ts`

- [ ] **Step 1: 新增 `executeAsyncImageGenerate` 私有方法**

在 `executeTaskInner` 方法之前插入：

```typescript
/**
 * 通过 new-api Task API 异步提交图片生成任务，定期轮询直到完成。
 * 相比同步调用，new-api 在收到 APIMart task_id 后立即释放内存（< 1s）。
 */
private async executeAsyncImageGenerate(
  request: Parameters<NewApiProvider['generateImage']>[0],
  timeoutMs = 20 * 60 * 1000,
): Promise<AIProviderResponse<ImageResult>> {
  const provider = this.providerFactory.getProvider(request.model, 'new-api') as NewApiProvider;

  // 提交任务，立即拿到 task_id
  const taskId = await provider.submitImageTask(request);
  this.logger.debug(`async image task submitted: taskId=${taskId}`);

  const deadline = Date.now() + timeoutMs;
  const intervalMs = 3000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const { status, imageUrl, failReason } = await provider.getImageTaskStatus(taskId);

    if (status === 'success' || status === 'succeeded' || status === 'completed') {
      if (!imageUrl) {
        return { success: false, error: { code: 'NO_IMAGE_URL', message: 'Task succeeded but no image URL returned' } };
      }
      return {
        success: true,
        data: {
          imageUrl,
          imageData: undefined,
          textResponse: 'Image generated successfully',
          hasImage: true,
          metadata: { provider: 'new-api', model: request.model, imageUrls: [imageUrl], raw: null },
        },
      };
    }

    if (status === 'failed' || status === 'failure' || status === 'cancelled') {
      return {
        success: false,
        error: { code: 'TASK_FAILED', message: failReason || `Image task failed with status: ${status}` },
      };
    }
    // status: queued / processing / in_progress → continue polling
  }

  return { success: false, error: { code: 'TIMEOUT', message: `Image task timed out after ${timeoutMs / 1000}s` } };
}
```

- [ ] **Step 2: 在生成任务分支中，对异步模型改调 `executeAsyncImageGenerate`**

找到 `executeTaskInner` 中调用 `provider.generateImage(...)` 的那段代码（约第 500 行附近），将其包装为：

```typescript
// 对支持 Task API 的 gemini image 模型走异步路径
const resolvedModel = (taskRequestData?.model as string | undefined) || model;
const useAsyncPath =
  resolvedProviderName === 'new-api' ||
  this.isGeminiProvider(resolvedProviderName ?? '');

const result = useAsyncPath && resolvedModel && NewApiProvider.isAsyncImageModel(resolvedModel)
  ? await this.executeAsyncImageGenerate({
      prompt: task.prompt,
      model: resolvedModel,
      imageOnly: taskRequestData.imageOnly,
      aspectRatio: taskRequestData.aspectRatio,
      imageSize: taskRequestData.imageSize,
      outputFormat: taskRequestData.outputFormat,
      providerOptions: taskRequestData.providerOptions,
      imageUrls: Array.isArray(taskRequestData.imageUrls)
        ? taskRequestData.imageUrls
            .filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
            .map((url: string) => this.oss.withImageResize(url))
        : undefined,
    })
  : await provider.generateImage({
      prompt: task.prompt,
      model,
      imageOnly: taskRequestData.imageOnly,
      aspectRatio: taskRequestData.aspectRatio,
      imageSize: taskRequestData.imageSize,
      thinkingLevel: taskRequestData.thinkingLevel,
      outputFormat: taskRequestData.outputFormat,
      providerOptions: taskRequestData.providerOptions,
      enableWebSearch: taskRequestData.enableWebSearch,
      imageUrls: Array.isArray(taskRequestData.imageUrls)
        ? taskRequestData.imageUrls
            .filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
            .map((url: string) => this.oss.withImageResize(url))
        : undefined,
      googleSearch: taskRequestData.googleSearch,
      googleImageSearch: taskRequestData.googleImageSearch,
      // ... 其余字段保持不变，复制原有调用中的所有字段
    });
```

> **重要**：原有 `const result = await provider.generateImage({...})` 调用的所有字段必须完整保留在 else 分支中，不要删减。

- [ ] **Step 3: 在文件顶部添加 NewApiProvider import（如果没有）**

检查 `image-task.service.ts` 顶部是否有 `NewApiProvider` 的 import，若没有则添加：

```typescript
import { NewApiProvider } from '../providers/new-api.provider';
```

- [ ] **Step 4: TypeScript 编译验证**

```bash
cd /Users/libiqiang/business/Tanva/backend
npx tsc --noEmit 2>&1 | grep "image-task\|new-api.provider" | head -20
```

Expected: 无输出

- [ ] **Step 5: Commit**

```bash
git -C /Users/libiqiang/business/Tanva/backend add src/ai/services/image-task.service.ts
git -C /Users/libiqiang/business/Tanva/backend commit -m "feat(image-task): use async submit+poll for gemini image models via new-api Task API"
```

---

## Task 5：联调测试

- [ ] **Step 1: 重建 new-api 容器**

```bash
cd /Users/libiqiang/business/Tanva/backend
docker-compose up -d --build new-api
```

- [ ] **Step 2: 重启 Tanva backend**

```bash
cd /Users/libiqiang/business/Tanva/backend
pnpm run start:dev
```

- [ ] **Step 3: 发送测试请求，确认立即返回（< 2s）**

```bash
curl -s -w "\nTime: %{time_total}s\n" \
  http://localhost:4000/api/ai/generate-image-async \
  -H 'authorization: Bearer <token>' \
  -H 'content-type: application/json' \
  -d '{"prompt":"一只猫","aiProvider":"banana","model":"gemini-3-pro-image-preview","aspectRatio":"1:1","providerOptions":{"banana":{"imageRoute":"ultra"}},"nodeId":"test","nodeConfigKey":"generate","nodeConfigNameZh":"测试","nodeConfigNameEn":"Test"}'
```

Expected: HTTP 200，响应时间 < 2s，返回 `{taskId: "..."}`（之前需要等 232s）

- [ ] **Step 4: 轮询任务直到完成**

用上一步返回的 `taskId`：

```bash
watch -n 3 'curl -s http://localhost:4000/api/ai/image-task/<taskId> -H "authorization: Bearer <token>" | jq .status'
```

Expected: 状态从 `queued` → `processing` → `succeeded`，有 `imageUrl`

- [ ] **Step 5: 检查 new-api 使用日志**

访问 `http://localhost:4458` → 使用日志，确认有该任务的记录

- [ ] **Step 6: 验证内存无明显增长**

```bash
# 连续提交 5 个并发图片任务后查看 new-api 内存
docker stats tanva-new-api --no-stream
```

Expected: 内存比之前同样并发量显著降低
