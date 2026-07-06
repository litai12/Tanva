import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

interface CaptureEntry {
  leaseToken: string;
  status: 'claimed' | 'succeeded' | 'failed';
  imageUrl?: string;
  error?: string;
  ts: number;
}

const TTL_MS = 10 * 60 * 1000;

@Injectable()
export class DirectorCaptureService {
  private readonly store = new Map<string, CaptureEntry>();

  claim(captureId: string): { ok: boolean; leaseToken?: string } {
    this.evict();
    if (this.store.has(captureId)) return { ok: false };
    const leaseToken = randomUUID();
    this.store.set(captureId, { leaseToken, status: 'claimed', ts: Date.now() });
    return { ok: true, leaseToken };
  }

  report(
    captureId: string,
    leaseToken: string,
    status: 'succeeded' | 'failed',
    imageUrl?: string,
    error?: string,
  ): boolean {
    const entry = this.store.get(captureId);
    if (!entry || entry.leaseToken !== leaseToken) return false;
    entry.status = status;
    if (imageUrl) entry.imageUrl = imageUrl;
    if (error) entry.error = error;
    return true;
  }

  private evict() {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, entry] of this.store.entries()) {
      if (entry.ts < cutoff) this.store.delete(id);
    }
  }
}
