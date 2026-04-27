# HappyHorse 1.0 R2V Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Aliyun Bailian `happyhorse-1.0-r2v` reference-image-to-video model as a standalone flow node `happyhorseR2V`, with per-resolution × per-second dynamic billing (720P=120 credits/s, 1080P=200 credits/s).

**Architecture:** New backend endpoint `POST /ai/dashscope/generate-happyhorse-r2v` reuses DashScope's existing async video-synthesis API (same URL as `wan2.6-r2v`, only `model` field differs). Independent `serviceType: 'happyhorse-r2v-video'` and a new credits resolver `resolveHappyhorseR2VCredits` reading `dynamicPricing.perSecondByResolution`. Frontend ships a new `HappyhorseR2VNode.tsx` (cloned from `Wan2R2VNode.tsx` shape, swapping video reference handles for **image** reference handles, plus a resolution dropdown and dynamic +/- 1~9 image inputs).

**Tech Stack:** NestJS + Prisma backend, React + reactflow frontend, TypeScript end-to-end. No unit-test infrastructure exists for the affected services — verification is `tsc -b` (type check) for both backend & frontend, plus manual integration testing in dev server. Frequent commits; each task ends with a commit.

**Spec:** `docs/superpowers/specs/2026-04-27-happyhorse-r2v-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `backend/src/credits/credits.config.ts` | Modify | Register `'happyhorse-r2v-video'` service config + `dynamicPricing.perSecondByResolution` matrix |
| `backend/src/credits/credits.service.ts` | Modify | Wire service-type into video-service lists, billing-remark judgments; add `resolveHappyhorseR2VCredits` resolver and inject into the resolver chain |
| `backend/src/ai/ai.controller.ts` | Modify | Add `pollDashScopeVideoTask` shared helper (used only by new endpoint), `normalizeHappyhorseR2VBodyForUpstream`, `buildHappyhorseCreditRequestParams`, and the `generateHappyhorseR2VViaDashscope` endpoint method |
| `backend/src/admin/services/node-config.service.ts` | Modify | Append `happyhorseR2V` config to both `defaultConfigs` arrays |
| `frontend/src/components/flow/nodes/HappyhorseR2VNode.tsx` | Create | New flow node component: prompt + 1~9 image handles + ratio/resolution/duration dropdowns |
| `frontend/src/services/aiBackendAPI.ts` | Modify | Add `generateHappyhorseR2VViaAPI` API client function |
| `frontend/src/components/flow/FlowOverlay.tsx` | Modify | Register `happyhorseR2V` in nodeTypes / category lists / size map / connection rules / Run dispatcher |
| `frontend/src/pages/Admin.tsx` | Modify | Register `happyhorseR2V` in admin model option lists & managed-model mappings |

---

## Important conventions (read before starting)

- **No tests, no jest config.** Verification is `tsc -b` after each phase + manual smoke test at the end. Don't create new test scaffolding for this feature.
- **DashScope key.** Backend reads `process.env.DASHSCOPE_API_KEY` exactly like the existing wan endpoints — no new env var.
- **Money/credit unit.** 1 credit = ¥0.01. 720P pricing = 120 credits/s. 1080P pricing = 200 credits/s.
- **Default resolution.** 720P everywhere it matters (node UI, fallback in `buildHappyhorseCreditRequestParams`). The upstream API's own default is 1080P, but we always send `resolution` explicitly so this doesn't bite us.
- **Watermark.** Always send `watermark: false` to upstream (forced in normalizer).
- **Commits.** One commit per task. Use the message shown in each task's last step.

---

## Task 1: Register `happyhorse-r2v-video` in `credits.config.ts`

**Files:**
- Modify: `backend/src/credits/credits.config.ts:194` (just after the existing `'wan26-r2v'` block)

- [ ] **Step 1:** Open `backend/src/credits/credits.config.ts`. Locate the `'wan26-r2v'` entry (around line 189-194) which ends with `description: '使用 Wan2.6 参考视频生成视频',\n  },`.

- [ ] **Step 2:** Insert a new service config immediately after the `'wan26-r2v'` block:

```ts
  'happyhorse-r2v-video': {
    serviceName: '快乐马参考视频',
    provider: 'dashscope',
    creditsPerCall: 600, // fallback：5s × 120 credits/s（720P，节点默认）
    description: '使用 HappyHorse 1.0 R2V 参考图生成视频',
    dynamicPricing: {
      perSecondByResolution: { '720P': 120, '1080P': 200 },
    },
  },
```

- [ ] **Step 3:** Type-check — backend root build:

```bash
cd backend && pnpm exec tsc -p tsconfig.build.json --noEmit
```

Expected: no new errors. The existing `dynamicPricing` field accepts arbitrary shapes (it's typed loosely as a matrix object), so adding a new sub-key is safe.

- [ ] **Step 4:** Commit:

```bash
git add backend/src/credits/credits.config.ts
git commit -m "feat(credits): register happyhorse-r2v-video service config"
```

---

## Task 2: Add `'happyhorse-r2v-video'` to video-service safety lists

**Files:**
- Modify: `backend/src/credits/credits.service.ts:90-102` and `:108-121`

- [ ] **Step 1:** Open `backend/src/credits/credits.service.ts`. Locate `STALE_PENDING_VIDEO_SERVICE_TYPES` (around line 90).

- [ ] **Step 2:** Add `'happyhorse-r2v-video'` to the list, after `'doubao-video'`:

```ts
const STALE_PENDING_VIDEO_SERVICE_TYPES: ServiceType[] = [
  'sora-sd',
  'sora-hd',
  'wan26-video',
  'wan27-video',
  'kling-video',
  'kling-2.6-video',
  'kling-3.0-video',
  'kling-o3-video',
  'vidu-video',
  'viduq3-pro-video',
  'doubao-video',
  'happyhorse-r2v-video',
];
```

- [ ] **Step 3:** Locate `FREE_USER_VIDEO_LIMITED_SERVICES` (around line 108-121). Add `'happyhorse-r2v-video'` after `'doubao-video'`:

```ts
const FREE_USER_VIDEO_LIMITED_SERVICES: ServiceType[] = [
  'sora-sd',
  'sora-hd',
  'wan26-video',
  'wan27-video',
  'wan26-r2v',
  'kling-video',
  'kling-2.6-video',
  'kling-3.0-video',
  'kling-o3-video',
  'vidu-video',
  'viduq3-pro-video',
  'doubao-video',
  'happyhorse-r2v-video',
];
```

- [ ] **Step 4:** Type-check:

```bash
cd backend && pnpm exec tsc -p tsconfig.build.json --noEmit
```

Expected: no errors.

- [ ] **Step 5:** Commit:

```bash
git add backend/src/credits/credits.service.ts
git commit -m "chore(credits): wire happyhorse-r2v-video into video service lists"
```

---

## Task 3: Add the credits resolver and wire it into the chain

**Files:**
- Modify: `backend/src/credits/credits.service.ts:441-460` (resolver chain) and `:892` (insert new private method nearby)

- [ ] **Step 1:** Open `backend/src/credits/credits.service.ts`. Locate `private resolveImageResolutionCredits(` (around line 892).

- [ ] **Step 2:** Insert a new private method **directly above** `resolveImageResolutionCredits`:

```ts
  /**
   * happyhorse-r2v-video 按分辨率 × 时长动态计费
   * pricing.dynamicPricing.perSecondByResolution = { '720P': N, '1080P': M }
   * credits = duration * rate[resolution]，缺失时回落 defaultCredits
   */
  private resolveHappyhorseR2VCredits(
    serviceType: ServiceType,
    defaultCredits: number,
    requestParams: any,
  ): number {
    if (serviceType !== 'happyhorse-r2v-video') return defaultCredits;
    const pricing = (CREDIT_PRICING_CONFIG as Record<string, any>)[serviceType];
    const matrix = pricing?.dynamicPricing?.perSecondByResolution as
      | Record<string, number>
      | undefined;
    if (!matrix) return defaultCredits;
    const resolution = (requestParams?.resolution || '').toString().toUpperCase();
    const rate = matrix[resolution];
    const duration = Number(requestParams?.duration);
    if (rate && Number.isFinite(duration) && duration > 0) {
      return Math.round(rate * duration);
    }
    return defaultCredits;
  }

```

- [ ] **Step 3:** Wire it into the resolver chain. Locate `resolveEffectiveCreditsQuote` (around line 404). Find the existing chain (line 441-460) and insert a new call **after** `resolveImageResolutionCredits`:

```ts
    creditsToDeduct = this.resolveImageResolutionCredits(
      params.serviceType,
      creditsToDeduct,
      effectiveRequestParams,
    );

    creditsToDeduct = this.resolveHappyhorseR2VCredits(
      params.serviceType,
      creditsToDeduct,
      effectiveRequestParams,
    );

    creditsToDeduct = this.resolveFixedAnalyzeCredits(params.serviceType, creditsToDeduct);
```

- [ ] **Step 4:** Type-check:

```bash
cd backend && pnpm exec tsc -p tsconfig.build.json --noEmit
```

Expected: no errors.

- [ ] **Step 5:** Quick sanity check — eyeball the math by adding a temporary log (and remove before commit). In `resolveHappyhorseR2VCredits`, before returning, you can `console.log` the resolved credits in dev. Skip this if you're confident.

- [ ] **Step 6:** Commit:

```bash
git add backend/src/credits/credits.service.ts
git commit -m "feat(credits): add resolveHappyhorseR2VCredits dynamic resolver"
```

---

## Task 4: Add billing-remark recognition for the new service type

**Files:**
- Modify: `backend/src/credits/credits.service.ts:1656-1660` and `:1719-1723`

- [ ] **Step 1:** Locate the first `isVideoService` block in `resolveBillingModelLabel` (around line 1656):

```ts
    const isVideoService =
      serviceType.includes('video') ||
      serviceType === 'sora-sd' ||
      serviceType === 'sora-hd' ||
      serviceType === 'wan26-r2v';
```

Note `serviceType.includes('video')` already matches `'happyhorse-r2v-video'` because the suffix `-video` is present. **No edit needed here** — verify by reading the substring rule. (`'happyhorse-r2v-video'.includes('video')` is `true`.)

- [ ] **Step 2:** Locate the second `isVideoService` block in `buildBillingRemark` (around line 1719). Same logic — `serviceType.includes('video')` already covers us. **No edit needed.**

- [ ] **Step 3:** No-op task (this is documentation that we audited the path). Sanity test:

```bash
cd backend && node -e "console.log('happyhorse-r2v-video'.includes('video'))"
```

Expected: `true`.

- [ ] **Step 4:** No commit (no code changed). Move on to Task 5.

---

## Task 5: Add the shared `pollDashScopeVideoTask` helper

**Files:**
- Modify: `backend/src/ai/ai.controller.ts` — insert new private method near the other DashScope helpers (around line 2080, after `normalizeWanR2VBodyForUpstream`)

- [ ] **Step 1:** Open `backend/src/ai/ai.controller.ts`. Locate the end of `normalizeWanR2VBodyForUpstream` method (around line 2081 — the closing `}` of that method).

- [ ] **Step 2:** Insert a new private helper directly after `normalizeWanR2VBodyForUpstream`:

```ts
  /**
   * 共用：轮询 DashScope 异步视频任务，返回最终视频 URL 或失败/超时错误。
   * 仅供新接入的 endpoint 使用；现有 wan26-* / wan27-* 各自的 inline 轮询保持不变（避免连带回归）。
   */
  private async pollDashScopeVideoTask(
    dashKey: string,
    taskId: string,
    label: string,
  ): Promise<
    | { success: true; data: any }
    | { success: false; error: { message: string; details?: any } }
  > {
    const statusUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(taskId)}`;
    const intervalMs = 15000;
    const maxAttempts = 40;

    const extractVideoUrl = (obj: any) =>
      obj?.output?.video_url ||
      obj?.video_url ||
      obj?.videoUrl ||
      (Array.isArray(obj?.output) && obj.output[0]?.video_url) ||
      undefined;

    this.logger.log(
      `🔁 Start polling DashScope ${label} task ${taskId} (${maxAttempts} attempts, ${intervalMs}ms interval)`,
    );

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, intervalMs));
      try {
        const statusResp = await fetch(statusUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${dashKey}`,
            'Content-Type': 'application/json',
          },
        });
        if (!statusResp.ok) {
          const errBody = await statusResp.text().catch(() => '');
          this.logger.warn(`DashScope ${label} status check non-OK`, {
            status: statusResp.status,
            body: errBody,
          });
          continue;
        }
        const statusData = await statusResp.json().catch(() => ({}));
        this.logger.debug(
          `🔎 DashScope ${label} status (attempt ${attempt + 1}): ${JSON.stringify(statusData).slice(0, 200)}`,
        );
        const statusValue = (
          statusData?.output?.task_status ||
          statusData?.status ||
          statusData?.state ||
          statusData?.task_status ||
          ''
        )
          .toString()
          .toLowerCase();

        if (statusValue === 'succeeded' || statusValue === 'success') {
          const finalVideoUrl =
            extractVideoUrl(statusData) ||
            extractVideoUrl(statusData?.result) ||
            extractVideoUrl(statusData?.output) ||
            undefined;
          if (!finalVideoUrl) {
            this.logger.warn(
              `DashScope ${label} task ${taskId} succeeded but no video URL`,
              { dataPreview: JSON.stringify(statusData).slice(0, 400) },
            );
            return {
              success: false,
              error: {
                message: 'DashScope 任务已完成但未返回视频地址',
                details: statusData,
              },
            };
          }
          this.logger.log(
            `✅ DashScope ${label} task ${taskId} succeeded, videoUrl: ${String(finalVideoUrl).slice(0, 120)}`,
          );
          return {
            success: true,
            data: {
              taskId,
              status: statusValue,
              videoUrl: finalVideoUrl,
              video_url: finalVideoUrl,
              output: { video_url: finalVideoUrl },
              raw: statusData,
            },
          };
        }
        if (statusValue === 'failed' || statusValue === 'error') {
          const failureCode =
            statusData?.output?.code ||
            statusData?.code ||
            statusData?.output?.error_code ||
            statusData?.output?.error?.code;
          const failureMessage =
            statusData?.output?.message ||
            statusData?.message ||
            statusData?.output?.error?.message ||
            statusData?.output?.error_message ||
            statusData?.output?.error?.msg ||
            statusData?.output?.reason;
          const message =
            typeof failureMessage === 'string' && failureMessage.trim().length > 0
              ? failureCode
                ? `${String(failureCode)}: ${failureMessage}`
                : failureMessage
              : `DashScope ${label} task failed`;
          this.logger.error(`❌ DashScope ${label} task ${taskId} failed`, {
            message,
            raw: statusData,
          });
          return {
            success: false,
            error: { message, details: statusData },
          };
        }
      } catch (err: any) {
        this.logger.warn(`DashScope ${label} polling exception, will retry`, err);
      }
    }
    this.logger.warn(
      `⏳ DashScope ${label} task ${taskId} polling timed out after ${maxAttempts} attempts`,
    );
    return {
      success: false,
      error: { message: `DashScope ${label} task polling timed out` },
    };
  }

```

- [ ] **Step 3:** Type-check:

```bash
cd backend && pnpm exec tsc -p tsconfig.build.json --noEmit
```

Expected: no errors. The helper isn't called anywhere yet, but it's a private method on the class so it must type-check.

- [ ] **Step 4:** Commit:

```bash
git add backend/src/ai/ai.controller.ts
git commit -m "feat(ai): add shared pollDashScopeVideoTask helper for new endpoints"
```

---

## Task 6: Add `normalizeHappyhorseR2VBodyForUpstream` and `buildHappyhorseCreditRequestParams`

**Files:**
- Modify: `backend/src/ai/ai.controller.ts` — insert near the other Wan helpers (right after `pollDashScopeVideoTask` from Task 5, or near `normalizeWanR2VBodyForUpstream`/`buildWanCreditRequestParams`)

- [ ] **Step 1:** Locate the helper region in `ai.controller.ts` (search for `private normalizeWanR2VBodyForUpstream`). Insert these two new helpers nearby (group with the other DashScope helpers — placement doesn't affect runtime behavior):

```ts
  private normalizeHappyhorseR2VBodyForUpstream(body: any): any {
    if (!body || typeof body !== 'object') return body;
    const next: any = { ...body };
    if (!next.input || typeof next.input !== 'object') return next;

    next.input = { ...next.input };
    const rawMedia = next.input.media;
    if (Array.isArray(rawMedia)) {
      next.input.media = rawMedia
        .map((item: any) => {
          if (!item || typeof item !== 'object') return null;
          const mediaItem: any = { ...item };
          if (typeof mediaItem.type !== 'string' || !mediaItem.type.trim()) {
            mediaItem.type = 'reference_image';
          }
          if (typeof mediaItem.url === 'string' && mediaItem.url.trim()) {
            mediaItem.url = this.normalizeImageUrlForUpstream(mediaItem.url);
          }
          return mediaItem;
        })
        .filter(
          (value: any) => value && typeof value.url === 'string' && value.url.trim(),
        );
    }

    // 强制不打水印 + 始终发送 ratio/resolution/duration 兜底
    next.parameters = { ...(next.parameters || {}), watermark: false };

    return next;
  }

  private buildHappyhorseCreditRequestParams(body: any): Record<string, any> {
    const parameters =
      body?.parameters && typeof body.parameters === 'object' && !Array.isArray(body.parameters)
        ? body.parameters
        : {};
    const resolution =
      typeof parameters.resolution === 'string' && parameters.resolution.trim().length > 0
        ? parameters.resolution.trim().toUpperCase()
        : '720P'; // 节点默认；与节点 UI 默认一致
    const durationRaw = Number(parameters.duration);
    const duration = Number.isFinite(durationRaw) && durationRaw > 0
      ? Math.min(15, Math.max(3, Math.round(durationRaw)))
      : 5;

    const referenceImageUrls = Array.isArray(body?.input?.media)
      ? body.input.media
          .map((m: any) => m?.url)
          .filter((u: any): u is string => typeof u === 'string')
      : [];

    return {
      managedModelKey: 'happyhorse-1.0-r2v',
      modelKey: 'happyhorse-1.0-r2v',
      vendorKey: 'dashscope',
      platformKey: 'dashscope',
      aiProvider: 'dashscope',
      generationMode: 'r2v',
      resolution,
      duration,
      durationSec: duration,
      referenceImageCount: referenceImageUrls.length,
      ...this.buildRequestPromptAndImageParams(
        body?.input?.prompt,
        referenceImageUrls,
      ),
    };
  }

```

- [ ] **Step 2:** Verify `normalizeImageUrlForUpstream` and `buildRequestPromptAndImageParams` exist on the class:

```bash
grep -nE "normalizeImageUrlForUpstream|buildRequestPromptAndImageParams" backend/src/ai/ai.controller.ts | head
```

Expected: each appears at least once as a private method definition.

- [ ] **Step 3:** Type-check:

```bash
cd backend && pnpm exec tsc -p tsconfig.build.json --noEmit
```

Expected: no errors.

- [ ] **Step 4:** Commit:

```bash
git add backend/src/ai/ai.controller.ts
git commit -m "feat(ai): add happyhorse-r2v body normalizer and credit params builder"
```

---

## Task 7: Add the `POST /ai/dashscope/generate-happyhorse-r2v` endpoint

**Files:**
- Modify: `backend/src/ai/ai.controller.ts` — insert immediately after the existing `generateWan26R2VViaDashscope` method (which ends around line 5097)

- [ ] **Step 1:** Locate the end of `generateWan26R2VViaDashscope` (find the line `}, undefined, undefined, undefined, this.buildWanCreditRequestParams(body, {` then scroll past the `treatReturnedFailureAsError: true,` block — it ends with `});` followed by a closing `}`). Right after that closing brace, insert:

```ts
  @Post('dashscope/generate-happyhorse-r2v')
  async generateHappyhorseR2VViaDashscope(@Body() body: any, @Req() req: any) {
    return this.withCredits(
      req,
      'happyhorse-r2v-video',
      'happyhorse-1.0-r2v',
      async () => {
        const dashKey = process.env.DASHSCOPE_API_KEY;
        if (!dashKey) {
          this.logger.error('DASHSCOPE_API_KEY not configured');
          return {
            success: false,
            error: { message: 'DASHSCOPE_API_KEY not configured on server' },
          };
        }

        const dashUrl =
          'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';
        const normalizedBody = this.normalizeHappyhorseR2VBodyForUpstream(body);

        try {
          const response = await fetch(dashUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${dashKey}`,
              'X-DashScope-Async': 'enable',
            },
            body: JSON.stringify(normalizedBody),
          });

          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            this.logger.error('DashScope happyhorse-r2v create task failed', {
              status: response.status,
              body: data,
            });
            return {
              success: false,
              error: {
                code: `HTTP_${response.status}`,
                message: data?.message || this.getHttpErrorMessage(response.status),
                details: data,
              },
            };
          }

          this.logger.log('✅ DashScope happyhorse-r2v task created', {
            resultPreview: JSON.stringify(data).slice(0, 200),
          });

          // 极少数情况下上游可能直接返回视频地址（兜底）
          const directVideoUrl =
            data?.output?.video_url ||
            data?.video_url ||
            data?.videoUrl ||
            (Array.isArray(data?.output) && data.output[0]?.video_url) ||
            undefined;
          if (directVideoUrl) return { success: true, data };

          const taskId =
            data?.taskId ||
            data?.task_id ||
            data?.id ||
            data?.output?.task_id ||
            data?.result?.task_id ||
            data?.output?.[0]?.task_id ||
            data?.data?.task_id ||
            data?.data?.output?.task_id;
          if (!taskId) {
            this.logger.warn(
              'DashScope happyhorse-r2v create response contains no task id and no video url',
              { dataPreview: JSON.stringify(data).slice(0, 200) },
            );
            return {
              success: false,
              error: {
                message: 'DashScope 未返回任务 ID 或视频地址',
                details: data,
              },
            };
          }

          return await this.pollDashScopeVideoTask(dashKey, taskId, 'happyhorse-r2v');
        } catch (error: any) {
          this.logger.error('❌ DashScope happyhorse-r2v request exception', error);
          return {
            success: false,
            error: { code: 'NETWORK_ERROR', message: error?.message || String(error) },
          };
        }
      },
      undefined,
      undefined,
      undefined,
      this.buildHappyhorseCreditRequestParams(body),
      {
        treatReturnedFailureAsError: true,
      },
    );
  }

```

- [ ] **Step 2:** Verify the new endpoint name doesn't collide:

```bash
grep -n "generate-happyhorse-r2v\|generateHappyhorseR2V" backend/src/ai/ai.controller.ts
```

Expected: each name appears in exactly one location (the new method).

- [ ] **Step 3:** Type-check:

```bash
cd backend && pnpm exec tsc -p tsconfig.build.json --noEmit
```

Expected: no errors.

- [ ] **Step 4:** Commit:

```bash
git add backend/src/ai/ai.controller.ts
git commit -m "feat(ai): add POST /ai/dashscope/generate-happyhorse-r2v endpoint"
```

---

## Task 8: Register `happyhorseR2V` in admin node configs

**Files:**
- Modify: `backend/src/admin/services/node-config.service.ts` — append entry in two `defaultConfigs` arrays (one near line 1300 and one near line 1794, both immediately **after** the `wan27Video` block)

- [ ] **Step 1:** Open `backend/src/admin/services/node-config.service.ts`. The first array is inside `initializeDefaultConfigs()`. Find the `wan27Video` entry there (around line 1261) and locate its closing `},` (around line 1300).

- [ ] **Step 2:** Insert this new entry **between** `wan27Video`'s closing `},` and the `// 其他节点` comment (around line 1301):

```ts
      {
        nodeKey: 'happyhorseR2V',
        nameZh: '快乐马参考视频',
        nameEn: 'HappyHorse R2V',
        category: 'video',
        sortOrder: 36,
        creditsPerCall: 600, // fallback；实际按 perSecondByResolution 动态计算
        serviceType: 'happyhorse-r2v-video',
        priceYuan: 6, // 5s/720P 节点默认档
        description: '阿里 HappyHorse 1.0 R2V 参考图视频生成',
        metadata: {
          ...buildVodNodeMetadata(
            {
              type: 'happyhorseR2V',
              provider: 'dashscope',
              supportedModels: ['happyhorse-1.0-r2v'],
              defaultData: {
                resolution: '720P',
                ratio: '16:9',
                duration: 5,
                watermark: false,
                referenceCount: 1,
              },
            },
            {
              label: 'DashScope HappyHorse 1.0 R2V',
              modelName: 'HappyHorse',
              modelVersion: '1.0-r2v',
              outputConfig: {
                durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
                resolutions: ['720P', '1080P'],
                ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
              },
              inputModes: ['reference_image_1_to_9'],
              notes: ['1~9 张参考图，prompt 用 character1/character2... 占位指代'],
            },
            {
              nodeKind: 'dashscope_video_generation',
              upstreamDomain: 'dashscope.aliyuncs.com',
            },
          ),
        },
      },
```

- [ ] **Step 3:** The second array is in `getDefaultConfigs()` (around line 1361). Find the `wan27Video` entry there (around line 1755) and the `// 其他节点` comment immediately after. Insert the **same** entry between them. Use the exact identical block from Step 2.

- [ ] **Step 4:** Type-check:

```bash
cd backend && pnpm exec tsc -p tsconfig.build.json --noEmit
```

Expected: no errors. (`buildVodNodeMetadata` is already imported at the top of this file.)

- [ ] **Step 5:** Verify `buildVodNodeMetadata` accepts these option shapes by reading its signature:

```bash
grep -n "function buildVodNodeMetadata\|buildVodNodeMetadata =" backend/src/admin/services/node-config.service.ts | head
```

If the function rejects unknown keys (e.g., it has a strict literal type), you may need to cast: `outputConfig: { durations, resolutions, ratios } as any` — but try without the cast first; only add `as any` if tsc complains.

- [ ] **Step 6:** Commit:

```bash
git add backend/src/admin/services/node-config.service.ts
git commit -m "feat(admin): register happyhorseR2V default node config"
```

---

## Task 9: Backend full-build sanity check

**Files:**
- Verify only.

- [ ] **Step 1:** Run a clean type check across the whole backend:

```bash
cd backend && pnpm exec tsc -p tsconfig.build.json --noEmit
```

Expected: no errors. If there are errors, fix them (likely candidates: missing optional `?` on a field, or `buildVodNodeMetadata` signature).

- [ ] **Step 2:** Boot the dev server briefly to confirm the new endpoint is registered:

```bash
cd backend && timeout 15 pnpm dev 2>&1 | grep -iE "happyhorse|dashscope/generate-" | head -20
```

Expected: see a Nest log line containing `Mapped {/ai/dashscope/generate-happyhorse-r2v, POST}` (or similar). Kill the server after confirming.

- [ ] **Step 3:** No commit (verification only).

---

## Task 10: Add `generateHappyhorseR2VViaAPI` to frontend API client

**Files:**
- Modify: `frontend/src/services/aiBackendAPI.ts` — insert after the existing `generateWan26R2VViaAPI` (around line 1971)

- [ ] **Step 1:** Open `frontend/src/services/aiBackendAPI.ts`. Locate the closing `}` of `generateWan26R2VViaAPI` (around line 1971).

- [ ] **Step 2:** Insert this new function **immediately after** `generateWan26R2VViaAPI`, before `generateWan27I2VViaAPI`:

```ts
/**
 * 调用后端代理的 DashScope HappyHorse 1.0 R2V 参考图生成视频接口
 */
export async function generateHappyhorseR2VViaAPI(request: {
  prompt: string;
  referenceImageUrls: string[]; // 1 ~ 9
  parameters?: {
    resolution?: "720P" | "1080P";
    ratio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
    duration?: number; // 3 ~ 15
  };
}): Promise<AIServiceResponse<any>> {
  const startedAt = getTimestamp();
  const dashscopeRequest = {
    model: "happyhorse-1.0-r2v",
    input: {
      prompt: request.prompt,
      media: request.referenceImageUrls.map((url) => ({
        type: "reference_image",
        url,
      })),
    },
    parameters: request.parameters || {},
  };
  try {
    const response = await fetchWithAuth(
      `${API_BASE_URL}/ai/dashscope/generate-happyhorse-r2v`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dashscopeRequest),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logApiTiming("generate-happyhorse-r2v", startedAt, {
        success: false,
        status: response.status,
      });
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData?.message || `HTTP ${response.status}`,
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();
    logApiTiming("generate-happyhorse-r2v", startedAt, { success: true });
    return data;
  } catch (error) {
    logApiTiming("generate-happyhorse-r2v", startedAt, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

```

- [ ] **Step 3:** Type-check:

```bash
cd frontend && pnpm exec tsc -b --noEmit
```

Expected: no new errors.

- [ ] **Step 4:** Commit:

```bash
git add frontend/src/services/aiBackendAPI.ts
git commit -m "feat(api): add generateHappyhorseR2VViaAPI client"
```

---

## Task 11: Create the `HappyhorseR2VNode.tsx` component

**Files:**
- Create: `frontend/src/components/flow/nodes/HappyhorseR2VNode.tsx`

- [ ] **Step 1:** Create the file with the full component below. It mirrors `Wan2R2VNode.tsx`'s scaffold (header buttons, dropdowns, video preview, history, error display) but swaps the 3 fixed video handles for a dynamic 1~9 image-handle list and adds a `resolution` dropdown.

```tsx
import React from "react";
import { Handle, Position } from "reactflow";
import { Video, Share2, Download, Plus, Minus } from "lucide-react";
import SmartImage from "../../ui/SmartImage";
import GenerationProgressBar from "./GenerationProgressBar";
import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";
import { useLocaleText } from "@/utils/localeText";
import RunCreditBadge from "./RunCreditBadge";
import { useNodeRunCredits } from "../hooks/useNodeRunCredits";
import { useBackendCreditsPreview } from "../hooks/useBackendCreditsPreview";

type VideoHistoryItem = {
  id: string;
  videoUrl: string;
  thumbnail?: string;
  prompt: string;
  createdAt: string;
  elapsedSeconds?: number;
  quality?: string;
  referenceCount?: number;
};

type Resolution = "720P" | "1080P";
type Ratio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";

type Props = {
  id: string;
  data: {
    status?: "idle" | "running" | "succeeded" | "failed";
    videoUrl?: string;
    thumbnail?: string;
    error?: string;
    videoVersion?: number;
    onRun?: (id: string) => void;
    creditsPerCall?: number;
    ratio?: Ratio;
    resolution?: Resolution;
    duration?: number;
    referenceCount?: number; // 1 ~ 9
    history?: VideoHistoryItem[];
  };
  selected?: boolean;
};

const RATIO_OPTIONS: Ratio[] = ["16:9", "9:16", "1:1", "4:3", "3:4"];
const RESOLUTION_OPTIONS: Resolution[] = ["720P", "1080P"];
const DURATION_OPTIONS: number[] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

const MIN_REFS = 1;
const MAX_REFS = 9;

function HappyhorseR2VNodeInner({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const [hover, setHover] = React.useState<string | null>(null);
  const [previewAspect, setPreviewAspect] = React.useState<string>("16/9");
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [downloadFeedback, setDownloadFeedback] = React.useState<{
    type: "progress" | "success" | "error";
    message: string;
  } | null>(null);
  const downloadFeedbackTimer = React.useRef<number | undefined>(undefined);
  const [ratioMenuOpen, setRatioMenuOpen] = React.useState(false);
  const [resMenuOpen, setResMenuOpen] = React.useState(false);
  const [durationMenuOpen, setDurationMenuOpen] = React.useState(false);
  const [showHistory, setShowHistory] = React.useState(false);

  const ratio: Ratio = (data.ratio as Ratio) || "16:9";
  const resolution: Resolution = (data.resolution as Resolution) || "720P";
  const duration: number =
    typeof data.duration === "number" && Number.isFinite(data.duration)
      ? Math.min(15, Math.max(3, Math.round(data.duration)))
      : 5;
  const referenceCount: number = (() => {
    const raw = Number(data.referenceCount);
    if (!Number.isFinite(raw)) return 1;
    return Math.min(MAX_REFS, Math.max(MIN_REFS, Math.round(raw)));
  })();

  const previewRequestParams = React.useMemo(
    () => ({
      generationMode: "r2v",
      resolution,
      duration,
      durationSec: duration,
    }),
    [resolution, duration]
  );
  const { credits: backendCredits } = useBackendCreditsPreview({
    serviceType: "happyhorse-r2v-video",
    model: "happyhorse-1.0-r2v",
    requestParams: {
      managedModelKey: "happyhorse-1.0-r2v",
      modelKey: "happyhorse-1.0-r2v",
      vendorKey: "dashscope",
      platformKey: "dashscope",
      aiProvider: "dashscope",
      ...previewRequestParams,
    },
    enabled: true,
  });
  const resolvedRunCredits =
    typeof backendCredits === "number" ? backendCredits : data.creditsPerCall;
  const { credits: runCredits, hasCredits: hasRunCredits } =
    useNodeRunCredits(resolvedRunCredits);

  const historyItems = React.useMemo<VideoHistoryItem[]>(
    () => (Array.isArray(data.history) ? data.history : []),
    [data.history]
  );

  const dispatchPatch = React.useCallback(
    (patch: Record<string, any>) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", { detail: { id, patch } })
      );
    },
    [id]
  );

  const handleApplyHistory = React.useCallback(
    (item: VideoHistoryItem) => {
      const patch: Record<string, any> = {
        videoUrl: item.videoUrl,
        thumbnail: item.thumbnail,
        videoVersion: Number(data.videoVersion || 0) + 1,
      };
      if (data.status !== "running") {
        patch.status = "succeeded";
        patch.error = undefined;
      }
      dispatchPatch(patch);
    },
    [dispatchPatch, data.videoVersion, data.status]
  );

  const formatHistoryTime = React.useCallback((iso: string) => {
    if (!iso) return "-";
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }, []);

  const truncatePrompt = React.useCallback(
    (text: string) => {
      if (!text) return lt("（无提示词）", "(No prompt)");
      return text.length > 80 ? `${text.slice(0, 80)}…` : text;
    },
    [lt]
  );

  const scheduleFeedbackClear = React.useCallback((delay: number = 3000) => {
    if (downloadFeedbackTimer.current) {
      window.clearTimeout(downloadFeedbackTimer.current);
      downloadFeedbackTimer.current = undefined;
    }
    downloadFeedbackTimer.current = window.setTimeout(() => {
      setDownloadFeedback(null);
      downloadFeedbackTimer.current = undefined;
    }, delay);
  }, []);

  const sanitizeMediaUrl = React.useCallback((url?: string | null) => {
    if (!url || typeof url !== "string") return undefined;
    const trimmed = url.trim();
    if (!trimmed) return undefined;
    const markdownSplit = trimmed.split("](");
    const candidate = markdownSplit.length > 1 ? markdownSplit[0] : trimmed;
    const spaceIdx = candidate.indexOf(" ");
    return spaceIdx > 0 ? candidate.slice(0, spaceIdx) : candidate;
  }, []);

  const sanitizedVideoUrl = React.useMemo(
    () => sanitizeMediaUrl((data as any)?.videoUrl),
    [data, sanitizeMediaUrl]
  );
  const sanitizedThumbnail = React.useMemo(
    () => sanitizeMediaUrl((data as any)?.thumbnail),
    [data, sanitizeMediaUrl]
  );

  React.useEffect(() => {
    if (!videoRef.current || !sanitizedVideoUrl) return;
    try {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
      videoRef.current.load();
    } catch (error) {
      console.warn("Unable to reset video player", error);
    }
  }, [sanitizedVideoUrl]);

  React.useEffect(() => {
    return () => {
      if (downloadFeedbackTimer.current) {
        window.clearTimeout(downloadFeedbackTimer.current);
        downloadFeedbackTimer.current = undefined;
      }
    };
  }, []);

  const copyVideoLink = React.useCallback(
    async (url?: string) => {
      if (!url) {
        setDownloadFeedback({
          type: "error",
          message: lt("没有可复制的视频链接", "No video link to copy"),
        });
        scheduleFeedbackClear(2000);
        return;
      }
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
          setDownloadFeedback({
            type: "success",
            message: lt("已复制视频链接", "Video link copied"),
          });
          scheduleFeedbackClear(2000);
          return;
        }
        const textArea = document.createElement("textarea");
        textArea.value = url;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        setDownloadFeedback({
          type: "success",
          message: lt("已复制视频链接", "Video link copied"),
        });
        scheduleFeedbackClear(2000);
      } catch {
        setDownloadFeedback({
          type: "error",
          message: lt("复制失败", "Copy failed"),
        });
        scheduleFeedbackClear(2000);
      }
    },
    [scheduleFeedbackClear, lt]
  );

  const triggerDownload = React.useCallback(
    async (url?: string) => {
      if (!url || isDownloading) return;
      setIsDownloading(true);
      setDownloadFeedback({
        type: "progress",
        message: lt("视频下载中，请稍等...", "Downloading video, please wait..."),
      });
      try {
        const isOss = url.includes("aliyuncs.com");
        const downloadUrl = isOss ? url : proxifyRemoteAssetUrl(url, { forceProxy: true });
        const response = await fetch(downloadUrl, { mode: "cors", credentials: "omit" });
        if (response.ok) {
          const blob = await response.blob();
          const videoBlob = blob.type.startsWith("video/")
            ? blob
            : new Blob([blob], { type: "video/mp4" });
          const blobUrl = URL.createObjectURL(videoBlob);
          const link = document.createElement("a");
          link.href = blobUrl;
          link.download = `video-${new Date().toISOString().split("T")[0]}.mp4`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 200);
          setDownloadFeedback({
            type: "success",
            message: lt("下载完成", "Download complete"),
          });
        } else {
          const link = document.createElement("a");
          link.href = url;
          link.target = "_blank";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setDownloadFeedback({
            type: "success",
            message: lt("已在新标签页打开视频链接", "Opened video link in a new tab"),
          });
        }
        scheduleFeedbackClear(3000);
      } catch (error) {
        console.error("Download failed:", error);
        setDownloadFeedback({
          type: "error",
          message: lt("下载失败，请稍后重试", "Download failed, please try again later"),
        });
        scheduleFeedbackClear(4000);
      } finally {
        setIsDownloading(false);
      }
    },
    [isDownloading, scheduleFeedbackClear, lt]
  );

  const renderPreview = () => {
    const commonStyle: React.CSSProperties = {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      borderRadius: 6,
      background: "#000",
    };
    if (sanitizedVideoUrl) {
      return (
        <video
          key={`${sanitizedVideoUrl}-${data.videoVersion || 0}`}
          ref={videoRef}
          controls
          poster={sanitizedThumbnail}
          style={commonStyle}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) {
              setPreviewAspect(`${v.videoWidth}/${v.videoHeight}`);
            }
          }}
        >
          <source src={sanitizedVideoUrl} type="video/mp4" />
        </video>
      );
    }
    if (sanitizedThumbnail) {
      return (
        <SmartImage
          src={sanitizedThumbnail}
          alt="video thumbnail"
          style={commonStyle}
        />
      );
    }
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          color: "#94a3b8",
        }}
      >
        <Video size={24} strokeWidth={2} />
        <div style={{ fontSize: 11 }}>
          {lt("等待生成...", "Waiting for generation...")}
        </div>
      </div>
    );
  };

  const referenceIndices = React.useMemo(
    () => Array.from({ length: referenceCount }, (_, i) => i + 1),
    [referenceCount]
  );

  const handleAdjustReferenceCount = React.useCallback(
    (delta: number) => {
      const next = Math.min(MAX_REFS, Math.max(MIN_REFS, referenceCount + delta));
      if (next !== referenceCount) {
        dispatchPatch({ referenceCount: next });
      }
    },
    [dispatchPatch, referenceCount]
  );

  const refHandleTopBase = 25; // 第一个 image handle 起始百分比
  const refHandleStep = 50 / Math.max(1, referenceCount); // 在 25%~75% 间均分

  return (
    <div
      style={{
        width: 280,
        padding: 10,
        background: "#fff",
        border: `1px solid ${selected ? "#2563eb" : "#e5e7eb"}`,
        borderRadius: 10,
        boxShadow: selected
          ? "0 0 0 2px rgba(37,99,235,0.12)"
          : "0 1px 2px rgba(0,0,0,0.04)",
        position: "relative",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{ top: "10%" }}
        onMouseEnter={() => setHover("text-in")}
        onMouseLeave={() => setHover(null)}
      />
      {referenceIndices.map((idx, arrIdx) => (
        <Handle
          key={`image-${idx}`}
          type="target"
          position={Position.Left}
          id={`image-${idx}`}
          style={{ top: `${refHandleTopBase + refHandleStep * (arrIdx + 0.5)}%` }}
          onMouseEnter={() => setHover(`image-${idx}-in`)}
          onMouseLeave={() => setHover(null)}
        />
      ))}
      <Handle
        type="source"
        position={Position.Right}
        id="video"
        style={{ top: "50%" }}
        onMouseEnter={() => setHover("video-out")}
        onMouseLeave={() => setHover(null)}
      />

      {hover === "text-in" && (
        <div className="flow-tooltip" style={{ left: -8, top: "10%", transform: "translate(-100%, -50%)" }}>
          prompt
        </div>
      )}
      {referenceIndices.map((idx, arrIdx) =>
        hover === `image-${idx}-in` ? (
          <div
            key={`tip-image-${idx}`}
            className="flow-tooltip"
            style={{
              left: -8,
              top: `${refHandleTopBase + refHandleStep * (arrIdx + 0.5)}%`,
              transform: "translate(-100%, -50%)",
            }}
          >
            character{idx}
          </div>
        ) : null
      )}
      {hover === "video-out" && (
        <div className="flow-tooltip" style={{ right: -8, top: "50%", transform: "translate(100%, -50%)" }}>
          video
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Video size={18} />
          <span>{lt("快乐马 R2V", "HappyHorse R2V")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            className="tanva-video-header-btn tanva-video-header-run run-btn-with-credit"
            onClick={() => data.onRun?.(id)}
            disabled={data.status === "running"}
            style={{
              minWidth: hasRunCredits ? 64 : 36,
              height: 32,
              padding: hasRunCredits ? "0 10px" : undefined,
              borderRadius: 8,
              border: "none",
              background: data.status === "running" ? "#e5e7eb" : "#111827",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: data.status === "running" ? "not-allowed" : "pointer",
              fontSize: 12,
              opacity: data.status === "running" ? 0.6 : 1,
            }}
          >
            {data.status === "running" ? (
              <span className="run-text-trigger">Running...</span>
            ) : (
              <>
                <span className="run-text-trigger">Run</span>
                {hasRunCredits ? <RunCreditBadge credits={runCredits} runButton /> : null}
              </>
            )}
          </button>
          <button
            className="tanva-video-header-btn tanva-video-header-share"
            onClick={() => copyVideoLink((data as any)?.videoUrl)}
            title={lt("复制链接", "Copy link")}
            style={{
              width: 36,
              height: 32,
              borderRadius: 8,
              border: "none",
              background: "#111827",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: (data as any)?.videoUrl ? "pointer" : "not-allowed",
              color: "#fff",
              opacity: (data as any)?.videoUrl ? 1 : 0.35,
            }}
            disabled={!(data as any)?.videoUrl}
          >
            <Share2 size={14} />
          </button>
          <button
            className="tanva-video-header-btn tanva-video-header-download"
            onClick={() => triggerDownload((data as any)?.videoUrl)}
            title={lt("下载视频", "Download video")}
            style={{
              width: 36,
              height: 32,
              borderRadius: 8,
              border: "none",
              background: !(data as any)?.videoUrl ? "#e5e7eb" : "#111827",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: !(data as any)?.videoUrl ? "not-allowed" : "pointer",
              color: "#fff",
              opacity: !(data as any)?.videoUrl ? 0.35 : 1,
            }}
            disabled={!(data as any)?.videoUrl || isDownloading}
          >
            {isDownloading ? (
              <span style={{ fontSize: 10, fontWeight: 600, color: "#111827" }}>···</span>
            ) : (
              <Download size={14} />
            )}
          </button>
        </div>
      </div>

      {downloadFeedback && (
        <div
          style={{
            margin: "2px 0",
            padding: "4px 8px",
            borderRadius: 6,
            fontSize: 11,
            border: `1px solid ${
              downloadFeedback.type === "error"
                ? "#fecaca"
                : downloadFeedback.type === "success"
                ? "#bbf7d0"
                : "#bfdbfe"
            }`,
            background:
              downloadFeedback.type === "error"
                ? "#fef2f2"
                : downloadFeedback.type === "success"
                ? "#ecfdf5"
                : "#eff6ff",
            color:
              downloadFeedback.type === "error"
                ? "#b91c1c"
                : downloadFeedback.type === "success"
                ? "#15803d"
                : "#1d4ed8",
          }}
        >
          {downloadFeedback.message}
        </div>
      )}

      {/* 参考图数量 +/- */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 12, color: "#6b7280" }}>
          {lt("参考图数量", "Reference images")}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            disabled={referenceCount <= MIN_REFS}
            onClick={() => handleAdjustReferenceCount(-1)}
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              border: "1px solid #e5e7eb",
              background: referenceCount <= MIN_REFS ? "#f3f4f6" : "#fff",
              cursor: referenceCount <= MIN_REFS ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Minus size={12} />
          </button>
          <span style={{ minWidth: 18, textAlign: "center", fontSize: 12 }}>
            {referenceCount}
          </span>
          <button
            type="button"
            disabled={referenceCount >= MAX_REFS}
            onClick={() => handleAdjustReferenceCount(1)}
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              border: "1px solid #e5e7eb",
              background: referenceCount >= MAX_REFS ? "#f3f4f6" : "#fff",
              cursor: referenceCount >= MAX_REFS ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* ratio 下拉 */}
      <div className="sora2-dropdown" style={{ marginBottom: 8, position: "relative" }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{lt("画幅", "Ratio")}</div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setResMenuOpen(false);
            setDurationMenuOpen(false);
            setRatioMenuOpen((o) => !o);
          }}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            background: "#fff",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <span>{ratio}</span>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{ratioMenuOpen ? "▴" : "▾"}</span>
        </button>
        {ratioMenuOpen && (
          <div
            className="sora2-dropdown-menu"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              zIndex: 20,
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: 8,
              boxShadow: "0 8px 16px rgba(15,23,42,0.08)",
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {RATIO_OPTIONS.map((opt) => {
                const active = opt === ratio;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      dispatchPatch({ ratio: opt });
                      setRatioMenuOpen(false);
                    }}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: `1px solid ${active ? "#2563eb" : "#e5e7eb"}`,
                      background: active ? "#2563eb" : "#fff",
                      color: active ? "#fff" : "#111827",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* resolution 下拉 */}
      <div className="sora2-dropdown" style={{ marginBottom: 8, position: "relative" }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
          {lt("分辨率", "Resolution")}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setRatioMenuOpen(false);
            setDurationMenuOpen(false);
            setResMenuOpen((o) => !o);
          }}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            background: "#fff",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <span>{resolution}</span>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{resMenuOpen ? "▴" : "▾"}</span>
        </button>
        {resMenuOpen && (
          <div
            className="sora2-dropdown-menu"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              zIndex: 20,
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: 8,
              boxShadow: "0 8px 16px rgba(15,23,42,0.08)",
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {RESOLUTION_OPTIONS.map((opt) => {
                const active = opt === resolution;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      dispatchPatch({ resolution: opt });
                      setResMenuOpen(false);
                    }}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: `1px solid ${active ? "#2563eb" : "#e5e7eb"}`,
                      background: active ? "#2563eb" : "#fff",
                      color: active ? "#fff" : "#111827",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* duration 下拉 */}
      <div className="sora2-dropdown" style={{ marginBottom: 8, position: "relative" }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
          {lt("时间长度", "Duration")}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setRatioMenuOpen(false);
            setResMenuOpen(false);
            setDurationMenuOpen((o) => !o);
          }}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            background: "#fff",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <span>{lt(`${duration}秒`, `${duration}s`)}</span>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{durationMenuOpen ? "▴" : "▾"}</span>
        </button>
        {durationMenuOpen && (
          <div
            className="sora2-dropdown-menu"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              zIndex: 20,
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: 8,
              boxShadow: "0 8px 16px rgba(15,23,42,0.08)",
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {DURATION_OPTIONS.map((opt) => {
                const active = opt === duration;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      dispatchPatch({ duration: opt });
                      setDurationMenuOpen(false);
                    }}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: `1px solid ${active ? "#2563eb" : "#e5e7eb"}`,
                      background: active ? "#2563eb" : "#fff",
                      color: active ? "#fff" : "#111827",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          width: "100%",
          aspectRatio: previewAspect,
          minHeight: 140,
          background: "#f8fafc",
          borderRadius: 6,
          border: "1px solid #eef0f2",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          marginBottom: 8,
        }}
      >
        {renderPreview()}
      </div>
      <GenerationProgressBar status={data.status || "idle"} />

      {historyItems.length > 0 && (
        <div
          className="tanva-video-history"
          style={{
            marginTop: 8,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            background: "#f8fafc",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              cursor: "pointer",
            }}
            onClick={() => setShowHistory(!showHistory)}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>
              {lt("历史记录", "History")}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>
                {historyItems.length} {lt("条", "items")}
              </span>
              <span style={{ fontSize: 14, color: "#64748b" }}>
                {showHistory ? "▴" : "▾"}
              </span>
            </div>
          </div>
          {showHistory &&
            historyItems.map((item, index) => {
              const isActive = item.videoUrl === data.videoUrl;
              return (
                <div
                  className="tanva-video-history-item"
                  key={item.id}
                  style={{
                    borderRadius: 6,
                    border: "1px solid " + (isActive ? "#c7d2fe" : "#e2e8f0"),
                    background: isActive ? "#eef2ff" : "#fff",
                    padding: "6px 8px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: 11,
                      color: "#475569",
                    }}
                  >
                    <span>
                      #{index + 1} · {formatHistoryTime(item.createdAt)}
                    </span>
                    {isActive && (
                      <span
                        style={{ fontSize: 10, color: "#1d4ed8", fontWeight: 600 }}
                      >
                        {lt("当前", "Current")}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#0f172a" }}>
                    {truncatePrompt(item.prompt)}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {!isActive && (
                      <button
                        type="button"
                        onClick={() => handleApplyHistory(item)}
                        style={{
                          padding: "4px 8px",
                          borderRadius: 6,
                          border: "1px solid #94a3b8",
                          background: "#fff",
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        {lt("设为当前", "Set as current")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => copyVideoLink(item.videoUrl)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: "1px solid #94a3b8",
                        background: "#fff",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      {lt("复制链接", "Copy link")}
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerDownload(item.videoUrl)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: "1px solid #94a3b8",
                        background: "#fff",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      {lt("下载", "Download")}
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {data.error && (
        <div
          style={{
            marginTop: 6,
            padding: "6px 8px",
            background: "#fef2f2",
            border: "1px solid #fecdd3",
            borderRadius: 6,
            color: "#b91c1c",
            fontSize: 12,
          }}
        >
          {data.error}
        </div>
      )}
    </div>
  );
}

export default React.memo(HappyhorseR2VNodeInner);
```

- [ ] **Step 2:** Type-check:

```bash
cd frontend && pnpm exec tsc -b --noEmit
```

Expected: no new errors. The component is not yet wired into FlowOverlay so TS won't see any unused-import warnings from that side.

- [ ] **Step 3:** Commit:

```bash
git add frontend/src/components/flow/nodes/HappyhorseR2VNode.tsx
git commit -m "feat(flow): add HappyhorseR2VNode component"
```

---

## Task 12: Register `happyhorseR2V` in FlowOverlay (registry & static maps)

**Files:**
- Modify: `frontend/src/components/flow/FlowOverlay.tsx` — multiple small inserts at known locations.

This task is one logical commit but many surgical edits. Use `grep` after each edit to confirm correctness. Each edit lists the exact anchor to find.

- [ ] **Step 1:** Add import. Find the import block where `Wan2R2VNode` is imported (around the same area as other node imports, usually a `const Wan2R2VNode = ...` lazy import or static `import Wan2R2VNode from`). Use `grep -n "Wan2R2VNode" frontend/src/components/flow/FlowOverlay.tsx | head` to find the import line, then add an analogous import for `HappyhorseR2VNode`:

```ts
import HappyhorseR2VNode from "./nodes/HappyhorseR2VNode";
```

- [ ] **Step 2:** Add to `nodeTypes` map (line 757 area). After `wan2R2V: Wan2R2VNode,`, insert:

```ts
  happyhorseR2V: HappyhorseR2VNode,
```

- [ ] **Step 3:** Add to two arrays at lines 914 and 958 (search for first occurrence of `"wan2R2V",`). After `"wan2R2V",` and before `"wan27Video",`, insert:

```ts
  "happyhorseR2V",
```

Do this for **both** occurrences in the file (lines 914-916 and 958-960 area). Use `grep -n '"wan2R2V",' frontend/src/components/flow/FlowOverlay.tsx | head -20` to enumerate all locations and ensure each has `"happyhorseR2V"` added.

- [ ] **Step 4:** `nodeCreditsMap` (line 1261). After `wan2R2V: 600, // 视频融合 - wan26-r2v`, insert:

```ts
  happyhorseR2V: 600, // fallback；实际由后端 perSecondByResolution 决定
```

- [ ] **Step 5:** Category items (line 1313). After the `wan2R2V` entry, insert:

```ts
  { key: "happyhorseR2V", zh: "快乐马 R2V", en: "HappyHorse R2V", category: "video" },
```

- [ ] **Step 6:** `nodeCategories` (line 1427). After `wan2R2V: "video",`, insert:

```ts
  happyhorseR2V: "video",
```

- [ ] **Step 7:** `nodeSizeMap` (line 1478). After `wan2R2V: { w: 300, h: 360 },`, insert (slightly taller because we have an extra resolution dropdown):

```ts
  happyhorseR2V: { w: 300, h: 460 },
```

- [ ] **Step 8:** Add to remaining static arrays. Run:

```bash
grep -n '"wan2R2V"' frontend/src/components/flow/FlowOverlay.tsx
```

For **each** line where `"wan2R2V"` appears as a standalone string in an array literal (not inside a connection-rule object — those come in Task 13), insert `"happyhorseR2V"` immediately after on the next line. Specifically:

- Line ~915, 959: video-node-type arrays (already covered in Step 3)
- Line ~1803: another video array
- Line ~8236, 8869, 8893, 8922, 8964, 9008, 9100, 9220, 9232, 9255, 9691: each is an array of video node types — add `"happyhorseR2V"` after `"wan2R2V"` in every one.
- Line ~9163: also an array — `["video", "sora2Video", "wan26", "wan2R2V", "wan27Video", ...]` — add `"happyhorseR2V"` between `"wan2R2V"` and `"wan27Video"`.

After each insert, re-run grep to track progress.

- [ ] **Step 9:** Add to nodeType-equality OR-chains. Search for `nodeType === "wan2R2V"` and `n.type === "wan2R2V"` and `targetNode.type === "wan2R2V"` and `targetNode?.type === "wan2R2V"`:

```bash
grep -nE 'nodeType === "wan2R2V"|\.type === "wan2R2V"' frontend/src/components/flow/FlowOverlay.tsx
```

For each line in the result (lines ~1856, 1881, 7852, 8995, 9418, 10030, 19070), inspect context. If the chain says e.g.:

```ts
nodeType === "wan26" ||
nodeType === "wan2R2V" ||
nodeType === "wan27Video" ||
```

— add `nodeType === "happyhorseR2V" ||` after the wan2R2V line. Same pattern for `n.type` / `targetNode.type` / `targetNode?.type` / `tgt?.type`.

**Subtle line:** `1878: if (nodeType === "wan27Video") return "1080P";` — this is the resolution-default lookup. Add a similar line for happyhorseR2V (default 720P):

```ts
  if (nodeType === "happyhorseR2V") return "720P";
```

Add right next to the wan27Video line.

- [ ] **Step 10:** The `7837/7852/7865` lines (`type === "wan2R2V"`) are inside a node-icon/title resolution chain. Search:

```bash
sed -n '7830,7880p' frontend/src/components/flow/FlowOverlay.tsx
```

Mirror the pattern — add a `: type === "happyhorseR2V"` branch returning the appropriate label/icon. If unclear what to return, use the same icon and label as `Wan2R2VNode` — adjust `Wan2R2V` text to `HappyHorse R2V`.

- [ ] **Step 11:** Type-check:

```bash
cd frontend && pnpm exec tsc -b --noEmit
```

Expected: no new errors. If you see errors about `HappyhorseR2VNode` not being found, check the import path. If errors mention duplicate keys, you double-inserted somewhere.

- [ ] **Step 12:** Commit:

```bash
git add frontend/src/components/flow/FlowOverlay.tsx
git commit -m "feat(flow): register happyhorseR2V in FlowOverlay registries & maps"
```

---

## Task 13: Register `happyhorseR2V` in FlowOverlay connection rules

**Files:**
- Modify: `frontend/src/components/flow/FlowOverlay.tsx` — touch the connection-rule arrays around line 1134-1199.

The new node accepts **image** sources on its `image-N` handles (not video sources like `wan2R2V`). The connection rules in FlowOverlay distinguish source/target compatibility.

- [ ] **Step 1:** Find the existing rule that registers `wan2R2V` as a video-target (around line 1134):

```ts
    { nodeType: "wan2R2V", targetHandle: "video-1" },
```

This is in an array that says "these node+handle pairs accept video sources." Do **not** add happyhorseR2V here (its image handles don't accept video).

- [ ] **Step 2:** Find the array around line 1181-1199 that lists `wan2R2V` as a video-source (it produces video output):

```ts
    { nodeType: "wan2R2V", sourceHandle: "video" },
```

Add right after, in **both** arrays where `wan2R2V` appears as `sourceHandle: "video"`:

```ts
    { nodeType: "happyhorseR2V", sourceHandle: "video" },
```

- [ ] **Step 3:** Find the **image-target** registration. Search:

```bash
grep -n 'targetHandle: "image"\|targetHandle: "image-' frontend/src/components/flow/FlowOverlay.tsx | head -30
```

Look for the array that lists nodes accepting image inputs (e.g., `wan27Video` with `targetHandle: "image"` and `"image-2"` from line 1135 area's neighbours). Register each image handle of `happyhorseR2V` as image-target. Append to that array (find similar entries for `wan27Video`):

```ts
    { nodeType: "happyhorseR2V", targetHandle: "image-1" },
    { nodeType: "happyhorseR2V", targetHandle: "image-2" },
    { nodeType: "happyhorseR2V", targetHandle: "image-3" },
    { nodeType: "happyhorseR2V", targetHandle: "image-4" },
    { nodeType: "happyhorseR2V", targetHandle: "image-5" },
    { nodeType: "happyhorseR2V", targetHandle: "image-6" },
    { nodeType: "happyhorseR2V", targetHandle: "image-7" },
    { nodeType: "happyhorseR2V", targetHandle: "image-8" },
    { nodeType: "happyhorseR2V", targetHandle: "image-9" },
```

If the existing image-handle registration uses a wildcard pattern instead of explicit list, follow that pattern instead.

- [ ] **Step 4:** Find the **text-target** registration (around the same connection rules block, search `targetHandle: "text"`):

```bash
grep -n 'targetHandle: "text"' frontend/src/components/flow/FlowOverlay.tsx | head
```

Append:

```ts
    { nodeType: "happyhorseR2V", targetHandle: "text" },
```

- [ ] **Step 5:** Type-check:

```bash
cd frontend && pnpm exec tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 6:** Commit:

```bash
git add frontend/src/components/flow/FlowOverlay.tsx
git commit -m "feat(flow): register happyhorseR2V connection rules (image-targets, video-source)"
```

---

## Task 14: Add the Run handler branch for `happyhorseR2V`

**Files:**
- Modify: `frontend/src/components/flow/FlowOverlay.tsx` — insert a new branch immediately **after** the `wan2R2V` Run branch (around line 12831, after `return;\n}` of the wan2R2V block) and **before** the `sora2Character` branch.

- [ ] **Step 1:** First confirm the import. Add to the imports for `aiBackendAPI`:

```bash
grep -n "generateWan26R2VViaAPI" frontend/src/components/flow/FlowOverlay.tsx
```

You should see one import line and one usage. In the import line, add `generateHappyhorseR2VViaAPI` to the destructured import.

- [ ] **Step 2:** Locate the wan2R2V Run branch closing brace (around line 12831):

```ts
        } catch (error) {
          const msg = error instanceof Error ? error.message : "任务提交失败";
          // ...
        }
        return;
      }

      if (node.type === "sora2Character") {
```

Insert this block **between** the wan2R2V's `return;\n}` and `if (node.type === "sora2Character") {`:

```ts
      // HappyHorse 1.0 R2V 节点处理逻辑（参考图生成视频）
      if (node.type === "happyhorseR2V") {
        const projectId = useProjectContentStore.getState().projectId;
        const { text: promptText, hasEdge: hasText } =
          getTextPromptForNode(nodeId);
        if (!hasText) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: "缺少 TextPrompt 输入",
                    },
                  }
                : n
            )
          );
          return;
        }
        const promptTrimmed = (promptText || "").trim();
        if (!promptTrimmed) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: "提示词为空" } }
                : n
            )
          );
          return;
        }

        const referenceCountRaw = Number((node.data as any)?.referenceCount);
        const referenceCount = Number.isFinite(referenceCountRaw)
          ? Math.min(9, Math.max(1, Math.round(referenceCountRaw)))
          : 1;

        // 收集 image-1 ~ image-N 边
        const imageEdges = currentEdges
          .filter(
            (e) =>
              e.target === nodeId &&
              typeof e.targetHandle === "string" &&
              /^image-\d+$/.test(e.targetHandle)
          )
          .sort((a, b) => {
            const ai = Number(String(a.targetHandle).slice(6));
            const bi = Number(String(b.targetHandle).slice(6));
            return ai - bi;
          })
          // 仅取当前 referenceCount 范围内的 handle
          .filter((e) => {
            const idx = Number(String(e.targetHandle).slice(6));
            return idx >= 1 && idx <= referenceCount;
          });

        if (!imageEdges.length) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: "请至少连接 1 张参考图",
                    },
                  }
                : n
            )
          );
          return;
        }

        const uploadResolvedImageEdge = async (
          edge: Edge
        ): Promise<string | undefined> => {
          const images = await resolveEdgesAsDataUrls([edge]);
          const firstImage = images.find(
            (value) => typeof value === "string" && value.trim().length > 0
          );
          if (!firstImage) return undefined;
          const trimmed = firstImage.trim();
          if (isRemoteUrl(trimmed)) {
            return normalizeStableRemoteUrl(trimmed);
          }
          const uploaded = await uploadImageToOSS(ensureDataUrl(trimmed), projectId);
          return uploaded || undefined;
        };

        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, status: "running", error: undefined } }
              : n
          )
        );

        try {
          const referenceImageUrls: string[] = [];
          for (const edge of imageEdges) {
            const url = await uploadResolvedImageEdge(edge);
            if (url) referenceImageUrls.push(url);
          }
          if (!referenceImageUrls.length) {
            throw new Error("参考图为空");
          }

          const ratio = ((node.data as any)?.ratio as
            | "16:9"
            | "9:16"
            | "1:1"
            | "4:3"
            | "3:4"
            | undefined) || "16:9";
          const resolution = (((node.data as any)?.resolution as
            | "720P"
            | "1080P"
            | undefined) || "720P");
          const durationVal = (() => {
            const raw = Number((node.data as any)?.duration);
            if (!Number.isFinite(raw)) return 5;
            return Math.min(15, Math.max(3, Math.round(raw)));
          })();

          const result = await generateHappyhorseR2VViaAPI({
            prompt: promptTrimmed,
            referenceImageUrls,
            parameters: { ratio, resolution, duration: durationVal },
          });

          const extractVideoUrl = (obj: any): string | undefined => {
            if (!obj) return undefined;
            return (
              obj.videoUrl ||
              obj.video_url ||
              obj.output?.video_url ||
              (Array.isArray(obj.output) && obj.output[0]?.video_url) ||
              obj.raw?.output?.video_url ||
              obj.raw?.video_url ||
              undefined
            );
          };

          if (!result?.success) {
            throw new Error(result?.error?.message || "任务提交失败");
          }
          const videoUrl = extractVideoUrl(result.data);
          if (!videoUrl) {
            throw new Error("未返回视频地址");
          }

          const thumbnail = (result.data as any)?.thumbnail;
          const historyEntry = {
            id: `history-${Date.now()}`,
            videoUrl,
            thumbnail,
            prompt: promptTrimmed,
            quality: `${resolution} / ${durationVal}s`,
            createdAt: new Date().toISOString(),
            referenceCount: referenceImageUrls.length,
          };

          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? (() => {
                    const previousData = (n.data as any) || {};
                    return {
                      ...n,
                      data: {
                        ...previousData,
                        status: "succeeded",
                        videoUrl,
                        thumbnail,
                        error: undefined,
                        videoVersion:
                          Number(previousData.videoVersion || 0) + 1,
                        history: appendVideoHistory(
                          previousData.history as
                            | Array<Record<string, any>>
                            | undefined,
                          historyEntry
                        ),
                      },
                    };
                  })()
                : n
            )
          );
        } catch (error) {
          const msg =
            error instanceof Error ? error.message : "任务提交失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                : n
            )
          );
        }
        return;
      }

```

- [ ] **Step 3:** The above uses `useProjectContentStore`, `resolveEdgesAsDataUrls`, `isRemoteUrl`, `normalizeStableRemoteUrl`, `uploadImageToOSS`, `ensureDataUrl`, `appendVideoHistory`. All of these are already in scope from the wan27Video branch in this same function. Verify by searching:

```bash
grep -nE "resolveEdgesAsDataUrls|appendVideoHistory|ensureDataUrl|useProjectContentStore" frontend/src/components/flow/FlowOverlay.tsx | head -10
```

Expected: each name appears multiple times (definition + usage by wan27Video). If any is missing, look at the wan27Video branch to see where it's imported / defined and copy that import to your branch.

- [ ] **Step 4:** Type-check:

```bash
cd frontend && pnpm exec tsc -b --noEmit
```

Expected: no errors. If `Edge` type isn't in scope where your branch lives, import it from `reactflow` at the top of the file (it likely already is).

- [ ] **Step 5:** Commit:

```bash
git add frontend/src/components/flow/FlowOverlay.tsx
git commit -m "feat(flow): add happyhorseR2V Run handler branch"
```

---

## Task 15: Register `happyhorseR2V` in `Admin.tsx`

**Files:**
- Modify: `frontend/src/pages/Admin.tsx`

- [ ] **Step 1:** Add the node type option (around line 1961). After the `wan2R2V` entry:

```ts
    { value: "happyhorseR2V", label: "快乐马 R2V 节点", category: "video" },
```

- [ ] **Step 2:** Add managedModel → flowNode mapping (around line 1992). After:

```ts
  if (modelKey === "wan-2.6-r2v") return "wan2R2V";
```

insert:

```ts
  if (modelKey === "happyhorse-1.0-r2v") return "happyhorseR2V";
```

- [ ] **Step 3:** Add to managedModelKey mapping table (around line 4072). After:

```ts
  "wan-2.6-r2v": ["wan2.6-r2v"],
```

insert:

```ts
  "happyhorse-1.0-r2v": ["happyhorse-1.0-r2v"],
```

- [ ] **Step 4:** Add to managedModelKey → serviceType mapping (around line 4100). After:

```ts
  "wan-2.6-r2v": "wan26-r2v",
```

insert:

```ts
  "happyhorse-1.0-r2v": "happyhorse-r2v-video",
```

- [ ] **Step 5:** Add the model default config (around line 2982). Find the wan-2.6-r2v block (look near the existing `flowNodeType: "wan2R2V"`). Insert a similar block:

```ts
        {
          modelKey: "happyhorse-1.0-r2v",
          modelName: "HappyHorse 1.0 R2V",
          taskType: "video",
          flowNodeType: "happyhorseR2V",
          nodeKey: "happyhorseR2V",
          enabled: true,
          defaultVendor: "dashscope",
          vendors: [
            {
              vendorKey: "dashscope",
              platformKey: "dashscope",
              label: "DashScope",
              enabled: true,
              route: "legacy",
              provider: "dashscope",
            },
          ],
        },
```

(Only include the keys the surrounding existing model entries use — match the structure of the wan2.6-r2v default model entry exactly. If there are extra fields like `metadata`, `description`, etc. in the wan-2.6-r2v default entry, mirror those.)

- [ ] **Step 6:** Type-check:

```bash
cd frontend && pnpm exec tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 7:** Commit:

```bash
git add frontend/src/pages/Admin.tsx
git commit -m "feat(admin): register happyhorse-1.0-r2v in admin model mappings"
```

---

## Task 16: Frontend full-build sanity check

**Files:**
- Verify only.

- [ ] **Step 1:** Run a clean type check + build:

```bash
cd frontend && pnpm exec tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 2:** Vite build (catches dynamic-import resolution issues that pure tsc misses):

```bash
cd frontend && pnpm build
```

Expected: build succeeds. If a slow build is unacceptable, you can skip this step and rely on dev-server import errors.

- [ ] **Step 3:** No commit (verification only).

---

## Task 17: End-to-end smoke test

**Files:**
- Verify only.

- [ ] **Step 1:** Start backend:

```bash
cd backend && pnpm dev
```

Wait until you see "Nest application successfully started" and `Mapped {/ai/dashscope/generate-happyhorse-r2v, POST}` in the log.

- [ ] **Step 2:** In another terminal, start frontend:

```bash
cd frontend && pnpm dev
```

- [ ] **Step 3:** Open the browser, log in, open a new project.

- [ ] **Step 4:** Open the node category panel, find "快乐马 R2V" under Video, drag it onto the canvas.

- [ ] **Step 5:** Verify the default state:
- 1 image handle on the left (image-1)
- prompt text handle above
- ratio = 16:9, resolution = 720P, duration = 5s
- Run button shows the credit badge with **600** (5 × 120)

- [ ] **Step 6:** Switch resolution to 1080P. Verify badge updates to **1000** (5 × 200).

- [ ] **Step 7:** Switch duration to 10s. Verify badge updates to **2000** (10 × 200).

- [ ] **Step 8:** Click "+" to add image handles up to 9. Verify the node grows additional left-side handles, each labelled `character{idx}` on hover.

- [ ] **Step 9:** Click "−" to drop back to 1.

- [ ] **Step 10:** Connect:
- a TextPrompt node to the `text` handle with a sample prompt referencing `character1`
- one Image node to `image-1`

- [ ] **Step 11:** Set resolution = 720P, duration = 5s. Click Run. Wait for the upstream task to finish (≤ 10 min). Verify:
- Status moves running → succeeded
- A video appears in the preview area
- Credits balance decreases by **600**
- The transaction remark shows "快乐马参考视频" (Chinese name) and includes 720P / 5秒 in the dimensions

- [ ] **Step 12:** Test failure path: disconnect the image node, click Run. Verify the error "请至少连接 1 张参考图" is shown and **no credits are deducted**.

- [ ] **Step 13:** No commit.

---

## Self-Review

(Performed inline by the planner before handing off.)

**Spec coverage:**

| Spec section | Implemented in task |
|---|---|
| §3.1 controller endpoint | Task 7 |
| §3.2 body normalizer | Task 6 |
| §3.3 credit params builder | Task 6 |
| §3.4 credits.config.ts entry | Task 1 |
| §3.5 credits.service resolver | Task 3 |
| §3.6 service-type registration | Task 2 |
| §3.7 admin node defaults | Task 8 |
| §4.1 node component | Task 11 |
| §4.2 API client | Task 10 |
| §4.3 FlowOverlay registration | Tasks 12, 13 |
| §4.4 Admin.tsx | Task 15 |
| §4.5 Run trigger logic | Task 14 |
| §6 边界与异常 | Task 14 (frontend Run guards), Task 17 (smoke test for failure path) |

Note: Spec §3.5 mentions extending `resolveManagedVideoServiceName` to surface a "HappyHorse 视频（720P / 5秒）" remark. Skipped in plan because the existing `serviceName: '快乐马参考视频'` plus `buildBillingRemark`'s automatic resolution/duration extraction already produces a useful remark like "模型: happyhorse-1.0-r2v | 时长: 5s | 分辨率: 720P". If the QA in Task 17 step 11 shows an unhelpful remark, add a one-liner to `resolveManagedVideoServiceName` similar to the doubao block, but otherwise this is unnecessary code.

**Placeholder scan:** No "TBD" / "implement later" / "appropriate handling" remained on review.

**Type consistency:** `serviceType: 'happyhorse-r2v-video'`, `nodeKey: 'happyhorseR2V'`, `managedModelKey: 'happyhorse-1.0-r2v'`, `model: 'happyhorse-1.0-r2v'` — confirmed identical across backend & frontend tasks.

**Pricing consistency:** 720P=120 credits/s and 1080P=200 credits/s used in: credits.config.ts (Task 1), resolver (Task 3), node-config metadata (Task 8 — implicit via `creditsPerCall`/`priceYuan`), node component default (Task 11 — defaults to 720P which yields 600 fallback), and smoke test assertions (Task 17).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-27-happyhorse-r2v.md`. Two execution options:

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
