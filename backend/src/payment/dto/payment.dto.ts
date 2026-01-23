// 支付方式枚举
export enum PaymentMethod {
  ALIPAY = 'alipay',
  WECHAT = 'wechat',
}

// 订单状态枚举
export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

// 创建订单请求
export interface CreateOrderDto {
  amount: number;      // 支付金额（元）
  credits: number;     // 获得积分
  paymentMethod: PaymentMethod;
}

// 订单响应
export interface PaymentOrderResponse {
  orderId: string;
  orderNo: string;
  amount: number;
  credits: number;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  qrCodeUrl: string | null;
  expiredAt: Date;
  createdAt: Date;
}

// 支付状态查询响应
export interface PaymentStatusResponse {
  orderNo: string;
  status: PaymentStatus;
  paidAt: Date | null;
  credits: number;
}

// 充值套餐配置
export const RECHARGE_PACKAGES = [
  { price: 10, credits: 2000, bonus: null, tag: '首充翻倍' },
  { price: 30, credits: 6300, bonus: '送5%', tag: '首充翻倍' },
  { price: 50, credits: 10500, bonus: '送5%', tag: '首充翻倍' },
  { price: 100, credits: 22400, bonus: '送12%', tag: '首充翻倍' },
  { price: 200, credits: 48000, bonus: '送5%', tag: '首充翻倍' },
  { price: 500, credits: 130000, bonus: '送30%', tag: '首充翻倍' },
];

// 积分兑换比例：1元 = 100积分
export const CREDITS_PER_YUAN = 100;
