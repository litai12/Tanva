import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, CheckCircle, Clock, Crown, FileText, Loader2, RefreshCw, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import PaymentPanel, { type PaymentPanelHandle } from "@/components/payment/PaymentPanel";
import { useAIChatStore } from "@/stores/aiChatStore";
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

type BillingPeriod = "monthly" | "yearly";

type VipMainTab = "plans" | "credits";

function normPlanCode(code: string | undefined): string {
  return (code || "").trim().toLowerCase();
}

/** 与后端档位一致；识别不到时不要用假默认（曾误用 599 导致 ¥0.01 测试档标题错成 599VIP） */
function tierKeyFromPlan(plan: PaymentMembershipPlan): "69" | "199" | "599" | null {
  const code = normPlanCode(plan.code);
  if (code === "vip_599" || code === "vip-599") return "599";
  if (code === "vip_199" || code === "vip-199") return "199";
  if (code === "vip_69" || code === "vip-69") return "69";
  if (code === "vip_01" || code === "vip-01" || code === "vip01") return "69";

  const mq = plan.monthlyQuotaCredits;
  const su = plan.signupBonusCredits;
  const dg = plan.dailyGiftCredits;
  if (mq === 60000 && su === 9000 && dg === 200) return "599";
  if (mq === 20000 && su === 2000 && dg === 100) return "199";
  if (mq === 7000 && su === 350 && dg === 50) return "69";
  if (mq === 1000 && su === 500 && dg === 10) return "69";

  const s = `${plan.code} ${plan.name}`.toLowerCase();
  if (s.includes("599")) return "599";
  if (s.includes("199")) return "199";
  if (s.includes("69")) return "69";

  return null;
}

function sortPlansByTier(a: PaymentMembershipPlan, b: PaymentMembershipPlan): number {
  const order = (p: PaymentMembershipPlan) => {
    const k = tierKeyFromPlan(p);
    if (k === "69") return 1; // 日常创作，在推荐档 199 之前
    if (k === "199") return 2;
    if (k === "599") return 3;
    return 9;
  };
  return order(a) - order(b);
}

const FREE_FEATURES: string[] = [
  "基础月卡积分：500",
  "每日签到：50 积分",
  "签到/活动赠送积分进入「赠送可消退积分」池",
  "赠送积分默认每日衰减 50",
  "每天最多生成 20 张图片",
  "每天最多生成 3 个视频",
  "邀请上限 5",
  "模板库：基础可用",
  "支持：有限技术支持",
];

function vipFeatureLines(plan: PaymentMembershipPlan): { main: string[]; accent: string[] } {
  const key = tierKeyFromPlan(plan);
  const bonusPct = key === "69" ? "5%" : key === "199" ? "10%" : key === "599" ? "15%" : "—";
  const total = plan.monthlyQuotaCredits + plan.signupBonusCredits;
  const dailyNote =
    key === "69"
      ? "约 1500 / 30 天"
      : key === "199"
        ? "约 3000 / 30 天"
        : key === "599"
          ? "约 6000 / 30 天"
          : "按自然月折算参考值";

  const main = [
    `月卡积分（固定刷新）${plan.monthlyQuotaCredits} + 档位赠送 ${plan.signupBonusCredits}，合计到账 ${total}（赠送比例 ${bonusPct}）`,
    `每日赠送积分 ${plan.dailyGiftCredits} / 日（${dailyNote}），计入「赠送可消退积分」，不归入月卡积分`,
    "折扣权益：最大折扣按 8 折计算",
    "年费在对应连续包月价格基础上统一按 8 折",
  ];

  const accent =
    key === "69"
      ? [
          "去水印、Seedance 2 权益、积分不衰减",
          "每日签到 50 积分（连续签到 7 天 3 倍当日）",
          "模板库：全部开放",
          "邀请上限 20",
          "支持：官方支持",
        ]
      : key === "199"
        ? [
            "去水印、Seedance 2 权益、积分不衰减",
            "每日签到 100 积分（连续签到 7 天 3 倍当日）",
            "模板库：全部开放",
            "邀请上限 40",
            "支持：官方 24 小时支持",
          ]
        : key === "599"
          ? [
              "去水印、Seedance 2 权益、积分不衰减",
              "每日签到 150 积分（连续签到 7 天 3 倍当日）",
              "模板库：全部开放",
              "邀请上限 100",
              "支持：CEO 直接支持",
            ]
          : [
              "去水印、Seedance 2 权益、积分不衰减",
              "签到与模板权益以账户策略为准",
              "邀请与支持等级以账户策略为准",
            ];

  return { main, accent };
}

const TIER_SERIF_LABEL: Record<string, string> = {
  free: "免费版",
  "69": "日常创作",
  "199": "专业进阶",
  "599": "旗舰尊享",
};

/** 结算区标题：避免展示 vip_01 等内部 code，统一为「VIP 69 月卡」 */
function checkoutPlanDisplayTitle(plan: PaymentMembershipPlan): string {
  const k = tierKeyFromPlan(plan);
  if (k) {
    return `VIP ${k} ${plan.billingCycle === "yearly" ? "年卡" : "月卡"}`;
  }
  const nm = (plan.name || "").trim();
  if (nm) return nm;
  return plan.code || "—";
}

/** 套餐卡默认统一最小高度（免费 + 各档付费、选中/未选中一致，与视觉稿对齐） */
const PLAN_CARD_MIN_H = "min-h-[520px] sm:min-h-[550px] lg:min-h-[580px] xl:min-h-[600px]";

const MembershipPanel: React.FC<MembershipPanelProps> = ({ onBack, onPaymentSuccess }) => {
  const [plans, setPlans] = useState<PaymentMembershipPlan[]>([]);
  const [current, setCurrent] = useState<MembershipCurrentResponse | null>(null);
  const [selectedPlanCode, setSelectedPlanCode] = useState<string | null>(null);
  /** 用户主动点选后为 true；切换计费周期/页面初始化时保持 false */
  const [userConfirmedPlan, setUserConfirmedPlan] = useState(false);
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("monthly");
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
  const [vipMainTab, setVipMainTab] = useState<VipMainTab>("plans");
  const [creditOrdersOpen, setCreditOrdersOpen] = useState(false);
  const paymentPanelRef = useRef<PaymentPanelHandle>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (vipMainTab === "plans") setCreditOrdersOpen(false);
  }, [vipMainTab]);

  const filteredPlans = useMemo(() => {
    const list = (plans || []).filter((p) => p.billingCycle === billingPeriod).sort(sortPlansByTier);
    return list;
  }, [plans, billingPeriod]);

  const hasYearly = useMemo(() => plans.some((p) => p.billingCycle === "yearly"), [plans]);
  const hasMonthly = useMemo(() => plans.some((p) => p.billingCycle === "monthly"), [plans]);

  const selectedPlan = useMemo(
    () => filteredPlans.find((plan) => plan.code === selectedPlanCode) ?? null,
    [filteredPlans, selectedPlanCode],
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
    } catch (error) {
      console.error("加载会员数据失败:", error);
      showToast("加载会员数据失败", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!filteredPlans.length) {
      if (selectedPlanCode !== null) setSelectedPlanCode(null);
      return;
    }
    if (selectedPlanCode === null) {
      const preferred199 = filteredPlans.find((p) => tierKeyFromPlan(p) === "199");
      setSelectedPlanCode((preferred199 ?? filteredPlans[0]).code);
      return;
    }
    const exists = filteredPlans.some((p) => p.code === selectedPlanCode);
    if (!exists) {
      const preferred199 = filteredPlans.find((p) => tierKeyFromPlan(p) === "199");
      setSelectedPlanCode((preferred199 ?? filteredPlans[0]).code);
    }
  }, [filteredPlans, selectedPlanCode]);

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
    if (onPaymentSuccess) {
      onPaymentSuccess();
    } else {
      onBack();
    }
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

  const createOrderForPlan = useCallback(async (planCode: string, method: PaymentMethod) => {
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
  }, []);

  useEffect(() => {
    if (!selectedPlanCode || !userConfirmedPlan) return;
    void createOrderForPlan(selectedPlanCode, paymentMethod);
  }, [selectedPlanCode, paymentMethod, userConfirmedPlan, createOrderForPlan]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "paid":
        return <CheckCircle className="h-4 w-4 text-emerald-400" />;
      case "pending":
        return <Clock className="h-4 w-4 text-amber-400" />;
      default:
        return <XCircle className="h-4 w-4 text-red-400" />;
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

  const isFreeUser = current?.entitlement?.membershipStatus !== "active";

  const currentTierKey = useMemo(() => {
    if (!current?.plan) return null;
    return tierKeyFromPlan(current.plan as PaymentMembershipPlan);
  }, [current?.plan]);

  const isWhite = useAIChatStore((s) => s.chatTheme === "white");

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center py-24", isWhite && "min-h-full bg-white")}>
        <Loader2 className={cn("h-7 w-7 animate-spin", isWhite ? "text-slate-400" : "text-zinc-500")} />
      </div>
    );
  }

  return (
    <div className={cn("min-h-0", isWhite ? "min-h-full bg-white" : "text-zinc-100")}>
      <div className={cn("flex items-center justify-between pb-5 pt-2", isWhite ? "border-b border-slate-100" : "border-b border-zinc-800/80")}>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (showOrders) {
                setShowOrders(false);
                return;
              }
              if (vipMainTab === "credits" && creditOrdersOpen) {
                paymentPanelRef.current?.closeOrders();
                return;
              }
              onBack();
            }}
            className={cn(
              "rounded-lg p-2 transition-colors",
              isWhite ? "text-slate-400 hover:bg-slate-100 hover:text-slate-700" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
            )}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h3 className={cn("text-lg font-medium tracking-tight", isWhite ? "text-slate-800" : "text-zinc-100")}>
            {showOrders
              ? "会员订单"
              : vipMainTab === "credits"
                ? creditOrdersOpen
                  ? "订单记录"
                  : "积分充值"
                : "VIP 订阅"}
          </h3>
        </div>
        {!showOrders && (
          <div className="flex items-center gap-1 sm:gap-2">
            {vipMainTab === "plans" ? (
              <button
                type="button"
                onClick={() => void loadData()}
                className={cn(
                  "rounded-lg p-2 transition-colors",
                  isWhite ? "text-slate-400 hover:bg-slate-100 hover:text-slate-700" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200",
                )}
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                if (vipMainTab === "plans") {
                  setShowOrders(true);
                  void loadOrders();
                } else {
                  paymentPanelRef.current?.openOrders();
                }
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors",
                isWhite ? "text-slate-400 hover:bg-slate-100 hover:text-slate-700" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
              )}
            >
              <FileText className="h-4 w-4" />
              订单记录
            </button>
          </div>
        )}
      </div>

      {showOrders ? (
        <div className="mt-6">
          {ordersLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-7 w-7 animate-spin text-zinc-500" />
            </div>
          ) : orders.length === 0 ? (
            <div className="py-16 text-center text-zinc-500">暂无会员订单</div>
          ) : (
            <div className="space-y-3">
              {orders.map((order) => (
                <div
                  key={order.orderId}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-4",
                    isWhite ? "border-slate-200 bg-white" : "border-zinc-800 bg-zinc-900/60",
                  )}
                >
                  <div>
                    <div className={cn("font-medium", isWhite ? "text-slate-900" : "text-zinc-100")}>{order.planCode}</div>
                    <div className={cn("mt-1 text-xs", isWhite ? "text-slate-500" : "text-zinc-500")}>{new Date(order.createdAt).toLocaleString()}</div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className={cn("font-medium", isWhite ? "text-slate-900" : "text-zinc-100")}>¥{order.amount}</div>
                      <div className={cn("text-xs", isWhite ? "text-slate-500" : "text-zinc-500")}>{order.paymentMethod}</div>
                    </div>
                    <div className={cn("flex items-center gap-2 text-sm", isWhite ? "text-slate-600" : "text-zinc-400")}>
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
        <div className="mt-6 space-y-8 pb-8">
          {!creditOrdersOpen && (
            <div className="flex justify-center px-2">
              <div
                role="tablist"
                aria-label="VIP 订阅与积分充值"
                className={cn(
                  "inline-flex items-stretch rounded-full border p-1",
                  isWhite
                    ? "border-slate-200 bg-white shadow-[inset_0_1px_0_rgba(15,23,42,0.05)]"
                    : "border-zinc-600/90 bg-zinc-950/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={vipMainTab === "plans"}
                  onClick={() => setVipMainTab("plans")}
                  className={cn(
                    "min-w-[5.5rem] rounded-full px-5 py-2 text-sm font-medium transition-colors sm:min-w-[6.5rem]",
                    vipMainTab === "plans"
                      ? "bg-white text-zinc-950 shadow-sm"
                      : isWhite
                        ? "text-slate-500 hover:text-slate-700"
                        : "text-zinc-400 hover:text-zinc-200",
                  )}
                >
                  套餐
                </button>
                <div className={cn("mx-0.5 w-px shrink-0 self-stretch", isWhite ? "bg-slate-200" : "bg-zinc-700")} aria-hidden />
                <button
                  type="button"
                  role="tab"
                  aria-selected={vipMainTab === "credits"}
                  onClick={() => setVipMainTab("credits")}
                  className={cn(
                    "min-w-[5.5rem] rounded-full px-5 py-2 text-sm font-medium transition-colors sm:min-w-[6.5rem]",
                    vipMainTab === "credits"
                      ? "bg-white text-zinc-950 shadow-sm"
                      : isWhite
                        ? "text-slate-500 hover:text-slate-700"
                        : "text-zinc-400 hover:text-zinc-200",
                  )}
                >
                  积分
                </button>
              </div>
            </div>
          )}

          {vipMainTab === "credits" ? (
            <PaymentPanel
              ref={paymentPanelRef}
              embeddedInVip
              onBack={onBack}
              onPaymentSuccess={onPaymentSuccess}
              onCreditsOrdersOpenChange={setCreditOrdersOpen}
            />
          ) : (
            <>
              <p className="mx-auto max-w-6xl text-center text-sm leading-relaxed text-zinc-500">
                月卡积分按 30 天周期刷新；每日赠送归入「赠送可消退积分」。会员在续费状态下，到期日刷新为当前档位的满额月卡积分；未续费则月卡积分刷新为
                0。切换月付 / 年付查看套餐与应付金额。
              </p>

              {!filteredPlans.length ? (
                <div
                  className={cn(
                    "rounded-2xl border border-dashed py-16 text-center",
                    isWhite ? "border-slate-300 bg-white text-slate-500" : "border-zinc-700 bg-zinc-900/40 text-zinc-500",
                  )}
                >
                  暂无{billingPeriod === "monthly" ? "月付" : "年付"}套餐，请稍后再试或联系管理员
                </div>
              ) : (
            <div className="min-w-0 space-y-8">
              <div className="min-w-0 space-y-6">
                {/* <div className="rounded-[20px] border border-[#C9A227]/85 bg-black p-5 sm:p-6">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs font-medium text-[#E8C547]">
                        <Crown className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                        当前会员
                      </div>
                      <div className="mt-3 text-2xl font-bold tracking-tight text-white">
                        {isFreeUser ? "免费版" : TIER_SERIF_LABEL[currentTierKey ?? ""] ?? current?.plan?.name ?? "会员"}
                      </div>
                      <div className="mt-1.5 text-sm text-[#8E8E93]">
                        状态：{isFreeUser ? "未开通付费会员" : "已开通"}
                      </div>
                    </div>
                    {!isFreeUser ? (
                      <div className="shrink-0 rounded-xl border border-[#C9A227]/35 bg-[#0a0a0a] px-4 py-3 text-right">
                        <div className="text-[10px] font-medium uppercase tracking-wider text-[#8E8E93]">月卡积分额度</div>
                        <div className="mt-0.5 text-xl font-bold tabular-nums text-white">
                          {current?.plan?.monthlyQuotaCredits ?? "—"}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div> */}

                {!isFreeUser ? (
                  <div className="flex justify-center sm:justify-start">
                    <div
                      className={cn(
                        "inline-flex rounded-full border p-1",
                        isWhite
                          ? "border-slate-200 bg-white shadow-[inset_0_1px_0_rgba(15,23,42,0.04)]"
                          : "border-zinc-700/90 bg-zinc-900/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
                      )}
                    >
                      <button
                        type="button"
                        disabled={!hasMonthly}
                        onClick={() => setBillingPeriod("monthly")}
                        className={cn(
                          "rounded-full px-5 py-2 text-sm font-medium transition-all",
                          billingPeriod === "monthly"
                            ? isWhite
                              ? "bg-slate-100 text-slate-900 shadow-[0_0_0_1px_rgba(148,163,184,0.45)]"
                              : "bg-zinc-950 text-white shadow-[0_0_0_1px_rgba(142,134,245,0.35)]"
                            : isWhite
                              ? "text-slate-500 hover:text-slate-700"
                              : "text-zinc-500 hover:text-zinc-300",
                          !hasMonthly && "cursor-not-allowed opacity-40",
                        )}
                      >
                        连续包月
                      </button>
                      <button
                        type="button"
                        disabled={!hasYearly}
                        onClick={() => setBillingPeriod("yearly")}
                        className={cn(
                          "rounded-full px-5 py-2 text-sm font-medium transition-all",
                          billingPeriod === "yearly"
                            ? isWhite
                              ? "bg-slate-100 text-slate-900 shadow-[0_0_0_1px_rgba(148,163,184,0.45)]"
                              : "bg-zinc-950 text-white shadow-[0_0_0_1px_rgba(142,134,245,0.35)]"
                            : isWhite
                              ? "text-slate-500 hover:text-slate-700"
                              : "text-zinc-500 hover:text-zinc-300",
                          !hasYearly && "cursor-not-allowed opacity-40",
                        )}
                      >
                        年费
                        {hasYearly ? (
                          <span className="ml-1.5 bg-gradient-to-r from-[#8E86F5] to-[#B6C3F9] bg-clip-text text-transparent">
                            8 折
                          </span>
                        ) : null}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div
                  className={cn(
                    "flex flex-col gap-6 xl:flex-row xl:items-stretch xl:gap-5 2xl:gap-6",
                  )}
                >
                  <div
                    className={cn(
                      "grid min-w-0 gap-3 sm:gap-4 lg:items-stretch lg:gap-4",
                      userConfirmedPlan
                        ? "flex-1 grid-cols-1 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-4"
                        : "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
                    )}
                  >
                  {/* 免费档（与顶部「当前会员」条：图1 金冠标题 + 图2 卡面色值） */}
                  <div
                    className={cn(
                      "relative flex min-h-0 min-w-0 flex-col rounded-2xl border p-4 sm:p-5 xl:p-4",
                      PLAN_CARD_MIN_H,
                      isWhite
                        ? "border-slate-200 bg-white shadow-[0_12px_24px_rgba(15,23,42,0.08)]"
                        : "border-[#252530] bg-[#121214] shadow-[0_24px_48px_rgba(0,0,0,0.45)]",
                      isFreeUser && "ring-1 ring-[#C9A227]/25",
                      !isFreeUser && (isWhite ? "hover:border-slate-300" : "hover:border-[#3a3a48]"),
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <Crown className="h-5 w-5 shrink-0 text-[#E8C547]" strokeWidth={1.75} aria-hidden />
                      <div className={cn("text-2xl font-bold tracking-tight", isWhite ? "text-slate-900" : "text-white")}>{TIER_SERIF_LABEL.free}</div>
                    </div>
                    <div className={cn("mt-6 text-4xl font-bold tabular-nums tracking-tight", isWhite ? "text-slate-900" : "text-white")}>¥0</div>
                    <div className="mt-1 text-sm text-[#8E8E93]">/ 月 · 无需订阅</div>
                    <button
                      type="button"
                      disabled={isFreeUser}
                      onClick={() => {
                        if (!isFreeUser) showToast("请选择付费档位完成升级", "info");
                      }}
                      className={cn(
                        "mt-8 w-full rounded-full py-3.5 text-sm font-medium transition-colors",
                        isFreeUser
                          ? isWhite
                            ? "cursor-default bg-slate-100 text-slate-500"
                            : "cursor-default bg-[#2C2C2E] text-[#8E8E93]"
                          : isWhite
                            ? "border border-slate-300 bg-transparent text-slate-700 hover:border-[#C9A227]/40 hover:bg-slate-50"
                            : "border border-[#3a3a48] bg-transparent text-[#D1D1D6] hover:border-[#C9A227]/40 hover:bg-[#1c1c1f]",
                      )}
                    >
                      {isFreeUser ? "当前计划" : "了解免费版"}
                    </button>
                    <ul className={cn("mt-5 flex flex-1 flex-col justify-between gap-2.5 text-xs leading-relaxed sm:text-sm sm:gap-3", isWhite ? "text-slate-600" : "text-[#D1D1D6]")}>
                      {FREE_FEATURES.map((line) => (
                        <li key={line} className="flex gap-2.5">
                          <Check className={cn("mt-0.5 h-4 w-4 shrink-0", isWhite ? "text-slate-700" : "text-white")} strokeWidth={2.5} />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {filteredPlans.map((plan) => {
                    const active = plan.code === selectedPlanCode;
                    const confirmedActive = active && userConfirmedPlan;
                    const tk = tierKeyFromPlan(plan);
                    const tierTitle = tk ? TIER_SERIF_LABEL[tk] : plan.name;
                    // const tierSub = tk ? TIER_SERIF_LABEL[tk] : "按套餐配置";
                    const { main, accent } = vipFeatureLines(plan);
                    const billingLabel = plan.billingCycle === "yearly" ? "年费套餐 · 在月付价基础上 8 折" : "月费套餐";
                    const equivMonthly =
                      plan.billingCycle === "yearly" && plan.price > 0
                        ? Math.round((plan.price / 12) * 100) / 100
                        : null;
                    const planTotalCredits = plan.monthlyQuotaCredits + plan.signupBonusCredits;

                    return (
                      <div
                        key={plan.code}
                        className={cn(
                          "relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border p-4 transition-all sm:p-5 xl:p-4",
                          PLAN_CARD_MIN_H,
                          isWhite
                            ? "bg-white shadow-[0_12px_24px_rgba(15,23,42,0.08)]"
                            : "bg-[#121218] shadow-[0_24px_48px_rgba(0,0,0,0.45)]",
                          active
                            ? isWhite
                              ? "border-[#8E86F5]/45 shadow-[0_0_30px_-12px_rgba(142,134,245,0.5),inset_0_0_0_1px_rgba(182,195,249,0.24)]"
                              : "border-[#8E86F5]/55 shadow-[0_0_40px_-12px_rgba(142,134,245,0.65),inset_0_0_0_1px_rgba(182,195,249,0.12)]"
                            : isWhite
                              ? "border-slate-200 hover:border-slate-300"
                              : "border-zinc-800/90 hover:border-zinc-600",
                          currentTierKey &&
                            tierKeyFromPlan(plan) === currentTierKey &&
                            current?.entitlement?.membershipStatus === "active"
                            ? "ring-1 ring-emerald-500/30"
                            : null,
                        )}
                      >
                        {tk === "199" ? (
                          <div className="absolute right-3 top-3 rounded-full bg-gradient-to-r from-[#8E86F5] to-[#B6C3F9] px-2.5 py-0.5 text-[10px] font-semibold text-white shadow-lg shadow-violet-950/40">
                            最受欢迎
                          </div>
                        ) : null}
                        <div className={cn("pr-14 text-xl font-semibold tracking-tight xl:text-lg 2xl:text-xl", isWhite ? "text-slate-900" : "text-white")}>
                          {tierTitle}
                        </div>
                        {/* <div className="mt-1 text-xs text-zinc-500">{tierSub}</div> */}
                        <div className="mt-1 text-[11px] text-zinc-600">{billingLabel}</div>

                        <div className="mt-3 flex flex-wrap items-end gap-2">
                          <span className={cn("text-3xl font-semibold tabular-nums tracking-tight xl:text-2xl 2xl:text-3xl", isWhite ? "text-slate-900" : "text-white")}>
                            ¥{plan.price}
                          </span>
                          <span className="pb-1 text-sm text-zinc-500">
                            / {plan.billingCycle === "yearly" ? "年" : "月"}
                          </span>
                        </div>
                        {equivMonthly != null ? (
                          <div className="mt-1 text-xs text-zinc-500">约合 ¥{equivMonthly} / 月</div>
                        ) : null}

                        <div
                          className={cn(
                            "mt-3 rounded-xl border px-2.5 py-2 sm:px-3 sm:py-2.5",
                            isWhite
                              ? "border-slate-200 bg-gradient-to-br from-indigo-50 to-slate-50"
                              : "border-violet-500/20 bg-gradient-to-br from-violet-950/40 to-zinc-950/30",
                          )}
                        >
                          <div className={cn("text-xs font-medium sm:text-sm", isWhite ? "text-indigo-700" : "text-violet-100")}>
                            <span className={isWhite ? "text-indigo-500" : "text-violet-300"}>✦</span> {planTotalCredits} 合计积分
                          </div>
                          <div className="mt-1 text-[10px] leading-snug text-zinc-500 sm:text-[11px]">
                            月卡 {plan.monthlyQuotaCredits}（30 天刷新）· 开通赠送 {plan.signupBonusCredits} · 每日赠送{" "}
                            {plan.dailyGiftCredits}（赠送可消退）
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setUserConfirmedPlan(true);
                            setSelectedPlanCode(plan.code);
                          }}
                          className={cn(
                            "mt-4 w-full rounded-xl py-3 text-xs font-semibold text-white shadow-lg transition-transform sm:py-3.5 sm:text-sm",
                            confirmedActive
                              ? "bg-gradient-to-r from-[#6f66e8] to-[#9aa8ef] shadow-violet-950/50 ring-2 ring-white/25"
                              : "bg-gradient-to-r from-[#8E86F5] to-[#B6C3F9] shadow-violet-950/40 hover:scale-[1.01] active:scale-[0.99]",
                          )}
                        >
                          {confirmedActive ? "已选择 · 右侧扫码支付" : plan.billingCycle === "yearly" ? "订阅年计划" : "订阅月计划"}
                        </button>

                        <ul className="mt-4 flex flex-1 flex-col gap-1.5 text-[11px] leading-relaxed sm:gap-2 sm:text-xs">
                          {main.map((line) => (
                            <li key={line} className={cn("flex gap-2", isWhite ? "text-slate-600" : "text-zinc-400")}>
                              <Check className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", isWhite ? "text-slate-500" : "text-zinc-300")} strokeWidth={2.5} />
                              <span>{line}</span>
                            </li>
                          ))}
                          {accent.map((line) => (
                            <li key={line} className={cn("flex gap-2", isWhite ? "text-indigo-600" : "text-violet-200/85")}>
                              <Check className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", isWhite ? "text-indigo-500" : "text-[#B6C3F9]")} strokeWidth={2.5} />
                              <span>{line}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                  </div>

                  {userConfirmedPlan ? (
                    <aside className="w-full shrink-0 xl:sticky xl:top-4 xl:self-start xl:w-[min(100%,420px)] 2xl:w-[440px]">
                      <div
                        className={cn(
                          "relative overflow-hidden rounded-2xl border p-5 sm:p-6",
                          isWhite
                            ? "border-slate-200 bg-white shadow-[0_14px_28px_rgba(15,23,42,0.08)]"
                            : "border-zinc-800 bg-[#0f0f14] shadow-[0_24px_48px_rgba(0,0,0,0.5)]",
                        )}
                      >
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#8E86F5]/60 to-transparent" />
                        <div className="mb-5">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">结算</div>
                          <div className={cn("mt-2 text-lg font-semibold", isWhite ? "text-slate-900" : "text-white")}>
                            当前选择 · {selectedPlan ? checkoutPlanDisplayTitle(selectedPlan) : "—"}
                          </div>
                          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                            切换支付方式会自动刷新付款码。支付成功后自动更新会员状态。
                          </p>
                        </div>

                        <div className="mb-5 grid grid-cols-2 gap-2">
                          {[
                            { value: "alipay" as const, label: "支付宝" },
                            { value: "wechat" as const, label: "微信支付" },
                          ].map((item) => (
                            <button
                              key={item.value}
                              type="button"
                              onClick={() => setPaymentMethod(item.value)}
                              className={cn(
                                "rounded-xl border px-4 py-3 text-sm font-medium transition-all",
                                paymentMethod === item.value
                                  ? isWhite
                                    ? "border-[#8E86F5]/50 bg-violet-50 text-violet-700 shadow-[0_0_0_1px_rgba(142,134,245,0.2)]"
                                    : "border-[#8E86F5]/70 bg-violet-500/10 text-violet-100 shadow-[0_0_0_1px_rgba(142,134,245,0.25)]"
                                  : isWhite
                                    ? "border-slate-300 text-slate-600 hover:border-slate-400 hover:text-slate-800"
                                    : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200",
                              )}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>

                        <div className={cn("rounded-2xl border p-4", isWhite ? "border-slate-200 bg-white" : "border-zinc-800/90 bg-zinc-950/80")}>
                          <div className={cn("flex items-center justify-between gap-3 text-sm", isWhite ? "text-slate-500" : "text-zinc-400")}>
                            <span className="shrink-0">应付金额</span>
                            <span
                              className={cn(
                                "bg-clip-text text-2xl font-semibold tabular-nums text-transparent",
                                isWhite ? "bg-gradient-to-r from-slate-900 to-slate-700" : "bg-gradient-to-r from-white to-zinc-200",
                              )}
                            >
                              ¥{selectedPlan?.price ?? 0}
                            </span>
                          </div>
                          {selectedPlan ? (
                            <div className={cn("mt-2 text-xs", isWhite ? "text-slate-500" : "text-zinc-500")}>
                              合计 {selectedPlan.monthlyQuotaCredits + selectedPlan.signupBonusCredits} 积分 · 月卡{" "}
                              {selectedPlan.monthlyQuotaCredits}（30 天刷新）· 开通赠送 {selectedPlan.signupBonusCredits} · 每日{" "}
                              {selectedPlan.dailyGiftCredits}（赠送可消退）
                            </div>
                          ) : null}
                        </div>

                        <div
                          className={cn(
                            "mt-4 rounded-2xl border border-dashed p-4 text-center xl:text-left",
                            isWhite ? "border-slate-300 bg-white" : "border-zinc-700/80 bg-zinc-950/50",
                          )}
                        >
                          {submitting ? (
                            <div className="flex w-full items-center justify-center py-12">
                              <Loader2 className={cn("h-7 w-7 animate-spin", isWhite ? "text-slate-400" : "text-zinc-500")} />
                            </div>
                          ) : qrCodeUrl ? (
                            <div className="flex flex-col items-center gap-4 xl:flex-row xl:items-start xl:justify-center">
                              <img
                                src={qrCodeUrl}
                                alt="会员支付二维码"
                                className={cn(
                                  "h-44 w-44 shrink-0 rounded-xl border object-contain sm:h-48 sm:w-48",
                                  isWhite ? "border-slate-200" : "border-zinc-700",
                                )}
                              />
                              <div className="flex min-h-[176px] flex-col justify-center text-center xl:text-left">
                                <div className={cn("text-sm", isWhite ? "text-slate-600" : "text-zinc-400")}>
                                  {isExpired
                                    ? "付款码已过期，请切换支付方式或重新点选套餐"
                                    : `请使用${paymentMethod === "alipay" ? "支付宝" : "微信"}扫码支付`}
                                </div>
                                {!isExpired ? <div className={cn("mt-2 text-xs", isWhite ? "text-slate-500" : "text-zinc-600")}>剩余 {countdown}s 自动失效</div> : null}
                              </div>
                            </div>
                          ) : (
                            <div className={cn("py-8 text-sm", isWhite ? "text-slate-500" : "text-zinc-600")}>正在生成付款码…</div>
                          )}
                        </div>
                      </div>
                    </aside>
                  ) : null}
                </div>
              </div>
            </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default MembershipPanel;
