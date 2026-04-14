import { fetchWithAuth } from "./authFetch";
import { getApiBaseUrl } from "@/utils/assetProxy";

export type CreditsPreviewRequest = {
  serviceType: string;
  model?: string;
  requestParams?: Record<string, any>;
};

export type CreditsPreviewResponse = {
  serviceType: string;
  serviceName: string;
  provider: string | null;
  model: string | null;
  credits: number;
  balance: number;
  sufficient: boolean;
  managedPricing?: {
    source?: string;
    vendorKey?: string;
    ruleKey?: string;
    label?: string;
    evaluatorKey?: string;
    evaluatorType?: string;
    pricingVersion?: string;
    price?: {
      credits?: number;
      priceYuan?: number;
      costYuan?: number;
    };
  } | null;
  requestParams?: Record<string, any> | null;
};

export const stableSerializePreviewPayload = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerializePreviewPayload(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerializePreviewPayload(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export const buildPreviewRequestSignature = (payload: CreditsPreviewRequest): string =>
  stableSerializePreviewPayload({
    serviceType: payload.serviceType,
    model: payload.model || null,
    requestParams: payload.requestParams || null,
  });

export async function previewCredits(
  payload: CreditsPreviewRequest
): Promise<CreditsPreviewResponse> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetchWithAuth(`${apiBaseUrl}/api/credits/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text().catch(() => "");
    throw new Error(error || `HTTP ${response.status}`);
  }

  return response.json();
}
