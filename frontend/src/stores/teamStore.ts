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
    }),
    {
      name: 'tanva_active_team_id',
      partialize: (s) => ({ activeTeamId: s.activeTeamId }),
    },
  ),
);
