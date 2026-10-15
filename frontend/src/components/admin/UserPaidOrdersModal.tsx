import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { getAdminUserPaidOrders, type AdminUserPaidOrders } from "@/services/adminApi";
import {
  ADMIN_BILLING_CYCLE_LABELS,
  getAdminOrderTypeLabel,
  getAdminPaymentMethodLabel,
} from "@/utils/adminOrderLabels";

interface UserPaidOrdersModalProps {
  user: {
    userId: string;
    userName: string;
    phone?: string | null;
    email?: string | null;
  };
  onClose: () => void;
}

const formatAmount = (amount: number) =>
  new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(amount);

function UserPaidOrdersContent({ user, onClose }: UserPaidOrdersModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    userId: string;
    page: number;
    data: AdminUserPaidOrders;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const userData = result?.userId === user.userId ? result.data : null;
  const currentData = result?.page === page ? userData : null;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const load = async () => {
      try {
        const data = await getAdminUserPaidOrders(user.userId, page, controller.signal);
        if (!cancelled) setResult({ userId: user.userId, page, data });
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "加载交易记录失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [user.userId, page, attempt]);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      } else if (event.key === "Tab") {
        const elements = panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        );
        if (!elements?.length) return;
        const first = elements[0];
        const last = elements[elements.length - 1];
        const focused = document.activeElement;
        const focusedIsAvailable = Array.from(elements).some((element) => element === focused);
        if (event.shiftKey && (focused === first || !focusedIsAvailable)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (focused === last || !focusedIsAvailable)) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      data-testid="paid-orders-backdrop"
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[85vh] w-full max-w-6xl flex-col rounded-lg bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 id={titleId} className="text-lg font-semibold">开发票 · 交易记录</h3>
          <Button ref={closeRef} variant="outline" size="sm" onClick={onClose}>关闭</Button>
        </div>
        <div className="mb-4 space-y-1 text-sm">
          <div className="font-medium text-gray-800">{user.userName}</div>
          <div className="break-all text-xs text-gray-500">
            {[user.phone, user.email].filter(Boolean).join(" · ")}
            <span className="ml-2">用户 ID: {user.userId}</span>
          </div>
          <div className="text-xs text-gray-500">以下为该用户全部支付成功交易，供开票核对。</div>
        </div>
        {userData && (
          <div className="mb-4 rounded-md bg-gray-50 p-3 text-sm text-gray-700">
            支付成功 {userData.pagination.total} 笔 · 累计支付 {formatAmount(userData.totalAmount)}
          </div>
        )}
        <div className="min-h-0 overflow-auto rounded-lg border" aria-busy={loading}>
          <table className="w-full min-w-[900px] text-sm">
            <thead className="sticky top-0 bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3">订单号 / 支付平台交易号</th>
                <th className="px-4 py-3">类型</th>
                <th className="px-4 py-3">支付方式</th>
                <th className="px-4 py-3 text-right">金额</th>
                <th className="px-4 py-3">支付成功时间</th>
                <th className="px-4 py-3">状态</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500" role="status">加载中...</td></tr>
              ) : error ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center">
                  <div className="mb-3 text-red-600" role="alert">{error}</div>
                  <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>重试</Button>
                </td></tr>
              ) : !currentData?.orders.length ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">暂无支付成功交易</td></tr>
              ) : currentData.orders.map((order) => (
                <tr key={order.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">
                    <div className="break-all text-gray-700">{order.orderNo}</div>
                    <div className="mt-1 break-all text-gray-400">{order.tradeNo || "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    <div>{getAdminOrderTypeLabel(order.orderType)}</div>
                    {order.orderType === "membership" && (
                      <div className="mt-1 text-xs text-gray-400">
                        {order.planName || "会员订单"}{order.billingCycle ? ADMIN_BILLING_CYCLE_LABELS[order.billingCycle] || "" : ""}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{getAdminPaymentMethodLabel(order.paymentMethod)}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatAmount(order.amount)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {order.paidAt ? new Date(order.paidAt).toLocaleString("zh-CN", { hour12: false }) : "—"}
                  </td>
                  <td className="px-4 py-3"><span className="whitespace-nowrap rounded bg-green-50 px-2 py-0.5 text-xs font-medium text-green-600">支付成功</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-500">
          <span>每页 20 条</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</Button>
            <span>第 {page} / {Math.max(1, userData?.pagination.totalPages || 1)} 页</span>
            <Button variant="outline" size="sm" disabled={loading || !!error || !currentData || page >= currentData.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>下一页</Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function UserPaidOrdersModal(props: UserPaidOrdersModalProps) {
  return <UserPaidOrdersContent key={props.user.userId} {...props} />;
}
