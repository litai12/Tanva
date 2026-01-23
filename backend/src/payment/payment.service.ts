import { Injectable, BadRequestException, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaymentMethod,
  PaymentStatus,
  CreateOrderDto,
  PaymentOrderResponse,
  PaymentStatusResponse,
  CREDITS_PER_YUAN,
} from './dto/payment.dto';
import { TransactionType } from '../credits/dto/credits.dto';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AlipaySdk } = require('alipay-sdk');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const QRCode = require('qrcode');

@Injectable()
export class PaymentService implements OnModuleInit {
  private alipaySdk: any;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  onModuleInit() {
    // 初始化支付宝SDK
    const appId = this.configService.get<string>('ALIPAY_APP_ID');
    const privateKey = this.configService.get<string>('ALIPAY_PRIVATE_KEY');
    const alipayPublicKey = this.configService.get<string>('ALIPAY_PUBLIC_KEY');

    if (appId && privateKey) {
      this.alipaySdk = new AlipaySdk({
        appId,
        privateKey,
        alipayPublicKey,
        signType: 'RSA2',
      });
      console.log('支付宝SDK初始化成功');
    } else {
      console.warn('支付宝配置缺失，支付功能不可用');
    }
  }

  /**
   * 生成订单号
   */
  private generateOrderNo(): string {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `PAY${timestamp}${random}`;
  }

  /**
   * 创建支付订单
   */
  async createOrder(userId: string, dto: CreateOrderDto): Promise<PaymentOrderResponse> {
    const { amount, credits, paymentMethod } = dto;

    // 验证金额和积分
    const minCredits = amount * CREDITS_PER_YUAN;
    const maxCredits = amount * CREDITS_PER_YUAN * 10;
    if (credits < minCredits * 0.5 || credits > maxCredits) {
      throw new BadRequestException('积分数量不合理');
    }

    // 取消该用户之前所有待支付的订单（避免订单堆积）
    await this.prisma.paymentOrder.updateMany({
      where: {
        userId,
        status: PaymentStatus.PENDING,
      },
      data: {
        status: PaymentStatus.CANCELLED,
      },
    });

    const orderNo = this.generateOrderNo();
    const expiredAt = new Date(Date.now() + 5 * 60 * 1000); // 5分钟过期

    // 生成支付二维码
    let qrCodeUrl: string | null = null;
    if (paymentMethod === PaymentMethod.ALIPAY) {
      qrCodeUrl = await this.generateAlipayQrCode(orderNo, amount);
    } else if (paymentMethod === PaymentMethod.WECHAT) {
      // 微信支付暂未开通，返回占位符
      qrCodeUrl = null;
    }

    // 创建订单记录
    const order = await this.prisma.paymentOrder.create({
      data: {
        orderNo,
        userId,
        amount,
        credits,
        paymentMethod,
        status: PaymentStatus.PENDING,
        qrCodeUrl,
        expiredAt,
      },
    });

    return {
      orderId: order.id,
      orderNo: order.orderNo,
      amount: Number(order.amount),
      credits: order.credits,
      paymentMethod: order.paymentMethod as PaymentMethod,
      status: order.status as PaymentStatus,
      qrCodeUrl: order.qrCodeUrl,
      expiredAt: order.expiredAt,
      createdAt: order.createdAt,
    };
  }

  /**
   * 生成支付宝当面付二维码 (alipay.trade.precreate)
   */
  private async generateAlipayQrCode(orderNo: string, amount: number): Promise<string> {
    if (!this.alipaySdk) {
      throw new BadRequestException('支付宝SDK未初始化');
    }

    try {
      // 调用支付宝当面付预创建接口
      const result = await this.alipaySdk.exec('alipay.trade.precreate', {
        bizContent: {
          out_trade_no: orderNo,
          total_amount: amount.toFixed(2),
          subject: `积分充值 - ${amount}元`,
          timeout_express: '30m',
        },
      });

      console.log('支付宝预创建订单响应:', JSON.stringify(result, null, 2));

      // 检查响应
      if (result.code !== '10000') {
        console.error('支付宝预创建失败:', result);
        throw new BadRequestException(result.subMsg || result.msg || '创建支付订单失败');
      }

      // 获取支付二维码链接
      const qrCodeLink = result.qrCode;
      if (!qrCodeLink) {
        throw new BadRequestException('未获取到支付二维码');
      }

      // 将二维码链接转换为Base64图片
      const qrCodeDataUrl = await QRCode.toDataURL(qrCodeLink, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      });

      return qrCodeDataUrl;
    } catch (error: any) {
      console.error('生成支付宝二维码失败:', error);
      throw new BadRequestException(error.message || '生成支付二维码失败');
    }
  }

  /**
   * 查询订单状态（包含支付宝实时查询）
   */
  async getOrderStatus(orderNo: string, userId: string): Promise<PaymentStatusResponse> {
    const order = await this.prisma.paymentOrder.findFirst({
      where: { orderNo, userId },
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    // 如果订单还是待支付状态，查询支付宝获取实时状态
    if (order.status === PaymentStatus.PENDING && order.paymentMethod === PaymentMethod.ALIPAY) {
      const alipayStatus = await this.queryAlipayTradeStatus(orderNo);

      if (alipayStatus === 'TRADE_SUCCESS' || alipayStatus === 'TRADE_FINISHED') {
        // 支付成功，更新订单并添加积分
        await this.processPaymentSuccess(order.id, userId, order.credits, order.amount);
        return {
          orderNo: order.orderNo,
          status: PaymentStatus.PAID,
          paidAt: new Date(),
          credits: order.credits,
        };
      }
    }

    return {
      orderNo: order.orderNo,
      status: order.status as PaymentStatus,
      paidAt: order.paidAt,
      credits: order.credits,
    };
  }

  /**
   * 查询支付宝交易状态 (alipay.trade.query)
   */
  private async queryAlipayTradeStatus(orderNo: string): Promise<string | null> {
    if (!this.alipaySdk) {
      return null;
    }

    try {
      const result = await this.alipaySdk.exec('alipay.trade.query', {
        bizContent: {
          out_trade_no: orderNo,
        },
      });

      console.log('支付宝交易查询响应:', JSON.stringify(result, null, 2));

      if (result.code === '10000') {
        return result.tradeStatus;
      }
      return null;
    } catch (error) {
      console.error('查询支付宝交易状态失败:', error);
      return null;
    }
  }

  /**
   * 处理支付成功（更新订单状态并添加积分）
   */
  private async processPaymentSuccess(
    orderId: string,
    userId: string,
    credits: number,
    amount: any,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // 更新订单状态
      await tx.paymentOrder.update({
        where: { id: orderId },
        data: {
          status: PaymentStatus.PAID,
          paidAt: new Date(),
        },
      });

      // 获取用户积分账户
      const account = await tx.creditAccount.findUnique({
        where: { userId },
      });

      if (!account) {
        throw new NotFoundException('用户积分账户不存在');
      }

      const newBalance = account.balance + credits;

      // 更新积分余额
      await tx.creditAccount.update({
        where: { id: account.id },
        data: {
          balance: newBalance,
          totalEarned: account.totalEarned + credits,
        },
      });

      // 创建交易记录
      await tx.creditTransaction.create({
        data: {
          accountId: account.id,
          type: TransactionType.EARN,
          amount: credits,
          balanceBefore: account.balance,
          balanceAfter: newBalance,
          description: `充值 ¥${amount} 获得积分`,
          metadata: { orderId, paymentMethod: PaymentMethod.ALIPAY },
        },
      });
    });
  }

  /**
   * 获取用户订单列表
   */
  async getUserOrders(userId: string, page = 1, pageSize = 10) {
    const [orders, total] = await Promise.all([
      this.prisma.paymentOrder.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.paymentOrder.count({ where: { userId } }),
    ]);

    return {
      orders: orders.map(order => ({
        orderId: order.id,
        orderNo: order.orderNo,
        amount: Number(order.amount),
        credits: order.credits,
        paymentMethod: order.paymentMethod,
        status: order.status,
        paidAt: order.paidAt,
        createdAt: order.createdAt,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * 确认支付完成（用户手动确认或管理员确认）
   */
  async confirmPayment(orderNo: string, userId: string): Promise<{ success: boolean; credits: number; newBalance: number }> {
    return await this.prisma.$transaction(async (tx) => {
      const order = await tx.paymentOrder.findFirst({
        where: { orderNo, userId, status: PaymentStatus.PENDING },
      });

      if (!order) {
        throw new NotFoundException('订单不存在或已处理');
      }

      // 检查订单是否过期
      if (new Date() > order.expiredAt) {
        await tx.paymentOrder.update({
          where: { id: order.id },
          data: { status: PaymentStatus.EXPIRED },
        });
        throw new BadRequestException('订单已过期');
      }

      // 更新订单状态
      await tx.paymentOrder.update({
        where: { id: order.id },
        data: {
          status: PaymentStatus.PAID,
          paidAt: new Date(),
        },
      });

      // 获取用户积分账户
      const account = await tx.creditAccount.findUnique({
        where: { userId },
      });

      if (!account) {
        throw new NotFoundException('用户积分账户不存在');
      }

      const newBalance = account.balance + order.credits;

      // 更新积分余额
      await tx.creditAccount.update({
        where: { id: account.id },
        data: {
          balance: newBalance,
          totalEarned: account.totalEarned + order.credits,
        },
      });

      // 创建交易记录
      await tx.creditTransaction.create({
        data: {
          accountId: account.id,
          type: TransactionType.EARN,
          amount: order.credits,
          balanceBefore: account.balance,
          balanceAfter: newBalance,
          description: `充值 ¥${order.amount} 获得积分`,
          metadata: { orderNo: order.orderNo, paymentMethod: order.paymentMethod },
        },
      });

      return {
        success: true,
        credits: order.credits,
        newBalance,
      };
    });
  }

  /**
   * 管理员确认支付
   */
  async adminConfirmPayment(orderNo: string): Promise<{ success: boolean; credits: number; userId: string }> {
    const order = await this.prisma.paymentOrder.findUnique({
      where: { orderNo },
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    const result = await this.confirmPayment(orderNo, order.userId);
    return {
      success: result.success,
      credits: result.credits,
      userId: order.userId,
    };
  }

  /**
   * 清理过期订单
   */
  async cleanupExpiredOrders(): Promise<number> {
    const result = await this.prisma.paymentOrder.updateMany({
      where: {
        status: PaymentStatus.PENDING,
        expiredAt: { lt: new Date() },
      },
      data: { status: PaymentStatus.EXPIRED },
    });

    return result.count;
  }

  /**
   * 处理支付宝异步回调通知
   */
  async handleAlipayNotify(notifyData: Record<string, string>): Promise<boolean> {
    console.log('收到支付宝回调:', JSON.stringify(notifyData, null, 2));

    if (!this.alipaySdk) {
      console.error('支付宝SDK未初始化');
      return false;
    }

    try {
      // 验证签名
      const isValid = this.alipaySdk.checkNotifySign(notifyData);
      if (!isValid) {
        console.error('支付宝回调签名验证失败');
        return false;
      }

      const { out_trade_no, trade_status } = notifyData;

      // 只处理支付成功的通知
      if (trade_status !== 'TRADE_SUCCESS' && trade_status !== 'TRADE_FINISHED') {
        console.log('交易状态非成功:', trade_status);
        return true;
      }

      // 查找订单
      const order = await this.prisma.paymentOrder.findUnique({
        where: { orderNo: out_trade_no },
      });

      if (!order) {
        console.error('订单不存在:', out_trade_no);
        return false;
      }

      // 如果订单已处理，直接返回成功
      if (order.status === PaymentStatus.PAID) {
        console.log('订单已处理:', out_trade_no);
        return true;
      }

      // 处理支付成功
      await this.processPaymentSuccess(
        order.id,
        order.userId,
        order.credits,
        order.amount,
      );

      console.log('支付宝回调处理成功:', out_trade_no);
      return true;
    } catch (error) {
      console.error('处理支付宝回调异常:', error);
      return false;
    }
  }

  /**
   * 检查用户是否首充（是否有已支付的订单）
   */
  async checkIsFirstRecharge(userId: string): Promise<boolean> {
    const paidOrder = await this.prisma.paymentOrder.findFirst({
      where: {
        userId,
        status: PaymentStatus.PAID,
      },
    });
    return !paidOrder; // 没有已支付订单 = 首充
  }
}
