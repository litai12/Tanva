import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest, FastifyReply } from 'fastify';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { ApiHealthService, CreateApiConfigDto, UpdateApiConfigDto } from './api-health.service';

interface AuthenticatedUser {
  id: string;
  role: string;
}

type AuthenticatedRequest = FastifyRequest & { user: AuthenticatedUser };

@ApiTags('管理后台 - API 健康检查')
@Controller('admin/api-health')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ApiHealthController {
  constructor(private readonly apiHealthService: ApiHealthService) {}

  /**
   * 检查是否为管理员
   */
  private checkAdmin(req: AuthenticatedRequest) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('只有管理员可以访问此接口');
    }
  }

  // ==================== API 配置管理 ====================

  @Get('configs')
  @ApiOperation({ summary: '获取所有 API 配置列表' })
  async getApiConfigs(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    return this.apiHealthService.getAllApiConfigs();
  }

  @Get('nodes')
  @ApiOperation({ summary: '获取业务节点监测列表（节点管理 1:1）' })
  async getApiHealthNodes(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    return this.apiHealthService.getAllApiHealthNodes();
  }

  @Patch('nodes/:nodeKey/binding')
  @ApiOperation({ summary: '设置业务节点底层通道绑定（写入 metadata.apiHealth.configId）' })
  async updateNodeBinding(
    @Request() req: AuthenticatedRequest,
    @Param('nodeKey') nodeKey: string,
    @Body() dto: { configId?: string | null },
  ) {
    this.checkAdmin(req);
    return this.apiHealthService.updateNodeBinding(nodeKey, dto.configId ?? null);
  }

  @Get('configs/:id')
  @ApiOperation({ summary: '获取单个 API 配置' })
  async getApiConfig(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    this.checkAdmin(req);
    return this.apiHealthService.getApiConfig(id);
  }

  @Post('configs')
  @ApiOperation({ summary: '创建 API 配置' })
  async createApiConfig(@Request() req: AuthenticatedRequest, @Body() dto: CreateApiConfigDto) {
    this.checkAdmin(req);
    return this.apiHealthService.createApiConfig(dto);
  }

  @Put('configs/:id')
  @ApiOperation({ summary: '更新 API 配置' })
  async updateApiConfig(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateApiConfigDto,
  ) {
    this.checkAdmin(req);
    return this.apiHealthService.updateApiConfig(id, dto);
  }

  @Delete('configs/:id')
  @ApiOperation({ summary: '删除 API 配置' })
  async deleteApiConfig(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    this.checkAdmin(req);
    await this.apiHealthService.deleteApiConfig(id);
    return { success: true, message: 'API 配置已删除' };
  }

  // ==================== 健康检查 ====================

  @Get('status')
  @ApiOperation({ summary: '获取最后一次健康检查结果' })
  async getHealthStatus(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    const lastCheck = this.apiHealthService.getLastHealthCheck();

    if (!lastCheck) {
      // 如果没有缓存，立即执行一次检查
      return this.apiHealthService.checkAllApisHealth();
    }

    return lastCheck;
  }

  @Post('check')
  @ApiOperation({ summary: '立即执行健康检查（一键测试所有 API）' })
  async checkAllApis(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    return this.apiHealthService.checkAllApisHealth();
  }

  @Post('check/:nodeKey')
  @ApiOperation({ summary: '测试单个节点健康状态' })
  async checkSingleNode(
    @Request() req: AuthenticatedRequest,
    @Param('nodeKey') nodeKey: string,
  ) {
    this.checkAdmin(req);
    return this.apiHealthService.checkSingleNodeHealth(nodeKey);
  }

  @Post('check-by-id/:id')
  @ApiOperation({ summary: '测试单个节点健康状态（按配置 ID）' })
  async checkSingleNodeById(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    this.checkAdmin(req);
    return this.apiHealthService.checkSingleNodeHealthById(id);
  }

  @Post('check-by-node/:nodeKey')
  @ApiOperation({ summary: '测试单个节点健康状态（按业务节点 nodeKey）' })
  async checkSingleNodeByNodeKey(
    @Request() req: AuthenticatedRequest,
    @Param('nodeKey') nodeKey: string,
  ) {
    this.checkAdmin(req);
    return this.apiHealthService.checkSingleNodeHealthByNodeKey(nodeKey);
  }

  // ==================== 定时任务配置 ====================

  @Get('schedule')
  @ApiOperation({ summary: '获取定时检测配置' })
  async getScheduleConfig(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    return this.apiHealthService.getScheduleConfig();
  }

  @Post('schedule')
  @ApiOperation({ summary: '更新定时检测配置' })
  async updateScheduleConfig(
    @Request() req: AuthenticatedRequest,
    @Body() config: { enabled: boolean; cronExpression: string; timezone?: string },
  ) {
    this.checkAdmin(req);
    await this.apiHealthService.updateScheduleConfig(config);
    return { success: true, message: '定时检测配置已更新' };
  }

  @Post('test-webhook')
  @ApiOperation({ summary: '发送测试消息到 Webhook（验证配置）' })
  async testWebhook(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    return this.apiHealthService.testWebhook();
  }

  @Post('trigger-scheduled')
  @ApiOperation({ summary: '手动触发定时任务（测试用）' })
  async triggerScheduled(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    await this.apiHealthService.triggerScheduledCheck();
    return { success: true, message: '定时任务已触发' };
  }

  // ==================== 历史趋势 ====================

  @Get('e2e-latest')
  @ApiOperation({ summary: '获取每个节点最新一条 E2E 深度拨测日志' })
  async getLatestE2ELogs(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    return this.apiHealthService.getLatestE2ELogs();
  }

  @Get('history')
  @ApiOperation({ summary: '获取 API 健康历史趋势（降采样）' })
  async getHealthHistory(
    @Request() req: AuthenticatedRequest,
    @Query('timeRange') timeRange: '24h' | '7d' | '30d' = '24h',
    @Query('provider') provider?: string,
    @Query('configId') configId?: string,
  ) {
    this.checkAdmin(req);
    return this.apiHealthService.getHealthHistory(timeRange, provider, configId);
  }

  // ==================== L2 E2E 深度拨测 ====================

  @Get('e2e-schedule')
  @ApiOperation({ summary: '获取 E2E 深度拨测定时配置' })
  async getE2EScheduleConfig(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    return this.apiHealthService.getE2EScheduleConfig();
  }

  @Post('e2e-schedule')
  @ApiOperation({ summary: '更新 E2E 深度拨测定时配置（含 Prompt）' })
  async updateE2EScheduleConfig(
    @Request() req: AuthenticatedRequest,
    @Body() config: { enabled: boolean; cronExpression: string; timezone?: string; prompt?: string },
  ) {
    this.checkAdmin(req);
    await this.apiHealthService.updateE2EScheduleConfig(config);
    return { success: true, message: 'E2E 拨测配置已更新' };
  }

  /**
   * 手动触发单节点 E2E 深度拨测（按配置 ID 精确触发，避免 provider 串号）
   */
  @Post('e2e-by-id/:id')
  @ApiOperation({ summary: '手动触发单节点 L2 E2E 深度拨测（按配置 ID，流式）' })
  async runE2ETestById(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    this.checkAdmin(req);

    const origin = (req.headers.origin as string) || '*';
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });

    let aborted = false;
    reply.raw.on('close', () => { aborted = true; });

    try {
      for await (const event of this.apiHealthService.runE2ENodeTestByConfigId(id)) {
        if (aborted) break;
        reply.raw.write(JSON.stringify(event) + '\n');
      }
    } catch (e: any) {
      if (!aborted) {
        reply.raw.write(JSON.stringify({ event: 'error', data: { message: e.message } }) + '\n');
      }
    } finally {
      reply.raw.end();
    }
  }

  /**
   * 手动触发单节点 E2E 深度拨测（按业务节点 nodeKey 精确触发）
   */
  @Post('e2e-by-node/:nodeKey')
  @ApiOperation({ summary: '手动触发单节点 L2 E2E 深度拨测（按业务节点 nodeKey，流式）' })
  async runE2ETestByNodeKey(
    @Request() req: AuthenticatedRequest,
    @Param('nodeKey') nodeKey: string,
    @Res() reply: FastifyReply,
  ) {
    this.checkAdmin(req);

    const origin = (req.headers.origin as string) || '*';
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });

    let aborted = false;
    reply.raw.on('close', () => { aborted = true; });

    try {
      for await (const event of this.apiHealthService.runE2ENodeTestByNodeKey(nodeKey)) {
        if (aborted) break;
        reply.raw.write(JSON.stringify(event) + '\n');
      }
    } catch (e: any) {
      if (!aborted) {
        reply.raw.write(JSON.stringify({ event: 'error', data: { message: e.message } }) + '\n');
      }
    } finally {
      reply.raw.end();
    }
  }

  /**
   * 手动触发单节点 E2E 深度拨测（流式 NDJSON，与试炼场格式完全一致）
   */
  @Post('e2e/:provider')
  @ApiOperation({ summary: '手动触发单节点 L2 E2E 深度拨测（流式）' })
  async runE2ETest(
    @Request() req: AuthenticatedRequest,
    @Param('provider') provider: string,
    @Res() reply: FastifyReply,
  ) {
    this.checkAdmin(req);

    const origin = (req.headers.origin as string) || '*';
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });

    let aborted = false;
    reply.raw.on('close', () => { aborted = true; });

    try {
      for await (const event of this.apiHealthService.runE2ENodeTest(provider)) {
        if (aborted) break;
        reply.raw.write(JSON.stringify(event) + '\n');
      }
    } catch (e: any) {
      if (!aborted) {
        reply.raw.write(JSON.stringify({ event: 'error', data: { message: e.message } }) + '\n');
      }
    } finally {
      reply.raw.end();
    }
  }
}
