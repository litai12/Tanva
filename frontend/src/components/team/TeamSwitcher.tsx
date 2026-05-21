import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTeamStore } from '../../stores/teamStore';
import { useAuthStore } from '../../stores/authStore';
import { teamApi } from '../../services/teamApi';
import { useProjectStore } from '../../stores/projectStore';
import { projectApi, type Project } from '../../services/projectApi';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ChevronDown, Users, Plus, Settings, LogIn, X, FolderOpen, Loader2, User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  onManage?: (teamId: string) => void;
  variant?: 'header' | 'home';
  className?: string;
}

type ActiveModal = 'none' | 'create' | 'join';

function TeamFormModal({
  mode,
  onClose,
  onDone,
}: {
  mode: 'create' | 'join';
  onClose: () => void;
  onDone: (teamId?: string) => void;
}) {
  const { teams, setTeams } = useTeamStore();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = value.trim();
    if (!val || busy) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'create') {
        const team = await teamApi.createTeam(val);
        const updated = await teamApi.getMyTeams();
        setTeams(updated);
        onDone(team.id);
      } else {
        await teamApi.acceptInvite(val);
        const updated = await teamApi.getMyTeams();
        const joined = updated.find((t: any) => !teams.find((old) => old.id === t.id));
        setTeams(updated);
        onDone(joined?.id);
      }
    } catch (err: any) {
      setError(err?.message || (mode === 'create' ? '创建失败' : '邀请码无效或已过期'));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/20 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-[0_20px_60px_rgba(15,23,42,0.18)] border border-slate-200 p-5 w-80"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800">
            {mode === 'create' ? '新建团队' : '使用邀请码加入'}
          </h3>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-slate-100 text-slate-400"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <input
            autoFocus
            className="w-full text-sm px-3 py-2 rounded-xl border border-slate-200 bg-white outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-all"
            placeholder={mode === 'create' ? '团队名称' : '粘贴邀请码或链接'}
            value={value}
            onChange={(e) => {
              let val = e.target.value;
              if (mode === 'join') {
                try {
                  const url = new URL(val.trim());
                  const code = url.searchParams.get('inviteCode');
                  if (code) val = code;
                } catch {}
              }
              setValue(val);
              setError('');
            }}
          />
          {mode === 'create' && (
            <p className="text-xs text-slate-400 mt-1.5">新建团队固定 2 席位起</p>
          )}
          {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}
          <div className="flex gap-2 mt-3">
            <Button
              type="submit"
              size="sm"
              disabled={busy || !value.trim()}
              className="flex-1 rounded-xl"
            >
              {busy ? '…' : mode === 'create' ? '创建' : '加入'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="rounded-xl text-slate-500"
            >
              取消
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function TeamProjectPickerModal({
  teamId,
  teamName,
  isPersonal,
  onConfirm,
  onCancel,
}: {
  teamId: string;
  teamName: string;
  isPersonal?: boolean;
  onConfirm: (projectId?: string) => void;
  onCancel: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const fetchFn = isPersonal ? projectApi.list() : projectApi.listByTeam(teamId);
    fetchFn
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, [teamId, isPersonal]);

  return createPortal(
    <div
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/20 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-[0_20px_60px_rgba(15,23,42,0.18)] border border-slate-200 p-5 w-96 max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h3 className="text-sm font-semibold text-slate-800">
            切换至 · <span className={isPersonal ? 'text-blue-500' : 'text-blue-600'}>{teamName}</span>
          </h3>
          <button
            onClick={onCancel}
            className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-slate-100 text-slate-400"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              <span className="text-sm">加载中…</span>
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-400">暂无项目</div>
          ) : (
            <div className="space-y-0.5">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onConfirm(p.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left hover:bg-slate-50 transition-colors group"
                >
                  <FolderOpen className="w-4 h-4 text-slate-400 shrink-0 group-hover:text-blue-500 transition-colors" />
                  <span className="text-sm text-slate-700 truncate flex-1">{p.name}</span>
                  <span className="text-xs text-slate-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">进入</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3 pt-3 border-t border-slate-100 shrink-0 flex items-center justify-between">
          <p className="text-xs text-slate-400">关闭此窗口将保留当前工作区</p>
          {!loading && (
            <button
              onClick={() => onConfirm(undefined)}
              className="text-xs text-blue-500 hover:text-blue-600 transition-colors"
            >
              直接进入
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function TeamSwitcher({ onManage, variant = 'header', className }: Props) {
  const { teams, activeTeamId, setActiveTeamId } = useTeamStore();
  const user = useAuthStore((s) => s.user);
  const projectStore = useProjectStore();
  const [modal, setModal] = useState<ActiveModal>('none');
  const [teamPickerTarget, setTeamPickerTarget] = useState<{ id: string; name: string; isPersonal?: boolean } | null>(null);

  const personalTeam = teams.find((t) => t.isPersonal);
  const orgTeams = teams.filter((t) => !t.isPersonal);
  const activeTeam = teams.find((t) => t.id === activeTeamId);
  const isPersonalActive = !activeTeam || activeTeam.isPersonal;

  const displayName = (() => {
    if (!activeTeam || activeTeam.isPersonal) {
      const name = (user as any)?.name || (user as any)?.phone || '个人';
      return name.length > 10 ? name.slice(0, 10) + '…' : name;
    }
    return activeTeam.name.length > 10 ? activeTeam.name.slice(0, 10) + '…' : activeTeam.name;
  })();

  const completeSwitchTeam = (teamId: string, projectId?: string) => {
    setActiveTeamId(teamId);
    window.dispatchEvent(new Event('refresh-credits'));
    setTimeout(() => {
      void projectStore.load().then(() => {
        if (projectId) projectStore.open(projectId);
      });
    }, 80);
  };

  const switchTeam = (teamId: string) => {
    if (teamId === activeTeamId) return;
    const target = teams.find((t) => t.id === teamId);
    if (!target) return;

    const displayName = target.isPersonal
      ? ((user as any)?.name || (user as any)?.phone || '个人工作区')
      : target.name;
    setTeamPickerTarget({ id: teamId, name: displayName, isPersonal: target.isPersonal });
  };

  const switchToPersonal = () => {
    if (personalTeam) switchTeam(personalTeam.id);
  };

  const handleTeamPickerConfirm = (projectId?: string) => {
    if (!teamPickerTarget) return;
    completeSwitchTeam(teamPickerTarget.id, projectId);
    setTeamPickerTarget(null);
  };

  const handleModalDone = (newTeamId?: string) => {
    setModal('none');
    if (newTeamId) switchTeam(newTeamId);
  };

  if (!user) return null;

  const triggerClass =
    variant === 'header'
      ? cn(
          'h-7 px-2 text-xs rounded-full border border-liquid-glass-light bg-liquid-glass-light backdrop-blur-minimal text-gray-700 hover:bg-liquid-glass-hover transition-all duration-200 flex items-center gap-1 max-w-[140px]',
          className,
        )
      : cn(
          'flex items-center gap-1.5 text-sm text-white/90 hover:text-white transition-colors bg-transparent border-none shadow-none p-0 h-auto',
          className,
        );

  const userName = (user as any)?.name || (user as any)?.phone || '个人账户';

  const menuContent = (
    <DropdownMenuContent
      align="end"
      sideOffset={8}
      className="w-60 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-md shadow-[0_12px_28px_rgba(15,23,42,0.12)] p-1.5"
    >
      {/* 个人账户 */}
      <DropdownMenuLabel className="px-3 py-1 text-[10px] text-slate-400 font-normal uppercase tracking-wide">
        个人账户
      </DropdownMenuLabel>
      <DropdownMenuItem
        onClick={switchToPersonal}
        className={cn(
          'rounded-xl px-3 py-2 cursor-pointer text-sm flex items-center gap-2',
          isPersonalActive ? 'bg-slate-100' : '',
        )}
      >
        <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
          <User className="w-3 h-3 text-blue-600" />
        </div>
        <span className="flex-1 truncate">{userName}</span>
        <span className="text-[10px] text-slate-400 shrink-0">个人</span>
        {isPersonalActive && (
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
        )}
      </DropdownMenuItem>

      {/* 团队账户 */}
      {orgTeams.length > 0 && (
        <>
          <DropdownMenuSeparator className="my-1" />
          <DropdownMenuLabel className="px-3 py-1 text-[10px] text-slate-400 font-normal uppercase tracking-wide">
            团队账户
          </DropdownMenuLabel>
          {orgTeams.map((team) => (
            <DropdownMenuItem
              key={team.id}
              onClick={() => switchTeam(team.id)}
              className={cn(
                'rounded-xl px-3 py-2 cursor-pointer text-sm flex items-center gap-2',
                team.id === activeTeamId ? 'bg-slate-100' : '',
              )}
            >
              <div className="w-5 h-5 rounded-lg bg-teal-100 flex items-center justify-center shrink-0">
                <Users className="w-3 h-3 text-teal-600" />
              </div>
              <span className="flex-1 truncate">{team.name}</span>
              {team.id === activeTeamId && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
              )}
            </DropdownMenuItem>
          ))}
        </>
      )}

      <DropdownMenuSeparator className="my-1" />

      {/* 当前活动团队的管理选项 */}
      {activeTeam && !activeTeam.isPersonal && onManage && (
        <DropdownMenuItem
          onClick={() => onManage(activeTeam.id)}
          className="rounded-xl px-3 py-2 cursor-pointer text-sm flex items-center gap-2 text-slate-600"
        >
          <Settings className="w-3.5 h-3.5" />
          管理团队
        </DropdownMenuItem>
      )}

      <DropdownMenuItem
        onClick={() => setModal('create')}
        className="rounded-xl px-3 py-2 cursor-pointer text-sm flex items-center gap-2 text-slate-600"
      >
        <Plus className="w-3.5 h-3.5" />
        新建团队
      </DropdownMenuItem>

      <DropdownMenuItem
        onClick={() => setModal('join')}
        className="rounded-xl px-3 py-2 cursor-pointer text-sm flex items-center gap-2 text-slate-600"
      >
        <LogIn className="w-3.5 h-3.5" />
        使用邀请码加入
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  return (
    <>
      {modal !== 'none' && (
        <TeamFormModal
          mode={modal}
          onClose={() => setModal('none')}
          onDone={handleModalDone}
        />
      )}

      {teamPickerTarget && (
        <TeamProjectPickerModal
          teamId={teamPickerTarget.id}
          teamName={teamPickerTarget.name}
          isPersonal={teamPickerTarget.isPersonal}
          onConfirm={handleTeamPickerConfirm}
          onCancel={() => setTeamPickerTarget(null)}
        />
      )}

      {variant === 'header' ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className={triggerClass}>
              {isPersonalActive
                ? <User className="w-3 h-3 shrink-0" />
                : <Users className="w-3 h-3 shrink-0" />
              }
              <span className="truncate">{displayName}</span>
              {isPersonalActive && (
                <span className="text-[10px] text-gray-400 shrink-0">个人</span>
              )}
              <ChevronDown className="w-3 h-3 shrink-0 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          {menuContent}
        </DropdownMenu>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger className={triggerClass}>
            {isPersonalActive
              ? <User className="w-3.5 h-3.5" />
              : <Users className="w-3.5 h-3.5" />
            }
            <span>{displayName}</span>
            {isPersonalActive && <span className="text-xs text-white/60">个人</span>}
            <ChevronDown className="w-3.5 h-3.5 opacity-70" />
          </DropdownMenuTrigger>
          {menuContent}
        </DropdownMenu>
      )}
    </>
  );
}
