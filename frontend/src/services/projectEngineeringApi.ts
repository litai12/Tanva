import { fetchWithAuth } from './authFetch';

const base = () => (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const parse = async <T>(response: Response): Promise<T> => {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.message || `工程状态请求失败（${response.status}）`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return body as T;
};

export type EngineeringStateResponse = { projectId: string; state: Record<string, unknown>; version: number; updatedAt: string | null };

export async function getProjectEngineering(projectId: string): Promise<EngineeringStateResponse> {
  return parse(await fetchWithAuth(`${base()}/api/projects/${encodeURIComponent(projectId)}/engineering`));
}

export async function saveProjectEngineering(projectId: string, state: Record<string, unknown>, version?: number): Promise<EngineeringStateResponse> {
  return parse(await fetchWithAuth(`${base()}/api/projects/${encodeURIComponent(projectId)}/engineering`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, version }),
  }));
}

/** Append a bounded operation receipt without placing local paths or binary data in design JSON. */
export async function recordEngineeringOperation(projectId: string, operation: Record<string, unknown>) {
  const safe = JSON.parse(JSON.stringify(operation, (_key, value) => typeof value === 'string' && value.length > 1_000 ? value.slice(0, 1_000) : value));
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await getProjectEngineering(projectId);
    const operations = Array.isArray(current.state.operations) ? current.state.operations.slice(-999) : [];
    try {
      return await saveProjectEngineering(projectId, { ...current.state, operations: [...operations, safe] }, current.version);
    } catch (error) {
      lastError = error;
      if ((error as Error & { status?: number })?.status !== 409 || attempt === 2) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('工程操作回执写入失败');
}
