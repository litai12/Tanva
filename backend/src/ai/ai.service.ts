import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly genAI: GoogleGenAI | null;

  constructor(private readonly config: ConfigService) {
    const apiKey =
      this.config.get<string>('GOOGLE_GEMINI_API_KEY') ??
      this.config.get<string>('VITE_GOOGLE_GEMINI_API_KEY');

    if (!apiKey) {
      this.logger.warn('Google Gemini API key not configured. AI routes will be unavailable.');
      this.genAI = null;
      return;
    }

    this.genAI = new GoogleGenAI({ apiKey });
    this.logger.log('Google GenAI client initialised for server-side use.');
  }

  private ensureClient(): GoogleGenAI {
    if (!this.genAI) {
      throw new ServiceUnavailableException('Google Gemini API key not configured on the server.');
    }
    return this.genAI;
  }

  async runToolSelectionPrompt(prompt: string): Promise<{ selectedTool: string; parameters: { prompt: string } }> {
    if (!prompt || !prompt.trim()) {
      throw new BadRequestException('Tool selection prompt is empty.');
    }

    const client = this.ensureClient();
    const maxAttempts = 3;
    const delayMs = 1000;
    let lastError: unknown;

    // 工具选择的系统提示
    const systemPrompt = `你是一个AI助手工具选择器。根据用户的输入，选择最合适的工具执行。

可用工具:
- generateImage: 生成新的图像
- editImage: 编辑现有图像
- blendImages: 融合多张图像
- analyzeImage: 分析图像内容
- chatResponse: 文本对话或聊天
- generateVideo: 生成视频
- generatePaperJS: 生成 Paper.js 矢量图形代码

请根据用户的实际需求，智能判断最合适的工具。例如：
- 用户要求生成矢量图、SVG、几何图形、代码绘图等 → generatePaperJS
- 用户要求生成图像、照片、画作等 → generateImage
- 用户要求编辑、修改现有图像 → editImage
- 用户要求融合、混合多张图像 → blendImages
- 用户要求分析、识别图像内容 → analyzeImage
- 用户要求生成视频 → generateVideo
- 其他对话、提问、讨论 → chatResponse

请以以下JSON格式回复（仅返回JSON，不要其他文字）:
{
  "selectedTool": "工具名称",
  "reasoning": "选择理由"
}`;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await client.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: [
            { text: systemPrompt },
            { text: `用户输入: ${prompt}` }
          ],
          config: {
            safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
          },
        });

        if (!response.text) {
          this.logger.warn('Tool selection response did not contain text. Full response omitted.');
          throw new Error('Empty Gemini response');
        }

        // 解析AI的JSON响应
        try {
          // 提取 JSON 内容（可能被 markdown 代码块包装）
          let jsonText = response.text.trim();

          // 移除 markdown 代码块标记
          if (jsonText.startsWith('```json')) {
            jsonText = jsonText.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
          } else if (jsonText.startsWith('```')) {
            jsonText = jsonText.replace(/^```\s*/i, '').replace(/\s*```$/, '');
          }

          const parsed = JSON.parse(jsonText.trim());
          const selectedTool = parsed.selectedTool || 'chatResponse';

          this.logger.log(`Tool selected: ${selectedTool}`);

          return {
            selectedTool,
            parameters: { prompt }
          };
        } catch (parseError) {
          this.logger.warn(`Failed to parse tool selection JSON: ${response.text}`);
          // 降级：如果解析失败，默认返回文本对话
          return {
            selectedTool: 'chatResponse',
            parameters: { prompt }
          };
        }
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Tool selection attempt ${attempt}/${maxAttempts} failed: ${message}`);
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    const message =
      lastError instanceof Error ? lastError.message : 'Unknown error occurred during tool selection.';
    this.logger.error(`All tool selection attempts failed: ${message}`);

    // 最后的降级方案：返回文本对话
    return {
      selectedTool: 'chatResponse',
      parameters: { prompt }
    };
  }
}
