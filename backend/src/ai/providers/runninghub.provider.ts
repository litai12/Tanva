import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  IAIProvider,
  ImageGenerationRequest,
  ImageEditRequest,
  ImageBlendRequest,
  ImageAnalysisRequest,
  TextChatRequest,
  ToolSelectionRequest,
  PaperJSGenerateRequest,
  AIProviderResponse,
  ImageResult,
  AnalysisResult,
  TextResult,
  ToolSelectionResult,
  PaperJSResult,
  RunningHubGenerateOptions,
} from './ai-provider.interface';

type RunningHubRunResponse = {
  code: number;
  msg?: string;
  data?: {
    taskId: string;
    taskStatus: string;
    netWssUrl?: string | null;
    clientId?: string;
    promptTips?: string;
  };
  errorMessages?: unknown;
};

type RunningHubOutputsResponse = {
  code: number;
  msg?: string;
  data?: Array<{
    fileUrl: string;
    fileType: string;
    taskCostTime?: string | number;
    nodeId?: string;
  }>;
};

@Injectable()
export class RunningHubProvider implements IAIProvider {
  private readonly logger = new Logger(RunningHubProvider.name);
  private readonly apiBaseUrl = 'https://www.runninghub.ai';
  private readonly defaultHostHeader = 'www.runninghub.cn';
  private readonly defaultPollInterval = 4000;
  private readonly defaultMaxPollAttempts = 45;

  private apiKey: string | null = null;
  private defaultWebappId: string | null = null;
  private defaultWebhookUrl: string | null = null;
  private hostHeader: string = this.defaultHostHeader;

  constructor(private readonly config: ConfigService) {}

  async initialize(): Promise<void> {
    this.apiKey = this.config.get<string>('RUNNINGHUB_API_KEY') ?? null;
    this.defaultWebappId = this.config.get<string>('RUNNINGHUB_WEBAPP_ID') ?? null;
    this.defaultWebhookUrl = this.config.get<string>('RUNNINGHUB_WEBHOOK_URL') ?? null;
    this.hostHeader = this.config.get<string>('RUNNINGHUB_HOST_HEADER') ?? this.defaultHostHeader;

    if (!this.apiKey) {
      this.logger.warn('RunningHub API key not configured. Provider will remain unavailable.');
      return;
    }

    if (!this.defaultWebappId) {
      this.logger.warn('RunningHub webappId not configured. Requests must specify providerOptions.runningHub.webappId.');
    }

    this.logger.log('RunningHub provider initialized.');
  }

  private ensureApiKey(): string {
    if (!this.apiKey) {
      throw new ServiceUnavailableException('RunningHub API key not configured on the server.');
    }
    return this.apiKey;
  }

  private resolveOptions(options?: RunningHubGenerateOptions | null): {
    webappId: string;
    webhookUrl?: string;
    nodeInfoList: RunningHubGenerateOptions['nodeInfoList'];
    pollIntervalMs: number;
    maxPollAttempts: number;
  } {
    const webappId = options?.webappId ?? this.defaultWebappId;
    if (!webappId) {
      throw new ServiceUnavailableException(
        'RunningHub webappId missing. Provide RUNNINGHUB_WEBAPP_ID env or pass providerOptions.runningHub.webappId.'
      );
    }

    const nodeInfoList = options?.nodeInfoList;
    if (!nodeInfoList || nodeInfoList.length === 0) {
      throw new BadRequestException(
        'RunningHub provider requires providerOptions.runningHub.nodeInfoList with at least one entry.'
      );
    }

    const invalidField = nodeInfoList.find(
      (node) => !node.nodeId || !node.fieldName || !node.fieldValue
    );
    if (invalidField) {
      throw new BadRequestException(
        `Invalid nodeInfoList entry detected. nodeId, fieldName and fieldValue are required. Problematic nodeId: ${invalidField.nodeId || 'unknown'}`
      );
    }

    return {
      webappId,
      webhookUrl: options?.webhookUrl ?? this.defaultWebhookUrl ?? undefined,
      nodeInfoList,
      pollIntervalMs: options?.pollIntervalMs ?? this.defaultPollInterval,
      maxPollAttempts: options?.maxPollAttempts ?? this.defaultMaxPollAttempts,
    };
  }

  private async callRunningHub<T>(
    endpoint: string,
    payload: Record<string, unknown>,
    operation: string
  ): Promise<T> {
    const url = `${this.apiBaseUrl}${endpoint}`;
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');

    if (this.hostHeader) {
      try {
        headers.set('Host', this.hostHeader);
      } catch (error) {
        this.logger.warn(
          `[RunningHub] Unable to set Host header due to platform restrictions: ${error instanceof Error ? error.message : error}`
        );
      }
    }

    this.logger.debug(`[RunningHub] ${operation} -> ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(
        `[RunningHub] ${operation} failed: HTTP ${response.status} ${response.statusText} ${text}`
      );
      throw new ServiceUnavailableException(
        `RunningHub ${operation} failed: ${response.status} ${response.statusText}`
      );
    }

    const data: T = await response.json();
    this.logger.debug(`[RunningHub] ${operation} succeeded.`);
    return data;
  }

  private async pollForResult(
    taskId: string,
    options: { pollIntervalMs: number; maxPollAttempts: number }
  ): Promise<RunningHubOutputsResponse['data']> {
    const apiKey = this.ensureApiKey();

    for (let attempt = 1; attempt <= options.maxPollAttempts; attempt += 1) {
      if (attempt > 1) {
        await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs));
      }

      this.logger.debug(`[RunningHub] Polling result attempt ${attempt}/${options.maxPollAttempts}`);

      const result = await this.callRunningHub<RunningHubOutputsResponse>(
        '/task/openapi/outputs',
        {
          apiKey,
          taskId,
        },
        'queryOutputs'
      );

      if (result.code !== 0) {
        this.logger.warn(
          `[RunningHub] queryOutputs returned non-zero code ${result.code}: ${result.msg ?? 'unknown'}`
        );
        continue;
      }

      if (Array.isArray(result.data) && result.data.length > 0) {
        return result.data;
      }
    }

    throw new ServiceUnavailableException(
      `RunningHub task ${taskId} did not return results within the expected time.`
    );
  }

  private async downloadImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
    this.logger.debug(`[RunningHub] Downloading generated image: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text();
      throw new ServiceUnavailableException(
        `Failed to download generated image: ${response.status} ${response.statusText} ${text}`
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = response.headers.get('content-type') || 'image/png';
    return {
      base64: buffer.toString('base64'),
      mimeType,
    };
  }

  private async executeGenerate(
    request: ImageGenerationRequest | ImageEditRequest | ImageBlendRequest,
    operation: 'generate' | 'edit' | 'blend'
  ): Promise<AIProviderResponse<ImageResult>> {
    try {
      const apiKey = this.ensureApiKey();
      const options = this.resolveOptions(request.providerOptions?.runningHub);

      const payload: Record<string, unknown> = {
        apiKey,
        webappId: options.webappId,
        nodeInfoList: options.nodeInfoList,
      };

      if (options.webhookUrl) {
        payload.webhookUrl = options.webhookUrl;
      }

      const runResponse = await this.callRunningHub<RunningHubRunResponse>(
        '/task/openapi/ai-app/run',
        payload,
        `${operation}Task`
      );

      if (runResponse.code !== 0 || !runResponse.data?.taskId) {
        const message = runResponse.msg ?? 'unknown error';
        this.logger.error(`[RunningHub] ${operation}Task failed: ${message}`);
        return {
          success: false,
          error: {
            code: `RUN_TASK_${runResponse.code ?? 'UNKNOWN'}`,
            message,
            details: runResponse.errorMessages,
          },
        };
      }

      const outputs = await this.pollForResult(runResponse.data.taskId, options);

      if (!outputs || outputs.length === 0) {
        return {
          success: false,
          error: {
            code: 'NO_OUTPUTS',
            message: 'RunningHub did not return any outputs for this task.',
          },
        };
      }

      const firstOutput = outputs[0];
      if (!firstOutput.fileUrl) {
        return {
          success: false,
          error: {
            code: 'INVALID_OUTPUT',
            message: 'RunningHub output missing fileUrl.',
            details: firstOutput,
          },
        };
      }

      const { base64 } = await this.downloadImageAsBase64(firstOutput.fileUrl);

      return {
        success: true,
        data: {
          imageData: base64,
          textResponse: '',
          hasImage: true,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[RunningHub] ${operation}Task error: ${message}`);
      return {
        success: false,
        error: {
          code: 'RUNNINGHUB_ERROR',
          message,
          details: error,
        },
      };
    }
  }

  async generateImage(
    request: ImageGenerationRequest
  ): Promise<AIProviderResponse<ImageResult>> {
    return this.executeGenerate(request, 'generate');
  }

  async editImage(request: ImageEditRequest): Promise<AIProviderResponse<ImageResult>> {
    return this.executeGenerate(request, 'edit');
  }

  async blendImages(request: ImageBlendRequest): Promise<AIProviderResponse<ImageResult>> {
    return this.executeGenerate(request, 'blend');
  }

  async analyzeImage(
    _request: ImageAnalysisRequest
  ): Promise<AIProviderResponse<AnalysisResult>> {
    return {
      success: false,
      error: {
        code: 'NOT_SUPPORTED',
        message: 'RunningHub provider does not support image analysis.',
      },
    };
  }

  async generateText(_request: TextChatRequest): Promise<AIProviderResponse<TextResult>> {
    return {
      success: false,
      error: {
        code: 'NOT_SUPPORTED',
        message: 'RunningHub provider does not support text chat.',
      },
    };
  }

  async selectTool(
    request: ToolSelectionRequest
  ): Promise<AIProviderResponse<ToolSelectionResult>> {
    const available = request.availableTools ?? [
      'generateImage',
      'editImage',
      'blendImages',
      'analyzeImage',
      'chatResponse',
    ];

    const pick = (tool: string) =>
      available.includes(tool) ? tool : available[0] ?? 'generateImage';

    const imageCount = request.imageCount ?? 0;
    const hasImages = request.hasImages || imageCount > 0 || Boolean(request.hasCachedImage);

    let selectedTool = 'generateImage';
    let reasoning = 'Defaulting to image generation.';
    let confidence = 0.55;

    if (hasImages) {
      if (imageCount >= 2) {
        selectedTool = 'blendImages';
        reasoning = 'Multiple input images detected, using blend mode.';
        confidence = 0.7;
      } else {
        selectedTool = 'editImage';
        reasoning = 'Single image provided, using edit mode for SU效果图转换。';
        confidence = 0.65;
      }
    }

    const finalTool = pick(selectedTool);

    return {
      success: true,
      data: {
        selectedTool: finalTool,
        reasoning,
        confidence,
      },
    };
  }

  async generatePaperJS(
    request: PaperJSGenerateRequest
  ): Promise<AIProviderResponse<PaperJSResult>> {
    this.logger.warn('Paper.js code generation is not supported by RunningHub provider');
    return {
      success: false,
      error: {
        code: 'PAPERJS_NOT_SUPPORTED',
        message: 'RunningHub provider does not support Paper.js code generation',
      },
    };
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey && (this.defaultWebappId || true));
  }

  getProviderInfo() {
    return {
      name: 'runninghub',
      version: '1.0.0',
      supportedModels: ['su-screenshot-effect'],
    };
  }
}
