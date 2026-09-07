import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAdminUserCreditTransactions, type AdminUserCreditTransaction } from "@/services/adminApi";
import { formatCreditBillingRemark } from "@/utils/creditBillingRemark";

const emptyFilters = { startDate: "", endDate: "", model: "" };

export default function UserCreditTransactions({ userId }: { userId: string }) {
  const [draft, setDraft] = useState(emptyFilters);
  const [query, setQuery] = useState({ ...emptyFilters, page: 1, pageSize: 20 });
  const [creditDetailTransactions, setTransactions] = useState<AdminUserCreditTransaction[]>([]);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const end = query.endDate ? new Date(`${query.endDate}T00:00:00`) : null;
    if (end) end.setDate(end.getDate() + 1);
    getAdminUserCreditTransactions(userId, {
      page: query.page, pageSize: query.pageSize,
      startDate: query.startDate ? new Date(`${query.startDate}T00:00:00`).toISOString() : undefined,
      endDate: end?.toISOString(),
      model: query.model.trim() || undefined,
    }).then(result => {
      if (!active) return;
      setTransactions(result.transactions);
      setPagination(result.pagination);
    }).catch(err => {
      if (!active) return;
      setTransactions([]);
      setPagination({ total: 0, totalPages: 0 });
      setError(err instanceof Error ? err.message : "加载积分明细失败，请重新查询");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, query]);

  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    if (draft.startDate && draft.endDate && draft.startDate > draft.endDate) {
      setValidationError("开始日期不能晚于结束日期");
      return;
    }
    setValidationError("");
    setQuery({ ...draft, page: 1, pageSize: query.pageSize });
  };
  const formatChannelLabel = (channel: string | null | undefined): string => {
    if (!channel) return "-";
    const normalized = channel.trim().toLowerCase();
    if (normalized.includes("apimart")) return "M";
    if (normalized === "legacy" || normalized.includes("147")) return "A";
    return channel;
  };

  return (
    <div className='border rounded-lg overflow-hidden'>
      <div className='px-4 py-3 bg-gray-50 border-b flex items-center justify-between'>
        <h4 className='font-medium text-gray-800'>细分积分明细</h4>
        <span className='text-xs text-gray-500'>
          共 {pagination.total} 条
        </span>
      </div>

      <form onSubmit={applyFilters} className="flex flex-wrap items-end gap-3 border-b p-4">
        <label className="text-sm">开始日期<Input type="date" value={draft.startDate} onChange={e => setDraft({ ...draft, startDate: e.target.value })} /></label>
        <label className="text-sm">结束日期<Input type="date" value={draft.endDate} onChange={e => setDraft({ ...draft, endDate: e.target.value })} /></label>
        <label className="text-sm">模型<Input placeholder="模型关键词，如 seedance、gpt-image" value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })} className="w-72" /></label>
        <Button type="submit">查询</Button>
        <Button type="button" variant="outline" onClick={() => { setDraft(emptyFilters); setQuery({ ...emptyFilters, page: 1, pageSize: query.pageSize }); setValidationError(""); }}>重置</Button>
        {validationError && <span role="alert" className="text-sm text-red-600">{validationError}</span>}
      </form>

      {loading ? <div className="py-10 text-center text-gray-500">加载中…</div> : error ? <div role="alert" className="py-6 text-center text-red-600">{error}</div> : creditDetailTransactions.length === 0 ? (
        <div className='py-10 text-center text-gray-500 text-sm'>暂无记录</div>
      ) : (
        <div className='max-h-[45vh] overflow-auto'>
          <table className='w-full text-sm'>
            <thead className='sticky top-0 bg-white z-10'>
              <tr className='border-b text-gray-500 text-xs bg-gray-50'>
                <th className='px-4 py-3 text-left'>项目</th>
                <th className='px-4 py-3 text-right'>积分</th>
                <th className='px-4 py-3 text-right'>剩余积分</th>
                <th className='px-4 py-3 text-left'>生成时间</th>
                <th className='px-4 py-3 text-left'>花费时间</th>
              </tr>
            </thead>
            <tbody>
              {creditDetailTransactions.map((tx) => {
                const durationSeconds =
                  typeof tx.processingTime === "number"
                    ? Math.max(0, Math.round(tx.processingTime / 1000))
                    : null;
                const isPositive = tx.amount > 0;
                const billingRemark = formatCreditBillingRemark(tx.billingRemark);
                const quantityLabel =
                  typeof tx.parallelGroupId === "string" && tx.parallelGroupId.trim()
                    ? tx.parallelGroupIndex !== null && tx.parallelGroupTotal !== null
                      ? `批次：${Math.max(1, Math.floor(tx.parallelGroupIndex || 0))}/${Math.max(1, Math.floor(tx.parallelGroupTotal || 0))}`
                      : "批次"
                    : typeof tx.outputImageCount === "number" && tx.outputImageCount > 1
                      ? `触发数量：x${Math.floor(tx.outputImageCount)}`
                      : null;

                return (
                  <tr key={tx.id} className='border-b hover:bg-gray-50'>
                    <td className='px-4 py-3'>
                      <div className='font-medium text-gray-800'>
                        {tx.description}
                      </div>
                      {quantityLabel && (
                        <div className='text-xs text-gray-500 mt-0.5'>
                          {quantityLabel}
                        </div>
                      )}
                      {tx.channel && (
                        <div className='text-xs text-gray-500 mt-0.5'>
                          渠道: {formatChannelLabel(tx.channel)}
                        </div>
                      )}
                      <div className='text-xs text-gray-500 mt-0.5'>
                        模型: {typeof tx.model === "string" && tx.model.trim().length > 0 ? tx.model : "--"}
                      </div>
                      {billingRemark && (
                        <div className='text-xs text-gray-400 mt-0.5 break-words'>
                          {billingRemark}
                        </div>
                      )}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-semibold ${
                        isPositive ? "text-green-600" : "text-orange-600"
                      }`}
                    >
                      {isPositive ? "+" : ""}
                      {tx.amount}
                    </td>
                    <td className='px-4 py-3 text-right text-blue-600 font-medium'>
                      {tx.balanceAfter}
                    </td>
                    <td className='px-4 py-3 text-gray-600 whitespace-nowrap'>
                      {new Date(tx.createdAt).toLocaleString()}
                    </td>
                    <td className='px-4 py-3 text-gray-600 whitespace-nowrap'>
                      {durationSeconds !== null ? `${durationSeconds}秒` : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t p-3 text-sm">
        <label>每页 <select aria-label="每页条数" value={query.pageSize} onChange={e => setQuery({ ...query, page: 1, pageSize: Number(e.target.value) })} className="rounded border p-1">{[20, 50, 100].map(size => <option key={size} value={size}>{size} 条</option>)}</select></label>
        <span>第 {pagination.totalPages ? query.page : 0} / {pagination.totalPages} 页</span>
        <Button variant="outline" disabled={loading || query.page <= 1} onClick={() => setQuery({ ...query, page: query.page - 1 })}>上一页</Button>
        <Button variant="outline" disabled={loading || query.page >= pagination.totalPages} onClick={() => setQuery({ ...query, page: query.page + 1 })}>下一页</Button>
      </div>
    </div>
  );
}
