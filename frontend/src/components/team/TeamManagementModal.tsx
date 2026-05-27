import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { teamApi } from '../../services/teamApi';
import { teamCreditsApi, teamSeatPackageApi } from '../../services/teamCreditsApi';
import { getPaymentStatus } from '../../services/adminApi';
import { useTeamStore } from '../../stores/teamStore';
import { useAuthStore, refreshTeams } from '../../stores/authStore';
import { useProjectStore } from '@/stores/projectStore';
import { Button } from '@/components/ui/button';
import { X, UserMinus, Crown, Shield, User, Mail, Copy, Check, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  teamId: string;
  onClose: () => void;
  initialTab?: 'members' | 'subscription' | 'ledger';
}

type Tab = 'members' | 'subscription' | 'ledger';

export function TeamManagementModal({ teamId, onClose, initialTab }: Props) {
  const { teams } = useTeamStore();
  const currentUser = useAuthStore((s) => s.user);
  const team = teams.find((t) => t.id === teamId);
  const [tab, setTab] = useState<Tab>(initialTab ?? 'members');
  const myRole = team?.myRole;
  const canManage = myRole === 'owner' || myRole === 'admin';

  return createPortal(
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg mx-4 rounded-3xl bg-white shadow-[0_32px_80px_rgba(15,23,42,0.18)] border border-slate-200/80 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-800">{team?.name ?? '团队管理'}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-6 border-b border-slate-100 gap-4">
          {(['members', 'subscription', 'ledger'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'py-3 text-sm font-medium border-b-2 transition-colors',
                tab === t
                  ? 'border-slate-800 text-slate-800'
                  : 'border-transparent text-slate-400 hover:text-slate-600',
              )}
            >
              {t === 'members' ? '成员' : t === 'subscription' ? '套餐' : '记录'}
            </button>
          ))}
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {tab === 'members' ? (
            <MembersTab
              teamId={teamId}
              myRole={myRole}
              canManage={canManage}
              currentUserId={currentUser?.id}
              teamName={team?.name}
              onClose={onClose}
            />
          ) : tab === 'subscription' ? (
            <SubscriptionTab teamId={teamId} myRole={myRole} />
          ) : (
            <LedgerTab teamId={teamId} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ─── Members tab ─────────────────────────────────────────────────── */

function MembersTab({
  teamId,
  myRole,
  canManage,
  currentUserId,
  teamName,
  onClose,
}: {
  teamId: string;
  myRole?: string;
  canManage: boolean;
  currentUserId?: string;
  teamName?: string;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<any[]>([]);
  const [seatCount, setSeatCount] = useState<number | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [quotaExpandedUserId, setQuotaExpandedUserId] = useState<string | null>(null);

  useEffect(() => {
    teamApi.getMembers(teamId).then(setMembers).catch(() => {});
    teamSeatPackageApi.listPackages(teamId).then((s: any) => {
      if (s?.totalSeats) setSeatCount(s.totalSeats);
    }).catch(() => {});
  }, [teamId]);

  const handleInvite = async () => {
    setInviteLoading(true);
    try {
      const inv = await teamApi.createInvite(teamId, { expiresInDays: 7 });
      setInviteCode(inv.code);
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (!inviteCode) return;
    navigator.clipboard.writeText(`${window.location.origin}/?inviteCode=${inviteCode}`).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  };

  const handleCopyCode = () => {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    });
  };

  const handleRemove = async (userId: string) => {
    if (!confirm('确认移除该成员？')) return;
    try {
      await teamApi.removeMember(teamId, userId);
    } catch (e: any) {
      alert('移除失败：' + (e?.message || '未知错误'));
      return;
    }
    setMembers((prev) => prev.filter((m) => m.userId !== userId));
  };

  const handleRoleChange = async (userId: string, role: string) => {
    await teamApi.updateMemberRole(teamId, userId, role);
    setMembers((prev) => prev.map((m) => (m.userId === userId ? { ...m, role } : m)));
  };

  const handleDissolve = async () => {
    if (!confirm(`确认解散团队「${teamName}」？此操作不可撤销。`)) return;
    await teamApi.dissolveTeam(teamId);
    await refreshTeams();
    await useProjectStore.getState().load();
    onClose();
  };

  const roleIcon = (role: string) => {
    if (role === 'owner') return <Crown className="w-3.5 h-3.5 text-amber-500" />;
    if (role === 'admin') return <Shield className="w-3.5 h-3.5 text-blue-500" />;
    return <User className="w-3.5 h-3.5 text-slate-400" />;
  };

  const roleLabel = (role: string) => {
    if (role === 'owner') return '所有者';
    if (role === 'admin') return '管理员';
    return '成员';
  };

  return (
    <>
      <div className="px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            成员 · {members.length} 人
          </p>
          {seatCount != null && (
            <span className={cn(
              'text-xs font-medium px-2 py-0.5 rounded-full',
              members.length >= seatCount
                ? 'bg-red-50 text-red-500'
                : 'bg-slate-100 text-slate-500',
            )}>
               {Math.max(0, seatCount - members.length)} / {seatCount} 席位
            </span>
          )}
        </div>
        <div className="space-y-1">
          {members.map((m) => {
            const isQuotaExpanded = quotaExpandedUserId === m.userId;
            const canEditQuota = canManage && m.role !== 'owner' && m.userId !== currentUserId;
            return (
              <div key={m.userId} className="rounded-xl hover:bg-slate-50 transition-colors -mx-2">
                <div className="flex items-center gap-3 py-2 px-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-xs font-medium text-slate-600 shrink-0">
                    {(m.user?.name || m.userId).charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">
                      {m.user?.name || m.userId}
                    </p>
                    {m.user?.email && (
                      <p className="text-xs text-slate-400 truncate">{m.user.email}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canManage && m.role !== 'owner' && m.userId !== currentUserId ? (
                      <select
                        value={m.role}
                        onChange={(e) => handleRoleChange(m.userId, e.target.value)}
                        className="text-xs text-slate-500 border border-slate-200 rounded-lg px-2 py-1 bg-white outline-none cursor-pointer hover:border-slate-300"
                      >
                        <option value="admin">管理员</option>
                        <option value="member">成员</option>
                      </select>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-slate-500">
                        {roleIcon(m.role)}
                        {roleLabel(m.role)}
                      </span>
                    )}
                    {canEditQuota && (
                      <button
                        onClick={() => setQuotaExpandedUserId(isQuotaExpanded ? null : m.userId)}
                        title="配额设置"
                        className={cn(
                          'w-6 h-6 rounded-full flex items-center justify-center transition-colors',
                          isQuotaExpanded
                            ? 'bg-blue-50 text-blue-500'
                            : 'text-slate-300 hover:bg-slate-100 hover:text-slate-500',
                        )}
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {canManage && m.role !== 'owner' && m.userId !== currentUserId && (
                      <button
                        onClick={() => handleRemove(m.userId)}
                        className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-red-50 text-slate-300 hover:text-red-400 transition-colors"
                        title="移除成员"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* 配额摘要行（已设置时展示）*/}
                {!isQuotaExpanded && (m.creditQuotaMonthly != null || m.creditQuotaTotal != null) && (
                  <div className="px-2 pb-1.5 flex gap-3">
                    {m.creditQuotaMonthly != null && (
                      <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                        月度
                        <span className="text-slate-600 font-medium mx-0.5">{m.creditUsedThisCycle?.toLocaleString() ?? 0}</span>
                        /
                        <span className="text-slate-500 mx-0.5">{m.creditQuotaMonthly.toLocaleString()}</span>
                      </span>
                    )}
                    {m.creditQuotaTotal != null && (
                      <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                        总量
                        <span className="text-slate-600 font-medium mx-0.5">{m.creditUsedTotal?.toLocaleString() ?? 0}</span>
                        /
                        <span className="text-slate-500 mx-0.5">{m.creditQuotaTotal.toLocaleString()}</span>
                      </span>
                    )}
                  </div>
                )}

                {/* 内联配额编辑器 */}
                {isQuotaExpanded && (
                  <MemberQuotaEditor
                    teamId={teamId}
                    member={m}
                    onSaved={(updated) => {
                      setMembers((prev) => prev.map((x) => (x.userId === m.userId ? { ...x, ...updated } : x)));
                      setQuotaExpandedUserId(null);
                    }}
                    onCancel={() => setQuotaExpandedUserId(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {canManage && (
        <div className="px-6 pb-4 border-t border-slate-100 pt-4">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">邀请成员</p>
          {inviteCode ? (
            <div className="space-y-2">
              {/* 邀请链接 */}
              <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <Mail className="w-4 h-4 text-slate-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-slate-400 mb-0.5">邀请链接</p>
                  <p className="text-xs text-slate-500 truncate">
                    {`${window.location.origin}/?inviteCode=${inviteCode}`}
                  </p>
                </div>
                <button
                  onClick={handleCopyLink}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 shrink-0 font-medium"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedLink ? '已复制' : '复制'}
                </button>
              </div>
              {/* 邀请码 */}
              <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <Mail className="w-4 h-4 text-slate-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-slate-400 mb-0.5">邀请码</p>
                  <p className="text-xs font-mono text-slate-600 truncate">{inviteCode}</p>
                </div>
                <button
                  onClick={handleCopyCode}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 shrink-0 font-medium"
                >
                  {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedCode ? '已复制' : '复制'}
                </button>
              </div>
              <p className="text-xs text-slate-400">
                链接或邀请码 7 天内有效。
                <button onClick={() => setInviteCode(null)} className="ml-1 text-blue-500 hover:underline">
                  重新生成
                </button>
              </p>
            </div>
          ) : (
            <Button
              size="sm"
              onClick={handleInvite}
              disabled={inviteLoading}
              variant="outline"
              className="rounded-xl"
            >
              {inviteLoading ? '生成中…' : '生成邀请链接 / 邀请码'}
            </Button>
          )}
        </div>
      )}

      {myRole === 'owner' && (
        <div className="px-6 pb-4 pt-2 border-t border-slate-100">
          <p className="text-xs font-medium text-red-400 uppercase tracking-wide mb-3">危险操作</p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDissolve}
            className="text-red-500 border-red-200 hover:bg-red-50 hover:border-red-300 rounded-xl"
          >
            解散团队
          </Button>
        </div>
      )}
    </>
  );
}

/* ─── Member quota inline editor ─────────────────────────────────── */

function MemberQuotaEditor({
  teamId,
  member,
  onSaved,
  onCancel,
}: {
  teamId: string;
  member: any;
  onSaved: (updated: Partial<any>) => void;
  onCancel: () => void;
}) {
  const [monthlyEnabled, setMonthlyEnabled] = useState(member.creditQuotaMonthly != null);
  const [totalEnabled, setTotalEnabled] = useState(member.creditQuotaTotal != null);
  const [monthly, setMonthly] = useState<string>(member.creditQuotaMonthly?.toString() ?? '');
  const [total, setTotal] = useState<string>(member.creditQuotaTotal?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    const monthlyVal = monthlyEnabled ? parseInt(monthly, 10) : null;
    const totalVal = totalEnabled ? parseInt(total, 10) : null;
    if (monthlyEnabled && (isNaN(monthlyVal!) || monthlyVal! < 0)) {
      setError('月度配额须为非负整数');
      return;
    }
    if (totalEnabled && (isNaN(totalVal!) || totalVal! < 0)) {
      setError('总量配额须为非负整数');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await teamApi.setMemberQuota(teamId, member.userId, {
        monthly: monthlyVal,
        total: totalVal,
      });
      onSaved({ creditQuotaMonthly: monthlyVal, creditQuotaTotal: totalVal });
    } catch (e: any) {
      setError(e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-2 pb-3 space-y-2.5">
      <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2.5">
        <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">积分配额</p>

        {/* 月度上限 */}
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={monthlyEnabled}
            onChange={(e) => setMonthlyEnabled(e.target.checked)}
            className="rounded accent-blue-500"
          />
          <span className="text-xs text-slate-600 w-16 shrink-0">月度上限</span>
          {monthlyEnabled ? (
            <div className="flex items-center gap-1.5 flex-1">
              <input
                type="number"
                min={0}
                value={monthly}
                onChange={(e) => setMonthly(e.target.value)}
                placeholder="如 10000"
                className="flex-1 text-xs px-2 py-1 rounded-lg border border-slate-200 outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-100"
              />
              <span className="text-[10px] text-slate-400 shrink-0">积分/月</span>
            </div>
          ) : (
            <span className="text-xs text-slate-400">不限</span>
          )}
        </label>
        {monthlyEnabled && (
          <p className="text-[10px] text-slate-400 pl-6">
            本周期已用：{member.creditUsedThisCycle?.toLocaleString() ?? 0} 积分，每 30 天自动重置
          </p>
        )}

        {/* 总量上限 */}
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={totalEnabled}
            onChange={(e) => setTotalEnabled(e.target.checked)}
            className="rounded accent-blue-500"
          />
          <span className="text-xs text-slate-600 w-16 shrink-0">总量上限</span>
          {totalEnabled ? (
            <div className="flex items-center gap-1.5 flex-1">
              <input
                type="number"
                min={0}
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                placeholder="如 50000"
                className="flex-1 text-xs px-2 py-1 rounded-lg border border-slate-200 outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-100"
              />
              <span className="text-[10px] text-slate-400 shrink-0">积分</span>
            </div>
          ) : (
            <span className="text-xs text-slate-400">不限</span>
          )}
        </label>
        {totalEnabled && (
          <p className="text-[10px] text-slate-400 pl-6">
            累计已用：{member.creditUsedTotal?.toLocaleString() ?? 0} 积分
          </p>
        )}

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex gap-2 pt-0.5">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg h-7 px-3 text-xs"
          >
            {saving ? '保存中…' : '保存'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            className="rounded-lg h-7 px-3 text-xs text-slate-500"
          >
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── Ledger tab ──────────────────────────────────────────────────── */

interface LedgerEntry {
  id: string;
  entryType: string;
  amount: number;
  taskId?: string;
  taskKind?: string;
  actorUserId?: string;
  note?: string;
  createdAt: string;
}

function LedgerTab({ teamId }: { teamId: string }) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [skip, setSkip] = useState(0);
  const PAGE = 20;

  const load = async (reset = false) => {
    setLoading(true);
    const nextSkip = reset ? 0 : skip;
    try {
      const data: LedgerEntry[] = await teamCreditsApi.getLedger(teamId, PAGE + 1, nextSkip);
      const page = data.slice(0, PAGE);
      setHasMore(data.length > PAGE);
      setEntries(reset ? page : (prev) => [...prev, ...page]);
      setSkip(nextSkip + PAGE);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(true);
  }, [teamId]);

  const NEGATIVE_TYPES = new Set(['reserve', 'deduct']);

  const entryLabel = (type: string) => {
    if (type === 'topup') return '充值';
    if (type === 'admin_add') return '管理员充值';
    if (type === 'reserve') return '冻结';
    if (type === 'deduct') return '扣款';
    if (type === 'release') return '解冻';
    if (type === 'refund') return '退款';
    return type;
  };

  const isNegative = (type: string) => NEGATIVE_TYPES.has(type);

  if (loading && entries.length === 0) {
    return <div className="px-6 py-10 text-center text-sm text-slate-400">加载中…</div>;
  }

  if (!loading && entries.length === 0) {
    return <div className="px-6 py-10 text-center text-sm text-slate-400">暂无积分记录</div>;
  }

  return (
    <div className="px-6 py-4">
      <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">团队积分消耗记录</p>
      <div className="space-y-1">
        {entries.map((entry) => (
          <div key={entry.id} className="flex items-start justify-between py-2.5 border-b border-slate-50 last:border-0">
            <div className="flex-1 min-w-0 pr-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded shrink-0', {
                  'bg-red-50 text-red-500': isNegative(entry.entryType),
                  'bg-emerald-50 text-emerald-600': !isNegative(entry.entryType),
                })}>
                  {entryLabel(entry.entryType)}
                </span>
                {(entry.note || entry.taskKind) && (
                  <span className="text-xs text-slate-500 truncate">
                    {entry.note || entry.taskKind}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {new Date(entry.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            <span className={cn('text-sm font-semibold shrink-0', isNegative(entry.entryType) ? 'text-red-500' : 'text-emerald-600')}>
              {isNegative(entry.entryType) ? '-' : '+'}{Math.abs(entry.amount).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
      {hasMore && (
        <button
          onClick={() => load(false)}
          disabled={loading}
          className="mt-3 w-full py-2 text-xs text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
        >
          {loading ? '加载中…' : '加载更多'}
        </button>
      )}
    </div>
  );
}

/* ─── Subscription tab ────────────────────────────────────────────── */

function SubscriptionTab({ teamId, myRole }: { teamId: string; myRole?: string }) {
  const canManage = myRole === 'owner' || myRole === 'admin';

  const [summary, setSummary] = useState<{
    permanentSeats: number;
    totalSeats: number;
    usedSeats: number;
    activePackages: Array<{
      id: string;
      seats: number;
      cycle: string;
      credits: number;
      expiresAt: string;
      purchasedAt: string;
    }>;
  } | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [seats, setSeats] = useState(2);
  const [paymentMethod, setPaymentMethod] = useState<'alipay' | 'wechat'>('alipay');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [qrOrder, setQrOrder] = useState<{
    orderNo: string;
    qrCodeUrl: string;
    amount: number;
    credits: number;
  } | null>(null);
  const [paySuccess, setPaySuccess] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const PLANS = {
    monthly: { pricePerSeat: 100, creditsPerSeat: 10000, label: '月卡', days: 30 },
    annual:  { pricePerSeat: 1200, creditsPerSeat: 120000, label: '年卡', days: 365 },
  } as const;

  const plan = PLANS[cycle];
  const totalAmount = plan.pricePerSeat * seats;
  const totalCredits = plan.creditsPerSeat * seats;

  const loadSummary = async () => {
    setSummaryLoading(true);
    try {
      const data = await teamSeatPackageApi.listPackages(teamId);
      setSummary(data);
    } catch {
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [teamId]);

  const startPolling = (orderNo: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const status = await getPaymentStatus(orderNo);
        if (status.status === 'paid') {
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
          setPaySuccess(true);
          setQrOrder(null);
          loadSummary();
          window.dispatchEvent(new CustomEvent('refresh-credits'));
        }
      } catch {}
    }, 3000);
  };

  const handleBuy = async () => {
    if (!canManage || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const order = await teamSeatPackageApi.createOrder(teamId, {
        seats,
        cycle,
        paymentMethod,
      });
      setQrOrder({
        orderNo: order.orderNo,
        qrCodeUrl: order.qrCodeUrl,
        amount: order.amount,
        credits: order.credits,
      });
      startPolling(order.orderNo);
    } catch (e: any) {
      setError(e?.message || '创建订单失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseQr = () => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    setQrOrder(null);
  };

  if (summaryLoading) {
    return <div className="px-6 py-10 text-center text-sm text-slate-400">加载中…</div>;
  }

  return (
    <div className="px-6 py-4 space-y-5">
      {paySuccess && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 flex items-center justify-between">
          <span>购买成功！积分已发放至团队账户。</span>
          <button onClick={() => setPaySuccess(false)} className="text-emerald-400 hover:text-emerald-600 ml-3">✕</button>
        </div>
      )}

      {summary && (
        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">席位概览</p>
          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className={cn(
                'text-2xl font-bold',
                summary.usedSeats >= summary.totalSeats ? 'text-red-500' : 'text-slate-800',
              )}>
                {summary.usedSeats}
              </span>
              <span className="text-slate-400 ml-1">/ {summary.totalSeats} 席位已用</span>
            </div>
            <div className="text-slate-400 text-xs">
              {summary.permanentSeats} 永久 + {summary.totalSeats - summary.permanentSeats} 套餐
            </div>
          </div>
        </div>
      )}

      {summary && summary.activePackages.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">已购套餐</p>
          <div className="space-y-2">
            {summary.activePackages.map((pkg) => (
              <div key={pkg.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium text-slate-700">{pkg.seats} 席位</span>
                  <span className="ml-2 text-xs text-slate-400">{pkg.cycle === 'annual' ? '年卡' : '月卡'}</span>
                </div>
                <div className="text-xs text-slate-400">
                  到期 {new Date(pkg.expiresAt).toLocaleDateString('zh-CN')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {canManage && (
        <div>
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">购买席位套餐</p>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
            <div className="flex rounded-xl overflow-hidden border border-slate-200">
              {(['monthly', 'annual'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCycle(c)}
                  className={cn(
                    'flex-1 py-2 text-sm font-medium transition-colors',
                    cycle === c ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50',
                  )}
                >
                  {PLANS[c].label}
                  <span className="ml-1 text-xs opacity-70">¥{PLANS[c].pricePerSeat}/席位</span>
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">席位数量（最少 2）</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSeats((s) => Math.max(2, s - 1))}
                  className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  −
                </button>
                <span className="w-8 text-center text-sm font-semibold text-slate-800">{seats}</span>
                <button
                  onClick={() => setSeats((s) => Math.min(100, s + 1))}
                  className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  +
                </button>
              </div>
            </div>

            <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>包含积分</span>
                <span className="font-semibold text-blue-700">+{totalCredits.toLocaleString()} 积分</span>
              </div>
              <div className="flex justify-between text-slate-400 text-xs mt-1">
                <span>{plan.creditsPerSeat.toLocaleString()} 积分/席位 × {seats} 席位</span>
                <span>有效期 {plan.days} 天</span>
              </div>
            </div>

            <div className="flex gap-2">
              {(['alipay', 'wechat'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={cn(
                    'flex-1 py-2 rounded-xl text-sm border transition-colors',
                    paymentMethod === m
                      ? 'border-slate-800 bg-slate-800 text-white'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300',
                  )}
                >
                  {m === 'alipay' ? '支付宝' : '微信支付'}
                </button>
              ))}
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <button
              onClick={handleBuy}
              disabled={submitting}
              className="w-full py-3 rounded-xl bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              {submitting ? '创建订单…' : `立即购买 ¥${totalAmount.toLocaleString()}`}
            </button>
          </div>
        </div>
      )}

      {!canManage && (
        <p className="text-xs text-slate-400 text-center pb-2">只有团队所有者或管理员可以购买套餐</p>
      )}

      {/* QR modal */}
      {qrOrder && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={handleCloseQr}>
          <div className="bg-white rounded-3xl shadow-2xl p-6 w-80 text-center space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">扫码完成支付</h3>
              <button onClick={handleCloseQr} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="text-2xl font-bold text-slate-800">¥{qrOrder.amount.toLocaleString()}</div>
            <div className="text-xs text-slate-400">支付后将发放 {qrOrder.credits.toLocaleString()} 积分</div>
            {qrOrder.qrCodeUrl ? (
              <img src={qrOrder.qrCodeUrl} alt="支付二维码" className="w-48 h-48 mx-auto rounded-xl" />
            ) : (
              <div className="w-48 h-48 mx-auto rounded-xl bg-slate-100 flex items-center justify-center text-xs text-slate-400">
                二维码加载中…
              </div>
            )}
            <p className="text-xs text-slate-400">请使用{paymentMethod === 'alipay' ? '支付宝' : '微信'}扫码</p>
          </div>
        </div>
      )}
    </div>
  );
}
