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
import { Response } from 'express';
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
   * 获取充值套餐列表（根据用户首充状态返回不同配置）
   */
  @Get('packages')
  @UseGuards(JwtAuthGuard)
  async getPackages(@Request() req: any) {
    const isFirstRecharge = await this.paymentService.checkIsFirstRecharge(req.user.sub);
    const creditsPerYuan = 100;

    // 首充套餐（有赠送）
    const firstRechargePackages = [
      { price: 10, credits: 2000, bonus: null, tag: '首充翻倍' },
      { price: 30, credits: 6300, bonus: '送5%', tag: '首充翻倍' },
      { price: 50, credits: 10500, bonus: '送5%', tag: '首充翻倍' },
      { price: 100, credits: 22400, bonus: '送12%', tag: '首充翻倍' },
      { price: 200, credits: 48000, bonus: '送20%', tag: '首充翻倍' },
      { price: 500, credits: 130000, bonus: '送30%', tag: '首充翻倍' },
    ];

    // 非首充套餐（原价 1:100）
    const normalPackages = [
      { price: 10, credits: 1000, bonus: null, tag: null },
      { price: 30, credits: 3000, bonus: null, tag: null },
      { price: 50, credits: 5000, bonus: null, tag: null },
      { price: 100, credits: 10000, bonus: null, tag: null },
      { price: 200, credits: 20000, bonus: null, tag: null },
      { price: 500, credits: 50000, bonus: null, tag: null },
    ];

    return {
      isFirstRecharge,
      packages: isFirstRecharge ? firstRechargePackages : normalPackages,
      creditsPerYuan,
    };
  }

  /**
   * 支付宝异步回调通知
   */
  @Post('notify')
  async alipayNotify(
    @Body() notifyData: Record<string, string>,
    @Res() res: Response,
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
}
