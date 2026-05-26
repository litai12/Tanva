import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Res,
  ForbiddenException,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { PaymentService } from './payment.service';
import { CreateOrderDto, PaymentMethod } from './dto/payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  /**
   * 创建支付订单
   */
  @Post('order')
  @UseGuards(JwtAuthGuard)
  async createOrder(
    @Request() req: any,
    @Body() dto: CreateOrderDto,
  ) {
    return this.paymentService.createOrder(req.user.sub, dto);
  }

  /**
   * 查询订单状态
   */
  @Get('order/:orderNo/status')
  @UseGuards(JwtAuthGuard)
  async getOrderStatus(
    @Request() req: any,
    @Param('orderNo') orderNo: string,
  ) {
    return this.paymentService.getOrderStatus(orderNo, req.user.sub);
  }

  /**
   * 获取用户订单列表
   */
  @Get('orders')
  @UseGuards(JwtAuthGuard)
  async getUserOrders(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.paymentService.getUserOrders(
      req.user.sub,
      parseInt(page || '1'),
      parseInt(pageSize || '10'),
    );
  }

  /**
   * 用户确认支付完成
   */
  @Post('order/:orderNo/confirm')
  @UseGuards(JwtAuthGuard)
  async confirmPayment(
    @Request() req: any,
    @Param('orderNo') orderNo: string,
  ) {
    return this.paymentService.confirmPayment(orderNo, req.user.sub);
  }

  /**
   * 获取充值套餐列表（固定积分档位）
   */
  @Get('packages')
  @UseGuards(JwtAuthGuard)
  async getPackages(@Request() req: any) {
    const userId = req.user?.id ?? req.user?.sub;
    return this.paymentService.getRechargePackages(userId);
  }

  @Get('membership-plans')
  @UseGuards(JwtAuthGuard)
  async getMembershipPlans() {
    return this.paymentService.getMembershipPlans();
  }

  /**
   * 支付宝异步回调通知
   */
  @Post('notify')
  async alipayNotify(
    @Body() notifyData: Record<string, string>,
    @Res() res: FastifyReply,
  ) {
    try {
      const result = await this.paymentService.handleAlipayNotify(notifyData);
      // 支付宝要求返回 'success' 字符串表示接收成功
      res.send(result ? 'success' : 'fail');
    } catch (error) {
      console.error('处理支付宝回调失败:', error);
      res.send('fail');
    }
  }

  /**
   * 微信支付异步回调通知
   */
  @Post('wechat-notify')
  async wechatNotify(
    @Request() req: any,
    @Body() notifyData: Record<string, any>,
    @Res() res: FastifyReply,
  ) {
    try {
      const result = await this.paymentService.handleWechatNotify(
        notifyData,
        (req?.headers || {}) as Record<string, string | string[] | undefined>,
      );
      // 微信支付要求返回成功响应
      res.send(result ? { code: 'SUCCESS', message: '成功' } : { code: 'FAIL', message: '失败' });
    } catch (error) {
      console.error('处理微信支付回调失败:', error);
      res.send({ code: 'FAIL', message: '处理失败' });
    }
  }

  /**
   * 微信支付异步回调通知（兼容路由）
   */
  @Post('wechat/notify')
  async wechatNotifyCompat(
    @Request() req: any,
    @Body() notifyData: Record<string, any>,
    @Res() res: FastifyReply,
  ) {
    return this.wechatNotify(req, notifyData, res);
  }

  /**
   * 管理员手动同步订单支付状态（用于处理漏单）
   */
  @Post('admin/orders/:orderNo/sync')
  @UseGuards(JwtAuthGuard)
  async adminSyncOrder(@Request() req: any, @Param('orderNo') orderNo: string) {
    const role = typeof req.user?.role === 'string' ? req.user.role.toLowerCase() : '';
    if (role !== 'admin') throw new ForbiddenException('仅管理员可操作');
    return this.paymentService.syncOrderByAdmin(orderNo);
  }
}
