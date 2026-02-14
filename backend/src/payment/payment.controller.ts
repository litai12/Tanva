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
   * 获取充值套餐列表（每个套餐独立判断首充状态）
   */
  @Get('packages')
  @UseGuards(JwtAuthGuard)
  async getPackages(@Request() req: any) {
    const creditsPerYuan = 100;
    const amounts = [10, 30, 50, 100, 200, 500];

    // 获取每个金额档位的首充状态
    const firstRechargeStatus = await this.paymentService.getFirstRechargeStatusByAmounts(
      req.user.sub,
      amounts,
    );

    // 首充配置
    const firstRechargeConfig: Record<number, { credits: number; bonus: string | null }> = {
      10: { credits: 2000, bonus: null },
      30: { credits: 6300, bonus: '送5%' },
      50: { credits: 10500, bonus: '送5%' },
      100: { credits: 22400, bonus: '送12%' },
      200: { credits: 48000, bonus: '送20%' },
      500: { credits: 130000, bonus: '送30%' },
    };

    // 根据每个套餐的首充状态返回对应配置
    const packages = amounts.map(price => {
      const isFirst = firstRechargeStatus[price];
      if (isFirst) {
        const config = firstRechargeConfig[price];
        return { price, credits: config.credits, bonus: config.bonus, tag: '首充翻倍', isFirstRecharge: true };
      } else {
        return { price, credits: price * creditsPerYuan, bonus: null, tag: null, isFirstRecharge: false };
      }
    });

    return {
      packages,
      creditsPerYuan,
    };
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
    @Body() notifyData: Record<string, any>,
    @Res() res: FastifyReply,
  ) {
    try {
      const result = await this.paymentService.handleWechatNotify(notifyData);
      // 微信支付要求返回成功响应
      res.send(result ? { code: 'SUCCESS', message: '成功' } : { code: 'FAIL', message: '失败' });
    } catch (error) {
      console.error('处理微信支付回调失败:', error);
      res.send({ code: 'FAIL', message: '处理失败' });
    }
  }
}
