
import { Injectable, BadRequestException, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
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
import { ReferralService } from '../referral/referral.service';
import { buildRechargeCreditLotData } from '../credits/credit-lot-grants';

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
  private wechatApiV3Key: string | null = null;
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private referralService: ReferralService,
  ) { }

  private isAlipaySuccessStatus(status: string | null | undefined): boolean {
    return status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED';
  }

  private isWechatSuccessStatus(status: string | null | undefined): boolean {
    return status === 'SUCCESS';
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private isAmountMatched(expected: number, actual: number | null): boolean {
    if (actual === null) {
      return true;
    }
    return Math.abs(expected - actual) < 0.01;
  }

  private parseNotifyData(data: unknown): Record<string, string> {
    if (!data) return {};

    if (typeof data === 'string') {
      const raw = data.trim();
      if (!raw) return {};

      if (raw.startsWith('{') || raw.startsWith('[')) {
        try {
          const parsed = JSON.parse(raw);
          return this.parseNotifyData(parsed);
        } catch {
          // 继续按 form body 解析
        }
      }

      const payload = new URLSearchParams(raw);
      const result: Record<string, string> = {};
      payload.forEach((value, key) => {
        result[key] = value;
      });
      return result;
    }

    if (typeof data === 'object' && !Array.isArray(data)) {
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (value === undefined || value === null) continue;
        if (typeof value === 'string') {
          result[key] = value;
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          result[key] = String(value);
        } else {
          result[key] = JSON.stringify(value);
        }
      }
      return result;
    }

    return {};
  }

  private mergeOrderMetadata(
    currentMetadata: unknown,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    const base =
      currentMetadata && typeof currentMetadata === 'object' && !Array.isArray(currentMetadata)
        ? { ...(currentMetadata as Record<string, unknown>) }
        : {};
    return { ...base, ...patch };
  }

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
    const wechatApiV3Key = this.configService.get<string>('WECHAT_API_V3_KEY');
    this.wechatApiV3Key = wechatApiV3Key?.trim() || null;

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
            ...(this.wechatApiV3Key ? { key: this.wechatApiV3Key } : {}),
          });
        } else if (wechatCertificate) {
          // 如果只有证书，让SDK自动提取序列号
          this.wechatPay = new WeChatPay({
            appid: wechatAppId,
            mchid: wechatMchId,
            privateKey: formattedPrivateKey,
            publicKey: wechatCertificate,
            ...(this.wechatApiV3Key ? { key: this.wechatApiV3Key } : {}),
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
      // 确保金额为合法数字并保留2位小数传给支付宝
      const numericAmount = Number(amount);
      if (isNaN(numericAmount) || numericAmount <= 0) {
        throw new BadRequestException(`非法金额: ${amount}`);
      }
      const amountStr = numericAmount.toFixed(2);
      console.log(`[Alipay] 生成二维码请求 → out_trade_no=${orderNo}, total_amount=${amountStr}`);
      const result = await this.alipaySdk.exec('alipay.trade.precreate', {
        notify_url: process.env.ALIPAY_NOTIFY_URL || 'https://www.tanvas.cn/api/payment/notify',
        bizContent: {
          out_trade_no: orderNo,
          total_amount: amountStr,
          subject: `积分充值 - ${amountStr}元`,
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

      const codeUrl =
        result?.code_url ||
        result?.data?.code_url ||
        result?.result?.code_url ||
        result?.codeUrl ||
        null;

      if (codeUrl) {
        // 生成二维码
        const qrCodeDataUrl = await QRCode.toDataURL(codeUrl, {
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

    if (order.status !== PaymentStatus.PAID && order.paymentMethod === PaymentMethod.ALIPAY) {
      const alipayTrade = await this.queryAlipayTradeStatus(orderNo);
      const expectedAmount = Number(order.amount);
      if (
        this.isAlipaySuccessStatus(alipayTrade.status) &&
        this.isAmountMatched(expectedAmount, alipayTrade.totalAmount)
      ) {
        await this.processPaymentSuccess(order.id, userId, order.credits, {
          tradeNo: alipayTrade.tradeNo,
          paymentMethod: PaymentMethod.ALIPAY,
          source: 'alipay_status_query',
        });
      }
    }

    if (order.status !== PaymentStatus.PAID && order.paymentMethod === PaymentMethod.WECHAT) {
      const wechatTrade = await this.queryWechatTradeStatus(orderNo);
      const expectedAmount = Number(order.amount);
      if (
        this.isWechatSuccessStatus(wechatTrade.status) &&
        this.isAmountMatched(expectedAmount, wechatTrade.totalAmount)
      ) {
        await this.processPaymentSuccess(order.id, userId, order.credits, {
          tradeNo: wechatTrade.transactionId,
          paymentMethod: PaymentMethod.WECHAT,
          source: 'wechat_status_query',
          ...(wechatTrade.paidAt ? { paidAt: wechatTrade.paidAt } : {}),
        });
      }
    }

    const latestOrder = await this.prisma.paymentOrder.findUnique({ where: { id: order.id } });
    if (!latestOrder) throw new NotFoundException('订单不存在');

    return {
      orderNo: latestOrder.orderNo,
      status: latestOrder.status as PaymentStatus,
      paidAt: latestOrder.paidAt,
      credits: latestOrder.credits,
    };
  }

  private async queryAlipayTradeStatus(orderNo: string): Promise<{
    status: string | null;
    tradeNo: string | null;
    totalAmount: number | null;
    raw: Record<string, unknown> | null;
  }> {
    if (!this.alipaySdk) {
      return { status: null, tradeNo: null, totalAmount: null, raw: null };
    }
    try {
      const result = await this.alipaySdk.exec('alipay.trade.query', { bizContent: { out_trade_no: orderNo } });
      if (result.code === '10000') {
        return {
          status: (result.tradeStatus ?? result.trade_status ?? null) as string | null,
          tradeNo: (result.tradeNo ?? result.trade_no ?? null) as string | null,
          totalAmount: this.toNumber(result.totalAmount ?? result.total_amount),
          raw: result as Record<string, unknown>,
        };
      }
      this.logger.warn(`查询支付宝交易状态失败: orderNo=${orderNo}, code=${String(result.code)}, subCode=${String(result.subCode ?? result.sub_code ?? '')}`);
      return { status: null, tradeNo: null, totalAmount: null, raw: result as Record<string, unknown> };
    } catch (error) {
      this.logger.error(
        `查询支付宝交易状态异常: orderNo=${orderNo}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { status: null, tradeNo: null, totalAmount: null, raw: null };
    }
  }

  /**
   * 查询微信支付交易状态
   */
  private async queryWechatTradeStatus(orderNo: string): Promise<{
    status: string | null;
    transactionId: string | null;
    totalAmount: number | null;
    paidAt: Date | null;
    raw: Record<string, unknown> | null;
  }> {
    if (!this.wechatPay) {
      return { status: null, transactionId: null, totalAmount: null, paidAt: null, raw: null };
    }

    try {
      let result: any = null;

      if (typeof this.wechatPay.query === 'function') {
        result = await this.wechatPay.query({ out_trade_no: orderNo });
      } else if (typeof this.wechatPay.orderQuery === 'function') {
        const appid = this.configService.get<string>('WECHAT_APP_ID');
        const mchid = this.configService.get<string>('WECHAT_MCH_ID');
        result = await this.wechatPay.orderQuery({ appid, mchid, out_trade_no: orderNo });
      } else {
        throw new Error('wechatpay-node-v3 SDK missing query method');
      }

      // SDK 标准返回: { status, data, errRaw, error }
      const payload = result?.data && typeof result.data === 'object' ? result.data : result;
      const totalInCents = this.toNumber(payload?.amount?.total);
      const tradeState =
        typeof payload?.trade_state === 'string'
          ? payload.trade_state
          : typeof payload?.tradeStatus === 'string'
            ? payload.tradeStatus
            : null;

      this.logger.log(
        `[wechat_query] orderNo=${orderNo}, httpStatus=${String(result?.status ?? '-')}, tradeState=${String(tradeState ?? '-')}, transactionId=${String(payload?.transaction_id ?? payload?.transactionId ?? '-')}`,
      );

      return {
        status: tradeState,
        transactionId:
          typeof payload?.transaction_id === 'string'
            ? payload.transaction_id
            : typeof payload?.transactionId === 'string'
              ? payload.transactionId
              : null,
        totalAmount: totalInCents === null ? null : totalInCents / 100,
        paidAt:
          typeof payload?.success_time === 'string' && payload.success_time
            ? new Date(payload.success_time)
            : null,
        raw: result as Record<string, unknown>,
      };
    } catch (error) {
      this.logger.error(
        `查询微信支付交易状态失败: orderNo=${orderNo}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { status: null, transactionId: null, totalAmount: null, paidAt: null, raw: null };
    }
  }
  private async processPaymentSuccess(
    orderId: string,
    userId: string,
    credits: number,
    options?: {
      tradeNo?: string | null;
      source?: string;
      paymentMethod?: PaymentMethod;
      paidAt?: Date;
    },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const currentOrder = await tx.paymentOrder.findUnique({ where: { id: orderId } });
      if (!currentOrder) return;

      if (currentOrder.status === PaymentStatus.PAID) {
        if (options?.tradeNo && !currentOrder.tradeNo) {
          await tx.paymentOrder.update({
            where: { id: orderId },
            data: {
              tradeNo: options.tradeNo,
              metadata: this.mergeOrderMetadata(currentOrder.metadata, {
                lastPaymentSyncAt: new Date().toISOString(),
                lastPaymentSource: options.source ?? 'unknown',
              }) as any,
            },
          });
        }
        return;
      }

      const paidOrderCount = await tx.paymentOrder.count({
        where: { userId, status: PaymentStatus.PAID },
      });
      const isFirstRecharge = paidOrderCount === 0;
      await tx.paymentOrder.update({
        where: { id: orderId },
        data: {
          status: PaymentStatus.PAID,
          paidAt: options?.paidAt ?? new Date(),
          ...(options?.tradeNo ? { tradeNo: options.tradeNo } : {}),
          metadata: this.mergeOrderMetadata(currentOrder.metadata, {
            lastPaymentSyncAt: new Date().toISOString(),
            lastPaymentSource: options?.source ?? 'unknown',
            paymentMethod: options?.paymentMethod ?? currentOrder.paymentMethod,
          }) as any,
        },
      });
      let account = await tx.creditAccount.findUnique({ where: { userId } });
      if (!account) account = await tx.creditAccount.create({ data: { userId, balance: 0, totalEarned: 0 } });
      const newBalance = account.balance + credits;
      await tx.creditAccount.update({ where: { id: account.id }, data: { balance: newBalance, totalEarned: account.totalEarned + credits } });
      const creditLot = await tx.creditLot.create({
        data: buildRechargeCreditLotData({
          accountId: account.id,
          amount: credits,
          grantedAt: options?.paidAt ?? new Date(),
          orderId: currentOrder.id,
          metadata: {
            orderNo: currentOrder.orderNo,
            ...(options?.tradeNo ? { tradeNo: options.tradeNo } : {}),
            source: options?.source ?? 'unknown',
            paymentMethod: options?.paymentMethod ?? currentOrder.paymentMethod,
          },
        }),
      });
      await tx.creditTransaction.create({
        data: {
          accountId: account.id,
          type: TransactionType.EARN,
          amount: credits,
          balanceBefore: account.balance,
          balanceAfter: newBalance,
          description: `充值`,
          creditLotId: creditLot.id,
          metadata: {
            orderId: currentOrder.id,
            orderNo: currentOrder.orderNo,
            ...(options?.tradeNo ? { tradeNo: options.tradeNo } : {}),
            source: options?.source ?? 'unknown',
          },
        },
      });
      if (isFirstRecharge) {
        await this.referralService.rewardInviterForInviteeFirstRechargeInTransaction(tx, userId);
      }
    });
  }
  
  private async syncPendingOrdersForUser(userId: string, limit = 10): Promise<void> {
    const safeLimit = Math.max(1, Math.min(limit, 20));
    const pendingOrders = await this.prisma.paymentOrder.findMany({
      where: {
        userId,
        status: PaymentStatus.PENDING,
        expiredAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
    });

    for (const order of pendingOrders) {
      try {
        const expectedAmount = Number(order.amount);

        if (order.paymentMethod === PaymentMethod.ALIPAY) {
          const alipayTrade = await this.queryAlipayTradeStatus(order.orderNo);
          if (
            this.isAlipaySuccessStatus(alipayTrade.status) &&
            this.isAmountMatched(expectedAmount, alipayTrade.totalAmount)
          ) {
            await this.processPaymentSuccess(order.id, userId, order.credits, {
              tradeNo: alipayTrade.tradeNo,
              paymentMethod: PaymentMethod.ALIPAY,
              source: 'alipay_orders_sync',
            });
          }
          continue;
        }

        if (order.paymentMethod === PaymentMethod.WECHAT) {
          const wechatTrade = await this.queryWechatTradeStatus(order.orderNo);
          if (
            this.isWechatSuccessStatus(wechatTrade.status) &&
            this.isAmountMatched(expectedAmount, wechatTrade.totalAmount)
          ) {
            await this.processPaymentSuccess(order.id, userId, order.credits, {
              tradeNo: wechatTrade.transactionId,
              paymentMethod: PaymentMethod.WECHAT,
              source: 'wechat_orders_sync',
              ...(wechatTrade.paidAt ? { paidAt: wechatTrade.paidAt } : {}),
            });
          }
        }
      } catch (error) {
        this.logger.warn(
          `同步待支付订单状态失败: orderNo=${order.orderNo}, error=${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async getUserOrders(userId: string, page = 1, pageSize = 10) {
      try {
        await this.syncPendingOrdersForUser(userId, 10);
      } catch (error) {
        this.logger.warn(
          `获取订单列表前同步支付状态失败: userId=${userId}, error=${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const [orders, total] = await Promise.all([
        this.prisma.paymentOrder.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
        this.prisma.paymentOrder.count({ where: { userId } }),
      ]);
      return {
        orders: orders.map(order => ({ orderId: order.id, orderNo: order.orderNo, amount: Number(order.amount), credits: order.credits, paymentMethod: order.paymentMethod, status: order.status, paidAt: order.paidAt, createdAt: order.createdAt })),
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      };
  }

  async confirmPayment(orderNo: string, userId: string) {
    const order = await this.prisma.paymentOrder.findFirst({
      where: { orderNo, userId },
    });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    if (order.status !== PaymentStatus.PAID && order.paymentMethod === PaymentMethod.ALIPAY) {
      const alipayTrade = await this.queryAlipayTradeStatus(orderNo);
      const expectedAmount = Number(order.amount);
      if (
        this.isAlipaySuccessStatus(alipayTrade.status) &&
        this.isAmountMatched(expectedAmount, alipayTrade.totalAmount)
      ) {
        await this.processPaymentSuccess(order.id, order.userId, order.credits, {
          tradeNo: alipayTrade.tradeNo,
          paymentMethod: PaymentMethod.ALIPAY,
          source: 'alipay_manual_confirm',
        });
      }
    }

    if (order.status !== PaymentStatus.PAID && order.paymentMethod === PaymentMethod.WECHAT) {
      const wechatTrade = await this.queryWechatTradeStatus(orderNo);
      const expectedAmount = Number(order.amount);
      if (
        this.isWechatSuccessStatus(wechatTrade.status) &&
        this.isAmountMatched(expectedAmount, wechatTrade.totalAmount)
      ) {
        await this.processPaymentSuccess(order.id, order.userId, order.credits, {
          tradeNo: wechatTrade.transactionId,
          paymentMethod: PaymentMethod.WECHAT,
          source: 'wechat_manual_confirm',
          ...(wechatTrade.paidAt ? { paidAt: wechatTrade.paidAt } : {}),
        });
      }
    }

    const [latestOrder, account] = await Promise.all([
      this.prisma.paymentOrder.findUnique({ where: { id: order.id } }),
      this.prisma.creditAccount.findUnique({ where: { userId } }),
    ]);
    if (!latestOrder) {
      throw new NotFoundException('订单不存在');
    }

    return {
      success: latestOrder.status === PaymentStatus.PAID,
      credits: latestOrder.status === PaymentStatus.PAID ? latestOrder.credits : 0,
      newBalance: account?.balance ?? 0,
    };
  }

  async adminConfirmPayment(orderNo: string) {
    const order = await this.prisma.paymentOrder.findFirst({ where: { orderNo } });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    await this.confirmPayment(orderNo, order.userId);
    const latestOrder = await this.prisma.paymentOrder.findUnique({ where: { id: order.id } });

    return {
      success: latestOrder?.status === PaymentStatus.PAID,
      credits: latestOrder?.status === PaymentStatus.PAID ? latestOrder.credits : 0,
      userId: order.userId,
    };
  }

  async cleanupExpiredOrders() {
    const result = await this.prisma.paymentOrder.updateMany({
      where: {
        status: PaymentStatus.PENDING,
        expiredAt: { lt: new Date() },
      },
      data: {
        status: PaymentStatus.EXPIRED,
      },
    });
    return result.count;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async cleanupExpiredOrdersJob() {
    try {
      const count = await this.cleanupExpiredOrders();
      if (count > 0) {
        this.logger.log(`已清理过期支付订单: ${count}`);
      }
    } catch (error) {
      this.logger.error(
        '清理过期支付订单失败',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async handleAlipayNotify(data: any) {
    try {
      const notifyData = this.parseNotifyData(data);
      const orderNo = notifyData.out_trade_no || notifyData.outTradeNo;
      const tradeStatus = notifyData.trade_status || notifyData.tradeStatus;
      const tradeNo = notifyData.trade_no || notifyData.tradeNo || null;

      if (!orderNo) {
        this.logger.warn('支付宝回调缺少 out_trade_no');
        return false;
      }

      if (tradeStatus && !this.isAlipaySuccessStatus(tradeStatus)) {
        this.logger.log(`支付宝回调非成功状态: orderNo=${orderNo}, tradeStatus=${tradeStatus}`);
        return true;
      }

      const order = await this.prisma.paymentOrder.findFirst({
        where: { orderNo },
      });

      if (!order) {
        this.logger.error(`支付宝回调订单不存在: orderNo=${orderNo}`);
        return false;
      }

      // 优先使用支付宝主动查询做二次确认，避免因回调体解析/验签差异导致漏单。
      const alipayTrade = await this.queryAlipayTradeStatus(orderNo);
      if (!this.isAlipaySuccessStatus(alipayTrade.status)) {
        this.logger.warn(`支付宝回调核对失败: orderNo=${orderNo}, queryStatus=${String(alipayTrade.status)}`);
        return false;
      }

      const expectedAmount = Number(order.amount);
      if (!this.isAmountMatched(expectedAmount, alipayTrade.totalAmount)) {
        this.logger.error(
          `支付宝回调金额不一致: orderNo=${orderNo}, expected=${expectedAmount}, actual=${String(alipayTrade.totalAmount)}`,
        );
        return false;
      }

      await this.processPaymentSuccess(order.id, order.userId, order.credits, {
        tradeNo: tradeNo || alipayTrade.tradeNo,
        source: 'alipay_notify',
        paymentMethod: PaymentMethod.ALIPAY,
      });
      this.logger.log(`支付宝回调处理成功: orderNo=${orderNo}, tradeNo=${tradeNo || alipayTrade.tradeNo || '-'}`);
      return true;
    } catch (error) {
      this.logger.error(
        '处理支付宝回调失败',
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  /**
   * 处理微信支付异步回调通知
   */
  async handleWechatNotify(
    data: any,
    headers?: Record<string, string | string[] | undefined>,
  ): Promise<boolean> {
    void headers;
    try {
      console.log('收到微信支付回调:', JSON.stringify(data, null, 2));

      const payload = data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, any>)
        : null;

      if (payload?.event_type && payload.event_type !== 'TRANSACTION.SUCCESS') {
        this.logger.log(`微信回调事件非支付成功，忽略: event_type=${String(payload.event_type)}`);
        return true;
      }

      let outTradeNo = '';
      let transactionId = '';
      let tradeState = '';
      const resource = payload?.resource;

      if (
        resource?.ciphertext &&
        resource?.nonce &&
        this.wechatApiV3Key &&
        this.wechatPay?.decipher_gcm
      ) {
        try {
          const decrypted = this.wechatPay.decipher_gcm(
            resource.ciphertext,
            resource.associated_data || '',
            resource.nonce,
            this.wechatApiV3Key,
          );
          const decryptedPayload =
            typeof decrypted === 'string'
              ? (JSON.parse(decrypted) as Record<string, any>)
              : (decrypted as Record<string, any>);

          outTradeNo = String(decryptedPayload?.out_trade_no || '').trim();
          transactionId = String(decryptedPayload?.transaction_id || '').trim();
          tradeState = String(decryptedPayload?.trade_state || '').trim();
        } catch (decryptError) {
          this.logger.warn(`微信回调 resource 解密失败，继续走兜底解析: ${decryptError instanceof Error ? decryptError.message : String(decryptError)}`);
        }
      }

      if (!outTradeNo) {
        const notifyData = this.parseNotifyData(data);
        outTradeNo = (notifyData.out_trade_no || notifyData.outTradeNo || '').trim();
        transactionId = (notifyData.transaction_id || notifyData.transactionId || '').trim();
        tradeState = (notifyData.trade_state || notifyData.tradeState || '').trim();
      }

      if (!outTradeNo) {
        this.logger.warn('微信回调缺少 out_trade_no');
        return false;
      }

      if (tradeState && !this.isWechatSuccessStatus(tradeState)) {
        this.logger.log(`微信回调非成功状态: orderNo=${outTradeNo}, tradeState=${tradeState}`);
        return true;
      }

      const order = await this.prisma.paymentOrder.findFirst({
        where: { orderNo: outTradeNo },
      });
      if (!order) {
        this.logger.error(`微信回调订单不存在: orderNo=${outTradeNo}`);
        return false;
      }

      const wechatTrade = await this.queryWechatTradeStatus(outTradeNo);
      if (!this.isWechatSuccessStatus(wechatTrade.status)) {
        this.logger.warn(`微信回调核对失败: orderNo=${outTradeNo}, queryStatus=${String(wechatTrade.status)}`);
        return false;
      }

      const expectedAmount = Number(order.amount);
      if (!this.isAmountMatched(expectedAmount, wechatTrade.totalAmount)) {
        this.logger.error(
          `微信回调金额不一致: orderNo=${outTradeNo}, expected=${expectedAmount}, actual=${String(wechatTrade.totalAmount)}`,
        );
        return false;
      }

      await this.processPaymentSuccess(order.id, order.userId, order.credits, {
        tradeNo: transactionId || wechatTrade.transactionId,
        paymentMethod: PaymentMethod.WECHAT,
        source: 'wechat_notify',
        ...(wechatTrade.paidAt ? { paidAt: wechatTrade.paidAt } : {}),
      });

      this.logger.log(`微信回调处理成功: orderNo=${outTradeNo}, tradeNo=${transactionId || wechatTrade.transactionId || '-'}`);
      return true;
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
