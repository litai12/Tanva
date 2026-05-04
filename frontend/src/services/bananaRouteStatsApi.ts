import { fetchWithAuth } from "./authFetch";
import { getApiBaseUrl } from "@/utils/assetProxy";
import type { BananaImageRoute } from "@/types/ai";

export type BananaRouteSuccessRateStats = {
  route: BananaImageRoute;
  totalCalls: number;
  completedCalls: number;
  successfulCalls: number;
  failedCalls: number;
  pendingCalls: number;
  successRate: number | null;
};

export type BananaRouteSuccessRatesResponse = {
  startAt: string;
  endAt: string;
  timezoneOffsetMinutes: number;
  routes: Record<BananaImageRoute, BananaRouteSuccessRateStats>;
};

export async function getBananaRouteSuccessRates(): Promise<BananaRouteSuccessRatesResponse> {
  const timezoneOffsetMinutes =
    typeof Date !== "undefined" ? new Date().getTimezoneOffset() : 0;
  const params = new URLSearchParams({
    timezoneOffsetMinutes: String(timezoneOffsetMinutes),
  });
  const response = await fetchWithAuth(
    `${getApiBaseUrl()}/api/ai/banana-route-success-rates?${params.toString()}`
  );
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(errorText || `HTTP ${response.status}`);
  }
  return response.json() as Promise<BananaRouteSuccessRatesResponse>;
}
