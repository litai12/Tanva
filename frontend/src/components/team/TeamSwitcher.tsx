import React, { useState } from 'react';
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
import { ChevronDown, Users, Plus, Settings, LogIn } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  onManage?: (teamId: string) => void;
  /** 'header' for canvas workspace header; 'home' for landing page header */
  variant?: 'header' | 'home';
  className?: string;
}

type CreateMode = 'none' | 'create' | 'join';

export function TeamSwitcher({ onManage, variant = 'header', className }: Props) {
  const { teams, activeTeamId, setTeams, setActiveTeamId } = useTeamStore();
  const user = useAuthStore((s) => s.user);
  const loadProjects = useProjectStore((s) => s.load);
  const [mode, setMode] = useState<CreateMode>('none');
  const [inputVal, setInputVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [joinError, setJoinError] = useState('');

  const activeTeam = teams.find((t) => t.id === activeTeamId);
  const displayName = (() => {
    if (!activeTeam) return '工作区';
    return activeTeam.name.length > 10 ? activeTeam.name.slice(0, 10) + '…' : activeTeam.name;
  })();

  const switchTeam = (teamId: string) => {
    setActiveTeamId(teamId);
    // reload project list so team-shared projects appear immediately
    setTimeout(() => loadProjects(), 80);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = inputVal.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const team = await teamApi.createTeam(name);
      const updated = await teamApi.getMyTeams();
      setTeams(updated);
      switchTeam(team.id);
      setInputVal('');
      setMode('none');
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = inputVal.trim();
    if (!code || busy) return;
    setBusy(true);
    setJoinError('');
    try {
      await teamApi.acceptInvite(code);
      const updated = await teamApi.getMyTeams();
      setTeams(updated);
      // switch to the newly joined team
      const joined = updated.find((t: any) => !teams.find((old) => old.id === t.id));
      if (joined) switchTeam(joined.id);
      setInputVal('');
      setMode('none');
    } catch (err: any) {
      setJoinError(err?.message || '邀请码无效或已过期');
    } finally {
      setBusy(false);
    }
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

  const inlineForm = (
    <form
      onSubmit={mode === 'create' ? handleCreate : handleJoin}
      onClick={(e) => e.stopPropagation()}
      className="px-3 py-2"
    >
      <input
        autoFocus
        className="w-full text-sm px-2 py-1.5 rounded-lg border border-slate-200 bg-white outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
        placeholder={mode === 'create' ? '输入团队名称…' : '粘贴邀请码…'}
        value={inputVal}
        onChange={(e) => { setInputVal(e.target.value); setJoinError(''); }}
      />
      {joinError && <p className="text-xs text-red-500 mt-1">{joinError}</p>}
      <div className="flex gap-2 mt-2">
        <button
          type="submit"
          disabled={busy || !inputVal.trim()}
          className="flex-1 text-xs bg-slate-800 text-white rounded-lg py-1.5 hover:bg-slate-700 disabled:opacity-40 font-medium"
        >
          {busy ? '…' : mode === 'create' ? '创建' : '加入'}
        </button>
        <button
          type="button"
          onClick={() => { setMode('none'); setInputVal(''); setJoinError(''); }}
          className="text-xs text-slate-400 hover:text-slate-600 px-2"
        >
          取消
        </button>
      </div>
    </form>
  );

  const menuContent = (
    <DropdownMenuContent
      align="end"
      sideOffset={8}
      className="w-56 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-md shadow-[0_12px_28px_rgba(15,23,42,0.12)] p-1.5"
    >
      {mode !== 'none' ? (
        inlineForm
      ) : (
        <>
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
            onSelect={(e) => { e.preventDefault(); setMode('create'); setInputVal(''); }}
            className="rounded-xl px-3 py-2 cursor-pointer text-sm flex items-center gap-2 text-slate-600"
          >
            <Plus className="w-3.5 h-3.5" />
            新建团队
          </DropdownMenuItem>

          <DropdownMenuItem
            onSelect={(e) => { e.preventDefault(); setMode('join'); setInputVal(''); }}
            className="rounded-xl px-3 py-2 cursor-pointer text-sm flex items-center gap-2 text-slate-600"
          >
            <LogIn className="w-3.5 h-3.5" />
            使用邀请码加入
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  );

  if (variant === 'header') {
    return (
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
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={triggerClass}>
        <Users className="w-3.5 h-3.5" />
        <span>{displayName}</span>
        {activeTeam?.isPersonal && <span className="text-xs text-white/60">个人</span>}
        <ChevronDown className="w-3.5 h-3.5 opacity-70" />
      </DropdownMenuTrigger>
      {menuContent}
    </DropdownMenu>
  );
}
