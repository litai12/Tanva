import React, { useState } from 'react';
import { useTeamStore } from '../../stores/teamStore';
import { useAuthStore } from '../../stores/authStore';
import { teamApi } from '../../services/teamApi';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ChevronDown, Users, Plus, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  onManage?: (teamId: string) => void;
  /** 'header' for canvas workspace header; 'home' for landing page header */
  variant?: 'header' | 'home';
  className?: string;
}

export function TeamSwitcher({ onManage, variant = 'header', className }: Props) {
  const { teams, activeTeamId, setTeams, setActiveTeamId } = useTeamStore();
  const user = useAuthStore((s) => s.user);
  const [newTeamName, setNewTeamName] = useState('');
  const [creating, setCreating] = useState(false);

  const activeTeam = teams.find((t) => t.id === activeTeamId);
  const displayName = (() => {
    if (!activeTeam) return '工作区';
    return activeTeam.name.length > 10 ? activeTeam.name.slice(0, 10) + '…' : activeTeam.name;
  })();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newTeamName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const team = await teamApi.createTeam(name);
      const updated = await teamApi.getMyTeams();
      setTeams(updated);
      setActiveTeamId(team.id);
      setNewTeamName('');
    } finally {
      setCreating(false);
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
          onClick={() => setActiveTeamId(team.id)}
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
        <>
          <DropdownMenuItem
            onClick={() => onManage(activeTeam.id)}
            className="rounded-xl px-3 py-2 cursor-pointer text-sm flex items-center gap-2 text-slate-600"
          >
            <Settings className="w-3.5 h-3.5" />
            管理团队
          </DropdownMenuItem>
          <DropdownMenuSeparator className="my-1" />
        </>
      )}

      {/* inline create-team form — stopPropagation prevents dropdown from closing on input click */}
      <form onSubmit={handleCreate} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1 px-3 py-1.5 rounded-xl hover:bg-slate-50 cursor-text">
          <Plus className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <input
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400 min-w-0"
            placeholder="新建团队…"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
          />
          {newTeamName.trim() && (
            <button
              type="submit"
              disabled={creating}
              className="text-xs text-blue-600 hover:text-blue-700 shrink-0 font-medium disabled:opacity-50"
            >
              {creating ? '…' : '创建'}
            </button>
          )}
        </div>
      </form>
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
