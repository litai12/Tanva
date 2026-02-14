
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
// --- 微信支付 SDK ---
const WeChatPay = require('wechatpay-node-v3');

@Injectable()
export class PaymentService implements OnModuleInit {
  private alipaySdk: any;
  private wechatPay: any;

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

    // 3. 组装：优先使用 RSA 专用头，也支持 PKCS8 格式
    let header, footer;
    if (type === 'PRIVATE') {
      // 支持 PKCS1 (RSA PRIVATE KEY) 和 PKCS8 (PRIVATE KEY)
      if (key.includes('-----BEGIN PRIVATE KEY-----')) {
        header = '-----BEGIN PRIVATE KEY-----';
        footer = '-----END PRIVATE KEY-----';
      } else {
        header = '-----BEGIN RSA PRIVATE KEY-----';
        footer = '-----END RSA PRIVATE KEY-----';
      }
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

    // --- 微信支付初始化 ---
    const wechatMchId = this.configService.get<string>('WECHAT_MCH_ID');
    const wechatPrivateKey = this.configService.get<string>('WECHAT_PRIVATE_KEY');
    const wechatAppId = this.configService.get<string>('WECHAT_APP_ID');
    const wechatCertificate = this.configService.get<string>('WECHAT_CERTIFICATE');
    const wechatSerialNo = this.configService.get<string>('WECHAT_SERIAL_NO');

    if (wechatMchId && wechatPrivateKey && wechatAppId) {
      try {
        // 格式化商户私钥
        let formattedPrivateKey = wechatPrivateKey;
        if (wechatPrivateKey && !wechatPrivateKey.includes('-----BEGIN')) {
          formattedPrivateKey = this.formatKey(wechatPrivateKey, 'PRIVATE');
        }

        console.log('🔧 微信支付初始化参数:', {
          appid: wechatAppId,
          mchid: wechatMchId,
          privateKeyStart: formattedPrivateKey?.substring(0, 50),
          hasCertificate: !!wechatCertificate,
          hasSerialNo: !!wechatSerialNo,
        });

        // 优先使用证书序列号方式初始化（推荐）
        if (wechatSerialNo && wechatCertificate) {
          this.wechatPay = new WeChatPay({
            appid: wechatAppId,
            mchid: wechatMchId,
            privateKey: formattedPrivateKey,
            publicKey: wechatCertificate,
            serial_no: wechatSerialNo,
          });
        } else if (wechatCertificate) {
          // 如果只有证书，让SDK自动提取序列号
          this.wechatPay = new WeChatPay({
            appid: wechatAppId,
            mchid: wechatMchId,
            privateKey: formattedPrivateKey,
            publicKey: wechatCertificate,
          });
        } else {
          throw new Error('缺少商户证书（WECHAT_CERTIFICATE）');
        }

        console.log('✅ 微信支付SDK初始化成功');
      } catch (error: any) {
        console.error('❌ 微信支付SDK初始化异常:', error);
        console.error('❌ 错误详情:', error?.message || error?.stack || error);
      }
    } else {
      console.warn('⚠️ 微信支付配置缺失，支付功能不可用');
      console.warn('  - WECHAT_MCH_ID:', wechatMchId ? '✅' : '❌ 缺失');
      console.warn('  - WECHAT_APP_ID:', wechatAppId ? '✅' : '❌ 缺失');
      console.warn('  - WECHAT_PRIVATE_KEY:', wechatPrivateKey ? '✅' : '❌ 缺失');
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
    } else if (paymentMethod === PaymentMethod.WECHAT) {
      qrCodeUrl = await this.generateWechatQrCode(orderNo, amount);
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

  /**
   * 生成微信支付二维码
   * 使用 Native 支付模式：统一下单获取 code_url，然后生成二维码
   */
  private async generateWechatQrCode(orderNo: string, amount: number): Promise<string> {
    if (!this.wechatPay) {
      throw new BadRequestException('微信支付SDK未初始化');
    }

    try {
      const params = {
        appid: this.configService.get<string>('WECHAT_APP_ID'),
        mchid: this.configService.get<string>('WECHAT_MCH_ID'),
        description: `积分充值 - ${amount}元`,
        out_trade_no: orderNo,
        notify_url: process.env.WECHAT_NOTIFY_URL || 'https://www.tanvas.cn/api/payment/wechat-notify',
        amount: {
          total: Math.round(amount * 100), // 金额单位：分
          currency: 'CNY',
        },
      };

      console.log('微信支付统一下单请求:', JSON.stringify(params, null, 2));

      const result = await this.wechatPay.transactions_native(params);

      console.log('微信支付统一下单响应:', JSON.stringify(result, null, 2));

      if (result.code_url) {
        // 生成二维码
        const qrCodeDataUrl = await QRCode.toDataURL(result.code_url, {
          width: 256,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
        });
        return qrCodeDataUrl;
      } else {
        throw new BadRequestException('未获取到微信支付二维码链接');
      }
    } catch (error: any) {
      console.error('生成微信支付二维码失败:', error);
      throw new BadRequestException(error.message || '生成微信支付二维码失败');
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
    // 微信支付状态查询
    if (order.status === PaymentStatus.PENDING && order.paymentMethod === PaymentMethod.WECHAT) {
      const wechatStatus = await this.queryWechatTradeStatus(orderNo);
      if (wechatStatus === 'SUCCESS') {
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

  /**
   * 查询微信支付交易状态
   */
  private async queryWechatTradeStatus(orderNo: string): Promise<string | null> {
    if (!this.wechatPay) { return null; }
    try {
      const appid = this.configService.get<string>('WECHAT_APP_ID');
      const mchid = this.configService.get<string>('WECHAT_MCH_ID');
      const result = await this.wechatPay.orderQuery({
        appid,
        mchid,
        out_trade_no: orderNo,
      });

      console.log('微信支付订单查询响应:', JSON.stringify(result, null, 2));

      if (result.trade_state) {
        return result.trade_state;
      }
      return null;
    } catch (error) {
      console.error('查询微信支付交易状态失败:', error);
      return null;
    }
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

  /**
   * 处理微信支付异步回调通知
   */
  async handleWechatNotify(data: any): Promise<boolean> {
    try {
      console.log('收到微信支付回调:', JSON.stringify(data, null, 2));

      // 微信支付 V3 回调验签和解密需要处理
      // 这里简化处理，实际需要验证签名和解密 ciphertext
      const { out_trade_no, transaction_id, trade_state } = data;

      if (trade_state === 'SUCCESS' && out_trade_no) {
        // 通过订单号查找订单
        const order = await this.prisma.paymentOrder.findFirst({
          where: { orderNo: out_trade_no },
        });

        if (order && order.status === PaymentStatus.PENDING) {
          await this.processPaymentSuccess(order.id, order.userId, order.credits, order.amount);
          console.log(`订单 ${out_trade_no} 已通过微信回调处理成功`);
          return true;
        }
      }

      return true; // 返回成功避免微信重复推送
    } catch (error) {
      console.error('处理微信支付回调失败:', error);
      return false;
    }
  }
  /**
   * 检查用户某个金额档位是否为首充
   * @param userId 用户ID
   * @param amount 套餐金额（可选，不传则返回所有档位的首充状态）
   */
  async checkIsFirstRechargeByAmount(userId: string, amount?: number): Promise<boolean> {
    const paidOrder = await this.prisma.paymentOrder.findFirst({
      where: {
        userId,
        status: PaymentStatus.PAID,
        ...(amount !== undefined && { amount }),
      },
    });
    return !paidOrder;
  }

  /**
   * 获取用户各套餐档位的首充状态
   * @param userId 用户ID
   * @param amounts 套餐金额列表
   */
  async getFirstRechargeStatusByAmounts(userId: string, amounts: number[]): Promise<Record<number, boolean>> {
    // 查询用户已支付的所有订单金额
    const paidOrders = await this.prisma.paymentOrder.findMany({
      where: { userId, status: PaymentStatus.PAID },
      select: { amount: true },
    });

    // 已购买过的金额集合
    const paidAmounts = new Set(paidOrders.map(o => Number(o.amount)));

    // 返回每个金额档位的首充状态
    const result: Record<number, boolean> = {};
    for (const amount of amounts) {
      result[amount] = !paidAmounts.has(amount);
    }
    return result;
  }
}