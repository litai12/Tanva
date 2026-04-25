import { fetchWithAuth } from "./authFetch";
import { getApiBaseUrl } from "../utils/assetProxy";

export type BioAuthStatus = "processing" | "active" | "failed";

export interface StartBioAuthResult {
  taskId: string;
}

export interface BioAuthStatusResult {
  status: BioAuthStatus;
  errorMessage?: string;
}

export async function startBioAuth(imageUrl: string): Promise<StartBioAuthResult> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetchWithAuth(`${apiBaseUrl}/api/bio-auth/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error((error as { message?: string }).message || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function getBioAuthStatus(taskId: string): Promise<BioAuthStatusResult> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetchWithAuth(
    `${apiBaseUrl}/api/bio-auth/${encodeURIComponent(taskId)}/status`
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error((error as { message?: string }).message || `HTTP ${response.status}`);
  }
  return response.json();
}
