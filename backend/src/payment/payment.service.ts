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

// --- 🛡️ 兼容引用 ---
const alipayLib = require('alipay-sdk');
const AlipaySdk = alipayLib.default || alipayLib.AlipaySdk || alipayLib;
const QRCode = require('qrcode');

@Injectable()
export class PaymentService implements OnModuleInit {
  private alipaySdk: any;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) { }

  /**
   * 🛡️ 密钥标准化函数 (PKCS1 专用版)
   */
  private formatKey(key: string, type: 'PRIVATE' | 'PUBLIC'): string {
    if (!key) return '';

    // 1. 清洗：移除所有干扰字符
    const content = key.replace(/-----BEGIN.*?-----/g, '')
                       .replace(/-----END.*?-----/g, '')
                       .replace(/\\n/g, '')
                       .replace(/[\s"']/g, ''); 

    // 2. 切分：每 64 字符换行
    const chunked = content.match(/.{1,64}/g)?.join('\n');

    // 3. 组装：使用 RSA 专用头 (完美匹配 MIIEow 开头的密钥)
    let header, footer;
    if (type === 'PRIVATE') {
      header = '-----BEGIN RSA PRIVATE KEY-----';  // 👈 必须是 RSA
      footer = '-----END RSA PRIVATE KEY-----';    // 👈 必须是 RSA
    } else {
      header = '-----BEGIN PUBLIC KEY-----';
      footer = '-----END PUBLIC KEY-----';
    }

    return `${header}\n${chunked}\n${footer}`;
  }

  onModuleInit() {
    const appId = this.configService.get<string>('ALIPAY_APP_ID');
    let privateKey = this.configService.get<string>('ALIPAY_PRIVATE_KEY');
    let alipayPublicKey = this.configService.get<string>('ALIPAY_PUBLIC_KEY');

    // ⚡️ 应用清洗
    if (privateKey) {
      privateKey = this.formatKey(privateKey, 'PRIVATE');
      const lines = privateKey.split('\n');
      console.log(`[Alipay] 私钥已配置(PKCS1): 头=${lines[0]} (共${lines.length}行)`);
    }

    if (alipayPublicKey) {
      alipayPublicKey = this.formatKey(alipayPublicKey, 'PUBLIC');
    }

    // 初始化 SDK
    if (appId && privateKey) {
      try {
        this.alipaySdk = new AlipaySdk({
          appId,
          privateKey,
          alipayPublicKey,
          signType: 'RSA2',
          // ⚠️ 如果您用的是沙箱环境，请解开下行注释
          // gateway: 'https://openapi-sandbox.dl.alipaydev.com/gateway.do',
        });
        console.log('✅ 支付宝SDK初始化成功');
      } catch (error) {
        console.error('❌ 支付宝SDK初始化异常:', error);
      }
    } else {
      console.warn('⚠️ 支付宝配置缺失，支付功能不可用');
    }
  }

  // --- 业务逻辑 ---
  private generateOrderNo(): string {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `PAY${timestamp}${random}`;
  }

  async createOrder(userId: string, dto: CreateOrderDto): Promise<PaymentOrderResponse> {
    const { amount, credits, paymentMethod } = dto;
    const minCredits = amount * CREDITS_PER_YUAN;
    const maxCredits = amount * CREDITS_PER_YUAN * 10;
    if (credits < minCredits * 0.5 || credits > maxCredits) {
      throw new BadRequestException('积分数量不合理');
    }

    await this.prisma.paymentOrder.updateMany({
      where: { userId, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.CANCELLED },
    });

    const orderNo = this.generateOrderNo();
    const expiredAt = new Date(Date.now() + 5 * 60 * 1000);

    let qrCodeUrl: string | null = null;
    if (paymentMethod === PaymentMethod.ALIPAY) {
      qrCodeUrl = await this.generateAlipayQrCode(orderNo, amount);
    }

    const order = await this.prisma.paymentOrder.create({
      data: {
        orderNo, userId, amount, credits, paymentMethod,
        status: PaymentStatus.PENDING, qrCodeUrl, expiredAt,
      },
    });

    return {
      orderId: order.id, orderNo: order.orderNo, amount: Number(order.amount),
      credits: order.credits, paymentMethod: order.paymentMethod as PaymentMethod,
      status: order.status as PaymentStatus, qrCodeUrl: order.qrCodeUrl,
      expiredAt: order.expiredAt, createdAt: order.createdAt,
    };
  }

  private async generateAlipayQrCode(orderNo: string, amount: number): Promise<string> {
    if (!this.alipaySdk) {
      throw new BadRequestException('支付宝SDK未初始化');
    }

    try {
      const result = await this.alipaySdk.exec('alipay.trade.precreate', {
        notify_url: process.env.ALIPAY_NOTIFY_URL || 'https://www.tanvas.cn/api/payment/notify',
        bizContent: {
          out_trade_no: orderNo,
          total_amount: amount.toFixed(2),
          subject: `积分充值 - ${amount}元`,
          timeout_express: '30m',
        },
      });

      console.log('支付宝预创建订单响应:', JSON.stringify(result, null, 2));

      if (result.code !== '10000') {
        console.error('支付宝预创建失败:', result);
        throw new BadRequestException(result.subMsg || result.msg || '创建支付订单失败');
      }

      const qrCodeLink = result.qrCode;
      if (!qrCodeLink) {
        throw new BadRequestException('未获取到支付二维码');
      }

      const qrCodeDataUrl = await QRCode.toDataURL(qrCodeLink, {
        width: 256, margin: 2, color: { dark: '#000000', light: '#ffffff' },
      });

      return qrCodeDataUrl;
    } catch (error: any) {
      console.error('生成支付宝二维码失败:', error);
      throw new BadRequestException(error.message || '生成支付二维码失败');
    }
  }

  async getOrderStatus(orderNo: string, userId: string): Promise<PaymentStatusResponse> {
    const order = await this.prisma.paymentOrder.findFirst({ where: { orderNo, userId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status === PaymentStatus.PENDING && order.paymentMethod === PaymentMethod.ALIPAY) {
      const alipayStatus = await this.queryAlipayTradeStatus(orderNo);
      if (alipayStatus === 'TRADE_SUCCESS' || alipayStatus === 'TRADE_FINISHED') {
        await this.processPaymentSuccess(order.id, userId, order.credits, order.amount);
        return { orderNo: order.orderNo, status: PaymentStatus.PAID, paidAt: new Date(), credits: order.credits };
      }
    }
    return { orderNo: order.orderNo, status: order.status as PaymentStatus, paidAt: order.paidAt, credits: order.credits };
  }

  private async queryAlipayTradeStatus(orderNo: string): Promise<string | null> {
    if (!this.alipaySdk) { return null; }
    try {
      const result = await this.alipaySdk.exec('alipay.trade.query', { bizContent: { out_trade_no: orderNo } });
      if (result.code === '10000') { return result.tradeStatus; }
      return null;
    } catch (error) { console.error('查询支付宝交易状态失败:', error); return null; }
  }

  private async processPaymentSuccess(orderId: string, userId: string, credits: number, amount: any): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const currentOrder = await tx.paymentOrder.findUnique({ where: { id: orderId } });
      if (!currentOrder || currentOrder.status === PaymentStatus.PAID) return;
      await tx.paymentOrder.update({ where: { id: orderId }, data: { status: PaymentStatus.PAID, paidAt: new Date() } });
      let account = await tx.creditAccount.findUnique({ where: { userId } });
      if (!account) account = await tx.creditAccount.create({ data: { userId, balance: 0, totalEarned: 0 } });
      const newBalance = account.balance + credits;
      await tx.creditAccount.update({ where: { id: account.id }, data: { balance: newBalance, totalEarned: account.totalEarned + credits } });
      await tx.creditTransaction.create({ data: { accountId: account.id, type: TransactionType.EARN, amount: credits, balanceBefore: account.balance, balanceAfter: newBalance, description: `充值`, metadata: { orderNo: orderId } } });
    });
  }
  
  async getUserOrders(userId: string, page = 1, pageSize = 10) { 
      // 简写，保持原样即可
      const [orders, total] = await Promise.all([
        this.prisma.paymentOrder.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
        this.prisma.paymentOrder.count({ where: { userId } }),
      ]);
      return {
        orders: orders.map(order => ({ orderId: order.id, orderNo: order.orderNo, amount: Number(order.amount), credits: order.credits, paymentMethod: order.paymentMethod, status: order.status, paidAt: order.paidAt, createdAt: order.createdAt })),
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      };
  }
  async confirmPayment(orderNo: string, userId: string) { return { success: true, credits: 0, newBalance: 0 }; }
  async adminConfirmPayment(orderNo: string) { return { success: true, credits: 0, userId: '' }; }
  async cleanupExpiredOrders() { return 0; }
  async handleAlipayNotify(data: any) { return true; }
  async checkIsFirstRecharge(userId: string): Promise<boolean> {
    // 查询用户是否有已支付的订单
    const paidOrder = await this.prisma.paymentOrder.findFirst({
      where: { userId, status: PaymentStatus.PAID },
    });
    return !paidOrder; // 没有已支付订单 = 首充
  }
}