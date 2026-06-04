import { fetchWithAuth } from "./authFetch";
import {
  loginNoticeHtmlToText,
  sanitizeLoginNoticeHtml,
} from "@/utils/loginNoticeRichText";

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
  contentHtml: string;
  mediaType: "image" | "video" | null;
  mediaUrl: string;
  posterUrl: string;
  primaryButtonText: string;
  primaryButtonUrl: string;
  secondaryButtonText: string;
  secondaryButtonUrl: string;
  secondaryButtonQrUrl: string;
  updatedAt: string | null;
}

const sanitizeNoticeUrl = (value: unknown) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^(?:javascript|data|blob):/i.test(trimmed)) return "";
  if (/^(?:https?:\/\/|\/)/i.test(trimmed)) return trimmed;
  return "";
};

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
  const contentHtml =
    typeof data?.contentHtml === "string" ? sanitizeLoginNoticeHtml(data.contentHtml) : "";
  const content =
    typeof data?.content === "string" && data.content.trim()
      ? data.content
      : loginNoticeHtmlToText(contentHtml);
  const mediaUrl = sanitizeNoticeUrl(data?.mediaUrl);
  const mediaType = mediaUrl ? (data?.mediaType === "video" ? "video" : "image") : null;
  return {
    enabled: data?.enabled === true,
    content,
    contentHtml,
    mediaType,
    mediaUrl,
    posterUrl: sanitizeNoticeUrl(data?.posterUrl),
    primaryButtonText:
      typeof data?.primaryButtonText === "string" ? data.primaryButtonText.trim() : "",
    primaryButtonUrl: sanitizeNoticeUrl(data?.primaryButtonUrl),
    secondaryButtonText:
      typeof data?.secondaryButtonText === "string" ? data.secondaryButtonText.trim() : "",
    secondaryButtonUrl: sanitizeNoticeUrl(data?.secondaryButtonUrl),
    secondaryButtonQrUrl: sanitizeNoticeUrl(data?.secondaryButtonQrUrl),
    updatedAt: typeof data?.updatedAt === "string" ? data.updatedAt : null,
  };
}
