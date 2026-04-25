import { fetchWithAuth } from "./authFetch";
import { getApiBaseUrl } from "../utils/assetProxy";

export type BioAuthStatus = "processing" | "active" | "failed";

export interface StartBioAuthResult {
  taskId: string;
  h5Link: string;
}

export interface BioAuthStatusResult {
  status: BioAuthStatus;
  errorMessage?: string;
  assetId?: string;
  groupId?: string;
}

export interface BioAuthGroupItem {
  groupId: string;
  imageUrl: string;
  createdAt: string;
}

export interface ListGroupsResult {
  groups: BioAuthGroupItem[];
}

export interface CreateAssetInGroupResult {
  taskId: string;
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

export async function listBioAuthGroups(): Promise<ListGroupsResult> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetchWithAuth(`${apiBaseUrl}/api/bio-auth/groups`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

export async function createAssetInGroup(
  groupId: string,
  imageUrl: string,
): Promise<CreateAssetInGroupResult> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetchWithAuth(`${apiBaseUrl}/api/bio-auth/asset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupId, imageUrl }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error((error as { message?: string }).message || `HTTP ${response.status}`);
  }
  return response.json();
}
