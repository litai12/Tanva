import React, { useEffect, useState } from 'react';
import { teamApi } from '../../services/teamApi';
import { useTeamStore } from '../../stores/teamStore';

interface Props {
  teamId: string;
  onClose: () => void;
}

export function TeamManagementModal({ teamId, onClose }: Props) {
  const { teams } = useTeamStore();
  const team = teams.find((t) => t.id === teamId);
  const [members, setMembers] = useState<any[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const myRole = team?.myRole;

  useEffect(() => {
    teamApi.getMembers(teamId).then(setMembers);
  }, [teamId]);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setLoading(true);
    try {
      const inv = await teamApi.createInvite(teamId, { email: inviteEmail, expiresInDays: 7 });
      alert(`邀请码：${inv.code}`);
      setInviteEmail('');
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (userId: string) => {
    if (!confirm('确认移除该成员？')) return;
    await teamApi.removeMember(teamId, userId);
    setMembers((prev) => prev.filter((m) => m.userId !== userId));
  };

  const handleRoleChange = async (userId: string, role: string) => {
    await teamApi.updateMemberRole(teamId, userId, role);
    setMembers((prev) => prev.map((m) => m.userId === userId ? { ...m, role } : m));
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, minWidth: 480, maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>{team?.name ?? '团队管理'}</h2>
          <button onClick={onClose}>✕</button>
        </div>

        <h3>成员列表</h3>
        {members.map((m) => (
          <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
            <img src={m.user?.avatarUrl ?? '/default-avatar.png'} alt="" style={{ width: 32, height: 32, borderRadius: '50%' }} />
            <span style={{ flex: 1 }}>{m.user?.name ?? m.userId}</span>
            <span style={{ fontSize: 12, color: '#888' }}>{m.role}</span>
            {(myRole === 'owner' || myRole === 'admin') && m.role !== 'owner' && (
              <>
                <select value={m.role} onChange={(e) => handleRoleChange(m.userId, e.target.value)} style={{ fontSize: 12 }}>
                  <option value="admin">admin</option>
                  <option value="member">member</option>
                </select>
                <button onClick={() => handleRemove(m.userId)} style={{ color: 'red', border: 'none', background: 'none', cursor: 'pointer' }}>移除</button>
              </>
            )}
          </div>
        ))}

        {!team?.isPersonal && (myRole === 'owner' || myRole === 'admin') && (
          <>
            <h3>邀请成员</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="邮箱或手机号"
                style={{ flex: 1, padding: '6px 10px', border: '1px solid #ddd', borderRadius: 6 }}
              />
              <button onClick={handleInvite} disabled={loading}>
                {loading ? '发送中...' : '发送邀请'}
              </button>
            </div>
          </>
        )}

        {!team?.isPersonal && myRole === 'owner' && (
          <div style={{ marginTop: 24, borderTop: '1px solid #fee', paddingTop: 16 }}>
            <button
              style={{ color: '#c00', border: '1px solid #c00', borderRadius: 6, padding: '6px 16px', background: 'transparent', cursor: 'pointer' }}
              onClick={async () => {
                if (!confirm('确认解散团队？此操作不可撤销。')) return;
                await teamApi.dissolveTeam(teamId);
                onClose();
              }}
            >
              解散团队
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
