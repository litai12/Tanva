import { fetchWithAuth } from "./authFetch";
import type {
  PersonalLibraryAsset,
  PersonalAssetType,
} from "@/stores/personalLibraryStore";

const viteEnv =
  typeof import.meta !== "undefined" && (import.meta as any).env
    ? (import.meta as any).env
    : undefined;

const base =
  viteEnv?.VITE_API_BASE_URL && viteEnv.VITE_API_BASE_URL.trim().length > 0
    ? viteEnv.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const d = await res.json();
      msg = d?.message || d?.error || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const personalLibraryApi = {
  async list(type?: PersonalAssetType): Promise<PersonalLibraryAsset[]> {
    const url = new URL(`${base}/api/personal-library/assets`);
    if (type) url.searchParams.set("type", type);
    const res = await fetchWithAuth(url.toString());
    return json<PersonalLibraryAsset[]>(res);
  },
  async upsert(asset: PersonalLibraryAsset): Promise<PersonalLibraryAsset> {
    const res = await fetchWithAuth(`${base}/api/personal-library/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ asset }),
    });
    return json<PersonalLibraryAsset>(res);
  },
  async patch(
    id: string,
    patch: Partial<PersonalLibraryAsset>
  ): Promise<PersonalLibraryAsset> {
    const res = await fetchWithAuth(
      `${base}/api/personal-library/assets/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch }),
      }
    );
    return json<PersonalLibraryAsset>(res);
  },
  async remove(id: string): Promise<{ ok: boolean }> {
    const res = await fetchWithAuth(
      `${base}/api/personal-library/assets/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
      }
    );
    return json<{ ok: boolean }>(res);
  },
};
