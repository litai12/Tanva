import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { ArrowLeft, FileText, CheckCircle, Clock, XCircle, Loader2, RefreshCw, Pencil } from "lucide-react";
import { useAIChatStore } from "@/stores/aiChatStore";
import {
  createPaymentOrder,
  getPaymentStatus,
  getPaymentOrders,
  getPaymentPackages,
  type PaymentMethod,
  type PaymentOrderRecord,
  type RechargePackage,
} from "@/services/adminApi";
import { useLocaleText } from "@/utils/localeText";

// 全局 toast 提示
const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
  window.dispatchEvent(
    new CustomEvent("toast", {
      detail: { message, type },
    })
  );
};

export type PaymentPanelHandle = {
  openOrders: () => void;
  closeOrders: () => void;
};

interface PaymentPanelProps {
  onBack: () => void;
  onPaymentSuccess?: () => void;
  /** 嵌入 VIP 订阅页：深色主题、隐藏自带顶栏 */
  embeddedInVip?: boolean;
  /** 同步积分订单列表是否打开（便于外层处理返回与标题） */
  onCreditsOrdersOpenChange?: (open: boolean) => void;
}

const PaymentPanel = forwardRef<PaymentPanelHandle, PaymentPanelProps>(function PaymentPanel(
  { onBack, onPaymentSuccess, embeddedInVip = false, onCreditsOrdersOpenChange },
  ref,
) {
  const { lt } = useLocaleText();
  const [packages, setPackages] = useState<RechargePackage[]>([]);
  const [creditsPerYuan, setCreditsPerYuan] = useState<number>(100);
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [selectedPackage, setSelectedPackage] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("alipay");
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [currentOrderNo, setCurrentOrderNo] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showOrders, setShowOrders] = useState(false);
  const [orders, setOrders] = useState<PaymentOrderRecord[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [countdown, setCountdown] = useState(300);
  const [isExpired, setIsExpired] = useState(false);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  /** 递增后可使尚未完成的 createPaymentOrder 回调不再写入 state，避免套餐单与自定义单互相覆盖 */
  const orderRequestIdRef = useRef(0);

  const isWhite = useAIChatStore((s) => s.chatTheme === "white");
  const isDark = !isWhite;

  // 自定义积分解锁：历史累计已支付 ≥ ¥200 才显示该区域
  const [customAmountEligible, setCustomAmountEligible] = useState(false);
  const [customAmountMode, setCustomAmountMode] = useState(false);
  const [customCreditsInput, setCustomCreditsInput] = useState("");

  const parseCustomCredits = (raw: string) =>
    Math.max(0, Math.floor(Number.parseFloat(raw.replace(/,/g, "").trim()) || 0));
  const localizePackageBadge = useCallback(
    (rawValue?: string | null): string => {
      const value = typeof rawValue === "string" ? rawValue.trim() : "";
      if (!value) return "";
      if (value === "首充翻倍" || value.toLowerCase() === "first top-up x2") {
        return lt("首充翻倍", "First top-up x2");
      }
      const ratioMatch = /^(?:送|赠送|\+)?\s*(\d+)\s*%$/i.exec(value);
      if (ratioMatch?.[1]) {
        const ratio = ratioMatch[1];
        return lt(`送${ratio}%`, `+${ratio}%`);
      }
      return value;
    },
    [lt]
  );

  // 当前选中的支付金额和积分（自定义：先填积分，再换算金额）
  const currentPayInfo = useMemo(() => {
    if (customAmountMode) {
      const credits = parseCustomCredits(customCreditsInput);
      const amount = Math.round((credits / creditsPerYuan) * 100) / 100;
      return { amount, credits };
    }
    if (selectedPackage !== null && packages[selectedPackage]) {
      const pkg = packages[selectedPackage];
      return { amount: pkg.price, credits: pkg.credits };
    }
    return { amount: 0, credits: 0 };
  }, [selectedPackage, packages, customAmountMode, customCreditsInput, creditsPerYuan]);

  // 筛选后的订单列表
  const filteredOrders = useMemo(() => {
    if (statusFilter === "all") return orders;
    return orders.filter(order => order.status === statusFilter);
  }, [orders, statusFilter]);

  // 加载订单列表
  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const result = await getPaymentOrders({ page: 1, pageSize: 200 });
      setOrders(result.orders);
    } catch (error) {
      console.error("加载订单失败:", error);
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  // 创建订单并获取二维码（套餐 / 刷新过期码）
  const handleCreateOrder = useCallback(async () => {
    if (currentPayInfo.amount <= 0 || isLoading) return;

    const requestId = ++orderRequestIdRef.current;
    setIsLoading(true);
    setIsExpired(false);
    try {
      const order = await createPaymentOrder({
        amount: currentPayInfo.amount,
        credits: currentPayInfo.credits,
        paymentMethod,
      });
      if (requestId !== orderRequestIdRef.current) return;
      setQrCodeUrl(order.qrCodeUrl);
      setCurrentOrderNo(order.orderNo);
      setCountdown(300);
    } catch (error: any) {
      console.error("创建订单失败:", error);
      if (requestId === orderRequestIdRef.current) {
        showToast(error.message || lt("创建订单失败", "Failed to create order"), "error");
      }
    } finally {
      if (requestId === orderRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [currentPayInfo, paymentMethod, isLoading, customAmountMode]);

  const handlePaymentCompleted = useCallback(
    (credits: number) => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      showToast(lt(`支付成功！获得 ${credits} 积分`, `Payment successful! You received ${credits} credits`), "success");
      window.dispatchEvent(new CustomEvent("refresh-credits"));
      onPaymentSuccess?.();
      if (!embeddedInVip) {
        onBack();
      }
    },
    [embeddedInVip, onBack, onPaymentSuccess, lt],
  );

  useImperativeHandle(
    ref,
    () => ({
      openOrders: () => {
        setShowOrders(true);
        void loadOrders();
      },
      closeOrders: () => setShowOrders(false),
    }),
    [loadOrders],
  );

  useEffect(() => {
    onCreditsOrdersOpenChange?.(showOrders);
  }, [showOrders, onCreditsOrdersOpenChange]);

  // 轮询支付状态
  const pollPaymentStatus = useCallback(async () => {
    if (!currentOrderNo) return;

    try {
      const status = await getPaymentStatus(currentOrderNo);
      if (status.status === "paid") {
        handlePaymentCompleted(status.credits);
      }
    } catch (error) {
      console.error("查询支付状态失败:", error);
    }
  }, [currentOrderNo, handlePaymentCompleted]);

  // 加载套餐配置
  useEffect(() => {
    const loadPackages = async () => {
      try {
        const data = await getPaymentPackages();
        setPackages(data.packages);
        if (data.creditsPerYuan) setCreditsPerYuan(data.creditsPerYuan);
        if (data.packages.length > 0) {
          setSelectedPackage(0);
        }
      } catch (error) {
        console.error("加载套餐失败:", error);
      } finally {
        setPackagesLoading(false);
      }
    };
    loadPackages();

    // 倒计时每秒更新
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
  }, []);

  // 打开面板时根据历史已付金额判断是否显示自定义积分入口：累计已支付 ≥ ¥200 才解锁
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getPaymentOrders({ page: 1, pageSize: 200 });
        if (cancelled) return;
        const totalPaid = result.orders
          .filter((o) => o.status === "paid")
          .reduce((sum, o) => sum + o.amount, 0);
        setCustomAmountEligible(totalPaid >= 200);
      } catch (e) {
        console.error("检查自定义充值资格失败:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 自定义模式：积分输入变化后自动生成订单（500ms 防抖）
  useEffect(() => {
    if (!customAmountMode || !customCreditsInput) return;
    const credits = parseCustomCredits(customCreditsInput);
    const amount = Math.round((credits / creditsPerYuan) * 100) / 100;
    if (credits < 1 || amount <= 0) return;
    if (paymentMethod !== "alipay" && paymentMethod !== "wechat") return;

    const timer = setTimeout(async () => {
      const requestId = ++orderRequestIdRef.current;
      setIsLoading(true);
      setQrCodeUrl(null);
      setCurrentOrderNo(null);
      setIsExpired(false);
      setCountdown(300);
      try {
        const order = await createPaymentOrder({ amount, credits, paymentMethod });
        if (requestId !== orderRequestIdRef.current) return;
        setQrCodeUrl(order.qrCodeUrl);
        setCurrentOrderNo(order.orderNo);
      } catch (err: any) {
        if (requestId === orderRequestIdRef.current) {
          showToast(err.message || lt("创建订单失败", "Failed to create order"), "error");
        }
      } finally {
        if (requestId === orderRequestIdRef.current) {
          setIsLoading(false);
        }
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [customAmountMode, customCreditsInput, creditsPerYuan, paymentMethod]);
  // 仅在套餐列表首次加载完成时自动下单，避免与 handlePackageSelect 在切换套餐时重复请求
  useEffect(() => {
    if (!packagesLoading && packages.length > 0 && selectedPackage !== null && (paymentMethod === "alipay" || paymentMethod === "wechat") && !showOrders && !customAmountMode) {
      const pkg = packages[selectedPackage];
      if (!pkg) return;
      const requestId = ++orderRequestIdRef.current;
      void (async () => {
        setIsLoading(true);
        setIsExpired(false);
        try {
          const order = await createPaymentOrder({
            amount: pkg.price,
            credits: pkg.credits,
            paymentMethod,
          });
          if (requestId !== orderRequestIdRef.current) return;
          setQrCodeUrl(order.qrCodeUrl);
          setCurrentOrderNo(order.orderNo);
          setCountdown(300);
        } catch (error: any) {
          console.error("创建订单失败:", error);
          if (requestId === orderRequestIdRef.current) {
            showToast(error.message || lt("创建订单失败", "Failed to create order"), "error");
          }
        } finally {
          if (requestId === orderRequestIdRef.current) {
            setIsLoading(false);
          }
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只响应 packagesLoading，首次进入面板拉默认套餐码
  }, [packagesLoading]);

  // 当有订单号时，启动支付状态轮询（每3秒查询一次）
  useEffect(() => {
    if (currentOrderNo && (paymentMethod === "alipay" || paymentMethod === "wechat")) {
      // 清除之前的轮询
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
      // 启动新的轮询，每3秒查询一次
      pollingRef.current = setInterval(pollPaymentStatus, 3000);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [currentOrderNo, paymentMethod, pollPaymentStatus]);

  // 切换支付方式时重新创建订单
  const handlePaymentMethodChange = async (method: PaymentMethod) => {
    orderRequestIdRef.current += 1;
    setPaymentMethod(method);
    setQrCodeUrl(null);
    setCurrentOrderNo(null);
    setIsExpired(false);
    setCountdown(300);

    if (customAmountMode) {
      // 切换支付方式后由 useEffect 自动重新生成订单
      return;
    }

    if (currentPayInfo.amount > 0) {
      const requestId = ++orderRequestIdRef.current;
      setIsLoading(true);
      try {
        const order = await createPaymentOrder({
          amount: currentPayInfo.amount,
          credits: currentPayInfo.credits,
          paymentMethod: method,
        });
        if (requestId !== orderRequestIdRef.current) return;
        setQrCodeUrl(order.qrCodeUrl);
        setCurrentOrderNo(order.orderNo);
      } catch (error: any) {
        if (requestId === orderRequestIdRef.current) {
          showToast(error.message || lt("创建订单失败", "Failed to create order"), "error");
        }
      } finally {
        if (requestId === orderRequestIdRef.current) {
          setIsLoading(false);
        }
      }
    }
  };

  const handlePackageSelect = (index: number) => {
    orderRequestIdRef.current += 1;
    setCustomAmountMode(false);
    setSelectedPackage(index);
    setQrCodeUrl(null);
    setCurrentOrderNo(null);
    setIsExpired(false);
    setCountdown(300);
    // 选择套餐后自动生成二维码
    if ((paymentMethod === "alipay" || paymentMethod === "wechat") && packages[index]) {
      const pkg = packages[index];
      setTimeout(async () => {
        const requestId = ++orderRequestIdRef.current;
        setIsLoading(true);
        try {
          const order = await createPaymentOrder({
            amount: pkg.price,
            credits: pkg.credits,
            paymentMethod: paymentMethod,
          });
          if (requestId !== orderRequestIdRef.current) return;
          setQrCodeUrl(order.qrCodeUrl);
          setCurrentOrderNo(order.orderNo);
        } catch (error: any) {
          if (requestId === orderRequestIdRef.current) {
            showToast(error.message || lt("创建订单失败", "Failed to create order"), "error");
          }
        } finally {
          if (requestId === orderRequestIdRef.current) {
            setIsLoading(false);
          }
        }
      }, 100);
    }
  };

  // 打开订单记录
  const handleShowOrders = () => {
    setShowOrders(true);
    loadOrders();
  };

  // 获取订单状态图标
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "paid":
        return <CheckCircle className={cn("w-4 h-4", embeddedInVip ? "text-emerald-400" : "text-green-500")} />;
      case "pending":
        return <Clock className={cn("w-4 h-4", embeddedInVip ? "text-amber-400" : "text-yellow-500")} />;
      case "expired":
      case "failed":
      case "cancelled":
        return <XCircle className={cn("w-4 h-4", embeddedInVip ? "text-red-400" : "text-red-500")} />;
      default:
        return null;
    }
  };

  // 获取订单状态文本
  const getStatusText = (status: string) => {
    switch (status) {
      case "paid": return lt("已支付", "Paid");
      case "pending": return lt("待支付", "Pending");
      case "expired": return lt("已过期", "Expired");
      case "failed": return lt("失败", "Failed");
      case "cancelled": return lt("已取消", "Cancelled");
      default: return status;
    }
  };

  return (
    <div
      className={cn(
        "pb-6",
        isWhite
          ? "bg-white text-slate-900"
          : embeddedInVip
            ? "bg-transparent text-zinc-100"
            : "bg-[#0a0a0f] text-zinc-100",
      )}
    >
      {/* 独立积分页顶栏；嵌入 VIP 时由 MembershipPanel 承接 */}
      {!embeddedInVip && !isWhite && (
        <div className="flex items-center justify-between border-b border-zinc-800/60 pb-6 pt-4">
          <div className="flex items-center gap-3">
            <button
              onClick={showOrders ? () => setShowOrders(false) : onBack}
              className="rounded-lg p-1.5 transition-colors hover:bg-zinc-800/80"
            >
              <ArrowLeft className="h-5 w-5 text-zinc-400" />
            </button>
            <h3 className="text-lg font-medium text-zinc-100">
              {showOrders ? lt("订单记录", "Orders") : lt("积分充值", "Top Up Credits")}
            </h3>
          </div>
          {!showOrders && (
            <button
              onClick={handleShowOrders}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-800/80 hover:text-zinc-100"
            >
              <FileText className="h-4 w-4" />
              {lt("订单记录", "Orders")}
            </button>
          )}
        </div>
      )}

      {/* 订单记录视图 */}
      {showOrders ? (
        <div className={cn(isWhite ? "mt-6" : "mt-2")}>
          {/* 状态筛选 */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {[
              { value: "all", label: lt("全部", "All") },
              { value: "paid", label: lt("已支付", "Paid") },
              { value: "pending", label: lt("待支付", "Pending") },
              { value: "expired", label: lt("已过期", "Expired") },
              { value: "cancelled", label: lt("已取消", "Cancelled") },
            ].map((item) => (
              <button
                key={item.value}
                onClick={() => setStatusFilter(item.value)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                  statusFilter === item.value
                    ? isWhite
                      ? "border-blue-400 bg-blue-50 text-blue-600"
                      : "border-[#8E86F5]/70 bg-violet-500/15 text-violet-100"
                    : isWhite
                      ? "border-slate-200 text-slate-500 hover:border-slate-300"
                      : "border-zinc-700 text-zinc-400 hover:border-zinc-600",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          {ordersLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className={cn("h-6 w-6 animate-spin", isWhite ? "text-slate-400" : "text-zinc-500")} />
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className={cn("py-12 text-center", isWhite ? "text-slate-400" : "text-zinc-500")}>
              {orders.length === 0 ? lt("暂无订单记录", "No orders yet") : lt("暂无符合条件的订单", "No matching orders")}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredOrders.map((order) => (
                <div
                  key={order.orderId}
                  className={cn(
                    "flex items-center justify-between rounded-xl p-4",
                    isWhite ? "bg-slate-50" : "border border-zinc-800/80 bg-[#0f0f15]",
                  )}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("font-medium", isWhite ? "text-slate-800" : "text-zinc-100")}>¥{order.amount}</span>
                      <span className={cn("text-sm", isWhite ? "text-slate-500" : "text-zinc-500")}>
                        → {order.credits.toLocaleString()} {lt("积分", "credits")}
                      </span>
                    </div>
                    <div className={cn("mt-1 text-xs", isWhite ? "text-slate-400" : "text-zinc-500")}>
                      {new Date(order.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(order.status)}
                    <span className={cn("text-sm", isWhite ? "text-slate-600" : "text-zinc-300")}>{getStatusText(order.status)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* 充值内容 */
        <div
          className={cn(
            "mt-6 flex gap-4",
            isWhite
              ? "mx-auto max-w-[min(100%,38rem)] flex-col sm:max-w-[min(100%,40rem)] xl:max-w-[min(100%,68rem)] xl:flex-row xl:items-start xl:gap-8"
              : "mx-auto w-full max-w-[min(100%,34rem)] flex-col sm:max-w-[min(100%,36rem)] xl:max-w-[min(100%,48rem)] xl:flex-row xl:items-start xl:gap-8",
          )}
        >
        {/* 左侧：套餐选择 */}
        <div className={cn("min-w-0 pb-4 md:pb-6", isWhite ? "w-full shrink-0 xl:flex-1 xl:min-w-0" : "flex-1")}>
          {/* 套餐网格 */}
          <div className="mb-3 grid grid-cols-3 gap-3">
            {packages.map((pkg, index) => {
              const localizedTag = localizePackageBadge(pkg.tag);
              const localizedBonus = localizePackageBadge(pkg.bonus);
              return (
                <button
                  key={pkg.price}
                  onClick={() => handlePackageSelect(index)}
                  className={cn(
                    "relative rounded-xl border-2 p-4 text-left transition-all",
                    selectedPackage === index && !customAmountMode
                      ? isWhite
                        ? "border-blue-400 bg-blue-50/50 shadow-[0_0_24px_-8px_rgba(59,130,246,0.3)]"
                        : "border-[#8E86F5]/70 bg-violet-500/15 shadow-[0_0_24px_-8px_rgba(142,134,245,0.5)]"
                      : isWhite
                        ? "border-slate-200 bg-white hover:border-slate-300"
                        : "border-zinc-700/80 bg-[#0f0f18] hover:border-zinc-600",
                  )}
                >
                  <div className={cn("text-2xl font-semibold", isWhite ? "text-slate-800" : "text-zinc-100")}>¥{pkg.price}</div>
                  <div className={cn("mt-1 text-sm", isWhite ? "text-slate-500" : "text-zinc-500")}>
                    {pkg.credits.toLocaleString()}
                    <span className="text-xs">{lt("积分", "credits")}</span>
                  </div>
                  {(localizedTag || localizedBonus) && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {localizedTag && (
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs",
                            isWhite ? "bg-orange-100 text-orange-600" : "bg-orange-500/20 text-orange-200",
                          )}
                        >
                          {localizedTag}
                        </span>
                      )}
                      {localizedBonus && (
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs",
                            isWhite ? "bg-purple-100 text-purple-600" : "bg-violet-500/20 text-violet-200",
                          )}
                        >
                          {localizedBonus}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* 自定义积分（历史累计已支付 ≥ ¥200 才显示该区域；金额由积分按汇率换算） */}
          {customAmountEligible && (
            <div
              className={cn(
                "rounded-xl border-2 transition-all",
                customAmountMode
                  ? isWhite
                    ? "border-blue-400 bg-blue-50/50"
                    : "border-[#8E86F5]/60 bg-violet-500/10"
                  : isWhite
                    ? "border-dashed border-slate-300 bg-white hover:border-blue-300 hover:bg-blue-50/30"
                    : "border-dashed border-zinc-600 bg-[#0f0f18] hover:border-violet-500/50 hover:bg-violet-500/5",
              )}
            >
              {customAmountMode ? (
                <div className="p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Pencil className={cn("h-4 w-4", isWhite ? "text-blue-500" : "text-violet-400")} />
                    <span className={cn("text-sm font-medium", isWhite ? "text-blue-600" : "text-violet-200")}>
                      {lt("自定义积分", "Custom credits")}
                    </span>
                    <button
                      onClick={() => {
                        setCustomAmountMode(false);
                        setQrCodeUrl(null);
                        setCurrentOrderNo(null);
                        setIsExpired(false);
                        setCountdown(300);
                      }}
                      className={cn(
                        "ml-auto text-xs underline",
                        isWhite ? "text-slate-400 hover:text-slate-600" : "text-zinc-500 hover:text-zinc-300",
                      )}
                    >
                      {lt("取消", "Cancel")}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={customCreditsInput}
                      onChange={(e) => setCustomCreditsInput(e.target.value)}
                      placeholder={lt("输入积分数量", "Enter credits")}
                      className={cn(
                        "min-w-[120px] flex-1 rounded-lg border-2 px-3 py-2 text-lg font-semibold outline-none transition-colors",
                        isWhite
                          ? "border-blue-300 bg-white text-slate-800 placeholder:text-slate-400 focus:border-blue-500"
                          : "border-violet-500/50 bg-[#0a0a10] text-zinc-100 placeholder:text-zinc-600 focus:border-violet-400",
                      )}
                    />
                    <span className={cn("shrink-0 text-sm", isWhite ? "text-slate-500" : "text-zinc-500")}>
                      {lt("积分", "credits")}
                    </span>
                    <span className={cn("shrink-0 text-sm", isWhite ? "text-slate-500" : "text-zinc-500")}>
                      ≈ ¥{currentPayInfo.amount.toFixed(2)}
                    </span>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => {
                    orderRequestIdRef.current += 1;
                    setSelectedPackage(null);
                    setCustomAmountMode(true);
                    setCustomCreditsInput("");
                    setQrCodeUrl(null);
                    setCurrentOrderNo(null);
                    setIsLoading(false);
                    setIsExpired(false);
                    setCountdown(300);
                  }}
                  className={cn(
                    "flex w-full items-center justify-center gap-2 p-4 transition-colors",
                    isWhite ? "text-slate-500 hover:text-blue-500" : "text-zinc-400 hover:text-violet-300",
                  )}
                >
                  <Pencil className={cn("h-4 w-4", isWhite ? "text-blue-500" : "text-violet-400")} />
                  <span className="text-sm">{lt("自定义积分充值", "Custom credits top-up")}</span>
                </button>
              )}
            </div>
          )}

        </div>

        {/* 右侧：二维码支付 */}
        <div className={cn("shrink-0", isWhite ? "w-full xl:w-[220px]" : "w-full xl:w-[240px]")}>
          {/* 支付方式切换 */}
          <div className="mb-3 flex items-center gap-2">
            <button
              onClick={() => handlePaymentMethodChange("alipay")}
              className={cn(
                "flex-1 rounded-lg border-2 py-2 text-sm transition-all",
                paymentMethod === "alipay"
                  ? isWhite
                    ? "border-blue-400 bg-blue-50 text-blue-600"
                    : "border-[#8E86F5]/70 bg-violet-500/15 text-violet-100"
                  : isWhite
                    ? "border-slate-200 text-slate-500 hover:border-slate-300"
                    : "border-zinc-700 text-zinc-500 hover:border-zinc-600",
              )}
            >
              {lt("支付宝", "Alipay")}
            </button>
            <button
              onClick={() => handlePaymentMethodChange("wechat")}
              className={cn(
                "flex-1 rounded-lg border-2 py-2 text-sm transition-all",
                paymentMethod === "wechat"
                  ? isWhite
                    ? "border-green-400 bg-green-50 text-green-600"
                    : "border-emerald-500/70 bg-emerald-500/15 text-emerald-100"
                  : isWhite
                    ? "border-slate-200 text-slate-500 hover:border-slate-300"
                    : "border-zinc-700 text-zinc-500 hover:border-zinc-600",
              )}
            >
              {lt("微信", "WeChat")}
            </button>
          </div>

          {/* 二维码区域 */}
          <div
            className={cn(
              "flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border-2",
              isWhite ? "border-slate-200 bg-white" : "border-zinc-700/80 bg-[#0f0f18]",
            )}
          >
            {isLoading ? (
              <Loader2 className={cn("h-8 w-8 animate-spin", isWhite ? "text-slate-400" : "text-zinc-500")} />
            ) : qrCodeUrl ? (
              <img src={qrCodeUrl} alt={lt("支付二维码", "Payment QR code")} className="h-full w-full object-contain" />
            ) : (
              <span className={cn("px-2 text-center text-sm", isWhite ? "text-slate-400" : "text-zinc-500")}>
                {customAmountMode
                  ? parseCustomCredits(customCreditsInput) < 1
                    ? lt("请输入积分数量", "Please enter credits")
                    : lt("正在生成二维码…", "Generating QR code...")
                  : lt("选择套餐生成二维码", "Select a package to generate QR code")}
              </span>
            )}
          </div>

          {/* 支付金额显示 */}
          {(paymentMethod === "alipay" || paymentMethod === "wechat") && (
            <div className={cn("mt-3 text-center text-sm", isWhite ? "text-slate-500" : "text-zinc-500")}>
              {lt("支付金额：", "Amount:")}
              <span className={cn("text-lg font-semibold", isWhite ? "text-slate-800" : "text-zinc-100")}>
                ¥{currentPayInfo.amount}
              </span>
            </div>
          )}

          {/* 倒计时和刷新按钮 */}
          {(paymentMethod === "alipay" || paymentMethod === "wechat") && qrCodeUrl && (
            <div className="mt-2 flex items-center justify-center gap-2 text-xs">
              {isExpired ? (
                <button
                  onClick={handleCreateOrder}
                  disabled={isLoading}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-2 py-1 transition-colors",
                    isWhite ? "text-orange-600 hover:bg-orange-50" : "text-amber-400 hover:bg-zinc-800/80",
                  )}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
                  <span>{lt("二维码已过期，点击刷新", "QR code expired, click to refresh")}</span>
                </button>
              ) : (
                <span className={isWhite ? "text-slate-400" : "text-zinc-500"}>
                  {Math.floor(countdown / 60)}:{(countdown % 60).toString().padStart(2, "0")} {lt("后过期", "until expiry")}
                </span>
              )}
            </div>
          )}
        </div>
        </div>
      )}
    </div>
  );
});

export default PaymentPanel;
