import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

interface SseConn {
  connId: string;
  userId: string;
  teamId: string;
  res: any;
}

@Injectable()
export class CanvasSseManager {
  private readonly projectConns = new Map<string, Set<SseConn>>();
  private readonly heartbeatIntervals = new Map<string, NodeJS.Timeout>();

  subscribe(projectId: string, userId: string, teamId: string, res: any): { connId: string; unsubscribe: () => void } {
    const connId = randomUUID();
    const conn: SseConn = { connId, userId, teamId, res };

    if (!this.projectConns.has(projectId)) {
      this.projectConns.set(projectId, new Set());
    }
    this.projectConns.get(projectId)!.add(conn);

    const interval = setInterval(() => {
      try { res.raw.write(':keepalive\n\n'); } catch { this.unsubscribe(projectId, connId); }
    }, 20_000);
    this.heartbeatIntervals.set(connId, interval);

    const unsubscribe = () => this.unsubscribe(projectId, connId);
    return { connId, unsubscribe };
  }

  private unsubscribe(projectId: string, connId: string) {
    const conns = this.projectConns.get(projectId);
    if (!conns) return;
    for (const c of conns) {
      if (c.connId === connId) { conns.delete(c); break; }
    }
    if (conns.size === 0) this.projectConns.delete(projectId);
    clearInterval(this.heartbeatIntervals.get(connId));
    this.heartbeatIntervals.delete(connId);
  }

  broadcast(projectId: string, patch: unknown, senderConnId: string) {
    const conns = this.projectConns.get(projectId);
    if (!conns) return;
    const data = `data: ${JSON.stringify(patch)}\n\n`;
    for (const c of conns) {
      if (c.connId === senderConnId) continue;
      try { c.res.raw.write(data); } catch { this.unsubscribe(projectId, c.connId); }
    }
  }

  kickTeamConnections(projectId: string, teamId: string) {
    const conns = this.projectConns.get(projectId);
    if (!conns) return;
    const toKick = [...conns].filter((c) => c.teamId === teamId);
    const revokedMsg = `data: ${JSON.stringify({ type: 'access_revoked' })}\n\n`;
    for (const c of toKick) {
      try { c.res.raw.write(revokedMsg); } catch {}
      this.unsubscribe(projectId, c.connId);
    }
  }

  kickAllConnections(teamId: string) {
    const revokedMsg = `data: ${JSON.stringify({ type: 'access_revoked' })}\n\n`;
    for (const [projectId, conns] of this.projectConns) {
      const toKick = [...conns].filter((c) => c.teamId === teamId);
      for (const c of toKick) {
        try { c.res.raw.write(revokedMsg); } catch {}
        this.unsubscribe(projectId, c.connId);
      }
    }
  }
}
