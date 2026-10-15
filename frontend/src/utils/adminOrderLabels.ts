export const ADMIN_ORDER_TYPE_LABELS: Record<string, string> = {
  recharge: "积分充值",
  membership: "会员订阅",
  team_seat: "团队座位",
  team_credits: "团队积分充值",
};

export const ADMIN_PAYMENT_METHOD_LABELS: Record<string, string> = {
  alipay: "支付宝",
  wechat: "微信",
  local: "本地支付",
};

export const ADMIN_BILLING_CYCLE_LABELS: Record<string, string> = {
  monthly: " · 月卡",
  yearly: " · 年卡",
};

export const getAdminOrderTypeLabel = (orderType: string) =>
  ADMIN_ORDER_TYPE_LABELS[orderType] || orderType || "未知类型";

export const getAdminPaymentMethodLabel = (paymentMethod: string) =>
  ADMIN_PAYMENT_METHOD_LABELS[paymentMethod] || paymentMethod || "未知方式";
