import { fetchWithAuth } from "./authFetch";
import { getApiBaseUrl } from "@/utils/assetProxy";

export type CreditsPreviewRequest = {
  serviceType: string;
  model?: string;
  requestParams?: Record<string, any>;
  outputImageCount?: number;
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
    outputImageCount: payload.outputImageCount ?? null,
  });

const PREVIEW_CACHE_TTL_MS = 30000;
const previewResponseCache = new Map<
  string,
  { expiresAt: number; value: CreditsPreviewResponse }
>();
const previewInflightCache = new Map<string, Promise<CreditsPreviewResponse>>();

// --- Micro-batch layer ---
// Requests arriving within BATCH_WINDOW_MS are merged into one POST /preview/batch call.
const BATCH_WINDOW_MS = 20;

type PendingItem = {
  payload: CreditsPreviewRequest;
  resolve: (v: CreditsPreviewResponse) => void;
  reject: (e: unknown) => void;
};

let batchQueue: PendingItem[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

async function flushBatch() {
  batchTimer = null;
  const items = batchQueue;
  batchQueue = [];

  // De-duplicate by signature; items sharing a signature share one slot.
  const sigToItems = new Map<string, PendingItem[]>();
  for (const item of items) {
    const sig = buildPreviewRequestSignature(item.payload);
    const group = sigToItems.get(sig);
    if (group) {
      group.push(item);
    } else {
      sigToItems.set(sig, [item]);
    }
  }

  // Unique payloads to send.
  const uniqueSignatures = [...sigToItems.keys()];
  const uniquePayloads = uniqueSignatures.map((sig) => sigToItems.get(sig)![0].payload);

  const apiBaseUrl = getApiBaseUrl();
  try {
    const response = await fetchWithAuth(`${apiBaseUrl}/api/credits/preview/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: uniquePayloads }),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => "");
      throw new Error(error || `HTTP ${response.status}`);
    }

    const results = (await response.json()) as CreditsPreviewResponse[];

    uniqueSignatures.forEach((sig, idx) => {
      const result = results[idx];
      previewResponseCache.set(sig, { value: result, expiresAt: Date.now() + PREVIEW_CACHE_TTL_MS });
      previewInflightCache.delete(sig);
      sigToItems.get(sig)!.forEach((item) => item.resolve(result));
    });
  } catch (err) {
    uniqueSignatures.forEach((sig) => {
      previewInflightCache.delete(sig);
      sigToItems.get(sig)!.forEach((item) => item.reject(err));
    });
  }
}

function enqueuePreview(payload: CreditsPreviewRequest): Promise<CreditsPreviewResponse> {
  return new Promise((resolve, reject) => {
    batchQueue.push({ payload, resolve, reject });
    if (!batchTimer) {
      batchTimer = setTimeout(flushBatch, BATCH_WINDOW_MS);
    }
  });
}

export async function previewCredits(
  payload: CreditsPreviewRequest
): Promise<CreditsPreviewResponse> {
  const signature = buildPreviewRequestSignature(payload);
  const now = Date.now();

  const cached = previewResponseCache.get(signature);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const inflight = previewInflightCache.get(signature);
  if (inflight) {
    return inflight;
  }

  const promise = enqueuePreview(payload);
  previewInflightCache.set(signature, promise);
  return promise;
}
