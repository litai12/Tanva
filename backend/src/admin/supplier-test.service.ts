import { Injectable, Logger } from '@nestjs/common';
import { ApiProtocolType } from '../common/api-protocol.enum';

// 兼容旧代码的别名（逐步迁移）
export type ApiProtocol = ApiProtocolType;
export type SupplierProvider = ApiProtocolType;

export interface SupplierTestRequest {
  agencyName: string;           // 渠道/代理商名称，仅用于日志展示
  apiProtocol: ApiProtocolType; // 底层协议，决定 payload 结构
  modelName?: string;           // 具体模型标识（可选，未传则按协议使用默认兜底）
  baseUrl: string;
  apiKey: string;
  prompt: string;
}

export interface SupplierTestResult {
  success: boolean;
  agencyName: string;
  apiProtocol: ApiProtocolType;
  taskId?: string;
  resultUrl?: string;
  elapsedMs?: number;
  ttfbMs?: number;
  tokens?: number;
  cost?: string;
  error?: string;
  requestPayload?: object;
  responseBody?: object;
}

// ─── 流式事件类型 ─────────────────────────────────────────────
export type StreamEventType = 'log' | 'ttfb' | 'poll' | 'done' | 'error';

export interface StreamEvent {
  event: StreamEventType;
  data: Record<string, any>;
}

// ─── Payload 构建器（严格面向 ApiProtocolType 枚举编程）─────────
export class PayloadBuilder {
  static defaultModelName(protocol: ApiProtocolType): string {
    switch (protocol) {
      case ApiProtocolType.OPENAI_COMPATIBLE:
        return 'gpt-4o';
      case ApiProtocolType.KLING_NATIVE:
        return 'kling-v1-6';
      case ApiProtocolType.VIDU_NATIVE:
        return 'viduq2';
      case ApiProtocolType.DOUBAO_VOLC_NATIVE:
        return 'doubao-seedance-1-5-pro-251215';
      case ApiProtocolType.ASYNC_PROXY_STANDARD:
        return 'sora-2';
    }
  }

  static resolveModelName(protocol: ApiProtocolType, modelName?: string): string {
    const normalized = modelName?.trim();
    if (normalized) return normalized;
    return this.defaultModelName(protocol);
  }

  static build(protocol: ApiProtocolType, prompt: string, modelName?: string): object {
    const resolvedModelName = this.resolveModelName(protocol, modelName);
    switch (protocol) {
      case ApiProtocolType.OPENAI_COMPATIBLE:
        // 标准 OpenAI Chat Completions 格式
        return {
          model: resolvedModelName,
          messages: [{ role: 'user', content: prompt }],
        };

      case ApiProtocolType.KLING_NATIVE:
        return { model_name: resolvedModelName, prompt, duration: '5' };

      case ApiProtocolType.VIDU_NATIVE:
        return { model: resolvedModelName, prompt, duration: 5, resolution: '720p' };

      case ApiProtocolType.DOUBAO_VOLC_NATIVE:
        return {
          model: resolvedModelName,
          content: [{ type: 'text', text: `${prompt} --ratio 16:9 --dur 5` }],
        };

      case ApiProtocolType.ASYNC_PROXY_STANDARD:
        // APIMart / 新147 / 贞贞 均兼容此格式
        return { model: resolvedModelName, prompt, duration: 10, ratio: '16:9' };
    }
  }

  /**
   * 统一清洗密钥输入，兼容用户误贴 `Bearer xxx`、前后空白等情况。
   */
  static normalizeApiKey(rawKey: string): string {
    return rawKey.replace(/^Bearer\s+/i, '').trim();
  }

  /**
   * 净化 Base URL：剥离末尾斜杠及常见的代理商路径后缀。
   * 例如 https://models.kapon.cloud/vidu/ → https://models.kapon.cloud
   */
  static sanitizeBaseUrl(rawUrl: string): string {
    // 已知代理后缀（按长度降序，避免 /sora 先于 /sora2 匹配）
    const PROXY_SUFFIXES = [
      '/apimart', '/xin147', '/zhenzhen',
      '/doubao', '/kling', '/vidu', '/sora2', '/sora',
      '/openai', '/chatgpt',
    ];
    let url = rawUrl.replace(/\/+$/, ''); // 去掉末尾所有斜杠
    for (const suffix of PROXY_SUFFIXES) {
      if (url.toLowerCase().endsWith(suffix)) {
        url = url.slice(0, url.length - suffix.length);
        break; // 只剥一层
      }
    }
    return url;
  }

  /**
   * 将净化后的 base 与 path 安全拼接，确保无双斜杠。
   */
  private static joinUrl(base: string, path: string): string {
    const cleanBase = this.sanitizeBaseUrl(base);
    const cleanPath = '/' + path.replace(/^\/+/, '');
    return cleanBase + cleanPath;
  }

  /**
   * 每个协议的原生路径定义（与 base URL 无关）
   * submitPath: 提交任务的路径
   * statusPath: 轮询状态的路径（:taskId 占位符会被替换）
   */
  private static readonly PROTOCOL_PATHS: Record<
    ApiProtocolType,
    { submitPath: string; statusPath: string }
  > = {
    [ApiProtocolType.OPENAI_COMPATIBLE]: {
      submitPath: '/v1/chat/completions',
      statusPath: '/v1/chat/completions',
    },
    [ApiProtocolType.KLING_NATIVE]: {
      submitPath: '/kling/v1/videos/text2video',
      statusPath: '/kling/v1/videos/text2video/:taskId',
    },
    [ApiProtocolType.VIDU_NATIVE]: {
      submitPath: '/vidu/ent/v2/text2video',
      statusPath: '/vidu/ent/v2/tasks/:taskId/creations',
    },
    [ApiProtocolType.DOUBAO_VOLC_NATIVE]: {
      submitPath: '/v1/video/generations',
      // 备选：部分代理商使用 /v1/videos/generations
      statusPath: '/v1/video/generations/:taskId',
    },
    [ApiProtocolType.ASYNC_PROXY_STANDARD]: {
      submitPath: '/v1/video/generations',
      statusPath: '/v1/video/generations/:taskId',
    },
  };

  static submitUrl(protocol: ApiProtocolType, baseUrl: string): string {
    const { submitPath } = this.PROTOCOL_PATHS[protocol];
    return this.joinUrl(baseUrl, submitPath);
  }

  static submitUrlCandidates(protocol: ApiProtocolType, baseUrl: string): string[] {
    if (protocol === ApiProtocolType.VIDU_NATIVE) {
      const normalizedBase = baseUrl.replace(/\/+$/, '').toLowerCase();
      const preferViduPrefix = normalizedBase.endsWith('/vidu');

      // Vidu 在代理商网关下可能存在路径差异：/vidu/ent/v2/* 或 /ent/v2/* 或 /v2/*。
      const candidates = preferViduPrefix
        ? [
            this.joinUrl(baseUrl, '/ent/v2/text2video'),
            this.joinUrl(baseUrl, '/vidu/ent/v2/text2video'),
            this.joinUrl(baseUrl, '/v2/text2video'),
          ]
        : [
            this.joinUrl(baseUrl, '/vidu/ent/v2/text2video'),
            this.joinUrl(baseUrl, '/ent/v2/text2video'),
            this.joinUrl(baseUrl, '/v2/text2video'),
          ];

      return [...new Set(candidates)];
    }

    if (protocol !== ApiProtocolType.DOUBAO_VOLC_NATIVE) {
      return [this.submitUrl(protocol, baseUrl)];
    }

    const normalizedBase = baseUrl.replace(/\/+$/, '').toLowerCase();

    // 直连火山引擎官方端点，直接使用官方路径
    if (normalizedBase.includes('volces.com') || normalizedBase.includes('ark.cn-beijing')) {
      return [this.joinUrl(baseUrl, '/api/v3/contents/generations/tasks')];
    }

    const preferDoubaoPrefix = normalizedBase.endsWith('/doubao');

    // Doubao 在代理商网关下经常存在路由差异，按优先级做 endpoint 盲测回退。
    const candidates = preferDoubaoPrefix
      ? [
          this.joinUrl(baseUrl, '/doubao/v1/video/generations'),
          this.joinUrl(baseUrl, '/doubao/v1/videos/generations'),
          this.joinUrl(baseUrl, '/v1/video/generations'),
          this.joinUrl(baseUrl, '/v1/videos/generations'),
          this.joinUrl(baseUrl, '/api/v3/contents/generations/tasks'),
        ]
      : [
          this.joinUrl(baseUrl, '/v1/video/generations'),
          this.joinUrl(baseUrl, '/v1/videos/generations'),
          this.joinUrl(baseUrl, '/doubao/v1/video/generations'),
          this.joinUrl(baseUrl, '/doubao/v1/videos/generations'),
          this.joinUrl(baseUrl, '/api/v3/contents/generations/tasks'),
        ];

    return [...new Set(candidates)];
  }

  static statusUrl(protocol: ApiProtocolType, baseUrl: string, taskId: string): string {
    const { statusPath } = this.PROTOCOL_PATHS[protocol];
    return this.joinUrl(baseUrl, statusPath.replace(':taskId', taskId));
  }

  static statusUrlFromSubmit(
    protocol: ApiProtocolType,
    baseUrl: string,
    taskId: string,
    submitUrlUsed?: string,
  ): string {
    if (protocol === ApiProtocolType.VIDU_NATIVE && submitUrlUsed) {
      const submitUrl = submitUrlUsed.replace(/\/+$/, '');
      const submitSuffixes = ['/text2video', '/img2video', '/reference2video', '/start-end2video'];
      for (const suffix of submitSuffixes) {
        if (submitUrl.toLowerCase().endsWith(suffix)) {
          return `${submitUrl.slice(0, -suffix.length)}/tasks/${taskId}/creations`;
        }
      }
      return `${submitUrl}/tasks/${taskId}/creations`;
    }

    if (protocol === ApiProtocolType.DOUBAO_VOLC_NATIVE && submitUrlUsed) {
      return `${submitUrlUsed.replace(/\/+$/, '')}/${taskId}`;
    }
    return this.statusUrl(protocol, baseUrl, taskId);
  }

  static extractTaskId(protocol: ApiProtocolType, body: any): string | null {
    switch (protocol) {
      case ApiProtocolType.OPENAI_COMPATIBLE:
        // 同步响应，用响应 id 作为 taskId 占位
        return body?.id ?? null;

      case ApiProtocolType.ASYNC_PROXY_STANDARD:
        return body?.id ?? body?.task_id ?? null;

      case ApiProtocolType.KLING_NATIVE:
        return body?.data?.task_id ?? body?.task_id ?? body?.id ?? null;

      case ApiProtocolType.DOUBAO_VOLC_NATIVE:
        // Kapon Doubao proxy: { "id": "...", "status": "queued" }
        return body?.id ?? body?.task_id ?? null;

      case ApiProtocolType.VIDU_NATIVE:
        // Vidu 响应: { "task_id": "vidu-xxx" } 或 { "id": "vidu-xxx" }
        return body?.task_id ?? body?.id ?? null;
    }
  }

  static extractStatus(
    protocol: ApiProtocolType,
    body: any,
  ): { done: boolean; url?: string; failed?: boolean; rawStatus?: string } {
    switch (protocol) {
      case ApiProtocolType.OPENAI_COMPATIBLE:
        // 同步响应，提交即完成
        return { done: true, url: body?.choices?.[0]?.message?.content };

      case ApiProtocolType.ASYNC_PROXY_STANDARD: {
        const rawStatus = body?.status ?? body?.data?.status;
        if (rawStatus === 'succeeded' || rawStatus === 'succeed' || rawStatus === 'completed') {
          const url = body?.output?.video_url ?? body?.data?.video_url ?? body?.video_url;
          return { done: true, url, rawStatus };
        }
        if (rawStatus === 'failed' || rawStatus === 'error') return { done: true, failed: true, rawStatus };
        return { done: false, rawStatus };
      }

      case ApiProtocolType.KLING_NATIVE: {
        const data = body?.data ?? body;
        const rawStatus = data?.task_status ?? data?.status;
        if (rawStatus === 'succeed' || rawStatus === 'succeeded' || rawStatus === 'completed') {
          const url =
            data?.task_result?.videos?.[0]?.url ??
            data?.video_url ??
            data?.output?.video_url;
          return { done: true, url, rawStatus };
        }
        if (rawStatus === 'failed' || rawStatus === 'error') return { done: true, failed: true, rawStatus };
        return { done: false, rawStatus };
      }

      case ApiProtocolType.DOUBAO_VOLC_NATIVE: {
        // Kapon Doubao proxy: { "status": "succeeded|failed|queued|running", "content": { "video_url": "..." } }
        const rawStatus = body?.status;
        if (rawStatus === 'succeeded' || rawStatus === 'completed') {
          const url = body?.content?.video_url ?? body?.video_url;
          return { done: true, url, rawStatus };
        }
        if (rawStatus === 'failed' || rawStatus === 'error') return { done: true, failed: true, rawStatus };
        return { done: false, rawStatus };
      }

      case ApiProtocolType.VIDU_NATIVE: {
        // Vidu 轮询响应: { "state": "success|processing|failed", "creations": [{ "url": "..." }] }
        const rawStatus = body?.state;
        if (rawStatus === 'success') {
          const url = body?.creations?.[0]?.url;
          return { done: true, url, rawStatus };
        }
        if (rawStatus === 'failed') return { done: true, failed: true, rawStatus };
        return { done: false, rawStatus };
      }
    }
  }

  static authHeader(protocol: ApiProtocolType, apiKey: string): Record<string, string> {
    // 所有协议目前均使用 Bearer Token，预留扩展点
    return { Authorization: `Bearer ${this.normalizeApiKey(apiKey)}` };
  }

  static extractTokenUsage(body: any): { tokens?: number; cost?: string } {
    const usage = body?.usage ?? body?.data?.usage;
    if (!usage) return {};
    const tokens = usage.total_tokens ?? usage.completion_tokens ?? usage.output_tokens;
    return { tokens: tokens ?? undefined };
  }

  static extractRateLimit(headers: Headers): { remaining?: number; reset?: string } {
    const remaining = headers.get('x-ratelimit-remaining');
    const reset = headers.get('x-ratelimit-reset');
    return {
      remaining: remaining != null ? parseInt(remaining, 10) : undefined,
      reset: reset ?? undefined,
    };
  }
}

// ─── 服务主体 ─────────────────────────────────────────────────
const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

@Injectable()
export class SupplierTestService {
  private readonly logger = new Logger(SupplierTestService.name);

  private shouldRetryNextSubmitEndpoint(protocol: ApiProtocolType, status: number): boolean {
    if (protocol === ApiProtocolType.VIDU_NATIVE) {
      return [404, 405].includes(status);
    }
    return protocol === ApiProtocolType.DOUBAO_VOLC_NATIVE && [401, 403, 404].includes(status);
  }

  private submitFailurePriority(status: number): number {
    if (status === 401 || status === 403) return 100; // 鉴权失败最关键，优先暴露
    if (status === 429) return 90;
    if (status >= 500) return 80;
    if (status >= 400) return 70;
    return 0;
  }

  /** 验证入参，返回错误字符串或 null */
  private validate(req: SupplierTestRequest): string | null {
    const normalizedBaseUrl = req.baseUrl?.trim() ?? '';
    const normalizedApiKey = PayloadBuilder.normalizeApiKey(req.apiKey ?? '');

    if (!normalizedBaseUrl || !/^https?:\/\//i.test(normalizedBaseUrl))
      return 'baseUrl 不合法，必须以 http:// 或 https:// 开头';
    if (!normalizedApiKey || normalizedApiKey.length < 8)
      return 'apiKey 不合法，请填写真实密钥';
    if (!req.prompt || req.prompt.trim().length === 0)
      return 'prompt 不能为空';
    return null;
  }

  /**
   * 流式测试 — AsyncGenerator，供 Controller 用 for-await 推送 SSE
   */
  async *streamTest(req: SupplierTestRequest): AsyncGenerator<StreamEvent> {
    const agencyName = req.agencyName;
    const apiProtocol = req.apiProtocol;
    const modelName = req.modelName;
    const baseUrl = req.baseUrl.trim();
    const apiKey = PayloadBuilder.normalizeApiKey(req.apiKey);
    const prompt = req.prompt.trim();

    const validationError = this.validate(req);
    if (validationError) {
      yield { event: 'error', data: { message: validationError } };
      return;
    }

    const startTime = Date.now();
    const resolvedModelName = PayloadBuilder.resolveModelName(apiProtocol, modelName);
    const requestPayload = PayloadBuilder.build(apiProtocol, prompt, resolvedModelName);
    const submitCandidates = PayloadBuilder.submitUrlCandidates(apiProtocol, baseUrl);
    const submitUrl = submitCandidates[0];

    yield { event: 'log', data: { message: `▶ 正在提交任务 [${agencyName}] 协议=${apiProtocol}...` } };
    yield { event: 'log', data: { message: `  ▶ 最终请求 URL: POST ${submitUrl}` } };
    if (submitCandidates.length > 1) {
      yield { event: 'log', data: { message: `  ↻ Endpoint 候选: ${submitCandidates.join(' | ')}` } };
    }
    yield { event: 'log', data: { message: `  Model: ${resolvedModelName}` } };
    yield { event: 'log', data: { message: `  Payload: ${JSON.stringify(requestPayload).slice(0, 200)}` } };

    // ── 1. 提交任务，记录 TTFB ──────────────────────────────────
    let taskId = '';
    let submitResponseBody: any;
    let ttfbMs = 0;
    let submitUrlUsed = submitUrl;
    let bestSubmitFailure:
      | { status: number; rawText: string; responseBody: any; url: string; priority: number }
      | null = null;

    try {
      const headers = {
        'Content-Type': 'application/json',
        ...PayloadBuilder.authHeader(apiProtocol, apiKey),
      };

      for (let i = 0; i < submitCandidates.length; i++) {
        const candidateUrl = submitCandidates[i];
        submitUrlUsed = candidateUrl;

        if (i > 0) {
          yield { event: 'log', data: { message: `  ↻ Endpoint 回退尝试 [${i + 1}/${submitCandidates.length}]: POST ${candidateUrl}` } };
        }

        const ttfbStart = Date.now();
        const res = await fetch(candidateUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestPayload),
        });
        ttfbMs = Date.now() - ttfbStart;

        const contentType = res.headers.get('content-type') ?? '';
        if (contentType.includes('text/html')) {
          if (i < submitCandidates.length - 1) {
            yield { event: 'log', data: { message: `  ⚠ 路径疑似无效（返回 HTML），尝试下一个 endpoint` } };
            continue;
          }
          throw new Error(`接口路径错误！服务器返回了 HTML 网页而非 JSON。请检查 Base URL 是否正确。实际请求 URL: ${candidateUrl}`);
        }

        const rawText = await res.text();
        yield { event: 'log', data: { message: `  HTTP ${res.status} (${contentType}) · 原始响应: ${rawText.slice(0, 300)}${rawText.length > 300 ? '…' : ''}` } };

        try { submitResponseBody = JSON.parse(rawText); } catch { submitResponseBody = { _raw: rawText.slice(0, 200) }; }

        if (!res.ok) {
          const failure = {
            status: res.status,
            rawText,
            responseBody: submitResponseBody,
            url: candidateUrl,
            priority: this.submitFailurePriority(res.status),
          };
          if (!bestSubmitFailure || failure.priority >= bestSubmitFailure.priority) {
            bestSubmitFailure = failure;
          }

          if (i < submitCandidates.length - 1 && this.shouldRetryNextSubmitEndpoint(apiProtocol, res.status)) {
            yield { event: 'log', data: { message: `  ⚠ endpoint 返回 ${res.status}，继续尝试下一个候选路径` } };
            continue;
          }
          // 统一在循环结束后按优先级输出最有价值的失败原因，避免末尾 404 覆盖前面的 401/403。
          break;
        }

        taskId = PayloadBuilder.extractTaskId(apiProtocol, submitResponseBody) ?? '';
        if (!taskId) {
          yield { event: 'error', data: { message: `无法提取 taskId (HTTP ${res.status})，原始响应: ${rawText.slice(0, 500)}`, requestPayload, responseBody: submitResponseBody } };
          return;
        }

        break;
      }
    } catch (e: any) {
      yield { event: 'error', data: { message: `提交请求异常: ${e.message}`, requestPayload } };
      return;
    }

    if (!taskId) {
      if (bestSubmitFailure) {
        yield {
          event: 'error',
          data: {
            message: `提交失败 HTTP ${bestSubmitFailure.status}: ${bestSubmitFailure.rawText.slice(0, 500)}`,
            requestPayload,
            responseBody: bestSubmitFailure.responseBody,
          },
        };
        return;
      }
      yield { event: 'error', data: { message: '提交失败：所有候选 endpoint 均不可用', requestPayload, responseBody: submitResponseBody } };
      return;
    }

    yield { event: 'ttfb', data: { ttfbMs } };
    yield { event: 'log', data: { message: `✓ 任务已提交，taskId=${taskId}，TTFB=${ttfbMs}ms` } };
    yield { event: 'log', data: { message: `  ✓ 命中 Endpoint: ${submitUrlUsed}` } };

    // ── 2. 轮询等待结果 ──────────────────────────────────────────
    const authHeaders = PayloadBuilder.authHeader(apiProtocol, apiKey);
    const statusUrl = PayloadBuilder.statusUrlFromSubmit(apiProtocol, baseUrl, taskId, submitUrlUsed);
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let attempt = 0;
    let lastResponseBody: any = submitResponseBody;

    while (Date.now() < deadline) {
      await this.sleep(POLL_INTERVAL_MS);
      attempt++;

      let pollRes: Response;
      let pollBody: any;

      try {
        pollRes = await fetch(statusUrl, { headers: authHeaders });
        const pollContentType = pollRes.headers.get('content-type') ?? '';
        if (pollContentType.includes('text/html')) {
          throw new Error(`轮询路径错误！服务器返回了 HTML 网页。实际请求 URL: ${statusUrl}`);
        }
        const pollRawText = await pollRes.text();
        try { pollBody = JSON.parse(pollRawText); } catch { pollBody = { _raw: pollRawText.slice(0, 200) }; }
        lastResponseBody = pollBody;
      } catch (e: any) {
        yield { event: 'log', data: { message: `⚠ 轮询请求异常 [${attempt}]: ${e.message}` } };
        continue;
      }

      if (!pollRes.ok) {
        yield { event: 'error', data: { message: `轮询失败 HTTP ${pollRes.status}: ${JSON.stringify(pollBody)}`, requestPayload, responseBody: pollBody } };
        return;
      }

      const rateLimit = PayloadBuilder.extractRateLimit(pollRes.headers);
      const { done, url, failed, rawStatus } = PayloadBuilder.extractStatus(apiProtocol, pollBody);

      yield {
        event: 'poll',
        data: {
          attempt,
          status: rawStatus ?? 'processing',
          rateLimitRemaining: rateLimit.remaining,
          rateLimitReset: rateLimit.reset,
        },
      };

      yield {
        event: 'log',
        data: {
          message: `⏳ 轮询 [${attempt}] status=${rawStatus ?? 'processing'}${rateLimit.remaining != null ? `  rate-limit-remaining=${rateLimit.remaining}` : ''}`,
        },
      };

      if (done) {
        const elapsedMs = Date.now() - startTime;
        const tokenUsage = PayloadBuilder.extractTokenUsage(pollBody);

        if (failed) {
          yield {
            event: 'error',
            data: { message: '任务执行失败（供应商返回 failed 状态）', requestPayload, responseBody: pollBody },
          };
          return;
        }

        if (!url) {
          yield {
            event: 'error',
            data: { message: '任务完成但未返回视频 URL', requestPayload, responseBody: pollBody },
          };
          return;
        }

        yield { event: 'log', data: { message: `✓ 任务完成，总耗时 ${(elapsedMs / 1000).toFixed(1)}s` } };

        yield {
          event: 'done',
          data: {
            success: true,
            agencyName,
            apiProtocol,
            taskId,
            resultUrl: url,
            elapsedMs,
            ttfbMs,
            tokens: tokenUsage.tokens,
            cost: tokenUsage.cost,
            requestPayload,
            responseBody: pollBody,
          } satisfies SupplierTestResult,
        };
        return;
      }
    }

    yield {
      event: 'error',
      data: {
        message: `超时（超过 ${POLL_TIMEOUT_MS / 1000}s 未完成）`,
        requestPayload,
        responseBody: lastResponseBody,
      },
    };
  }

  /** 兼容旧接口（保留，供非流式场景使用）*/
  async runTest(req: SupplierTestRequest): Promise<SupplierTestResult> {
    const validationError = this.validate(req);
    if (validationError) return { success: false, agencyName: req.agencyName, apiProtocol: req.apiProtocol, error: validationError };

    let lastEvent: StreamEvent | null = null;
    for await (const event of this.streamTest(req)) {
      lastEvent = event;
      if (event.event === 'done' || event.event === 'error') break;
    }

    if (!lastEvent) return { success: false, agencyName: req.agencyName, apiProtocol: req.apiProtocol, error: '未知错误' };

    if (lastEvent.event === 'done') {
      return lastEvent.data as SupplierTestResult;
    }
    return { success: false, agencyName: req.agencyName, apiProtocol: req.apiProtocol, error: lastEvent.data.message };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
