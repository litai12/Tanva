import React, { useEffect, useState } from 'react';
import { useTeamStore } from '../../stores/teamStore';
import { teamApi } from '../../services/teamApi';

export function TeamSwitcher() {
  const { teams, activeTeamId, setTeams, setActiveTeamId } = useTeamStore();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    teamApi.getMyTeams().then(setTeams).catch(() => {});
  }, [setTeams]);

  const activeTeam = teams.find((t) => t.id === activeTeamId);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setOpen((v) => !v)}>
        {activeTeam?.name ?? '选择工作区'} ▾
      </button>

      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, background: '#fff', border: '1px solid #eee', borderRadius: 8, minWidth: 200, zIndex: 100, boxShadow: '0 4px 16px rgba(0,0,0,.12)' }}>
          {teams.map((t) => (
            <button
              key={t.id}
              style={{ display: 'block', width: '100%', padding: '8px 16px', textAlign: 'left', background: t.id === activeTeamId ? '#f0f4ff' : 'transparent', border: 'none', cursor: 'pointer' }}
              onClick={() => { setActiveTeamId(t.id); setOpen(false); }}
            >
              {t.name}
              {t.isPersonal && <span style={{ fontSize: 11, color: '#888', marginLeft: 6 }}>个人</span>}
            </button>
          ))}
          <hr style={{ margin: '4px 0' }} />
          <button
            style={{ display: 'block', width: '100%', padding: '8px 16px', textAlign: 'left', border: 'none', cursor: 'pointer' }}
            onClick={() => {
              const name = prompt('团队名称');
              if (name) teamApi.createTeam(name).then((t) => { teamApi.getMyTeams().then(setTeams); setActiveTeamId(t.id); });
              setOpen(false);
            }}
          >
            + 新建团队
          </button>
        </div>
      )}
    </div>
  );
}
