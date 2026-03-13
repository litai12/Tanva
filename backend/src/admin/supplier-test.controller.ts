import { Controller, Post, Get, Body, UseGuards, Request, ForbiddenException, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest, FastifyReply } from 'fastify';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SupplierTestService, SupplierTestRequest } from './supplier-test.service';
import { PROTOCOL_DESCRIPTORS } from '../common/api-protocol.enum';

interface AuthenticatedUser { id: string; role: string; }
type AuthenticatedRequest = FastifyRequest & { user: AuthenticatedUser };

@ApiTags('管理后台 - 供应商试炼场')
@Controller('admin/supplier-test')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SupplierTestController {
  constructor(private readonly supplierTestService: SupplierTestService) {}

  private checkAdmin(req: AuthenticatedRequest) {
    if (req.user.role !== 'admin') throw new ForbiddenException('只有管理员可以访问此接口');
  }

  /** GET /admin/supplier-test/supported-protocols — 返回系统支持的协议列表 */
  @Get('supported-protocols')
  @ApiOperation({ summary: '获取系统支持的底层 API 协议列表' })
  getSupportedProtocols(@Request() req: AuthenticatedRequest) {
    this.checkAdmin(req);
    return PROTOCOL_DESCRIPTORS;
  }

  /**
   * 流式推送测试进度（POST body 传参，避免 apiKey 泄漏到 URL）
   * 响应格式：每行一个 JSON，以 \n 分隔（NDJSON）
   */
  @Post('stream')
  @ApiOperation({ summary: '流式供应商测试（NDJSON 推送）' })
  async streamTest(
    @Request() req: AuthenticatedRequest,
    @Body() body: SupplierTestRequest,
    @Res() reply: FastifyReply,
  ) {
    this.checkAdmin(req);

    // 设置流式响应头
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // 禁用 Nginx 缓冲
    });

    let aborted = false;
    reply.raw.on('close', () => { aborted = true; });

    try {
      for await (const event of this.supplierTestService.streamTest(body)) {
        if (aborted) break;
        // 每个事件写一行 JSON，前端用 \n 分割读取
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

  /** 保留旧的同步接口，兼容现有调用 */
  @Post('run')
  @ApiOperation({ summary: '发起供应商真实测试（同步等待，兼容旧版）' })
  async runTest(@Request() req: AuthenticatedRequest, @Body() body: SupplierTestRequest) {
    this.checkAdmin(req);
    return this.supplierTestService.runTest(body);
  }
}
