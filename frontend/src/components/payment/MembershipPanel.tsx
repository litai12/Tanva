import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle, Clock, Crown, FileText, Loader2, RefreshCw, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  createMembershipOrder,
  getMembershipCurrent,
  getMembershipOrders,
  getPaymentMembershipPlans,
  getPaymentStatus,
  type MembershipCurrentResponse,
  type MembershipOrderRecord,
  type PaymentMembershipPlan,
  type PaymentMethod,
} from "@/services/adminApi";

const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
  window.dispatchEvent(new CustomEvent("toast", { detail: { message, type } }));
};

interface MembershipPanelProps {
  onBack: () => void;
  onPaymentSuccess?: () => void;
}

const MembershipPanel: React.FC<MembershipPanelProps> = ({ onBack, onPaymentSuccess }) => {
  const [plans, setPlans] = useState<PaymentMembershipPlan[]>([]);
  const [current, setCurrent] = useState<MembershipCurrentResponse | null>(null);
  const [selectedPlanCode, setSelectedPlanCode] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("alipay");
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [currentOrderNo, setCurrentOrderNo] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(300);
  const [isExpired, setIsExpired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showOrders, setShowOrders] = useState(false);
  const [orders, setOrders] = useState<MembershipOrderRecord[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.code === selectedPlanCode) ?? null,
    [plans, selectedPlanCode],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [plansResult, currentResult] = await Promise.all([
        getPaymentMembershipPlans(),
        getMembershipCurrent(),
      ]);
      setPlans(plansResult.plans || []);
      setCurrent(currentResult);
      if (!selectedPlanCode && plansResult.plans?.length) {
        setSelectedPlanCode(plansResult.plans[0].code);
      }
    } catch (error) {
      console.error("加载会员数据失败:", error);
      showToast("加载会员数据失败", "error");
    } finally {
      setLoading(false);
    }
  }, [selectedPlanCode]);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const result = await getMembershipOrders({ page: 1, pageSize: 100 });
      setOrders(result.items || []);
    } catch (error) {
      console.error("加载会员订单失败:", error);
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setIsExpired(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [loadData]);

  const handlePaymentCompleted = useCallback(async () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    showToast("VIP 订阅成功", "success");
    await loadData();
    onPaymentSuccess?.();
    onBack();
  }, [loadData, onBack, onPaymentSuccess]);

  const pollPaymentStatus = useCallback(async () => {
    if (!currentOrderNo) return;
    try {
      const status = await getPaymentStatus(currentOrderNo);
      if (status.status === "paid") {
        await handlePaymentCompleted();
      }
    } catch (error) {
      console.error("查询会员支付状态失败:", error);
    }
  }, [currentOrderNo, handlePaymentCompleted]);

  useEffect(() => {
    if (!currentOrderNo) return;
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(() => {
      void pollPaymentStatus();
    }, 3000);
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [currentOrderNo, pollPaymentStatus]);

  const createOrderForPlan = useCallback(
    async (planCode: string, method: PaymentMethod) => {
      setSubmitting(true);
      setQrCodeUrl(null);
      setCurrentOrderNo(null);
      setIsExpired(false);
      setCountdown(300);
      try {
        const order = await createMembershipOrder({
          planCode,
          paymentMethod: method,
        });
        setQrCodeUrl(order.qrCodeUrl);
        setCurrentOrderNo(order.orderNo);
      } catch (error: any) {
        showToast(error.message || "创建会员订单失败", "error");
      } finally {
        setSubmitting(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!selectedPlanCode) return;
    void createOrderForPlan(selectedPlanCode, paymentMethod);
  }, [selectedPlanCode, paymentMethod, createOrderForPlan]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "paid":
        return <CheckCircle className='h-4 w-4 text-green-500' />;
      case "pending":
        return <Clock className='h-4 w-4 text-yellow-500' />;
      default:
        return <XCircle className='h-4 w-4 text-red-500' />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "paid":
        return "已支付";
      case "pending":
        return "待支付";
      case "expired":
        return "已过期";
      case "failed":
        return "失败";
      case "cancelled":
        return "已取消";
      default:
        return status;
    }
  };

  if (loading) {
    return (
      <div className='flex items-center justify-center py-16'>
        <Loader2 className='h-6 w-6 animate-spin text-slate-400' />
      </div>
    );
  }

  return (
    <div className='pb-6'>
      <div className='flex items-center justify-between border-b border-slate-100 pb-6 pt-4'>
        <div className='flex items-center gap-3'>
          <button onClick={showOrders ? () => setShowOrders(false) : onBack} className='rounded-lg p-1.5 transition-colors hover:bg-slate-100'>
            <ArrowLeft className='h-5 w-5 text-slate-500' />
          </button>
          <h3 className='text-lg font-medium text-slate-800'>
            {showOrders ? "会员订单" : "VIP 订阅"}
          </h3>
        </div>
        {!showOrders && (
          <div className='flex items-center gap-2'>
            <button
              onClick={() => void loadData()}
              className='rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800'
            >
              <RefreshCw className='h-4 w-4' />
            </button>
            <button
              onClick={() => {
                setShowOrders(true);
                void loadOrders();
              }}
              className='flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800'
            >
              <FileText className='h-4 w-4' />
              订单记录
            </button>
          </div>
        )}
      </div>

      {showOrders ? (
        <div className='mt-6'>
          {ordersLoading ? (
            <div className='flex items-center justify-center py-12'>
              <Loader2 className='h-6 w-6 animate-spin text-slate-400' />
            </div>
          ) : orders.length === 0 ? (
            <div className='py-12 text-center text-slate-400'>暂无会员订单</div>
          ) : (
            <div className='space-y-3'>
              {orders.map((order) => (
                <div key={order.orderId} className='flex items-center justify-between rounded-xl bg-slate-50 p-4'>
                  <div>
                    <div className='font-medium text-slate-800'>{order.planCode}</div>
                    <div className='mt-1 text-xs text-slate-400'>{new Date(order.createdAt).toLocaleString()}</div>
                  </div>
                  <div className='flex items-center gap-3'>
                    <div className='text-right'>
                      <div className='font-medium text-slate-800'>¥{order.amount}</div>
                      <div className='text-xs text-slate-400'>{order.paymentMethod}</div>
                    </div>
                    <div className='flex items-center gap-2 text-sm text-slate-600'>
                      {getStatusIcon(order.status)}
                      {getStatusText(order.status)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className='mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]'>
          <div className='space-y-4'>
            <div className='rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-5'>
              <div className='flex items-start justify-between gap-4'>
                <div>
                  <div className='mb-1 flex items-center gap-2 text-sm font-medium text-amber-700'>
                    <Crown className='h-4 w-4' />
                    当前会员
                  </div>
                  <div className='text-2xl font-semibold text-slate-900'>
                    {current?.plan?.name || "免费版"}
                  </div>
                  <div className='mt-2 text-sm text-slate-600'>
                    状态：{current?.entitlement?.membershipStatus === "active" ? "生效中" : "未开通"}
                  </div>
                  {current?.entitlement?.currentPeriodEndAt && (
                    <div className='mt-1 text-sm text-slate-500'>
                      到期时间：{new Date(current.entitlement.currentPeriodEndAt).toLocaleString()}
                    </div>
                  )}
                </div>
                <div className='rounded-xl bg-white/80 px-4 py-3 text-right shadow-sm'>
                  <div className='text-xs text-slate-500'>月额度</div>
                  <div className='text-xl font-semibold text-slate-900'>
                    {current?.plan?.monthlyQuotaCredits ?? 0}
                  </div>
                </div>
              </div>
            </div>

            <div className='grid gap-3'>
              {plans.map((plan) => {
                const active = plan.code === selectedPlanCode;
                return (
                  <button
                    key={plan.code}
                    type='button'
                    onClick={() => setSelectedPlanCode(plan.code)}
                    className={cn(
                      "rounded-2xl border p-4 text-left transition-all",
                      active
                        ? "border-slate-900 bg-slate-900 text-white shadow-lg"
                        : "border-slate-200 bg-white hover:border-slate-300",
                    )}
                  >
                    <div className='flex items-start justify-between gap-4'>
                      <div>
                        <div className='text-lg font-semibold'>{plan.name}</div>
                        <div className={cn("mt-1 text-sm", active ? "text-slate-300" : "text-slate-500")}>
                          {plan.billingCycle === "yearly" ? "年费套餐" : "月费套餐"}
                        </div>
                      </div>
                      <div className='text-right'>
                        <div className='text-2xl font-bold'>¥{plan.price}</div>
                        <div className={cn("text-xs", active ? "text-slate-300" : "text-slate-500")}>
                          {plan.code}
                        </div>
                      </div>
                    </div>
                    <div className={cn("mt-4 grid grid-cols-3 gap-2 text-sm", active ? "text-slate-100" : "text-slate-700")}>
                      <div className='rounded-xl bg-black/5 p-3'>
                        <div className='text-xs opacity-70'>月额度</div>
                        <div className='mt-1 font-semibold'>{plan.monthlyQuotaCredits}</div>
                      </div>
                      <div className='rounded-xl bg-black/5 p-3'>
                        <div className='text-xs opacity-70'>开通赠送</div>
                        <div className='mt-1 font-semibold'>{plan.signupBonusCredits}</div>
                      </div>
                      <div className='rounded-xl bg-black/5 p-3'>
                        <div className='text-xs opacity-70'>每日赠送</div>
                        <div className='mt-1 font-semibold'>{plan.dailyGiftCredits}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'>
            <div className='mb-4'>
              <div className='text-sm text-slate-500'>当前选择</div>
              <div className='mt-1 text-xl font-semibold text-slate-900'>{selectedPlan?.name || "请选择套餐"}</div>
              <div className='mt-2 text-sm text-slate-500'>
                切换支付方式会自动刷新付款码。支付成功后自动更新会员状态。
              </div>
            </div>

            <div className='mb-4 grid grid-cols-2 gap-2'>
              {[
                { value: "alipay" as const, label: "支付宝" },
                { value: "wechat" as const, label: "微信支付" },
              ].map((item) => (
                <button
                  key={item.value}
                  type='button'
                  onClick={() => setPaymentMethod(item.value)}
                  className={cn(
                    "rounded-xl border px-4 py-3 text-sm font-medium transition-colors",
                    paymentMethod === item.value
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-600 hover:border-slate-300",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className='rounded-2xl bg-slate-50 p-4'>
              <div className='flex items-center justify-between text-sm text-slate-600'>
                <span>应付金额</span>
                <span className='text-lg font-semibold text-slate-900'>¥{selectedPlan?.price ?? 0}</span>
              </div>
              {selectedPlan && (
                <div className='mt-2 text-xs text-slate-500'>
                  {selectedPlan.monthlyQuotaCredits} 月额度 + {selectedPlan.signupBonusCredits} 开通赠送 + 每日 {selectedPlan.dailyGiftCredits}
                </div>
              )}
            </div>

            <div className='mt-4 rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-center'>
              {submitting ? (
                <div className='flex items-center justify-center py-12'>
                  <Loader2 className='h-6 w-6 animate-spin text-slate-400' />
                </div>
              ) : qrCodeUrl ? (
                <>
                  <img src={qrCodeUrl} alt='会员支付二维码' className='mx-auto h-56 w-56 rounded-xl border border-slate-200 object-contain' />
                  <div className='mt-4 text-sm text-slate-600'>
                    {isExpired ? "付款码已过期，请重新选择套餐或支付方式" : `请使用${paymentMethod === "alipay" ? "支付宝" : "微信"}扫码支付`}
                  </div>
                  {!isExpired && (
                    <div className='mt-2 text-xs text-slate-400'>剩余 {countdown}s 自动失效</div>
                  )}
                </>
              ) : (
                <div className='py-12 text-sm text-slate-400'>选择套餐后自动生成付款码</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MembershipPanel;
