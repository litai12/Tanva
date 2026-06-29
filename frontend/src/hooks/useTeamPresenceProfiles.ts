import { useEffect, useMemo, useState } from 'react';
import { teamApi } from '@/services/teamApi';
import { useTeamStore } from '@/stores/teamStore';
import { useAuthStore } from '@/stores/authStore';
import type { PresenceUser } from '@/collab/types';

export function useTeamPresenceProfiles(): Record<string, Pick<PresenceUser, 'name' | 'avatarUrl'>> {
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const activeTeam = useTeamStore((s) => s.getActiveTeam());
  const currentUser = useAuthStore((s) => s.user);
  const [profiles, setProfiles] = useState<Record<string, Pick<PresenceUser, 'name' | 'avatarUrl'>>>({});

  useEffect(() => {
    if (!activeTeamId || activeTeam?.isPersonal) {
      setProfiles({});
      return;
    }
    let cancelled = false;
    const load = () => teamApi
      .getMembers(activeTeamId)
      .then((rows) => {
        if (cancelled) return;
        const next: Record<string, Pick<PresenceUser, 'name' | 'avatarUrl'>> = {};
        for (const row of Array.isArray(rows) ? rows : []) {
          const user = row?.user;
          if (!user?.id) continue;
          next[user.id] = {
            name: user.name ?? user.id.slice(0, 8),
            avatarUrl: user.avatarUrl ?? null,
          };
        }
        setProfiles(next);
      })
      .catch(() => undefined);
    void load();
    const onProfileUpdated = () => {
      void load();
    };
    window.addEventListener('tanva:profile-updated', onProfileUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener('tanva:profile-updated', onProfileUpdated);
    };
  }, [activeTeamId, activeTeam?.isPersonal]);

  return useMemo(() => {
    if (!currentUser?.id) return profiles;
    return {
      ...profiles,
      [currentUser.id]: {
        name: currentUser.name ?? currentUser.id.slice(0, 8),
        avatarUrl: currentUser.avatarUrl ?? null,
      },
    };
  }, [profiles, currentUser?.id, currentUser?.name, currentUser?.avatarUrl]);
}
