import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { teamApi } from '../../services/teamApi';
import { teamSubscriptionApi } from '../../services/teamCreditsApi';
import { useTeamStore } from '../../stores/teamStore';
import { useAuthStore } from '../../stores/authStore';
import { Button } from '@/components/ui/button';
import { X, UserMinus, Crown, Shield, User, Mail, Copy, Check, Zap, Calendar, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  teamId: string;
  onClose: () => void;
}

type Tab = 'members' | 'subscription';

export function TeamManagementModal({ teamId, onClose }: Props) {
  const { teams } = useTeamStore();
  const currentUser = useAuthStore((s) => s.user);
  const team = teams.find((t) => t.id === teamId);
  const [tab, setTab] = useState<Tab>('members');
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
          {(['members', 'subscription'] as Tab[]).map((t) => (
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
              {t === 'members' ? '成员' : '套餐'}
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
          ) : (
            <SubscriptionTab teamId={teamId} myRole={myRole} />
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
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);

  useEffect(() => {
    teamApi.getMembers(teamId).then(setMembers).catch(() => {});
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

  const handleCopyCode = () => {
    if (!inviteCode) return;
    const url = `${window.location.origin}/?inviteCode=${inviteCode}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleRemove = async (userId: string) => {
    if (!confirm('确认移除该成员？')) return;
    await teamApi.removeMember(teamId, userId);
    setMembers((prev) => prev.filter((m) => m.userId !== userId));
  };

  const handleRoleChange = async (userId: string, role: string) => {
    await teamApi.updateMemberRole(teamId, userId, role);
    setMembers((prev) => prev.map((m) => (m.userId === userId ? { ...m, role } : m)));
  };

  const handleDissolve = async () => {
    if (!confirm(`确认解散团队「${teamName}」？此操作不可撤销。`)) return;
    await teamApi.dissolveTeam(teamId);
    const updated = await teamApi.getMyTeams();
    useTeamStore.getState().setTeams(updated);
    const personal = updated.find((t: any) => t.isPersonal);
    if (personal) useTeamStore.getState().setActiveTeamId(personal.id);
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
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">
          成员 · {members.length} 人
        </p>
        <div className="space-y-1">
          {members.map((m) => (
            <div
              key={m.userId}
              className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-xl hover:bg-slate-50 transition-colors"
            >
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
          ))}
        </div>
      </div>

      {canManage && (
        <div className="px-6 pb-4 border-t border-slate-100 pt-4">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">邀请成员</p>
          {inviteCode ? (
            <div>
              <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <Mail className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="flex-1 text-sm font-mono text-slate-600 truncate">{inviteCode}</span>
                <button
                  onClick={handleCopyCode}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 shrink-0 font-medium"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? '已复制' : '复制链接'}
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                将链接分享给对方，7 天内有效。
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
              {inviteLoading ? '生成中…' : '生成邀请码'}
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

/* ─── Subscription tab ────────────────────────────────────────────── */

function SubscriptionTab({ teamId, myRole }: { teamId: string; myRole?: string }) {
  const [plans, setPlans] = useState<any[]>([]);
  const [current, setCurrent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [seatCount, setSeatCount] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const isOwner = myRole === 'owner';

  useEffect(() => {
    Promise.all([
      teamSubscriptionApi.listPlans(),
      teamSubscriptionApi.getSubscription(teamId),
    ])
      .then(([p, s]) => {
        setPlans(p);
        setCurrent(s);
        if (p.length > 0 && !selectedPlanId) setSelectedPlanId(p[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [teamId]);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId);

  const monthlyCost = selectedPlan
    ? billingCycle === 'annual'
      ? Math.round(selectedPlan.priceAnnualFen / 12)
      : selectedPlan.priceMonthlyFen
    : 0;
  const totalMonthly = monthlyCost * seatCount;
  const creditsPerMonth = selectedPlan ? selectedPlan.creditsPerSeatPerMonth * seatCount : 0;

  const handleSubscribe = async () => {
    if (!selectedPlanId || !isOwner) return;
    if (seatCount < (selectedPlan?.minSeats ?? 1) || seatCount > (selectedPlan?.maxSeats ?? 100)) {
      setError(`座位数须在 ${selectedPlan?.minSeats}~${selectedPlan?.maxSeats} 之间`);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const sub = await teamSubscriptionApi.createSubscription(teamId, {
        planId: selectedPlanId,
        billingCycle,
        seatCount,
      });
      setCurrent(sub);
    } catch (e: any) {
      setError(e?.message || '订阅失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!confirm('确认取消订阅？当前周期结束前仍可使用。')) return;
    setSubmitting(true);
    try {
      await teamSubscriptionApi.cancelSubscription(teamId);
      setCurrent(null);
    } catch (e: any) {
      setError(e?.message || '取消失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="px-6 py-10 text-center text-sm text-slate-400">加载中…</div>;
  }

  return (
    <div className="px-6 py-4 space-y-5">
      {/* Current subscription */}
      {current && (
        <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-blue-500 uppercase tracking-wide mb-1">当前套餐</p>
              <p className="text-sm font-semibold text-slate-800">{current.plan?.name ?? current.planId}</p>
              <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {current.seatCount} 个座位
                </span>
                <span className="flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  {current.creditsPerRenewal?.toLocaleString()} 积分/期
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {current.billingCycle === 'annual' ? '年付' : '月付'}
                  ，到期 {new Date(current.currentPeriodEnd).toLocaleDateString('zh-CN')}
                </span>
              </div>
            </div>
            {isOwner && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                disabled={submitting}
                className="text-red-400 hover:text-red-500 hover:bg-red-50 rounded-xl shrink-0 text-xs"
              >
                取消订阅
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Plans */}
      {plans.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-6">暂无可用套餐</p>
      ) : (
        <>
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">选择套餐</p>
            <div className="space-y-2">
              {plans.map((plan) => (
                <button
                  key={plan.id}
                  onClick={() => isOwner && setSelectedPlanId(plan.id)}
                  disabled={!isOwner}
                  className={cn(
                    'w-full text-left rounded-2xl border p-3.5 transition-all',
                    selectedPlanId === plan.id
                      ? 'border-slate-800 bg-slate-800 text-white'
                      : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700',
                    !isOwner && 'cursor-default',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{plan.name}</p>
                      <p className={cn('text-xs mt-0.5', selectedPlanId === plan.id ? 'text-slate-300' : 'text-slate-400')}>
                        {plan.creditsPerSeatPerMonth?.toLocaleString()} 积分/人/月
                        · {plan.minSeats}~{plan.maxSeats} 座位
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold">
                        ¥{(plan.priceMonthlyFen / 100).toFixed(0)}
                        <span className={cn('text-xs font-normal ml-0.5', selectedPlanId === plan.id ? 'text-slate-300' : 'text-slate-400')}>
                          /人/月
                        </span>
                      </p>
                      {plan.priceAnnualFen < plan.priceMonthlyFen * 12 && (
                        <p className={cn('text-xs', selectedPlanId === plan.id ? 'text-blue-300' : 'text-blue-500')}>
                          年付省 {Math.round((1 - plan.priceAnnualFen / (plan.priceMonthlyFen * 12)) * 100)}%
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {isOwner && selectedPlan && (
            <div className="space-y-3">
              {/* Billing cycle */}
              <div>
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">付款周期</p>
                <div className="flex gap-2">
                  {(['monthly', 'annual'] as const).map((cycle) => (
                    <button
                      key={cycle}
                      onClick={() => setBillingCycle(cycle)}
                      className={cn(
                        'flex-1 py-2 rounded-xl text-sm border transition-all',
                        billingCycle === cycle
                          ? 'border-slate-800 bg-slate-800 text-white'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300',
                      )}
                    >
                      {cycle === 'monthly' ? '月付' : '年付'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Seat count */}
              <div>
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">
                  座位数（{selectedPlan.minSeats}~{selectedPlan.maxSeats}）
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSeatCount((n) => Math.max(selectedPlan.minSeats, n - 1))}
                    className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 text-lg leading-none"
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-sm font-semibold text-slate-800">{seatCount}</span>
                  <button
                    onClick={() => setSeatCount((n) => Math.min(selectedPlan.maxSeats, n + 1))}
                    className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 text-lg leading-none"
                  >
                    +
                  </button>
                  <span className="text-xs text-slate-400 ml-1">
                    {creditsPerMonth.toLocaleString()} 积分/月
                  </span>
                </div>
              </div>

              {/* Summary + subscribe */}
              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
                <div className="flex items-center justify-between text-sm mb-3">
                  <span className="text-slate-500">
                    {billingCycle === 'annual' ? '年付总价' : '月付总价'}
                  </span>
                  <span className="font-semibold text-slate-800">
                    ¥{billingCycle === 'annual'
                      ? ((selectedPlan.priceAnnualFen / 100) * seatCount).toFixed(0)
                      : (totalMonthly / 100).toFixed(0)}
                    <span className="text-xs font-normal text-slate-400">
                      /{billingCycle === 'annual' ? '年' : '月'}
                    </span>
                  </span>
                </div>
                {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
                <Button
                  className="w-full rounded-xl"
                  onClick={handleSubscribe}
                  disabled={submitting}
                >
                  {submitting ? '处理中…' : current ? '更换套餐' : '立即订阅'}
                </Button>
              </div>
            </div>
          )}

          {!isOwner && (
            <p className="text-xs text-slate-400 text-center pb-2">只有团队所有者可以管理套餐</p>
          )}
        </>
      )}
    </div>
  );
}
