import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export interface NodeConfigDto {
  nodeKey: string;
  nameZh: string;
  nameEn: string;
  category?: string;
  status?: string;
  statusMessage?: string;
  creditsPerCall?: number;
  priceYuan?: number;
  serviceType?: string;
  sortOrder?: number;
  isVisible?: boolean;
  description?: string;
  metadata?: Record<string, any>;
}

export interface UpdateNodeConfigDto {
  nameZh?: string;
  nameEn?: string;
  category?: string;
  status?: string;
  statusMessage?: string;
  creditsPerCall?: number;
  priceYuan?: number;
  serviceType?: string;
  sortOrder?: number;
  isVisible?: boolean;
  description?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class NodeConfigService {
  private readonly logger = new Logger(NodeConfigService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取所有节点配置（公开接口，前端使用）
   */
  async getAllNodeConfigs() {
    const configs = await this.prisma.nodeConfig.findMany({
      where: { isVisible: true },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    });

    return configs.map((config) => ({
      nodeKey: config.nodeKey,
      nameZh: config.nameZh,
      nameEn: config.nameEn,
      category: config.category,
      status: config.status,
      statusMessage: config.statusMessage,
      creditsPerCall: config.creditsPerCall,
      priceYuan: config.priceYuan ? Number(config.priceYuan) : null,
      serviceType: config.serviceType,
      sortOrder: config.sortOrder,
      description: config.description,
      metadata: config.metadata,
    }));
  }

  /**
   * 获取所有节点配置（管理接口，包含隐藏的）
   */
  async getAllNodeConfigsAdmin() {
    const configs = await this.prisma.nodeConfig.findMany({
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    });

    return configs.map((config) => ({
      id: config.id,
      nodeKey: config.nodeKey,
      nameZh: config.nameZh,
      nameEn: config.nameEn,
      category: config.category,
      status: config.status,
      statusMessage: config.statusMessage,
      creditsPerCall: config.creditsPerCall,
      priceYuan: config.priceYuan ? Number(config.priceYuan) : null,
      serviceType: config.serviceType,
      sortOrder: config.sortOrder,
      isVisible: config.isVisible,
      description: config.description,
      metadata: config.metadata,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    }));
  }

  /**
   * 获取单个节点配置
   */
  async getNodeConfig(nodeKey: string) {
    const config = await this.prisma.nodeConfig.findUnique({
      where: { nodeKey },
    });

    if (!config) {
      return null;
    }

    return {
      id: config.id,
      nodeKey: config.nodeKey,
      nameZh: config.nameZh,
      nameEn: config.nameEn,
      category: config.category,
      status: config.status,
      statusMessage: config.statusMessage,
      creditsPerCall: config.creditsPerCall,
      priceYuan: config.priceYuan ? Number(config.priceYuan) : null,
      serviceType: config.serviceType,
      sortOrder: config.sortOrder,
      isVisible: config.isVisible,
      description: config.description,
      metadata: config.metadata,
    };
  }

  /**
   * 创建节点配置
   */
  async createNodeConfig(dto: NodeConfigDto) {
    const config = await this.prisma.nodeConfig.create({
      data: {
        nodeKey: dto.nodeKey,
        nameZh: dto.nameZh,
        nameEn: dto.nameEn,
        category: dto.category || 'other',
        status: dto.status || 'normal',
        statusMessage: dto.statusMessage,
        creditsPerCall: dto.creditsPerCall || 0,
        priceYuan: dto.priceYuan ? new Prisma.Decimal(dto.priceYuan) : null,
        serviceType: dto.serviceType,
        sortOrder: dto.sortOrder || 0,
        isVisible: dto.isVisible ?? true,
        description: dto.description,
        metadata: dto.metadata || {},
      },
    });

    this.logger.log(`创建节点配置: ${dto.nodeKey}`);
    return config;
  }

  /**
   * 更新节点配置
   */
  async updateNodeConfig(nodeKey: string, dto: UpdateNodeConfigDto) {
    const existing = await this.prisma.nodeConfig.findUnique({
      where: { nodeKey },
    });

    if (!existing) {
      throw new NotFoundException(`节点配置不存在: ${nodeKey}`);
    }

    const updateData: Prisma.NodeConfigUpdateInput = {};

    if (dto.nameZh !== undefined) updateData.nameZh = dto.nameZh;
    if (dto.nameEn !== undefined) updateData.nameEn = dto.nameEn;
    if (dto.category !== undefined) updateData.category = dto.category;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.statusMessage !== undefined) updateData.statusMessage = dto.statusMessage;
    if (dto.creditsPerCall !== undefined) updateData.creditsPerCall = dto.creditsPerCall;
    if (dto.priceYuan !== undefined) {
      updateData.priceYuan = dto.priceYuan ? new Prisma.Decimal(dto.priceYuan) : null;
    }
    if (dto.serviceType !== undefined) updateData.serviceType = dto.serviceType;
    if (dto.sortOrder !== undefined) updateData.sortOrder = dto.sortOrder;
    if (dto.isVisible !== undefined) updateData.isVisible = dto.isVisible;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.metadata !== undefined) updateData.metadata = dto.metadata;

    const config = await this.prisma.nodeConfig.update({
      where: { nodeKey },
      data: updateData,
    });

    this.logger.log(`更新节点配置: ${nodeKey}`);
    return config;
  }

  /**
   * 删除节点配置
   */
  async deleteNodeConfig(nodeKey: string) {
    const existing = await this.prisma.nodeConfig.findUnique({
      where: { nodeKey },
    });

    if (!existing) {
      throw new NotFoundException(`节点配置不存在: ${nodeKey}`);
    }

    await this.prisma.nodeConfig.delete({
      where: { nodeKey },
    });

    this.logger.log(`删除节点配置: ${nodeKey}`);
    return { success: true };
  }

  /**
   * 批量初始化节点配置（用于首次部署）
   */
  async initializeDefaultConfigs() {
    const defaultConfigs: NodeConfigDto[] = [
      // 输入节点 - 免费
      { nodeKey: 'textPrompt', nameZh: '提示词节点', nameEn: 'Prompt', category: 'input', sortOrder: 1, creditsPerCall: 0, description: '输入文本提示词' },
      { nodeKey: 'textPromptPro', nameZh: '高级提示词', nameEn: 'Prompt Pro', category: 'input', sortOrder: 2, creditsPerCall: 0, description: '支持多段提示词输入' },
      { nodeKey: 'image', nameZh: '图片节点', nameEn: 'Image', category: 'input', sortOrder: 3, creditsPerCall: 0, description: '上传或粘贴图片' },
      { nodeKey: 'imagePro', nameZh: '高级图片节点', nameEn: 'Image Pro', category: 'input', sortOrder: 4, creditsPerCall: 0, description: '支持多图输入' },
      { nodeKey: 'video', nameZh: '视频节点', nameEn: 'Video', category: 'input', sortOrder: 5, creditsPerCall: 0, description: '上传视频文件' },
      { nodeKey: 'textNote', nameZh: '文本便签', nameEn: 'Note', category: 'input', sortOrder: 6, creditsPerCall: 0, description: '纯文本记录' },
      { nodeKey: 'camera', nameZh: '相机节点', nameEn: 'Camera', category: 'input', sortOrder: 7, creditsPerCall: 0, description: '截取画布内容' },

      // 生图节点
      { nodeKey: 'generate', nameZh: '生成节点', nameEn: 'Generate', category: 'image', sortOrder: 10, creditsPerCall: 10, serviceType: 'gemini-2.5-image', priceYuan: 0.1, description: '文生图，按次计费' },
      { nodeKey: 'generate4', nameZh: '四图生成', nameEn: 'Generate 4', category: 'image', sortOrder: 11, creditsPerCall: 40, serviceType: 'gemini-2.5-image', priceYuan: 0.4, description: '一次生成4张图' },
      { nodeKey: 'generatePro', nameZh: '高级生成', nameEn: 'Generate Pro', category: 'image', sortOrder: 12, creditsPerCall: 30, serviceType: 'gemini-3-pro-image', priceYuan: 0.3, description: '高质量文生图' },
      { nodeKey: 'generatePro4', nameZh: '高级四图', nameEn: 'Generate Pro 4', category: 'image', sortOrder: 13, creditsPerCall: 120, serviceType: 'gemini-3-pro-image', priceYuan: 1.2, description: '高质量一次4张' },
      { nodeKey: 'generateReference', nameZh: '参考生成', nameEn: 'Reference', category: 'image', sortOrder: 14, creditsPerCall: 30, serviceType: 'gemini-image-blend', priceYuan: 0.3, description: '参考图生成' },
      { nodeKey: 'midjourney', nameZh: 'Midjourney', nameEn: 'Midjourney', category: 'image', sortOrder: 15, creditsPerCall: 20, serviceType: 'midjourney-imagine', priceYuan: 0.2, description: 'Midjourney生图' },

      // 视频生成节点
      {
        nodeKey: 'klingVideo',
        nameZh: 'Kling视频生成',
        nameEn: 'Kling',
        category: 'video',
        sortOrder: 20,
        creditsPerCall: 60,
        serviceType: 'kling-video',
        priceYuan: 0.6,
        status: 'maintenance',
        statusMessage: '接口维护中',
        description: '可灵视频生成，按次计费',
      },
      {
        nodeKey: 'kling26Video',
        nameZh: 'Kling 2.6视频生成',
        nameEn: 'Kling 2.6',
        category: 'video',
        sortOrder: 21,
        creditsPerCall: 100,
        serviceType: 'kling-2.6-video',
        priceYuan: 1,
        description: '可灵Kling 2.6视频生成，使用kling-v2-6模型',
      },
      {
        nodeKey: 'klingO1Video',
        nameZh: 'Kling O1视频生成',
        nameEn: 'Kling O1',
        category: 'video',
        sortOrder: 22,
        creditsPerCall: 100,
        serviceType: 'kling-o1-video',
        priceYuan: 1,
        description: '可灵O1全能视频，支持文生视频/图生视频/视频编辑',
        metadata: {
          billingType: 'per_call',
          billingNote: '按次计费，1元/次',
          supportedModes: ['text2video', 'image2video', 'video_edit'],
          durationRange: { min: 3, max: 10 },
        },
      },
      {
        nodeKey: 'viduVideo',
        nameZh: 'Vidu视频生成',
        nameEn: 'Vidu',
        category: 'video',
        sortOrder: 23,
        creditsPerCall: 60,
        serviceType: 'vidu-video',
        priceYuan: 0.6,
        description: 'Vidu视频生成',
      },
      {
        nodeKey: 'doubaoVideo',
        nameZh: '豆包视频生成',
        nameEn: 'Seedance',
        category: 'video',
        sortOrder: 24,
        creditsPerCall: 60,
        serviceType: 'doubao-video',
        priceYuan: 0.6,
        description: '豆包Seedance 1.5 Pro视频',
      },
      {
        nodeKey: 'sora2Video',
        nameZh: 'Sora视频生成',
        nameEn: 'Sora',
        category: 'video',
        sortOrder: 25,
        creditsPerCall: 40,
        serviceType: 'sora-sd',
        priceYuan: 0.4,
        description: 'OpenAI Sora视频',
        metadata: {
          billingType: 'by_quality',
          pricing: {
            sd: { credits: 40, priceYuan: 0.4 },
            hd: { credits: 400, priceYuan: 4 },
          },
        },
      },
      {
        nodeKey: 'wan26',
        nameZh: 'Wan2.6视频',
        nameEn: 'Wan2.6',
        category: 'video',
        sortOrder: 26,
        creditsPerCall: 600,
        serviceType: 'wan26-video',
        priceYuan: 6,
        description: '阿里Wan2.6视频生成',
      },
      {
        nodeKey: 'wan2R2V',
        nameZh: 'Wan2参考视频',
        nameEn: 'Wan2 R2V',
        category: 'video',
        sortOrder: 27,
        creditsPerCall: 600,
        serviceType: 'wan26-r2v',
        priceYuan: 6,
        description: '参考视频生成',
      },

      // 其他节点
      { nodeKey: 'videoAnalyze', nameZh: '视频分析节点', nameEn: 'Video Analysis', category: 'other', sortOrder: 30, creditsPerCall: 30, serviceType: 'gemini-video-analyze', priceYuan: 0.3, description: '分析视频内容' },
      { nodeKey: 'videoFrameExtract', nameZh: '视频帧提取', nameEn: 'Frame Extract', category: 'other', sortOrder: 31, creditsPerCall: 0, description: '从视频提取帧，免费' },
      { nodeKey: 'analysis', nameZh: '图像分析节点', nameEn: 'Analysis', category: 'other', sortOrder: 32, creditsPerCall: 6, serviceType: 'gemini-image-analyze', priceYuan: 0.06, description: '分析图像内容' },
      { nodeKey: 'promptOptimize', nameZh: '提示词优化', nameEn: 'Optimize', category: 'other', sortOrder: 33, creditsPerCall: 2, serviceType: 'gemini-text', priceYuan: 0.02, description: 'AI优化提示词' },
      { nodeKey: 'textChat', nameZh: '文字对话', nameEn: 'Chat', category: 'other', sortOrder: 34, creditsPerCall: 2, serviceType: 'gemini-text', priceYuan: 0.02, description: 'AI文字对话' },
      { nodeKey: 'storyboardSplit', nameZh: '分镜拆解', nameEn: 'Storyboard', category: 'other', sortOrder: 35, creditsPerCall: 10, serviceType: 'gemini-text', priceYuan: 0.1, description: '拆解分镜脚本' },
      { nodeKey: 'imageGrid', nameZh: '图片拼接', nameEn: 'Grid', category: 'other', sortOrder: 36, creditsPerCall: 0, description: '拼接多张图片，免费' },
      { nodeKey: 'imageSplit', nameZh: '图片拆分', nameEn: 'Split', category: 'other', sortOrder: 37, creditsPerCall: 0, description: '拆分图片，免费' },
      { nodeKey: 'three', nameZh: '2D转3D', nameEn: '2D to 3D', category: 'other', sortOrder: 38, creditsPerCall: 30, serviceType: 'convert-2d-to-3d', priceYuan: 0.3, description: '图片转3D模型' },
    ];

    let created = 0;
    let skipped = 0;

    for (const config of defaultConfigs) {
      const existing = await this.prisma.nodeConfig.findUnique({
        where: { nodeKey: config.nodeKey },
      });

      if (!existing) {
        await this.createNodeConfig(config);
        created++;
      } else {
        skipped++;
      }
    }

    this.logger.log(`节点配置初始化完成: 创建 ${created} 个, 跳过 ${skipped} 个`);
    return { created, skipped };
  }

  /**
   * 强制同步所有节点配置（覆盖已存在的配置）
   */
  async syncAllConfigs() {
    const defaultConfigs = await this.getDefaultConfigs();

    let created = 0;
    let updated = 0;

    for (const config of defaultConfigs) {
      const existing = await this.prisma.nodeConfig.findUnique({
        where: { nodeKey: config.nodeKey },
      });

      if (!existing) {
        await this.createNodeConfig(config);
        created++;
      } else {
        // 更新已存在的配置
        await this.prisma.nodeConfig.update({
          where: { nodeKey: config.nodeKey },
          data: {
            nameZh: config.nameZh,
            nameEn: config.nameEn,
            category: config.category || 'other',
            status: config.status || 'normal',
            statusMessage: config.statusMessage,
            creditsPerCall: config.creditsPerCall || 0,
            priceYuan: config.priceYuan ? new Prisma.Decimal(config.priceYuan) : null,
            serviceType: config.serviceType,
            sortOrder: config.sortOrder || 0,
            description: config.description,
            metadata: config.metadata || {},
          },
        });
        updated++;
      }
    }

    this.logger.log(`节点配置同步完成: 创建 ${created} 个, 更新 ${updated} 个`);
    return { created, updated };
  }

  /**
   * 获取默认配置列表
   */
  private async getDefaultConfigs(): Promise<NodeConfigDto[]> {
    return [
      // 输入节点 - 免费
      { nodeKey: 'textPrompt', nameZh: '提示词节点', nameEn: 'Prompt', category: 'input', sortOrder: 1, creditsPerCall: 0, description: '输入文本提示词' },
      { nodeKey: 'textPromptPro', nameZh: '高级提示词', nameEn: 'Prompt Pro', category: 'input', sortOrder: 2, creditsPerCall: 0, description: '支持多段提示词输入' },
      { nodeKey: 'image', nameZh: '图片节点', nameEn: 'Image', category: 'input', sortOrder: 3, creditsPerCall: 0, description: '上传或粘贴图片' },
      { nodeKey: 'imagePro', nameZh: '高级图片节点', nameEn: 'Image Pro', category: 'input', sortOrder: 4, creditsPerCall: 0, description: '支持多图输入' },
      { nodeKey: 'video', nameZh: '视频节点', nameEn: 'Video', category: 'input', sortOrder: 5, creditsPerCall: 0, description: '上传视频文件' },
      { nodeKey: 'textNote', nameZh: '文本便签', nameEn: 'Note', category: 'input', sortOrder: 6, creditsPerCall: 0, description: '纯文本记录' },
      { nodeKey: 'camera', nameZh: '相机节点', nameEn: 'Camera', category: 'input', sortOrder: 7, creditsPerCall: 0, description: '截取画布内容' },

      // 生图节点
      { nodeKey: 'generate', nameZh: '生成节点', nameEn: 'Generate', category: 'image', sortOrder: 10, creditsPerCall: 10, serviceType: 'gemini-2.5-image', priceYuan: 0.1, description: '文生图，按次计费' },
      { nodeKey: 'generate4', nameZh: '四图生成', nameEn: 'Generate 4', category: 'image', sortOrder: 11, creditsPerCall: 40, serviceType: 'gemini-2.5-image', priceYuan: 0.4, description: '一次生成4张图' },
      { nodeKey: 'generatePro', nameZh: '高级生成', nameEn: 'Generate Pro', category: 'image', sortOrder: 12, creditsPerCall: 30, serviceType: 'gemini-3-pro-image', priceYuan: 0.3, description: '高质量文生图' },
      { nodeKey: 'generatePro4', nameZh: '高级四图', nameEn: 'Generate Pro 4', category: 'image', sortOrder: 13, creditsPerCall: 120, serviceType: 'gemini-3-pro-image', priceYuan: 1.2, description: '高质量一次4张' },
      { nodeKey: 'generateReference', nameZh: '参考生成', nameEn: 'Reference', category: 'image', sortOrder: 14, creditsPerCall: 30, serviceType: 'gemini-image-blend', priceYuan: 0.3, description: '参考图生成' },
      { nodeKey: 'midjourney', nameZh: 'Midjourney', nameEn: 'Midjourney', category: 'image', sortOrder: 15, creditsPerCall: 20, serviceType: 'midjourney-imagine', priceYuan: 0.2, description: 'Midjourney生图' },

      // 视频生成节点
      {
        nodeKey: 'klingVideo',
        nameZh: 'Kling视频生成',
        nameEn: 'Kling',
        category: 'video',
        sortOrder: 20,
        creditsPerCall: 60,
        serviceType: 'kling-video',
        priceYuan: 0.6,
        status: 'maintenance',
        statusMessage: '接口维护中',
        description: '可灵视频生成，按次计费',
      },
      {
        nodeKey: 'kling26Video',
        nameZh: 'Kling 2.6视频生成',
        nameEn: 'Kling 2.6',
        category: 'video',
        sortOrder: 21,
        creditsPerCall: 100,
        serviceType: 'kling-2.6-video',
        priceYuan: 1,
        description: '可灵Kling 2.6视频生成，使用kling-v2-6模型',
      },
      {
        nodeKey: 'klingO1Video',
        nameZh: 'Kling O1视频生成',
        nameEn: 'Kling O1',
        category: 'video',
        sortOrder: 22,
        creditsPerCall: 100,
        serviceType: 'kling-o1-video',
        priceYuan: 1,
        description: '可灵O1全能视频，支持文生视频/图生视频/视频编辑',
        metadata: {
          billingType: 'per_call',
          billingNote: '按次计费，1元/次',
          supportedModes: ['text2video', 'image2video', 'video_edit'],
          durationRange: { min: 3, max: 10 },
        },
      },
      {
        nodeKey: 'viduVideo',
        nameZh: 'Vidu视频生成',
        nameEn: 'Vidu',
        category: 'video',
        sortOrder: 23,
        creditsPerCall: 60,
        serviceType: 'vidu-video',
        priceYuan: 0.6,
        description: 'Vidu视频生成',
      },
      {
        nodeKey: 'doubaoVideo',
        nameZh: '豆包视频生成',
        nameEn: 'Seedance',
        category: 'video',
        sortOrder: 24,
        creditsPerCall: 60,
        serviceType: 'doubao-video',
        priceYuan: 0.6,
        description: '豆包Seedance 1.5 Pro视频',
      },
      {
        nodeKey: 'sora2Video',
        nameZh: 'Sora视频生成',
        nameEn: 'Sora',
        category: 'video',
        sortOrder: 25,
        creditsPerCall: 40,
        serviceType: 'sora-sd',
        priceYuan: 0.4,
        description: 'OpenAI Sora视频',
        metadata: {
          billingType: 'by_quality',
          pricing: {
            sd: { credits: 40, priceYuan: 0.4 },
            hd: { credits: 400, priceYuan: 4 },
          },
        },
      },
      {
        nodeKey: 'wan26',
        nameZh: 'Wan2.6视频',
        nameEn: 'Wan2.6',
        category: 'video',
        sortOrder: 26,
        creditsPerCall: 600,
        serviceType: 'wan26-video',
        priceYuan: 6,
        description: '阿里Wan2.6视频生成',
      },
      {
        nodeKey: 'wan2R2V',
        nameZh: 'Wan2参考视频',
        nameEn: 'Wan2 R2V',
        category: 'video',
        sortOrder: 27,
        creditsPerCall: 600,
        serviceType: 'wan26-r2v',
        priceYuan: 6,
        description: '参考视频生成',
      },

      // 其他节点
      { nodeKey: 'videoAnalyze', nameZh: '视频分析节点', nameEn: 'Video Analysis', category: 'other', sortOrder: 30, creditsPerCall: 30, serviceType: 'gemini-video-analyze', priceYuan: 0.3, description: '分析视频内容' },
      { nodeKey: 'videoFrameExtract', nameZh: '视频帧提取', nameEn: 'Frame Extract', category: 'other', sortOrder: 31, creditsPerCall: 0, description: '从视频提取帧，免费' },
      { nodeKey: 'analysis', nameZh: '图像分析节点', nameEn: 'Analysis', category: 'other', sortOrder: 32, creditsPerCall: 6, serviceType: 'gemini-image-analyze', priceYuan: 0.06, description: '分析图像内容' },
      { nodeKey: 'promptOptimize', nameZh: '提示词优化', nameEn: 'Optimize', category: 'other', sortOrder: 33, creditsPerCall: 2, serviceType: 'gemini-text', priceYuan: 0.02, description: 'AI优化提示词' },
      { nodeKey: 'textChat', nameZh: '文字对话', nameEn: 'Chat', category: 'other', sortOrder: 34, creditsPerCall: 2, serviceType: 'gemini-text', priceYuan: 0.02, description: 'AI文字对话' },
      { nodeKey: 'storyboardSplit', nameZh: '分镜拆解', nameEn: 'Storyboard', category: 'other', sortOrder: 35, creditsPerCall: 10, serviceType: 'gemini-text', priceYuan: 0.1, description: '拆解分镜脚本' },
      { nodeKey: 'imageGrid', nameZh: '图片拼接', nameEn: 'Grid', category: 'other', sortOrder: 36, creditsPerCall: 0, description: '拼接多张图片，免费' },
      { nodeKey: 'imageSplit', nameZh: '图片拆分', nameEn: 'Split', category: 'other', sortOrder: 37, creditsPerCall: 0, description: '拆分图片，免费' },
      { nodeKey: 'three', nameZh: '2D转3D', nameEn: '2D to 3D', category: 'other', sortOrder: 38, creditsPerCall: 30, serviceType: 'convert-2d-to-3d', priceYuan: 0.3, description: '图片转3D模型' },
    ];
  }

  /**
   * 根据 serviceType 获取积分消耗
   */
  async getCreditsForService(serviceType: string): Promise<number | null> {
    const config = await this.prisma.nodeConfig.findFirst({
      where: { serviceType },
    });
    return config?.creditsPerCall ?? null;
  }
}
