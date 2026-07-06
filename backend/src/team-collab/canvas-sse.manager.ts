import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CollabEventBus } from './collab-event-bus.service';
import {
  CollabEnvelope,
  CursorPayload,
  PresenceUserPayload,
} from './types';

const HEARTBEAT_INTERVAL_MS = 20_000;
const CURSOR_FLUSH_MS = Number(process.env.COLLAB_CURSOR_FLUSH_MS ?? 100);
const TICK_MS = 50;
const MAX_QUEUE_PER_CONN = 1000;
const MAX_CONNS_PER_PROJECT = 50;
const MAX_CONNS_PER_USER_PER_PROJECT = 2;

interface SseConn {
  connId: string;
  userId: string;
  userName: string;
  avatarUrl: string | null;
  teamId: string;
  projectId: string;
  res: any;
  queueLength: number;
  lastBeatAt: number;
  cursorBuffer: Map<string, CollabEnvelope<CursorPayload>>;
}

@Injectable()
export class CanvasSseManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CanvasSseManager.name);
  private readonly projectConns = new Map<string, Set<SseConn>>();
  private readonly connIndex = new Map<string, SseConn>();
  private readonly busUnsubs = new Map<string, () => void>();
  private tickTimer: NodeJS.Timeout | null = null;

  constructor(private readonly bus: CollabEventBus) {}

  onModuleInit(): void {
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    for (const conn of this.connIndex.values()) {
      try {
        conn.res.raw.end?.();
      } catch {}
    }
    this.projectConns.clear();
    this.connIndex.clear();
    for (const unsub of this.busUnsubs.values()) {
      try {
        unsub();
      } catch {}
    }
    this.busUnsubs.clear();
  }

  async subscribe(
    projectId: string,
    userId: string,
    userName: string,
    avatarUrl: string | null,
    teamId: string,
    res: any,
  ): Promise<{ connId: string; unsubscribe: () => void } | { error: string }> {
    const existing = this.projectConns.get(projectId);
    if (existing && existing.size >= MAX_CONNS_PER_PROJECT) {
      return { error: 'project_connection_limit' };
    }
    if (existing) {
      let same = 0;
      for (const c of existing) {
        if (c.userId === userId) same++;
      }
      if (same >= MAX_CONNS_PER_USER_PER_PROJECT) {
        return { error: 'user_connection_limit' };
      }
    }

    const connId = randomUUID();
    const conn: SseConn = {
      connId,
      userId,
      userName,
      avatarUrl,
      teamId,
      projectId,
      res,
      queueLength: 0,
      lastBeatAt: Date.now(),
      cursorBuffer: new Map(),
    };

    if (!this.projectConns.has(projectId)) {
      this.projectConns.set(projectId, new Set());
      const unsub = await this.bus.subscribe(projectId, (env) =>
        this.fanout(projectId, env),
      );
      this.busUnsubs.set(projectId, unsub);
    }
    this.projectConns.get(projectId)!.add(conn);
    this.connIndex.set(connId, conn);

    // notify presence_join
    const joinEnv: CollabEnvelope<PresenceUserPayload> = {
      type: 'presence_join',
      payload: { userId, name: userName, avatarUrl },
      ts: Date.now(),
      senderUserId: userId,
      senderConnId: connId,
    };
    await this.bus.publish(projectId, joinEnv);

    return {
      connId,
      unsubscribe: () => this.unsubscribe(projectId, connId),
    };
  }

  unsubscribe(projectId: string, connId: string): { userId?: string; userName?: string } {
    const conns = this.projectConns.get(projectId);
    if (!conns) return {};
    let removed: SseConn | undefined;
    for (const c of conns) {
      if (c.connId === connId) {
        removed = c;
        conns.delete(c);
        break;
      }
    }
    this.connIndex.delete(connId);
    if (conns.size === 0) {
      this.projectConns.delete(projectId);
      const unsub = this.busUnsubs.get(projectId);
      if (unsub) {
        unsub();
        this.busUnsubs.delete(projectId);
      }
    }
    if (removed) {
      const leaveEnv: CollabEnvelope<PresenceUserPayload> = {
        type: 'presence_leave',
        payload: { userId: removed.userId, name: removed.userName, avatarUrl: removed.avatarUrl },
        ts: Date.now(),
        senderUserId: removed.userId,
        senderConnId: removed.connId,
      };
      this.bus.publish(projectId, leaveEnv).catch(() => undefined);
      return { userId: removed.userId, userName: removed.userName };
    }
    return {};
  }

  private fanout(projectId: string, envelope: CollabEnvelope): void {
    const conns = this.projectConns.get(projectId);
    if (!conns) return;
    for (const c of conns) {
      if (envelope.senderConnId && c.connId === envelope.senderConnId) continue;
      if (envelope.type === 'cursor') {
        const payload = envelope.payload as CursorPayload;
        c.cursorBuffer.set(payload.userId, envelope as CollabEnvelope<CursorPayload>);
      } else {
        this.writeFrame(c, envelope);
      }
    }
  }

  private writeFrame(conn: SseConn, envelope: CollabEnvelope): void {
    if (conn.queueLength >= MAX_QUEUE_PER_CONN) {
      this.logger.warn(
        `dropping slow consumer conn=${conn.connId} user=${conn.userId} project=${conn.projectId}`,
      );
      this.kickConn(conn);
      return;
    }
    const data = JSON.stringify(envelope);
    const idLine =
      typeof envelope.seq === 'number' ? `id: ${envelope.seq}\n` : '';
    const frame = `event: ${envelope.type}\n${idLine}data: ${data}\n\n`;
    conn.queueLength++;
    try {
      const ok = conn.res.raw.write(frame, () => {
        conn.queueLength = Math.max(0, conn.queueLength - 1);
      });
      if (!ok) {
        // backpressure - flow will resume on drain
      }
      conn.lastBeatAt = Date.now();
    } catch (err) {
      this.unsubscribe(conn.projectId, conn.connId);
    }
  }

  private writeRaw(conn: SseConn, data: string): void {
    try {
      conn.res.raw.write(data);
      conn.lastBeatAt = Date.now();
    } catch {
      this.unsubscribe(conn.projectId, conn.connId);
    }
  }

  private kickConn(conn: SseConn): void {
    try {
      conn.res.raw.end?.();
    } catch {}
    this.unsubscribe(conn.projectId, conn.connId);
  }

  private tick(): void {
    const now = Date.now();
    for (const conn of this.connIndex.values()) {
      // flush cursor buffer
      if (conn.cursorBuffer.size > 0 && now - conn.lastBeatAt > 0) {
        for (const env of conn.cursorBuffer.values()) {
          this.writeFrame(conn, env);
        }
        conn.cursorBuffer.clear();
      }
      // heartbeat
      if (now - conn.lastBeatAt >= HEARTBEAT_INTERVAL_MS) {
        this.writeRaw(conn, `:keepalive\n\n`);
      }
    }
  }

  /**
   * Send a direct frame to a specific connection (bypasses Pub/Sub).
   * Used for connection-scoped messages (initial connected ack, replay frames).
   */
  sendDirect(connId: string, envelope: CollabEnvelope): void {
    const conn = this.connIndex.get(connId);
    if (!conn) return;
    this.writeFrame(conn, envelope);
  }

  /**
   * Force-close all connections belonging to a team on a specific project.
   */
  async kickTeamConnections(projectId: string, teamId: string): Promise<void> {
    const conns = this.projectConns.get(projectId);
    if (!conns) return;
    const toKick = [...conns].filter((c) => c.teamId === teamId);
    for (const c of toKick) {
      this.sendDirect(c.connId, {
        type: 'access_revoked',
        payload: { reason: 'team_removed' },
        ts: Date.now(),
      });
      this.kickConn(c);
    }
  }

  async kickAllConnections(teamId: string): Promise<void> {
    for (const projectId of [...this.projectConns.keys()]) {
      await this.kickTeamConnections(projectId, teamId);
    }
  }

  hasConn(connId: string): boolean {
    return this.connIndex.has(connId);
  }

  getConnUserId(connId: string): string | undefined {
    return this.connIndex.get(connId)?.userId;
  }

  /**
   * Get a snapshot of currently online users for a project (deduped by userId).
   */
  getPresence(projectId: string): PresenceUserPayload[] {
    const conns = this.projectConns.get(projectId);
    if (!conns) return [];
    const seen = new Map<string, PresenceUserPayload>();
    for (const c of conns) {
      if (!seen.has(c.userId)) {
        seen.set(c.userId, { userId: c.userId, name: c.userName, avatarUrl: c.avatarUrl });
      }
    }
    return [...seen.values()];
  }
}
