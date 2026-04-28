import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, CheckCircle, Clock, Crown, FileText, Loader2, RefreshCw, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import PaymentPanel from "@/components/payment/PaymentPanel";
import { useAIChatStore } from "@/stores/aiChatStore";
import {
  createMembershipOrder,
  getMembershipCurrent,
  getMembershipOrders,
  getPaymentMembershipPlans,
  getPaymentStatus,
  getSeedance2Access,
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
  /** 独立页面时隐藏左上角返回按钮 */
  hideBackButton?: boolean;
}

type BillingPeriod = "monthly" | "yearly";

function normPlanCode(code: string | undefined): string {
  return (code || "").trim().toLowerCase();
}

function sortPlansByTier(a: PaymentMembershipPlan, b: PaymentMembershipPlan): number {
  const sortOrderDelta = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
  if (sortOrderDelta !== 0) return sortOrderDelta;
  return (a.name || "").localeCompare(b.name || "", "zh-CN");
}

const FREE_FEATURES: string[] = [
  "基础月卡积分：500",
  "每日签到：50 积分",
  "Seedance 2 权益：不支持",
  "快乐马权益：充值后可用",
  "无水印权益：不支持",
  "签到/活动赠送积分进入「赠送可消退积分」池",
  "赠送积分默认每日衰减 50",
  "邀请上限 5",
  "模板库：基础可用",
  "支持：有限技术支持",
];

function getPlanMetadataObject(metadata?: Record<string, any> | null): Record<string, any> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
}

function splitBenefitText(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/\r?\n|[；;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildPlanCreditsSummary(plan: PaymentMembershipPlan): string {
  const total = plan.monthlyQuotaCredits + plan.signupBonusCredits;
  return `套餐积分合计到账 ${total} `;
}

function vipFeatureLines(plan: PaymentMembershipPlan): { main: string[]; accent: string[] } {
  const metadata = getPlanMetadataObject(plan.metadata);
  const main = [buildPlanCreditsSummary(plan), ...splitBenefitText(metadata.coreBenefits)];
  const accent: string[] = [];

  if (metadata.seedance2Access === "enabled") {
    accent.push("Seedance 2 权益：支持");
  }

  if (metadata.happyhorseAccess === "enabled") {
    accent.push("快乐马权益：支持");
  } else {
    accent.push("快乐马权益：充值后可用");
  }

  accent.push(
    `${metadata.noWatermarkAccess === "enabled" ? "去水印" : "有水印"}`
  );

  if (typeof metadata.templateLibraryAccess === "string" && metadata.templateLibraryAccess.trim()) {
    accent.push(`模板库：${metadata.templateLibraryAccess.trim()}`);
  }

  const inviteLimit = metadata.inviteLimit;
  if (typeof inviteLimit === "number" && Number.isFinite(inviteLimit)) {
    accent.push(`邀请上限：${Math.trunc(inviteLimit)}`);
  } else if (typeof inviteLimit === "string" && inviteLimit.trim()) {
    accent.push(`邀请上限：${inviteLimit.trim()}`);
  }

  if (typeof metadata.supportLevel === "string" && metadata.supportLevel.trim()) {
    accent.push(`支持：${metadata.supportLevel.trim()}`);
  }

  if (typeof plan.dailyGiftCredits === "number" && plan.dailyGiftCredits > 0) {
    accent.push(`每日赠送：${plan.dailyGiftCredits} 积分`);
  }

  if (metadata.pauseGiftDecay === true) {
    accent.push("赠送积分：不衰减");
  }

  if (accent.length === 0) {
    accent.push("具体会员权益以账户当前生效策略为准");
  }

  return {
    main: Array.from(new Set(main)),
    accent: Array.from(new Set(accent)),
  };
}

const TIER_SERIF_LABEL: Record<string, string> = {
  free: "标准版",
};

function checkoutPlanDisplayTitle(plan: PaymentMembershipPlan): string {
  const nm = (plan.name || "").trim();
  if (nm) return nm;
  return plan.code || "—";
}

function isRecommendedPlan(plan: PaymentMembershipPlan): boolean {
  const code = normPlanCode(plan.code);
  const name = (plan.name || "").trim().toLowerCase();
  return plan.sortOrder === 20 || code.includes("199") || name.includes("专业");
}

function isDailyCreationPlan(plan: PaymentMembershipPlan): boolean {
  const name = (plan.name || "").trim().toLowerCase();
  return name.includes("日常");
}

/** 套餐卡默认统一最小高度（免费 + 各档付费、选中/未选中一致，与视觉稿对齐） */
const PLAN_CARD_MIN_H = "min-h-[520px] sm:min-h-[550px] lg:min-h-[580px] xl:min-h-[600px]";

const MembershipPanel: React.FC<MembershipPanelProps> = ({ onBack, onPaymentSuccess, hideBackButton = false }) => {
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
  const [submitting, setSubmitting] = useState(false);
  const [showOrders, setShowOrders] = useState(false);
  const [orders, setOrders] = useState<MembershipOrderRecord[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [hasWhitelistTopUpAccess, setHasWhitelistTopUpAccess] = useState(false);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const hasYearlyPlans = useMemo(() => (plans || []).some((plan) => plan.billingCycle === "yearly"), [plans]);

  const filteredPlans = useMemo(() => {
    const list = (plans || []).filter((p) => p.billingCycle === billingPeriod).sort(sortPlansByTier);
    return list;
  }, [plans, billingPeriod]);

  const selectedPlan = useMemo(
    () => filteredPlans.find((plan) => plan.code === selectedPlanCode) ?? null,
    [filteredPlans, selectedPlanCode],
  );

  const loadData = useCallback(async () => {
    const [plansResult, currentResult, seedance2AccessResult] = await Promise.allSettled([
      getPaymentMembershipPlans(),
      getMembershipCurrent(),
      getSeedance2Access(),
    ]);

    if (plansResult.status === "fulfilled") {
      setPlans(plansResult.value.plans || []);
    } else {
      console.error("加载会员套餐失败:", plansResult.reason);
      setPlans([]);
      showToast("加载会员套餐失败", "error");
    }

    if (currentResult.status === "fulfilled") {
      setCurrent(currentResult.value);
    } else {
      // current 失败时仍允许展示套餐和支付区，避免整块不可用
      console.warn("加载当前会员状态失败，已降级为仅展示套餐列表:", currentResult.reason);
      setCurrent(null);
    }

    if (seedance2AccessResult.status === "fulfilled") {
      setHasWhitelistTopUpAccess(Boolean(seedance2AccessResult.value.byWhitelist));
    } else {
      console.warn("加载白名单状态失败，默认按非白名单处理:", seedance2AccessResult.reason);
      setHasWhitelistTopUpAccess(false);
    }
  }, []);

  useEffect(() => {
    if (!filteredPlans.length) {
      if (selectedPlanCode !== null) setSelectedPlanCode(null);
      return;
    }
    if (selectedPlanCode === null) {
      setSelectedPlanCode(filteredPlans[0].code);
      return;
    }
    const exists = filteredPlans.some((p) => p.code === selectedPlanCode);
    if (!exists) {
      setSelectedPlanCode(filteredPlans[0].code);
    }
  }, [filteredPlans, selectedPlanCode]);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const result = await getMembershipOrders({ page: 1, pageSize: 100, includeRecharge: true });
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "创建会员订单失败";
      showToast(message, "error");
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
  const canTopUpCredits = true;

  const isWhite = useAIChatStore((state) => state.chatTheme === "white");

  return (
    <div
      className={cn(
        "min-h-full px-10 pt-5",
        isWhite ? "bg-white text-slate-900" : "bg-[#0a0a0f] text-zinc-100",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between pb-5 pt-2",
          isWhite ? "border-b border-slate-100" : "border-b border-zinc-800/60",
        )}
      >
        <div className={cn("flex items-center", !hideBackButton ? "gap-3" : "")}>
          {!hideBackButton && (
            <button
              type="button"
              onClick={() => {
                if (showOrders) {
                  setShowOrders(false);
                  return;
                }
                onBack();
              }}
              className={cn(
                "rounded-lg p-2 transition-colors",
                isWhite
                  ? "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100",
              )}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <h3 className={cn("text-lg font-medium tracking-tight", isWhite ? "text-slate-800" : "text-zinc-100")}>
            {showOrders ? "会员订单" : "VIP 订阅"}
          </h3>
        </div>
        {!showOrders && (
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => void loadData()}
              className={cn(
                "rounded-lg p-2 transition-colors",
                isWhite
                  ? "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  : "text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-200",
              )}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setShowOrders(true);
                void loadOrders();
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors",
                isWhite
                  ? "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100",
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
            <div className="py-16 text-center text-zinc-500">暂无订单记录</div>
          ) : (
            <div className="space-y-3">
              {orders.map((order) => (
                <div
                  key={order.orderId}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-4",
                    isWhite ? "border-slate-200 bg-white" : "border-zinc-800/80 bg-[#0f0f15]",
                  )}
                >
                  <div>
                    <div
                      className={cn("font-medium", isWhite ? "text-slate-900" : "text-zinc-100")}
                    >
                      {order.planCode}
                    </div>
                    <div className={cn("mt-1 text-xs", isWhite ? "text-slate-500" : "text-zinc-500")}>
                      {new Date(order.createdAt).toLocaleString()} · {order.orderType === "recharge" ? "积分充值" : "会员订阅"}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className={cn("font-medium", isWhite ? "text-slate-900" : "text-zinc-100")}>
                        ¥{order.amount}
                      </div>
                      <div className={cn("text-xs", isWhite ? "text-slate-500" : "text-zinc-500")}>
                        {order.paymentMethod}
                      </div>
                    </div>
                    <div
                      className={cn(
                        "flex items-center gap-2 text-sm",
                        isWhite ? "text-slate-600" : "text-zinc-400",
                      )}
                    >
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
          <div className="flex justify-center px-2">
            <div
              role="tablist"
              aria-label="会员计费周期"
              className={cn(
                "inline-flex items-stretch rounded-full border p-1",
                isWhite
                  ? "border-slate-200 bg-white shadow-[inset_0_1px_0_rgba(15,23,42,0.05)]"
                  : "border-zinc-700/80 bg-[#12121a] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={billingPeriod === "monthly"}
                onClick={() => setBillingPeriod("monthly")}
                className={cn(
                  "min-w-[5.5rem] rounded-full px-5 py-2 text-sm font-medium transition-colors sm:min-w-[6.5rem]",
                  billingPeriod === "monthly"
                    ? isWhite
                      ? "bg-white text-zinc-950 shadow-sm"
                      : "bg-gradient-to-r from-[#8E86F5] to-[#9aa8ef] text-white shadow-[0_0_20px_rgba(142,134,245,0.35)]"
                    : isWhite
                      ? "text-slate-500 hover:text-slate-700"
                      : "text-zinc-400 hover:text-zinc-200",
                )}
              >
                月付
              </button>
              <div
                className={cn("mx-0.5 w-px shrink-0 self-stretch", isWhite ? "bg-slate-200" : "bg-zinc-700")}
                aria-hidden
              />
              <button
                type="button"
                role="tab"
                aria-selected={billingPeriod === "yearly"}
                onClick={() => {
                  if (hasYearlyPlans) setBillingPeriod("yearly");
                }}
                className={cn(
                  "min-w-[5.5rem] rounded-full px-5 py-2 text-sm font-medium transition-colors sm:min-w-[6.5rem]",
                  billingPeriod === "yearly"
                    ? isWhite
                      ? "bg-white text-zinc-950 shadow-sm"
                      : "bg-gradient-to-r from-[#8E86F5] to-[#9aa8ef] text-white shadow-[0_0_20px_rgba(142,134,245,0.35)]"
                    : hasYearlyPlans
                      ? isWhite
                        ? "text-slate-500 hover:text-slate-700"
                        : "text-zinc-400 hover:text-zinc-200"
                      : isWhite
                        ? "cursor-not-allowed text-slate-300"
                        : "cursor-not-allowed text-zinc-600",
                )}
              >
                年付
              </button>
            </div>
          </div>

          <p
            className={cn(
              "mx-auto max-w-6xl text-center text-sm leading-relaxed",
              isWhite ? "text-slate-500" : "text-zinc-500",
            )}
          >
            {hasYearlyPlans
              ? "月卡积分按 30 天周期刷新。会员在续费状态下，到期日刷新为当前档位的满额月卡积分；未续费则月卡积分刷新为 0。年付档位同样按月刷新额度，但按年结算。"
              : "月卡积分按 30 天周期刷新。会员在续费状态下，到期日刷新为当前档位的满额月卡积分；未续费则月卡积分刷新为 0。"}
          </p>

          {!filteredPlans.length ? (
            <div
              className={cn(
                "rounded-2xl border border-dashed py-16 text-center",
                isWhite
                  ? "border-slate-300 bg-white text-slate-500"
                  : "border-zinc-700/60 bg-[#272727] text-zinc-500",
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
                        {isFreeUser ? "标准版" : TIER_SERIF_LABEL[currentTierKey ?? ""] ?? current?.plan?.name ?? "会员"}
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
                  {/* 标准档（与顶部「当前会员」条：图1 金冠标题 + 图2 卡面色值） */}
                  <div
                    className={cn(
                      "relative flex min-h-0 min-w-0 flex-col rounded-2xl border p-4 sm:p-5 xl:p-4",
                      PLAN_CARD_MIN_H,
                      isWhite
                        ? "border-[#E8C547]/60 bg-white shadow-[0_0_24px_-14px_rgba(232,197,71,0.4),0_12px_24px_rgba(15,23,42,0.08)]"
                        : "border-[#E8C547]/55 bg-[#0f0f18] shadow-[0_0_28px_-14px_rgba(232,197,71,0.35),0_8px_32px_rgba(0,0,0,0.5)]",
                      isFreeUser && "ring-1 ring-[#C9A227]/25",
                      !isFreeUser &&
                        (isWhite ? "hover:border-[#E8C547]/80" : "hover:border-[#E8C547]/75"),
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <Crown className="h-5 w-5 shrink-0 text-[#E8C547]" strokeWidth={1.75} aria-hidden />
                      <div
                        className={cn(
                          "text-2xl font-bold tracking-tight",
                          isWhite ? "text-slate-900" : "text-zinc-100",
                        )}
                      >
                        {TIER_SERIF_LABEL.free}
                      </div>
                    </div>
                    <div
                      className={cn(
                        "mt-6 text-4xl font-bold tabular-nums tracking-tight",
                        isWhite ? "text-slate-900" : "text-zinc-100",
                      )}
                    >
                      ¥0
                    </div>
                    <div
                      className={cn("mt-1 text-sm", isWhite ? "text-slate-500" : "text-zinc-500")}
                    >
                      / 月 · 无需订阅
                    </div>
                    <button
                      type="button"
                      disabled={isFreeUser}
                      onClick={() => {
                        if (!isFreeUser) showToast("请选择付费档位完成升级", "info");
                      }}
                      className={cn(
                        "mt-16 w-full rounded-xl py-3 text-xs font-semibold transition-all sm:py-3.5 sm:text-sm",
                        isFreeUser
                          ? isWhite
                            ? "cursor-default border border-slate-200 bg-slate-100 text-slate-500 shadow-sm"
                            : "cursor-default border border-zinc-700 bg-[#1a1a22] text-zinc-500 shadow-[0_8px_20px_rgba(0,0,0,0.22)]"
                          : isWhite
                            ? "border border-slate-300 bg-transparent text-slate-700 shadow-sm hover:border-[#C9A227]/40 hover:bg-slate-50"
                            : "border border-zinc-700 bg-transparent text-zinc-300 shadow-[0_8px_20px_rgba(0,0,0,0.22)] hover:border-[#C9A227]/40 hover:bg-[#1c1c1f]",
                      )}
                    >
                      {isFreeUser ? "当前计划" : "了解标准版"}
                    </button>
                    <ul
                      className={cn(
                        "mt-4 flex flex-1 flex-col gap-1.5 text-[11px] leading-relaxed sm:gap-2 sm:text-xs",
                        isWhite ? "text-slate-600" : "text-zinc-400",
                      )}
                    >
                      {FREE_FEATURES.map((line) => (
                        <li key={line} className="flex gap-2">
                          <Check
                            className={cn(
                              "mt-0.5 h-3.5 w-3.5 shrink-0",
                              isWhite ? "text-slate-500" : "text-zinc-400",
                            )}
                            strokeWidth={2.5}
                          />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {filteredPlans.map((plan) => {
                    const active = plan.code === selectedPlanCode;
                    const confirmedActive = active && userConfirmedPlan;
                    const tierTitle = plan.name;
                    const { main, accent } = vipFeatureLines(plan);
                    const isRecommended = isRecommendedPlan(plan);
                    const isDailyCreation = !isRecommended && isDailyCreationPlan(plan);
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
                            : "bg-[#0f0f18] shadow-[0_8px_32px_rgba(0,0,0,0.5)]",
                          active
                            ? isDailyCreation
                              ? isWhite
                                ? "border-emerald-300/75 shadow-[0_0_22px_-14px_rgba(16,185,129,0.35),inset_0_0_0_1px_rgba(16,185,129,0.16)]"
                                : "border-emerald-300/70 shadow-[0_0_28px_-14px_rgba(16,185,129,0.35),inset_0_0_0_1px_rgba(16,185,129,0.2)]"
                              : isWhite
                                ? "border-[#8E86F5]/45 shadow-[0_0_30px_-12px_rgba(142,134,245,0.5),inset_0_0_0_1px_rgba(182,195,249,0.24)]"
                                : "border-[#8E86F5]/70 shadow-[0_0_40px_-12px_rgba(142,134,245,0.6),inset_0_0_0_1.5px_rgba(142,134,245,0.3)]"
                            : isRecommended
                              ? isWhite
                                ? "border-[#8E86F5]/60 shadow-[0_0_24px_-14px_rgba(142,134,245,0.38)] hover:border-[#8E86F5]/80"
                                : "border-[#8E86F5]/65 shadow-[0_0_28px_-14px_rgba(142,134,245,0.38)] hover:border-[#8E86F5]/80"
                              : isDailyCreation
                                ? isWhite
                                  ? "border-emerald-200/85 shadow-[0_0_18px_-16px_rgba(16,185,129,0.22)] hover:border-emerald-300/85"
                                  : "border-emerald-300/45 shadow-[0_0_22px_-16px_rgba(16,185,129,0.22)] hover:border-emerald-300/65"
                                : isWhite
                                  ? "border-slate-200 hover:border-slate-300"
                                  : "border-zinc-800/60 hover:border-zinc-700",
                          current?.plan?.code &&
                            plan.code === current.plan.code &&
                            current?.entitlement?.membershipStatus === "active"
                            ? "ring-1 ring-emerald-500/40"
                            : null,
                        )}
                      >
                        {isRecommended ? (
                          <div className="absolute right-3 top-3 rounded-full bg-gradient-to-r from-[#8E86F5] to-[#9aa8ef] px-2.5 py-0.5 text-[10px] font-semibold text-white shadow-lg shadow-violet-950/60">
                            最受欢迎
                          </div>
                        ) : null}
                        <div
                          className={cn(
                            "pr-14 text-xl font-semibold tracking-tight xl:text-lg 2xl:text-xl",
                            isWhite ? "text-slate-900" : "text-zinc-100",
                          )}
                        >
                          {tierTitle}
                        </div>
                        {/* <div className="mt-1 text-xs text-zinc-500">{tierSub}</div> */}
                        <div
                          className={cn("mt-1 text-[11px]", isWhite ? "text-slate-500" : "text-zinc-500")}
                        >
                          {billingLabel}
                        </div>

                        <div className="mt-3 flex flex-wrap items-end gap-2">
                          <span
                            className={cn(
                              "text-3xl font-semibold tabular-nums tracking-tight xl:text-2xl 2xl:text-3xl",
                              isWhite ? "text-slate-900" : "text-zinc-100",
                            )}
                          >
                            ¥{plan.price}
                          </span>
                          <span
                            className={cn("pb-1 text-sm", isWhite ? "text-slate-500" : "text-zinc-500")}
                          >
                            / {plan.billingCycle === "yearly" ? "年" : "月"}
                          </span>
                        </div>
                        {equivMonthly != null ? (
                          <div
                            className={cn("mt-1 text-xs", isWhite ? "text-slate-500" : "text-zinc-500")}
                          >
                            约合 ¥{equivMonthly} / 月
                          </div>
                        ) : null}

                        <div
                          className={cn(
                            "mt-3 rounded-xl border px-2.5 py-2 sm:px-3 sm:py-2.5",
                            isWhite
                              ? "border-slate-200 bg-gradient-to-br from-indigo-50 to-slate-50"
                              : "border-violet-500/25 bg-gradient-to-br from-violet-950/50 to-[#12121a]",
                          )}
                        >
                          <div
                            className={cn(
                              "text-xs font-medium sm:text-sm",
                              isWhite ? "text-indigo-700" : "text-violet-100",
                            )}
                          >
                            <span className={isWhite ? "text-indigo-500" : "text-violet-300"}>✦</span>{" "}
                            {planTotalCredits} 合计积分
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
                              ? "bg-gradient-to-r from-[#6f66e8] to-[#9aa8ef] shadow-violet-950/50 ring-2 ring-white/20"
                              : "bg-gradient-to-r from-[#8E86F5] to-[#9aa8ef] shadow-violet-950/40 hover:scale-[1.01] active:scale-[0.99]",
                          )}
                        >
                          {confirmedActive
                            ? "已选择 · 右侧扫码支付"
                            : plan.billingCycle === "yearly"
                              ? "订阅年计划"
                              : "订阅月计划"}
                        </button>

                        <ul className="mt-4 flex flex-1 flex-col gap-1.5 text-[11px] leading-relaxed sm:gap-2 sm:text-xs">
                          {main.map((line) => (
                            <li
                              key={line}
                              className={cn(
                                "flex gap-2",
                                isWhite ? "text-slate-600" : "text-zinc-400",
                              )}
                            >
                              <Check
                                className={cn(
                                  "mt-0.5 h-3.5 w-3.5 shrink-0",
                                  isWhite ? "text-slate-500" : "text-zinc-400",
                                )}
                                strokeWidth={2.5}
                              />
                              <span>{line}</span>
                            </li>
                          ))}
                          {accent.map((line) => (
                            <li
                              key={line}
                              className={cn(
                                "flex gap-2",
                                isWhite ? "text-indigo-600" : "text-violet-200",
                              )}
                            >
                              <Check
                                className={cn(
                                  "mt-0.5 h-3.5 w-3.5 shrink-0",
                                  isWhite ? "text-indigo-500" : "text-violet-300",
                                )}
                                strokeWidth={2.5}
                              />
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
                            : "border-[#8E86F5]/30 bg-[#181818] shadow-[0_8px_32px_rgba(0,0,0,0.5)]",
                        )}
                      >
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#8E86F5]/60 to-transparent" />
                        <div className="mb-5">
                          <div className={cn("text-[10px] font-semibold uppercase tracking-[0.2em]", isWhite ? "text-slate-500" : "text-zinc-500")}>结算</div>
                          <div className={cn("mt-2 text-lg font-semibold", isWhite ? "text-slate-900" : "text-zinc-100")}>
                            当前选择 · {selectedPlan ? checkoutPlanDisplayTitle(selectedPlan) : "—"}
                          </div>
                          <p className={cn("mt-2 text-xs leading-relaxed", isWhite ? "text-slate-500" : "text-zinc-500")}>
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
                                    : "border-[#8E86F5]/70 bg-violet-500/15 text-violet-100 shadow-[0_0_12px_rgba(142,134,245,0.3)]"
                                  : isWhite
                                    ? "border-slate-300 text-slate-600 hover:border-slate-400 hover:text-slate-800"
                                    : "border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200",
                              )}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>

                        <div
                          className={cn(
                            "rounded-2xl border p-4",
                            isWhite ? "border-slate-200 bg-white" : "border-zinc-800/80 bg-[#12121a]",
                          )}
                        >
                          <div className={cn("flex items-center justify-between gap-3 text-sm", isWhite ? "text-slate-500" : "text-zinc-400")}>
                            <span className="shrink-0">应付金额</span>
                            <span
                              className={cn(
                                "text-2xl font-semibold tabular-nums",
                                isWhite ? "text-slate-900" : "text-zinc-100",
                              )}
                            >
                              ¥{selectedPlan?.price ?? 0}
                            </span>
                          </div>
                          {selectedPlan ? (
                            <div className={cn("mt-2 text-xs", isWhite ? "text-slate-500" : "text-zinc-500")}>
                              {buildPlanCreditsSummary(selectedPlan)}
                            </div>
                          ) : null}
                        </div>

                        <div
                          className={cn(
                            "mt-4 rounded-2xl border border-dashed p-4 text-center xl:text-left",
                            isWhite ? "border-slate-300 bg-white" : "border-zinc-700/60 bg-[#0a0a10]",
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
                                  isWhite ? "border-slate-200" : "border-zinc-700/80",
                                )}
                              />
                              <div className="flex min-h-[176px] flex-col justify-center text-center xl:text-left">
                                <div className={cn("text-sm", isWhite ? "text-slate-600" : "text-zinc-400")}>
                                  {isExpired
                                    ? "付款码已过期，请切换支付方式或重新点选套餐"
                                    : `请使用${paymentMethod === "alipay" ? "支付宝" : "微信"}扫码支付`}
                                </div>
                                {!isExpired ? (
                                  <div className={cn("mt-2 text-xs", isWhite ? "text-slate-500" : "text-zinc-500")}>
                                    剩余 {countdown}s 自动失效
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ) : (
                            <div className={cn("py-8 text-sm", isWhite ? "text-slate-500" : "text-zinc-600")}>
                              正在生成付款码…
                            </div>
                          )}
                        </div>
                      </div>
                    </aside>
                  ) : null}
                </div>

                {canTopUpCredits ? (
                  <section
                    className={cn(
                      "space-y-4 border-t pt-2",
                      isWhite ? "border-slate-200" : "border-zinc-800/80",
                    )}
                  >
                    <div>
                      <h4 className={cn("text-base font-semibold", isWhite ? "text-slate-900" : "text-zinc-100")}>
                        积分充值
                      </h4>
                      <p className={cn("mt-1 text-sm", isWhite ? "text-slate-500" : "text-zinc-500")}>
                        积分充值已开放，所有用户均可直接购买积分。
                      </p>
                    </div>
                    <PaymentPanel
                      embeddedInVip
                      onBack={onBack}
                      onPaymentSuccess={onPaymentSuccess}
                    />
                  </section>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MembershipPanel;
