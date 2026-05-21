import { fetchWithAuth } from './authFetch';

const base =
  import.meta.env.VITE_API_BASE_URL && import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const d = await res.json(); msg = d?.message || d?.error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const teamApi = {
  getMyTeams: () => fetchWithAuth(`${base}/api/teams`).then((r) => json<any[]>(r)),
  createTeam: (name: string) =>
    fetchWithAuth(`${base}/api/teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then((r) => json<any>(r)),
  dissolveTeam: (teamId: string) =>
    fetchWithAuth(`${base}/api/teams/${teamId}`, { method: 'DELETE' }).then((r) => json<any>(r)),
  getMembers: (teamId: string) =>
    fetchWithAuth(`${base}/api/teams/${teamId}/members`).then((r) => json<any[]>(r)),
  updateMemberRole: (teamId: string, userId: string, role: string) =>
    fetchWithAuth(`${base}/api/teams/${teamId}/members/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    }).then((r) => json<any>(r)),
  removeMember: (teamId: string, userId: string) =>
    fetchWithAuth(`${base}/api/teams/${teamId}/members/${userId}`, { method: 'DELETE' }).then((r) => json<any>(r)),
  setMemberQuota: (teamId: string, userId: string, quota: { monthly?: number | null; total?: number | null }) =>
    fetchWithAuth(`${base}/api/teams/${teamId}/members/${userId}/quota`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(quota),
    }).then((r) => json<any>(r)),
  createInvite: (teamId: string, data: { email?: string; phone?: string; expiresInDays?: number }) =>
    fetchWithAuth(`${base}/api/teams/${teamId}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => json<any>(r)),
  revokeInvite: (teamId: string, inviteId: string) =>
    fetchWithAuth(`${base}/api/teams/${teamId}/invites/${inviteId}`, { method: 'DELETE' }).then((r) => json<any>(r)),
  getInviteInfo: (code: string) =>
    fetchWithAuth(`${base}/api/invites/${code}`).then((r) => json<{ teamId: string; teamName: string; expiresAt: string | null }>(r)),
  acceptInvite: (code: string) =>
    fetchWithAuth(`${base}/api/invites/${code}/accept`, { method: 'POST' }).then((r) => json<any>(r)),
  transferOwnership: (teamId: string, newOwnerId: string) =>
    fetchWithAuth(`${base}/api/teams/${teamId}/transfer-ownership`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newOwnerId }),
    }).then((r) => json<any>(r)),
};
