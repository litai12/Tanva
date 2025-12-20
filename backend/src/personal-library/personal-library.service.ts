import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OssService } from '../oss/oss.service';

export type PersonalLibraryAssetType = '2d' | '3d';

export type PersonalLibraryAsset = {
  id: string;
  type: PersonalLibraryAssetType;
  name: string;
  url: string;
  thumbnail?: string;
  fileName?: string;
  fileSize?: number;
  contentType?: string;
  createdAt: number;
  updatedAt: number;
  width?: number;
  height?: number;
  // 3D specific
  format?: string;
  key?: string;
  path?: string;
  defaultScale?: { x: number; y: number; z: number };
  defaultRotation?: { x: number; y: number; z: number };
  camera?: unknown;
};

type PersonalLibrarySnapshot = {
  version: 1;
  updatedAt: string;
  assets: PersonalLibraryAsset[];
};

const SNAPSHOT_VERSION = 1 as const;

const ALLOWED_KEYS: Array<keyof PersonalLibraryAsset> = [
  'id',
  'type',
  'name',
  'url',
  'thumbnail',
  'fileName',
  'fileSize',
  'contentType',
  'createdAt',
  'updatedAt',
  'width',
  'height',
  'format',
  'key',
  'path',
  'defaultScale',
  'defaultRotation',
  'camera',
];

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isAssetType(value: unknown): value is PersonalLibraryAssetType {
  return value === '2d' || value === '3d';
}

@Injectable()
export class PersonalLibraryService {
  constructor(private readonly oss: OssService) {}

  private key(userId: string): string {
    return `personal-library/${userId}/assets.json`;
  }

  private sanitizeAssetForUpsert(input: Record<string, unknown>, now: number): PersonalLibraryAsset {
    const id = toNonEmptyString(input.id);
    const typeRaw = input.type;
    const url = toNonEmptyString(input.url);
    const name = toNonEmptyString(input.name) || '未命名资源';

    if (!id) throw new BadRequestException('asset.id 不能为空');
    if (!isAssetType(typeRaw)) throw new BadRequestException('asset.type 必须为 2d 或 3d');
    if (!url) throw new BadRequestException('asset.url 不能为空');

    const base: PersonalLibraryAsset = {
      id,
      type: typeRaw,
      name,
      url,
      createdAt: toFiniteNumber(input.createdAt) ?? now,
      updatedAt: toFiniteNumber(input.updatedAt) ?? now,
    };

    const output: Record<string, unknown> = { ...base };
    for (const key of ALLOWED_KEYS) {
      if (key in output) continue;
      if (!(key in input)) continue;
      const value = (input as any)[key];
      if (value === undefined) continue;
      output[key] = value;
    }

    return output as PersonalLibraryAsset;
  }

  private sanitizePatch(input: Record<string, unknown>, now: number): Partial<PersonalLibraryAsset> {
    const output: Record<string, unknown> = {};
    for (const key of ALLOWED_KEYS) {
      if (!(key in input)) continue;
      const value = (input as any)[key];
      if (value === undefined) continue;
      // patch 不允许更改 id
      if (key === 'id') continue;
      output[key] = value;
    }
    if (output.updatedAt === undefined) {
      output.updatedAt = now;
    }
    return output as Partial<PersonalLibraryAsset>;
  }

  private normalizeLoadedAsset(input: unknown): PersonalLibraryAsset | null {
    if (!input || typeof input !== 'object') return null;
    const obj = input as Record<string, unknown>;
    const id = toNonEmptyString(obj.id);
    const typeRaw = obj.type;
    const url = toNonEmptyString(obj.url);
    const name = toNonEmptyString(obj.name) || '未命名资源';
    if (!id || !isAssetType(typeRaw) || !url) return null;

    const now = Date.now();
    const createdAt = toFiniteNumber(obj.createdAt) ?? now;
    const updatedAt = toFiniteNumber(obj.updatedAt) ?? createdAt;

    const base: PersonalLibraryAsset = {
      id,
      type: typeRaw,
      name,
      url,
      createdAt,
      updatedAt,
    };

    const output: Record<string, unknown> = { ...base };
    for (const key of ALLOWED_KEYS) {
      if (key in output) continue;
      if (!(key in obj)) continue;
      const value = (obj as any)[key];
      if (value === undefined) continue;
      output[key] = value;
    }
    return output as PersonalLibraryAsset;
  }

  private async readSnapshot(userId: string): Promise<PersonalLibrarySnapshot> {
    const key = this.key(userId);
    const raw = await this.oss.getJSON<any>(key);
    const base: PersonalLibrarySnapshot = {
      version: SNAPSHOT_VERSION,
      updatedAt: new Date().toISOString(),
      assets: [],
    };

    if (!raw) return base;

    const rawAssets = Array.isArray(raw)
      ? raw
      : typeof raw === 'object' && raw && Array.isArray((raw as any).assets)
        ? (raw as any).assets
        : null;

    if (!rawAssets) return base;

    const normalized: PersonalLibraryAsset[] = [];
    for (const item of rawAssets) {
      const asset = this.normalizeLoadedAsset(item);
      if (asset) normalized.push(asset);
    }

    return {
      ...base,
      assets: normalized.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    };
  }

  private async writeSnapshot(userId: string, snapshot: PersonalLibrarySnapshot): Promise<void> {
    const key = this.key(userId);
    await this.oss.putJSON(key, {
      ...snapshot,
      version: SNAPSHOT_VERSION,
      updatedAt: new Date().toISOString(),
    }, { acl: 'private' });
  }

  async listAssets(userId: string, type?: PersonalLibraryAssetType): Promise<PersonalLibraryAsset[]> {
    const snapshot = await this.readSnapshot(userId);
    const assets = type ? snapshot.assets.filter((asset) => asset.type === type) : snapshot.assets;
    return assets.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async upsertAsset(userId: string, asset: Record<string, unknown>): Promise<PersonalLibraryAsset> {
    const now = Date.now();
    const normalized = this.sanitizeAssetForUpsert(asset, now);
    const snapshot = await this.readSnapshot(userId);

    const existingIndex = snapshot.assets.findIndex((item) => item.id === normalized.id);
    if (existingIndex >= 0) {
      const existing = snapshot.assets[existingIndex];
      snapshot.assets[existingIndex] = {
        ...existing,
        ...normalized,
        createdAt: existing.createdAt ?? normalized.createdAt,
        updatedAt: normalized.updatedAt ?? now,
      };
    } else {
      snapshot.assets.unshift(normalized);
    }

    snapshot.assets = snapshot.assets.sort((a, b) => b.updatedAt - a.updatedAt);
    await this.writeSnapshot(userId, snapshot);

    return snapshot.assets.find((item) => item.id === normalized.id) || normalized;
  }

  async updateAsset(userId: string, id: string, patch: Record<string, unknown>): Promise<PersonalLibraryAsset> {
    const now = Date.now();
    const snapshot = await this.readSnapshot(userId);
    const idx = snapshot.assets.findIndex((item) => item.id === id);
    if (idx < 0) throw new NotFoundException('资源不存在');

    const existing = snapshot.assets[idx];
    const sanitizedPatch = this.sanitizePatch(patch, now);
    snapshot.assets[idx] = {
      ...existing,
      ...sanitizedPatch,
      updatedAt: toFiniteNumber((sanitizedPatch as any).updatedAt) ?? now,
    };
    snapshot.assets = snapshot.assets.sort((a, b) => b.updatedAt - a.updatedAt);

    await this.writeSnapshot(userId, snapshot);
    return snapshot.assets.find((item) => item.id === id) || snapshot.assets[idx];
  }

  async removeAsset(userId: string, id: string): Promise<{ ok: true }> {
    const snapshot = await this.readSnapshot(userId);
    const next = snapshot.assets.filter((item) => item.id !== id);
    if (next.length === snapshot.assets.length) {
      throw new NotFoundException('资源不存在');
    }
    snapshot.assets = next;
    await this.writeSnapshot(userId, snapshot);
    return { ok: true };
  }
}
