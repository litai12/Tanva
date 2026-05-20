import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { teamApi } from '../../services/teamApi';
import { useTeamStore } from '../../stores/teamStore';
import { useAuthStore } from '../../stores/authStore';
import { Button } from '@/components/ui/button';
import { X, UserMinus, Crown, Shield, User, Mail, Copy, Check } from 'lucide-react';

interface Props {
  teamId: string;
  onClose: () => void;
}

export function TeamManagementModal({ teamId, onClose }: Props) {
  const { teams } = useTeamStore();
  const currentUser = useAuthStore((s) => s.user);
  const team = teams.find((t) => t.id === teamId);
  const [members, setMembers] = useState<any[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const myRole = team?.myRole;
  const canManage = myRole === 'owner' || myRole === 'admin';

  useEffect(() => {
    teamApi.getMembers(teamId).then(setMembers).catch(() => {});
  }, [teamId]);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteLoading(true);
    try {
      const inv = await teamApi.createInvite(teamId, { email: inviteEmail, expiresInDays: 7 });
      setInviteCode(inv.code);
      setInviteEmail('');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCopyCode = () => {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode).then(() => {
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
    if (!confirm(`确认解散团队「${team?.name}」？此操作不可撤销。`)) return;
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
            <p className="text-xs text-slate-400 mt-0.5">{members.length} 位成员</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {/* Members list */}
          <div className="px-6 py-4">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">成员</p>
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
                    {canManage && m.role !== 'owner' && m.userId !== currentUser?.id ? (
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
                    {canManage && m.role !== 'owner' && m.userId !== currentUser?.id && (
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

          {/* Invite section */}
          {canManage && (
            <div className="px-6 pb-4 border-t border-slate-100 pt-4">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">邀请成员</p>
              {inviteCode ? (
                <div>
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <Mail className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="flex-1 text-sm font-mono text-slate-600 truncate">
                      {inviteCode}
                    </span>
                    <button
                      onClick={handleCopyCode}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 shrink-0 font-medium"
                    >
                      {copied ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      {copied ? '已复制' : '复制'}
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 mt-2">
                    分享此邀请码，7 天内有效。
                    <button
                      onClick={() => setInviteCode(null)}
                      className="ml-1 text-blue-500 hover:underline"
                    >
                      再次邀请
                    </button>
                  </p>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="email"
                    className="flex-1 text-sm px-3 py-2 rounded-xl border border-slate-200 bg-white outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-all"
                    placeholder="输入邮箱地址"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleInvite();
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={handleInvite}
                    disabled={inviteLoading || !inviteEmail.trim()}
                    className="rounded-xl"
                  >
                    {inviteLoading ? '…' : '邀请'}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Danger zone */}
          {myRole === 'owner' && (
            <div className="px-6 pb-4 pt-2 border-t border-slate-100">
              <p className="text-xs font-medium text-red-400 uppercase tracking-wide mb-3">
                危险操作
              </p>
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
        </div>
      </div>
    </div>,
    document.body,
  );
}
