import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTeamStore } from '../../stores/teamStore';
import { useAuthStore } from '../../stores/authStore';
import { teamApi } from '../../services/teamApi';
import { useProjectStore } from '../../stores/projectStore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ChevronDown, Users, Plus, Settings, LogIn, X } from 'lucide-react';
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
            placeholder={mode === 'create' ? '团队名称' : '粘贴邀请码'}
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(''); }}
          />
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

export function TeamSwitcher({ onManage, variant = 'header', className }: Props) {
  const { teams, activeTeamId, setActiveTeamId } = useTeamStore();
  const user = useAuthStore((s) => s.user);
  const loadProjects = useProjectStore((s) => s.load);
  const [modal, setModal] = useState<ActiveModal>('none');

  const activeTeam = teams.find((t) => t.id === activeTeamId);
  const displayName = (() => {
    if (!activeTeam) return '工作区';
    return activeTeam.name.length > 10 ? activeTeam.name.slice(0, 10) + '…' : activeTeam.name;
  })();

  const switchTeam = (teamId: string) => {
    setActiveTeamId(teamId);
    setTimeout(() => loadProjects(), 80);
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

  const menuContent = (
    <DropdownMenuContent
      align="end"
      sideOffset={8}
      className="w-56 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-md shadow-[0_12px_28px_rgba(15,23,42,0.12)] p-1.5"
    >
      <DropdownMenuLabel className="px-3 py-1 text-xs text-slate-400 font-normal">
        切换工作区
      </DropdownMenuLabel>

      {teams.map((team) => (
        <DropdownMenuItem
          key={team.id}
          onClick={() => switchTeam(team.id)}
          className={cn(
            'rounded-xl px-3 py-2 cursor-pointer text-sm flex items-center gap-2',
            team.id === activeTeamId ? 'bg-slate-100' : '',
          )}
        >
          <span className="flex-1 truncate">{team.name}</span>
          {team.isPersonal && <span className="text-[10px] text-slate-400">个人</span>}
          {team.id === activeTeamId && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
          )}
        </DropdownMenuItem>
      ))}

      <DropdownMenuSeparator className="my-1" />

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

      {variant === 'header' ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className={triggerClass}>
              <Users className="w-3 h-3 shrink-0" />
              <span className="truncate">{displayName}</span>
              {activeTeam?.isPersonal && (
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
            <Users className="w-3.5 h-3.5" />
            <span>{displayName}</span>
            {activeTeam?.isPersonal && <span className="text-xs text-white/60">个人</span>}
            <ChevronDown className="w-3.5 h-3.5 opacity-70" />
          </DropdownMenuTrigger>
          {menuContent}
        </DropdownMenu>
      )}
    </>
  );
}
