import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { ArrowLeft, FileText, CheckCircle, Clock, XCircle, Loader2, RefreshCw, Pencil } from "lucide-react";
import {
  createPaymentOrder,
  getPaymentStatus,
  getPaymentOrders,
  getPaymentPackages,
  type PaymentMethod,
  type PaymentOrderRecord,
  type RechargePackage,
} from "@/services/adminApi";

// 全局 toast 提示
const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
  window.dispatchEvent(
    new CustomEvent("toast", {
      detail: { message, type },
    })
  );
};

interface PaymentPanelProps {
  onBack: () => void;
  onPaymentSuccess?: () => void;
}

const PaymentPanel: React.FC<PaymentPanelProps> = ({ onBack, onPaymentSuccess }) => {
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

  // 自定义积分解锁：历史累计已支付 ≥ ¥200 才显示该区域
  const [customAmountEligible, setCustomAmountEligible] = useState(false);
  const [customAmountMode, setCustomAmountMode] = useState(false);
  const [customCreditsInput, setCustomCreditsInput] = useState("");

  const parseCustomCredits = (raw: string) =>
    Math.max(0, Math.floor(Number.parseFloat(raw.replace(/,/g, "").trim()) || 0));

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
      // const totalPaid = result.orders
      //   .filter(o => o.status === "paid")
      //   .reduce((sum, o) => sum + o.amount, 0);
      // setCustomAmountEligible(totalPaid >= 200);
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
        showToast(error.message || "创建订单失败", "error");
      }
    } finally {
      if (requestId === orderRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [currentPayInfo, paymentMethod, isLoading, customAmountMode]);

  // 轮询支付状态
  const pollPaymentStatus = useCallback(async () => {
    if (!currentOrderNo) return;

    try {
      const status = await getPaymentStatus(currentOrderNo);
      if (status.status === "paid") {
        // 停止轮询
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        // 全局提示支付成功
        showToast(`支付成功！获得 ${status.credits} 积分`, "success");
        // 触发全局积分刷新
        window.dispatchEvent(new CustomEvent("refresh-credits"));
        // 跳转到工作区
        onPaymentSuccess?.();
        onBack();
      }
    } catch (error) {
      console.error("查询支付状态失败:", error);
    }
  }, [currentOrderNo, onPaymentSuccess, onBack]);

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
          showToast(err.message || "创建订单失败", "error");
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
            showToast(error.message || "创建订单失败", "error");
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
          showToast(error.message || "创建订单失败", "error");
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
            showToast(error.message || "创建订单失败", "error");
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
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case "pending":
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case "expired":
      case "failed":
      case "cancelled":
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return null;
    }
  };

  // 获取订单状态文本
  const getStatusText = (status: string) => {
    switch (status) {
      case "paid": return "已支付";
      case "pending": return "待支付";
      case "expired": return "已过期";
      case "failed": return "失败";
      case "cancelled": return "已取消";
      default: return status;
    }
  };

  return (
    <div className='pb-6'>
      {/* 标题栏带返回按钮和订单记录 */}
      <div className='flex items-center justify-between pt-4 pb-6 border-b border-slate-100'>
        <div className='flex items-center gap-3'>
          <button
            onClick={showOrders ? () => setShowOrders(false) : onBack}
            className='p-1.5 rounded-lg hover:bg-slate-100 transition-colors'
          >
            <ArrowLeft className='w-5 h-5 text-slate-500' />
          </button>
          <h3 className='text-lg font-medium text-slate-800'>
            {showOrders ? "订单记录" : "积分充值"}
          </h3>
        </div>
        {!showOrders && (
          <button
            onClick={handleShowOrders}
            className='flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors'
          >
            <FileText className='w-4 h-4' />
            订单记录
          </button>
        )}
      </div>

      {/* 订单记录视图 */}
      {showOrders ? (
        <div className='mt-6'>
          {/* 状态筛选 */}
          <div className='flex items-center gap-2 mb-4 flex-wrap'>
            {[
              { value: "all", label: "全部" },
              { value: "paid", label: "已支付" },
              { value: "pending", label: "待支付" },
              { value: "expired", label: "已过期" },
              { value: "cancelled", label: "已取消" },
            ].map((item) => (
              <button
                key={item.value}
                onClick={() => setStatusFilter(item.value)}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-lg border transition-colors",
                  statusFilter === item.value
                    ? "border-blue-400 bg-blue-50 text-blue-600"
                    : "border-slate-200 text-slate-500 hover:border-slate-300"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          {ordersLoading ? (
            <div className='flex items-center justify-center py-12'>
              <Loader2 className='w-6 h-6 animate-spin text-slate-400' />
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className='text-center py-12 text-slate-400'>
              {orders.length === 0 ? "暂无订单记录" : "暂无符合条件的订单"}
            </div>
          ) : (
            <div className='space-y-3'>
              {filteredOrders.map((order) => (
                <div
                  key={order.orderId}
                  className='flex items-center justify-between p-4 bg-slate-50 rounded-xl'
                >
                  <div className='flex-1'>
                    <div className='flex items-center gap-2'>
                      <span className='font-medium text-slate-800'>
                        ¥{order.amount}
                      </span>
                      <span className='text-sm text-slate-500'>
                        → {order.credits.toLocaleString()} 积分
                      </span>
                    </div>
                    <div className='text-xs text-slate-400 mt-1'>
                      {new Date(order.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className='flex items-center gap-2'>
                    {getStatusIcon(order.status)}
                    <span className='text-sm'>{getStatusText(order.status)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* 充值内容 */
        <div className='flex gap-4 mt-6'>
        {/* 左侧：套餐选择 */}
        <div className='flex-1'>
          {/* 套餐网格 */}
          <div className='grid grid-cols-3 gap-3 mb-3'>
            {packages.map((pkg, index) => (
              <button
                key={pkg.price}
                onClick={() => handlePackageSelect(index)}
                className={cn(
                  "relative p-4 rounded-xl border-2 text-left transition-all",
                  selectedPackage === index && !customAmountMode
                    ? "border-blue-400 bg-blue-50/50"
                    : "border-slate-200 bg-white hover:border-slate-300"
                )}
              >
                <div className='text-2xl font-semibold text-slate-800'>
                  ¥{pkg.price}
                </div>
                <div className='text-sm text-slate-500 mt-1'>
                  {pkg.credits.toLocaleString()}
                  <span className='text-xs'>积分</span>
                </div>
                {(pkg.tag || pkg.bonus) && (
                  <div className='flex items-center gap-1.5 mt-2'>
                    {pkg.tag && (
                      <span className='px-2 py-0.5 text-xs rounded-full bg-orange-100 text-orange-600'>
                        {pkg.tag}
                      </span>
                    )}
                    {pkg.bonus && (
                      <span className='px-2 py-0.5 text-xs rounded-full bg-purple-100 text-purple-600'>
                        {pkg.bonus}
                      </span>
                    )}
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* 自定义积分（历史累计已支付 ≥ ¥200 才显示该区域；金额由积分按汇率换算） */}
          {customAmountEligible && (
          <div
            className={cn(
              "rounded-xl border-2 transition-all",
              customAmountMode
                ? "border-blue-400 bg-blue-50/50"
                : "border-dashed border-slate-300 bg-white hover:border-blue-300 hover:bg-blue-50/30"
            )}
          >
            {customAmountMode ? (
              <div className='p-4'>
                <div className='flex items-center gap-2 mb-3'>
                  <Pencil className='w-4 h-4 text-blue-500' />
                  <span className='text-sm font-medium text-blue-600'>自定义积分</span>
                  <button
                    onClick={() => {
                      setCustomAmountMode(false);
                      setQrCodeUrl(null);
                      setCurrentOrderNo(null);
                      setIsExpired(false);
                      setCountdown(300);
                    }}
                    className='ml-auto text-xs text-slate-400 hover:text-slate-600 underline'
                  >
                    取消
                  </button>
                </div>
                <div className='flex flex-wrap items-center gap-2'>
                  <input
                    type='number'
                    inputMode='numeric'
                    min={1}
                    step={1}
                    value={customCreditsInput}
                    onChange={(e) => setCustomCreditsInput(e.target.value)}
                    placeholder='输入积分数量'
                    className='min-w-[120px] flex-1 px-3 py-2 text-lg font-semibold text-slate-800 bg-white border-2 border-blue-300 rounded-lg outline-none focus:border-blue-500 transition-colors'
                  />
                  <span className='text-sm text-slate-500 shrink-0'>积分</span>
                  <span className='text-sm text-slate-500 shrink-0'>
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
                className='w-full p-4 flex items-center justify-center gap-2 text-slate-500 hover:text-blue-500 transition-colors'
              >
                <Pencil className='w-4 h-4 text-blue-500' />
                <span className='text-sm'>自定义积分充值</span>
              </button>
            )}
          </div>
          )}

        </div>

        {/* 右侧：二维码支付 */}
        <div className='w-[200px] shrink-0'>
          {/* 支付方式切换 */}
          <div className='flex items-center gap-2 mb-3'>
            <button
              onClick={() => handlePaymentMethodChange("alipay")}
              className={cn(
                "flex-1 py-2 text-sm rounded-lg border-2 transition-all",
                paymentMethod === "alipay"
                  ? "border-blue-400 bg-blue-50 text-blue-600"
                  : "border-slate-200 text-slate-500 hover:border-slate-300"
              )}
            >
              支付宝
            </button>
            <button
              onClick={() => handlePaymentMethodChange("wechat")}
              className={cn(
                "flex-1 py-2 text-sm rounded-lg border-2 transition-all",
                paymentMethod === "wechat"
                  ? "border-green-400 bg-green-50 text-green-600"
                  : "border-slate-200 text-slate-500 hover:border-slate-300"
              )}
            >
              微信
            </button>
          </div>

          {/* 二维码区域 */}
          <div className='w-full aspect-square rounded-xl border-2 border-slate-200 bg-white flex items-center justify-center overflow-hidden'>
            {isLoading ? (
              <Loader2 className='w-8 h-8 animate-spin text-slate-400' />
            ) : qrCodeUrl ? (
              <img src={qrCodeUrl} alt='支付二维码' className='w-full h-full object-contain' />
            ) : (
              <span className='text-slate-400 text-sm text-center px-2'>
                {customAmountMode
                  ? parseCustomCredits(customCreditsInput) < 1
                    ? "请输入积分数量"
                    : "正在生成二维码…"
                  : "选择套餐生成二维码"}
              </span>
            )}
          </div>

          {/* 微信支付提示 */}
          {paymentMethod === "wechat" && qrCodeUrl && (
            <div className='mt-2 p-2 bg-green-50 rounded-lg text-center'>
              <p className='text-xs text-green-700'>请向管理员转账</p>
              <p className='text-sm font-semibold text-green-800'>¥{currentPayInfo.amount}</p>
              <p className='text-xs text-green-600 mt-1'>转账后自动到账</p>
            </div>
          )}

          {/* 支付金额显示 */}
          {paymentMethod === "alipay" && (
            <div className='text-center mt-3 text-sm text-slate-500'>
              支付金额：<span className='text-lg font-semibold text-slate-800'>¥{currentPayInfo.amount}</span>
            </div>
          )}

          {/* 倒计时和刷新按钮 */}
          {(paymentMethod === "alipay" || paymentMethod === "wechat") && qrCodeUrl && (
            <div className='flex items-center justify-center gap-2 mt-2 text-xs'>
              {isExpired ? (
                <button
                  onClick={handleCreateOrder}
                  disabled={isLoading}
                  className='flex items-center gap-1.5 px-2 py-1 text-orange-600 hover:bg-orange-50 rounded transition-colors'
                >
                  <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
                  <span>二维码已过期，点击刷新</span>
                </button>
              ) : (
                <span className='text-slate-400'>
                  {Math.floor(countdown / 60)}:{(countdown % 60).toString().padStart(2, '0')} 后过期
                </span>
              )}
            </div>
          )}
        </div>
        </div>
      )}
    </div>
  );
};

export default PaymentPanel;
