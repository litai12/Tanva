/**
 * Google Gemini 2.5 Flash Image (Nano Banana) API 服务层
 * 处理AI图像生成、编辑和融合功能
 * 使用最新的 gemini-2.5-flash-image-preview 模型
 */

import { GoogleGenAI } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import type {
  AIImageGenerateRequest,
  AIImageEditRequest,
  AIImageBlendRequest,
  AIImageAnalyzeRequest,
  AITextChatRequest,
  AIImageResult,
  AIImageAnalysisResult,
  AITextChatResult,
  AIServiceResponse,
  AIError,
  AITool,
  ToolSelectionRequest,
  ToolSelectionResult
} from '@/types/ai';

class AIImageService {
  private genAI: GoogleGenAI | null = null;
  private readonly DEFAULT_MODEL = 'gemini-2.5-flash-image-preview';
  private readonly DEFAULT_TIMEOUT = 30000;

  constructor() {
    this.initializeClient();
  }

  private initializeClient(): void {
    // 兼容 Vite 和 Node.js 环境
    const apiKey = typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_GOOGLE_GEMINI_API_KEY
      : process.env.VITE_GOOGLE_GEMINI_API_KEY;

    // 临时使用默认密钥进行测试（生产环境应该移除）
    const defaultApiKey = 'AIzaSyAWVrzl5s4JQDhrZN8iSPcxmbFmgEJTTxw';
    const finalApiKey = apiKey || defaultApiKey;

    if (!finalApiKey) {
      console.warn('Google Gemini API key not found. Please set VITE_GOOGLE_GEMINI_API_KEY in your .env.local file');
      return;
    }

    console.log('🔑 使用API密钥:', finalApiKey.substring(0, 10) + '...');
    console.log('🔑 密钥来源:', apiKey ? '环境变量' : '默认密钥');

    try {
      this.genAI = new GoogleGenAI({ apiKey: finalApiKey });
      console.log('✅ Google GenAI client initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Google GenAI client:', error);
    }
  }

  private createError(code: string, message: string, details?: unknown): AIError {
    return {
      code,
      message,
      details,
      timestamp: new Date()
    };
  }

  private async processWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number = this.DEFAULT_TIMEOUT
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
    );

    return Promise.race([promise, timeoutPromise]);
  }

  /**
   * 生成图像
   */
  async generateImage(request: AIImageGenerateRequest): Promise<AIServiceResponse<AIImageResult>> {
    console.log('🎨 开始生成图像:', request);

    if (!this.genAI) {
      return {
        success: false,
        error: this.createError(
          'CLIENT_NOT_INITIALIZED',
          'Google GenAI client is not initialized. Please check your API key.'
        )
      };
    }

    try {
      // 直接使用用户的提示词，不添加前缀
      let prompt = request.prompt;

      // 添加宽高比信息（如果指定）
      if (request.aspectRatio && request.aspectRatio !== '1:1') {
        prompt += ` (aspect ratio: ${request.aspectRatio})`;
      }

      console.log('📝 发送提示词:', prompt);

      const startTime = Date.now();

      // 发送生成请求 - 使用新的generateContent API
      const result = await this.processWithTimeout(
        this.genAI.models.generateContent({
          model: request.model || this.DEFAULT_MODEL,
          contents: prompt,
        })
      );

      const processingTime = Date.now() - startTime;
      console.log(`⏱️ 处理耗时: ${processingTime}ms`);

      console.log('📄 API响应:', result);

      // 获取生成的图像数据 - 新的响应格式
      if (!result.candidates || result.candidates.length === 0) {
        throw new Error('No candidates returned from API');
      }

      const candidate = result.candidates[0];
      if (!candidate.content || !candidate.content.parts) {
        throw new Error('No content parts in response');
      }

      // 查找图像数据
      let imageBytes: string | null = null;
      for (const part of candidate.content.parts) {
        if (part.inlineData) {
          imageBytes = part.inlineData.data;
          break;
        }
      }

      if (!imageBytes) {
        throw new Error('No image data found in response');
      }

      const aiResult: AIImageResult = {
        id: uuidv4(),
        imageData: imageBytes, // base64编码的图像数据
        prompt: request.prompt,
        model: request.model || this.DEFAULT_MODEL,
        createdAt: new Date(),
        metadata: {
          aspectRatio: request.aspectRatio,
          outputFormat: request.outputFormat || 'png',
          processingTime
        }
      };

      console.log('✅ 图像生成成功:', aiResult.id);

      return {
        success: true,
        data: aiResult
      };

    } catch (error) {
      console.error('❌ 图像生成失败:', error);

      // 详细的错误分析
      let errorCode = 'GENERATION_FAILED';
      let errorMessage = error instanceof Error ? error.message : 'Failed to generate image';

      if (error.message) {
        if (error.message.includes('API_KEY_INVALID')) {
          errorCode = 'INVALID_API_KEY';
          errorMessage = 'API密钥无效，请检查密钥是否正确配置';
        } else if (error.message.includes('PERMISSION_DENIED')) {
          errorCode = 'PERMISSION_DENIED';
          errorMessage = 'API权限被拒绝，请检查密钥权限设置';
        } else if (error.message.includes('QUOTA_EXCEEDED')) {
          errorCode = 'QUOTA_EXCEEDED';
          errorMessage = 'API配额已用完，请检查账户余额';
        } else if (error.message.includes('User location is not supported')) {
          errorCode = 'LOCATION_NOT_SUPPORTED';
          errorMessage = '当前地区不支持此API功能，请尝试使用VPN或联系管理员';
        } else if (error.message.includes('billed users')) {
          errorCode = 'BILLING_REQUIRED';
          errorMessage = 'Gemini API需要付费账户，请升级您的Google Cloud账户';
        } else if (error.message.includes('fetch failed')) {
          errorCode = 'NETWORK_ERROR';
          errorMessage = '网络连接失败，请检查网络连接或API服务状态';
        }
      }

      return {
        success: false,
        error: this.createError(errorCode, errorMessage, error)
      };
    }
  }

  /**
   * 编辑图像
   */
  async editImage(request: AIImageEditRequest): Promise<AIServiceResponse<AIImageResult>> {
    console.log('✏️ 开始编辑图像:', { prompt: request.prompt, hasImage: !!request.sourceImage });

    if (!this.genAI) {
      return {
        success: false,
        error: this.createError(
          'CLIENT_NOT_INITIALIZED',
          'Google GenAI client is not initialized. Please check your API key.'
        )
      };
    }

    try {
      const prompt = `Edit this image based on the following instruction: ${request.prompt}`;

      // 将base64图像转换为适当的格式
      const imageData = request.sourceImage.replace(/^data:image\/[a-z]+;base64,/, '');

      const startTime = Date.now();

      const result = await this.processWithTimeout(
        this.genAI.models.generateContent({
          model: request.model || this.DEFAULT_MODEL,
          contents: [
            { text: prompt },
            {
              inlineData: {
                mimeType: 'image/jpeg', // 根据实际格式调整
                data: imageData
              }
            }
          ]
        })
      );

      const processingTime = Date.now() - startTime;

      // 处理新的响应格式
      if (!result.candidates || result.candidates.length === 0) {
        throw new Error('No candidates returned from API');
      }

      const candidate = result.candidates[0];
      if (!candidate.content || !candidate.content.parts) {
        throw new Error('No content parts in response');
      }

      // 查找图像数据
      let editedImageData: string | null = null;
      for (const part of candidate.content.parts) {
        if (part.inlineData) {
          editedImageData = part.inlineData.data;
          break;
        }
      }

      if (!editedImageData) {
        throw new Error('No edited image data found in response');
      }

      const aiResult: AIImageResult = {
        id: uuidv4(),
        imageData: editedImageData,
        prompt: request.prompt,
        model: request.model || this.DEFAULT_MODEL,
        createdAt: new Date(),
        metadata: {
          outputFormat: request.outputFormat,
          processingTime
        }
      };

      console.log('✅ 图像编辑成功:', aiResult.id);

      return {
        success: true,
        data: aiResult
      };

    } catch (error) {
      console.error('❌ 图像编辑失败:', error);

      // 详细的错误分析
      let errorCode = 'EDIT_FAILED';
      let errorMessage = error instanceof Error ? error.message : 'Failed to edit image';

      if (error.message) {
        if (error.message.includes('API_KEY_INVALID')) {
          errorCode = 'INVALID_API_KEY';
          errorMessage = 'API密钥无效，请检查密钥是否正确配置';
        } else if (error.message.includes('PERMISSION_DENIED')) {
          errorCode = 'PERMISSION_DENIED';
          errorMessage = 'API权限被拒绝，请检查密钥权限设置';
        } else if (error.message.includes('QUOTA_EXCEEDED')) {
          errorCode = 'QUOTA_EXCEEDED';
          errorMessage = 'API配额已用完，请检查账户余额';
        } else if (error.message.includes('User location is not supported')) {
          errorCode = 'LOCATION_NOT_SUPPORTED';
          errorMessage = '当前地区不支持此API功能，请尝试使用VPN或联系管理员';
        } else if (error.message.includes('billed users')) {
          errorCode = 'BILLING_REQUIRED';
          errorMessage = 'Gemini API需要付费账户，请升级您的Google Cloud账户';
        } else if (error.message.includes('fetch failed')) {
          errorCode = 'NETWORK_ERROR';
          errorMessage = '网络连接失败，请检查网络连接或API服务状态';
        }
      }

      return {
        success: false,
        error: this.createError(errorCode, errorMessage, error)
      };
    }
  }

  /**
   * 融合多个图像
   */
  async blendImages(request: AIImageBlendRequest): Promise<AIServiceResponse<AIImageResult>> {
    console.log('🎭 开始融合图像:', { prompt: request.prompt, imageCount: request.sourceImages.length });

    if (!this.genAI) {
      return {
        success: false,
        error: this.createError(
          'CLIENT_NOT_INITIALIZED',
          'Google GenAI client is not initialized. Please check your API key.'
        )
      };
    }

    try {
      const prompt = `Blend these images together: ${request.prompt}`;

      // 构建包含多个图像的请求
      const imageParts = request.sourceImages.map((imageData) => ({
        inlineData: {
          mimeType: 'image/jpeg', // 根据实际格式调整
          data: imageData.replace(/^data:image\/[a-z]+;base64,/, '')
        }
      }));

      const startTime = Date.now();

      const result = await this.processWithTimeout(
        this.genAI.models.generateContent({
          model: request.model || this.DEFAULT_MODEL,
          contents: [{ text: prompt }, ...imageParts]
        })
      );

      const processingTime = Date.now() - startTime;

      // 处理新的响应格式
      if (!result.candidates || result.candidates.length === 0) {
        throw new Error('No candidates returned from API');
      }

      const candidate = result.candidates[0];
      if (!candidate.content || !candidate.content.parts) {
        throw new Error('No content parts in response');
      }

      // 查找图像数据
      let blendedImageData: string | null = null;
      for (const part of candidate.content.parts) {
        if (part.inlineData) {
          blendedImageData = part.inlineData.data;
          break;
        }
      }

      if (!blendedImageData) {
        throw new Error('No blended image data found in response');
      }

      const aiResult: AIImageResult = {
        id: uuidv4(),
        imageData: blendedImageData,
        prompt: request.prompt,
        model: request.model || this.DEFAULT_MODEL,
        createdAt: new Date(),
        metadata: {
          outputFormat: request.outputFormat,
          processingTime
        }
      };

      console.log('✅ 图像融合成功:', aiResult.id);

      return {
        success: true,
        data: aiResult
      };

    } catch (error) {
      console.error('❌ 图像融合失败:', error);

      // 详细的错误分析
      let errorCode = 'BLEND_FAILED';
      let errorMessage = error instanceof Error ? error.message : 'Failed to blend images';

      if (error.message) {
        if (error.message.includes('API_KEY_INVALID')) {
          errorCode = 'INVALID_API_KEY';
          errorMessage = 'API密钥无效，请检查密钥是否正确配置';
        } else if (error.message.includes('PERMISSION_DENIED')) {
          errorCode = 'PERMISSION_DENIED';
          errorMessage = 'API权限被拒绝，请检查密钥权限设置';
        } else if (error.message.includes('QUOTA_EXCEEDED')) {
          errorCode = 'QUOTA_EXCEEDED';
          errorMessage = 'API配额已用完，请检查账户余额';
        } else if (error.message.includes('User location is not supported')) {
          errorCode = 'LOCATION_NOT_SUPPORTED';
          errorMessage = '当前地区不支持此API功能，请尝试使用VPN或联系管理员';
        } else if (error.message.includes('billed users')) {
          errorCode = 'BILLING_REQUIRED';
          errorMessage = 'Gemini API需要付费账户，请升级您的Google Cloud账户';
        } else if (error.message.includes('fetch failed')) {
          errorCode = 'NETWORK_ERROR';
          errorMessage = '网络连接失败，请检查网络连接或API服务状态';
        }
      }

      return {
        success: false,
        error: this.createError(errorCode, errorMessage, error)
      };
    }
  }

  /**
   * 检查API是否可用
   */
  isAvailable(): boolean {
    const apiKey = typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_GOOGLE_GEMINI_API_KEY
      : process.env.VITE_GOOGLE_GEMINI_API_KEY;
    const defaultApiKey = 'AIzaSyAWVrzl5s4JQDhrZN8iSPcxmbFmgEJTTxw';
    const finalApiKey = apiKey || defaultApiKey;
    const available = !!this.genAI && !!finalApiKey;
    console.log('🔍 API可用性检查:', available ? '✅ 可用' : '❌ 不可用');
    console.log('🔑 使用的API密钥:', finalApiKey ? `${finalApiKey.substring(0, 10)}...` : '无');
    return available;
  }

  /**
   * 估算成本（基于Gemini原生图片生成定价：每张图片1,290个token，$30/100万token）
   */
  estimateCost(imageCount: number): number {
    const tokensPerImage = 1290;
    const costPer1MTokens = 30; // $30 per 1M tokens
    return (imageCount * tokensPerImage * costPer1MTokens) / 1000000;
  }

  // 定义可用的工具
  private readonly AVAILABLE_TOOLS: AITool[] = [
    {
      name: 'generateImage',
      description: '根据文本描述生成新图像。适用于用户想要创建、画、生成图片的请求。',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '图像生成的详细描述文字，包含风格、内容、色彩等信息'
          },
          aspectRatio: {
            type: 'string',
            description: '图像宽高比，如 16:9(横屏), 9:16(竖屏), 1:1(正方形), 4:3, 3:4',
            enum: ['1:1', '9:16', '16:9', '4:3', '3:4']
          }
        },
        required: ['prompt']
      }
    },
    {
      name: 'editImage',
      description: '编辑现有图像。适用于用户想要修改、编辑已有图片的请求。需要提供源图像。',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '编辑指令，描述如何修改图像'
          },
          sourceImage: {
            type: 'string',
            description: '源图像的base64数据'
          }
        },
        required: ['prompt', 'sourceImage']
      }
    },
    {
      name: 'blendImages',
      description: '融合多张图像。适用于用户想要混合、合并、融合多张图片的请求。需要2张或更多图像。',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '融合指令，描述如何融合图像'
          },
          sourceImages: {
            type: 'array',
            description: '多张源图像的base64数据数组',
            items: { type: 'string' }
          }
        },
        required: ['prompt', 'sourceImages']
      }
    },
    {
      name: 'analyzeImage',
      description: '分析图像内容，提供详细描述。适用于用户想要了解、分析、描述图片内容的请求。',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '分析问题或留空进行全面分析。例如：这是什么？分析构图？识别物体？'
          },
          sourceImage: {
            type: 'string',
            description: '要分析的图像base64数据'
          }
        },
        required: ['sourceImage']
      }
    },
    {
      name: 'chatResponse',
      description: '进行文本对话，回答问题或聊天。适用于数学计算、知识问答、日常对话等不涉及图像的请求。',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '用户的问题或对话内容'
          }
        },
        required: ['prompt']
      }
    }
  ];

  /**
   * 使用Gemini Function Calling选择合适的工具
   */
  async selectTool(request: ToolSelectionRequest): Promise<AIServiceResponse<ToolSelectionResult>> {
    console.log('🤖 开始AI工具选择:', request);
    console.log('🔑 API密钥状态:', this.genAI ? '✅ 已初始化' : '❌ 未初始化');

    if (!this.genAI) {
      return {
        success: false,
        error: this.createError('CLIENT_NOT_INITIALIZED', 'GenAI client not initialized')
      };
    }

    try {
      // 构建Function Calling的系统提示
      const systemPrompt = `你是一个智能助手，需要根据用户输入选择最合适的工具。

用户输入: "${request.userInput}"
是否有图像: ${request.hasImages}
图像数量: ${request.imageCount}

请分析用户意图并选择最合适的工具：

1. generateImage - 如果用户想要生成、创建、画新图像
2. editImage - 如果有1张图像且用户想要编辑、修改它
3. blendImages - 如果有2张或更多图像且用户想要融合它们
4. analyzeImage - 如果有图像且用户想要分析、了解图像内容
5. chatResponse - 如果是数学问题、知识问答、日常对话等文本交互

选择规则：
- 优先考虑用户的明确意图词汇
- 生图关键词：画、生成、创建、制作、设计、draw、create、generate
- 编辑关键词：编辑、修改、改变、调整、edit、modify、change
- 分析关键词：什么、分析、描述、识别、看看、tell me、what、analyze
- 对话关键词：计算、等于、为什么、如何、问题、数学、+、-、*、/

请直接选择工具名称并说明理由，格式：工具名称|理由`;

      // 使用Gemini进行工具选择
      const result = await this.processWithTimeout(
        this.genAI.models.generateContent({
          model: 'gemini-2.0-flash', // 使用文本模型进行工具选择
          contents: systemPrompt,  // 直接传字符串
        })
      );

      if (!result.text) {
        throw new Error('No tool selection response from API');
      }

      console.log('🤖 AI工具选择原始响应:', result.text);

      // 解析AI的选择
      const toolSelection = this.parseToolSelection(result.text, request);

      console.log('✅ 工具选择成功:', toolSelection);

      return {
        success: true,
        data: toolSelection
      };

    } catch (error) {
      console.error('❌ 工具选择失败:', error);

      // 降级处理：使用简单规则选择工具
      const fallbackSelection = this.fallbackToolSelection(request);

      return {
        success: true, // 即使AI失败，也返回降级结果
        data: fallbackSelection
      };
    }
  }

  /**
   * 解析AI的工具选择响应
   */
  private parseToolSelection(aiResponse: string, request: ToolSelectionRequest): ToolSelectionResult {
    const { userInput, hasImages, imageCount } = request;

    // 提取工具名称和理由
    const lines = aiResponse.trim().split('\n');
    let selectedTool = '';
    let reasoning = aiResponse;

    // 尝试解析格式：工具名称|理由
    const pipeMatch = aiResponse.match(/(\w+)\|(.+)/);
    if (pipeMatch) {
      selectedTool = pipeMatch[1];
      reasoning = pipeMatch[2].trim();
    } else {
      // 尝试从文本中提取工具名称
      const toolNames = this.AVAILABLE_TOOLS.map(tool => tool.name);
      for (const toolName of toolNames) {
        if (aiResponse.toLowerCase().includes(toolName.toLowerCase())) {
          selectedTool = toolName;
          break;
        }
      }
    }

    // 验证选择的工具是否存在
    const toolExists = this.AVAILABLE_TOOLS.some(tool => tool.name === selectedTool);
    if (!toolExists) {
      console.warn('AI选择了不存在的工具:', selectedTool, '使用降级逻辑');
      return this.fallbackToolSelection(request);
    }

    // 构建参数
    let parameters: Record<string, any> = { prompt: userInput };

    switch (selectedTool) {
      case 'generateImage':
        // 检测宽高比
        const aspectRatio = this.detectAspectRatio(userInput);
        if (aspectRatio) {
          parameters.aspectRatio = aspectRatio;
        }
        break;
      case 'editImage':
      case 'analyzeImage':
        // 这些需要在store层添加sourceImage参数
        break;
      case 'blendImages':
        // 这些需要在store层添加sourceImages参数
        break;
    }

    return {
      selectedTool,
      parameters,
      confidence: 0.9,
      reasoning: reasoning || `AI选择了${selectedTool}`
    };
  }

  /**
   * 检测用户输入中的宽高比需求
   */
  private detectAspectRatio(input: string): string | undefined {
    const lowerInput = input.toLowerCase();

    if (lowerInput.includes('横屏') || lowerInput.includes('宽屏') || lowerInput.includes('landscape')) {
      return '16:9';
    }
    if (lowerInput.includes('竖屏') || lowerInput.includes('竖版') || lowerInput.includes('portrait')) {
      return '9:16';
    }
    if (lowerInput.includes('正方形') || lowerInput.includes('方形') || lowerInput.includes('square')) {
      return '1:1';
    }

    return undefined;
  }

  /**
   * 降级工具选择（基于简单规则）
   */
  private fallbackToolSelection(request: ToolSelectionRequest): ToolSelectionResult {
    const { userInput, hasImages, imageCount } = request;
    const lowerInput = userInput.toLowerCase();

    // 优先级规则
    if (imageCount >= 2) {
      return {
        selectedTool: 'blendImages',
        parameters: { prompt: userInput },
        confidence: 0.8,
        reasoning: '检测到多张图像，选择融合功能'
      };
    }

    if (imageCount === 1) {
      // 检查是否是分析意图
      const analysisKeywords = ['什么', '分析', '描述', '识别', '看看', 'what', 'analyze', 'describe', 'identify'];
      const hasAnalysisKeywords = analysisKeywords.some(keyword => lowerInput.includes(keyword));

      if (hasAnalysisKeywords) {
        return {
          selectedTool: 'analyzeImage',
          parameters: { prompt: userInput },
          confidence: 0.85,
          reasoning: '检测到分析意图'
        };
      }

      // 默认编辑
      return {
        selectedTool: 'editImage',
        parameters: { prompt: userInput },
        confidence: 0.75,
        reasoning: '有图像且非分析意图，选择编辑'
      };
    }

    // 无图像时的判断
    const imageKeywords = ['画', '生成', '创建', '制作', '设计', 'draw', 'create', 'generate', 'make', 'design'];
    const hasImageKeywords = imageKeywords.some(keyword => lowerInput.includes(keyword));

    if (hasImageKeywords) {
      return {
        selectedTool: 'generateImage',
        parameters: { prompt: userInput },
        confidence: 0.9,
        reasoning: '检测到图像生成关键词'
      };
    }

    // 数学表达式
    if (lowerInput.match(/^\d+[\+\-\*\/]\d+/) || lowerInput.includes('=') || lowerInput.includes('计算')) {
      return {
        selectedTool: 'chatResponse',
        parameters: { prompt: userInput },
        confidence: 0.95,
        reasoning: '检测到数学或计算意图'
      };
    }

    // 默认对话
    return {
      selectedTool: 'chatResponse',
      parameters: { prompt: userInput },
      confidence: 0.6,
      reasoning: '默认选择对话功能'
    };
  }

  /**
   * 分析图像内容
   */
  async analyzeImage(request: AIImageAnalyzeRequest): Promise<AIServiceResponse<AIImageAnalysisResult>> {
    console.log('🔍 开始分析图像:', { prompt: request.prompt, hasImage: !!request.sourceImage });

    if (!this.genAI) {
      return {
        success: false,
        error: this.createError('CLIENT_NOT_INITIALIZED', 'GenAI client not initialized')
      };
    }

    try {
      // 构建分析提示词
      const analysisPrompt = request.prompt || `请详细分析这张图片，包括：
1. 图片的主要内容和主题
2. 图片中的对象、人物、场景
3. 色彩和构图特点
4. 图片的风格和质量
5. 任何值得注意的细节

请用中文详细描述。`;

      // 将base64图像转换为适当的格式
      const imageData = request.sourceImage.replace(/^data:image\/[a-z]+;base64,/, '');

      const startTime = Date.now();

      // 使用 gemini-2.0-flash 进行图像分析
      const result = await this.processWithTimeout(
        this.genAI.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: [
            { text: analysisPrompt },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: imageData
              }
            }
          ]
        })
      );

      const processingTime = Date.now() - startTime;

      if (!result.text) {
        throw new Error('No analysis text returned from API');
      }

      const analysisResult: AIImageAnalysisResult = {
        analysis: result.text,
        confidence: 0.95,
        tags: this.extractTagsFromAnalysis(result.text)
      };

      console.log('✅ 图像分析成功');
      console.log(`⏱️ 分析耗时: ${processingTime}ms`);

      return {
        success: true,
        data: analysisResult
      };

    } catch (error) {
      console.error('❌ 图像分析失败:', error);
      return {
        success: false,
        error: this.createError('ANALYSIS_FAILED', error.message, error)
      };
    }
  }

  /**
   * 从分析文本中提取标签
   */
  private extractTagsFromAnalysis(analysisText: string): string[] {
    const tags: string[] = [];
    const commonTags = [
      '人物', '风景', '建筑', '动物', '植物', '食物', '交通工具', '艺术品',
      '室内', '室外', '白天', '夜晚', '彩色', '黑白', '现代', '古典'
    ];

    commonTags.forEach(tag => {
      if (analysisText.includes(tag)) {
        tags.push(tag);
      }
    });

    return tags.slice(0, 5); // 最多返回5个标签
  }

  /**
   * 纯文本对话生成
   */
  async generateTextResponse(request: AITextChatRequest): Promise<AIServiceResponse<AITextChatResult>> {

    if (!this.genAI) {
      return {
        success: false,
        error: this.createError('CLIENT_NOT_INITIALIZED', 'GenAI client not initialized')
      };
    }

    try {

      const result = await this.processWithTimeout(
        this.genAI.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: request.prompt,  // 直接传字符串，与官方文档一致
        })
      );


      if (!result.text) {
        throw new Error('No text response from API');
      }


      return {
        success: true,
        data: {
          text: result.text,
          model: 'gemini-2.0-flash'
        }
      };

    } catch (error) {
      console.error('❌ 文本回复失败:', error);
      return {
        success: false,
        error: this.createError('TEXT_GENERATION_FAILED', error.message, error)
      };
    }
  }

  /**
   * 测试API连接
   */
  async testConnection(): Promise<boolean> {
    console.log('🔬 测试API连接...');

    if (!this.isAvailable()) {
      console.log('❌ API不可用');
      return false;
    }

    try {
      // 使用基础的文本生成来测试连接，避免图像生成的计费问题
      const result = await this.genAI!.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: 'Hello, this is a connection test. Please respond with "Connection successful!"'
      });

      const success = !!result.text;
      console.log('🔬 连接测试结果:', success ? '✅ 成功' : '❌ 失败');

      if (success) {
        console.log('📄 测试响应:', result.text);
      }

      return success;
    } catch (error) {
      console.error('❌ 连接测试异常:', error);
      return false;
    }
  }
}

// 导出单例实例
export const aiImageService = new AIImageService();
export default aiImageService;