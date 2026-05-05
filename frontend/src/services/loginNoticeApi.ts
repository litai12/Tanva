import { fetchWithAuth } from "./authFetch";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  "http://localhost:4000";

const buildUrl = (path: string) => {
  const base = API_BASE.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return `${base}/${p}`;
};

export interface LoginNotice {
  enabled: boolean;
  content: string;
  updatedAt: string | null;
}

export async function getLoginNotice(): Promise<LoginNotice> {
  const response = await fetchWithAuth(buildUrl("/api/settings/login-notice"), {
    auth: "omit",
    allowRefresh: false,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "获取登录提醒失败");
  }

  const data = await response.json().catch(() => ({}));
  return {
    enabled: data?.enabled === true,
    content: typeof data?.content === "string" ? data.content : "",
    updatedAt: typeof data?.updatedAt === "string" ? data.updatedAt : null,
  };
}
