import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface TeamInfo {
  id: string;
  name: string;
  isPersonal: boolean;
  myRole: 'owner' | 'admin' | 'member';
  memberCount: number;
  availableCredits: number;
}

interface TeamStore {
  teams: TeamInfo[];
  activeTeamId: string | null;
  setTeams: (teams: TeamInfo[]) => void;
  setActiveTeamId: (id: string | null) => void;
  getActiveTeam: () => TeamInfo | null;
  getPersonalTeam: () => TeamInfo | null;
  /** Patch a single team's availableCredits without reloading the whole list. */
  patchTeamCredits: (teamId: string, availableCredits: number) => void;
}

export const useTeamStore = create<TeamStore>()(
  persist(
    (set, get) => ({
      teams: [],
      activeTeamId: null,
      setTeams: (teams) => set({ teams }),
      setActiveTeamId: (id) => set({ activeTeamId: id }),
      getActiveTeam: () => get().teams.find((t) => t.id === get().activeTeamId) ?? null,
      getPersonalTeam: () => get().teams.find((t) => t.isPersonal) ?? null,
      patchTeamCredits: (teamId, availableCredits) => {
        const current = get().teams;
        const idx = current.findIndex((t) => t.id === teamId);
        if (idx < 0 || current[idx].availableCredits === availableCredits) return;
        const next = current.slice();
        next[idx] = { ...next[idx], availableCredits };
        set({ teams: next });
      },
    }),
    {
      name: 'tanva_active_team_id',
      // 持久化 teams 和 activeTeamId，确保 projectStore.load() 首次调用时
      // 就能正确判断上下文（避免 teams=[] 时误走个人路径的竞态条件）。
      partialize: (s) => ({ activeTeamId: s.activeTeamId, teams: s.teams }),
    },
  ),
);
