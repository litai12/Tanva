import { fetchWithAuth } from "./authFetch";

const base =
  import.meta.env.VITE_API_BASE_URL && import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000";

export type MaterialKindDto = "character" | "scene" | "prop" | "style" | "text";

export interface MaterialAssetVersionDto {
  id: string;
  assetId: string;
  version: number;
  data: Record<string, unknown>;
  note: string | null;
  createdAt: string;
}

export interface MaterialAssetDto {
  id: string;
  teamId: string | null;
  folderId: string | null;
  kind: MaterialKindDto;
  name: string;
  favorite: boolean;
  currentVersion: number;
  latestVersion: MaterialAssetVersionDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialFolderDto {
  id: string;
  ownerId: string | null;
  teamId: string | null;
  name: string;
  createdAt: string;
}

/** 从素材资产读出可用图片 URL（imageUrl > url > thumbnailUrl）。 */
export function getAssetImageUrl(asset: MaterialAssetDto): string {
  const data = asset.latestVersion?.data as Record<string, unknown> | undefined;
  if (!data) return "";
  const pick = (key: string): string => {
    const value = data[key];
    return typeof value === "string" && value.trim() ? value.trim() : "";
  };
  return pick("imageUrl") || pick("url") || pick("thumbnailUrl");
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const d = await res.json();
      msg = d?.message || d?.error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

const headers = { "Content-Type": "application/json" } as const;

// ── personal assets ───────────────────────────────────────────────────────────

export async function listMaterialAssets(params?: {
  kind?: MaterialKindDto;
}): Promise<MaterialAssetDto[]> {
  const url = new URL(`${base}/api/material-library/assets`);
  if (params?.kind) url.searchParams.set("kind", params.kind);
  return json(await fetchWithAuth(url.toString()));
}

export async function createMaterialAsset(input: {
  kind: MaterialKindDto;
  name: string;
  initialData: Record<string, unknown>;
  folderId?: string;
}): Promise<MaterialAssetDto> {
  return json(
    await fetchWithAuth(`${base}/api/material-library/assets`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    })
  );
}

export async function updateMaterialAsset(
  assetId: string,
  patch: {
    name?: string;
    data?: Record<string, unknown>;
    favorite?: boolean;
    folderId?: string | null;
    kind?: MaterialKindDto;
  }
): Promise<MaterialAssetDto> {
  return json(
    await fetchWithAuth(
      `${base}/api/material-library/assets/${encodeURIComponent(assetId)}`,
      { method: "PATCH", headers, body: JSON.stringify(patch) }
    )
  );
}

export async function deleteMaterialAsset(assetId: string): Promise<void> {
  await json(
    await fetchWithAuth(
      `${base}/api/material-library/assets/${encodeURIComponent(assetId)}`,
      { method: "DELETE" }
    )
  );
}

// ── team assets ────────────────────────────────────────────────────────────────

export async function listTeamMaterialAssets(params: {
  teamId: string;
  kind?: MaterialKindDto;
}): Promise<MaterialAssetDto[]> {
  const url = new URL(`${base}/api/material-library/team-assets`);
  url.searchParams.set("teamId", params.teamId);
  if (params.kind) url.searchParams.set("kind", params.kind);
  return json(await fetchWithAuth(url.toString()));
}

export async function createTeamMaterialAsset(input: {
  teamId: string;
  kind: MaterialKindDto;
  name: string;
  initialData: Record<string, unknown>;
  folderId?: string;
}): Promise<MaterialAssetDto> {
  return json(
    await fetchWithAuth(`${base}/api/material-library/team-assets`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    })
  );
}

export async function updateTeamMaterialAsset(
  assetId: string,
  patch: {
    name?: string;
    data?: Record<string, unknown>;
    favorite?: boolean;
    folderId?: string | null;
    kind?: MaterialKindDto;
  }
): Promise<MaterialAssetDto> {
  return json(
    await fetchWithAuth(
      `${base}/api/material-library/team-assets/${encodeURIComponent(assetId)}`,
      { method: "PATCH", headers, body: JSON.stringify(patch) }
    )
  );
}

export async function deleteTeamMaterialAsset(assetId: string): Promise<void> {
  await json(
    await fetchWithAuth(
      `${base}/api/material-library/team-assets/${encodeURIComponent(assetId)}`,
      { method: "DELETE" }
    )
  );
}

// ── folders ─────────────────────────────────────────────────────────────────────

export async function listMaterialFolders(params?: {
  teamId?: string;
}): Promise<MaterialFolderDto[]> {
  const url = new URL(`${base}/api/material-library/folders`);
  if (params?.teamId) url.searchParams.set("teamId", params.teamId);
  return json(await fetchWithAuth(url.toString()));
}

export async function createMaterialFolder(input: {
  teamId?: string;
  name: string;
}): Promise<MaterialFolderDto> {
  return json(
    await fetchWithAuth(`${base}/api/material-library/folders`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    })
  );
}

export async function updateMaterialFolder(
  folderId: string,
  patch: { name: string }
): Promise<MaterialFolderDto> {
  return json(
    await fetchWithAuth(
      `${base}/api/material-library/folders/${encodeURIComponent(folderId)}`,
      { method: "PATCH", headers, body: JSON.stringify(patch) }
    )
  );
}

export async function deleteMaterialFolder(folderId: string): Promise<void> {
  await json(
    await fetchWithAuth(
      `${base}/api/material-library/folders/${encodeURIComponent(folderId)}`,
      { method: "DELETE" }
    )
  );
}
