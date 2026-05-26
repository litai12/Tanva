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

export const teamCreditsApi = {
  getAccount: (teamId: string) =>
    fetchWithAuth(`${base}/api/teams/${teamId}/credits`).then((r) => json<any>(r)),
  getLedger: (teamId: string, take = 50, skip = 0) =>
    fetchWithAuth(`${base}/api/teams/${teamId}/credits/ledger?take=${take}&skip=${skip}`).then((r) => json<any>(r)),
  getMemberUsages: (teamId: string) =>
    fetchWithAuth(`${base}/api/teams/${teamId}/credits/members`).then((r) => json<any[]>(r)),
  setMemberQuota: (teamId: string, userId: string, quota: number | null) =>
    fetchWithAuth(`${base}/api/teams/${teamId}/members/${userId}/quota`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quota }),
    }).then((r) => json<any>(r)),
};

export const teamSubscriptionApi = {
  listPlans: () =>
    fetchWithAuth(`${base}/api/team-plans`).then((r) => json<any[]>(r)),
  getSubscription: (teamId: string) =>
    fetchWithAuth(`${base}/api/teams/${teamId}/subscription`).then((r) => json<any>(r)),
  createSubscription: (teamId: string, data: { planId: string; billingCycle: string; seatCount: number }) =>
    fetchWithAuth(`${base}/api/teams/${teamId}/subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => json<any>(r)),
  cancelSubscription: (teamId: string) =>
    fetchWithAuth(`${base}/api/teams/${teamId}/subscription`, { method: 'DELETE' }).then((r) => json<any>(r)),
};

export const teamSeatPackageApi = {
  createOrder: (
    teamId: string,
    body: { seats: number; cycle: 'monthly' | 'annual'; paymentMethod: string },
  ) =>
    fetchWithAuth(`${base}/api/teams/${teamId}/seat-packages/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<any>(r)),

  listPackages: (teamId: string) =>
    fetchWithAuth(`${base}/api/teams/${teamId}/seat-packages`).then((r) => json<any>(r)),
};
