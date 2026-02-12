import { fetchWithAuth } from "./authFetch";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  "http://localhost:4000";

const buildUrl = (path: string) => {
  const base = API_BASE.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return `${base}/${p}`;
};

async function request(path: string, options: RequestInit = {}) {
  const response = await fetchWithAuth(buildUrl(path), options);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "请求失败");
  }
  return response;
}

// 邀请记录
export interface InviteRecord {
  id: string;
  inviteeName: string;
  inviteePhone: string;
  createdAt: string;
  rewardStatus: "pending" | "rewarded";
  rewardAmount: number;
  rewardedAt: string | null;
}

// 推广统计
export interface ReferralStats {
  inviteCode: string;
  inviteLink: string;
  successfulInvites: number;
  totalEarnings: number;
  inviteRecords: InviteRecord[];
}

// 签到状态
export interface CheckInStatus {
  consecutiveDays: number;
  lastCheckInDate: string | null;
  canCheckIn: boolean;
  todayReward: number;
  weeklyBonus: number;
  rewards: number[];
}

// 签到结果
export interface CheckInResult {
  success: boolean;
  consecutiveDays: number;
  reward: number;
  newBalance: number;
  isWeeklyBonus: boolean;
}

// 获取推广统计
export async function getReferralStats(): Promise<ReferralStats> {
  const response = await request("/api/referral/stats");
  return response.json();
}

// 获取签到状态
export async function getCheckInStatus(): Promise<CheckInStatus> {
  const response = await request("/api/referral/check-in/status");
  return response.json();
}

// 执行签到
export async function checkIn(): Promise<CheckInResult> {
  const response = await request("/api/referral/check-in", {
    method: "POST",
  });
  return response.json();
}

// 验证邀请码
export async function validateInviteCode(
  code: string
): Promise<{ valid: boolean; inviterName?: string; message?: string }> {
  const response = await fetch(buildUrl(`/api/referral/validate-code?code=${encodeURIComponent(code)}`));
  return response.json();
}

// 使用邀请码
export async function useInviteCode(code: string): Promise<any> {
  const response = await request("/api/referral/use-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  return response.json();
}
