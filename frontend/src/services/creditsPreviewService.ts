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
