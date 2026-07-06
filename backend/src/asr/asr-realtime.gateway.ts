import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomUUID } from 'crypto';
import type { IncomingMessage, Server as HttpServer } from 'http';
import type { Duplex } from 'stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

const WS_PATH = '/ws/asr/realtime';
const HEARTBEAT_MS = 25_000;
const MAX_SESSION_MS = 2 * 60 * 1000;
const TENCENT_ASR_HOST = 'asr.cloud.tencent.com';

type AsrLanguage = 'mixed' | 'zh' | 'en';

interface AsrConn {
  client: WebSocket;
  upstream: WebSocket | null;
  sessionId: string;
  userId: string;
  isAlive: boolean;
  closeTimer: NodeJS.Timeout | null;
  audioBytes: number;
  upstreamMessages: number;
  transcriptMessages: number;
}

@Injectable()
export class AsrRealtimeGateway implements OnModuleDestroy {
  private readonly logger = new Logger(AsrRealtimeGateway.name);
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly conns = new Set<AsrConn>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private originAllowed: ((origin: string) => boolean) | null = null;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
  }

  setOriginCheck(fn: (origin: string) => boolean): void {
    this.originAllowed = fn;
  }

  attach(server: HttpServer): void {
    server.on('upgrade', (req, socket, head) => {
      void this.handleUpgrade(req, socket as Duplex, head as Buffer);
    });
  }

  private reject(socket: Duplex, code: number, msg: string): void {
    try {
      socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`);
    } catch {}
    try {
      socket.destroy();
    } catch {}
  }

  private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    let url: URL;
    try {
      url = new URL(req.url ?? '', 'http://localhost');
    } catch {
      return this.reject(socket, 400, 'Bad Request');
    }
    if (url.pathname !== WS_PATH) return;

    const origin = req.headers.origin ?? '';
    if (this.originAllowed && origin && !this.originAllowed(origin)) {
      return this.reject(socket, 403, 'Forbidden Origin');
    }

    const token = url.searchParams.get('token') ?? '';
    let userId = '';
    try {
      const payload = await this.jwt.verifyAsync<any>(token);
      userId = String(payload?.sub ?? '');
    } catch {
      return this.reject(socket, 401, 'Unauthorized');
    }
    if (!userId) return this.reject(socket, 401, 'Unauthorized');

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      void this.register(ws, userId, this.normalizeLanguage(url.searchParams.get('lang')));
    });
  }

  private async register(client: WebSocket, userId: string, language: AsrLanguage): Promise<void> {
    const conn: AsrConn = {
      client,
      upstream: null,
      sessionId: randomUUID(),
      userId,
      isAlive: true,
      closeTimer: null,
      audioBytes: 0,
      upstreamMessages: 0,
      transcriptMessages: 0,
    };
    this.conns.add(conn);

    client.on('pong', () => {
      conn.isAlive = true;
    });
    client.on('message', (raw, isBinary) => this.onClientMessage(conn, raw, isBinary));
    client.on('close', () => this.cleanup(conn));
    client.on('error', () => this.cleanup(conn));

    conn.closeTimer = setTimeout(() => {
      this.sendClient(conn, {
        type: 'error',
        message: '单次语音输入已到达 2 分钟上限，请重新开始。',
      });
      this.cleanup(conn);
    }, MAX_SESSION_MS);

    try {
      conn.upstream = this.connectTencentAsr(conn, language);
      this.logger.log(`ASR session created: ${conn.sessionId} user=${userId} lang=${language}`);
    } catch (error) {
      this.sendClient(conn, {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
      this.cleanup(conn);
    }
  }

  private connectTencentAsr(conn: AsrConn, language: AsrLanguage): WebSocket {
    const appId = this.getRequiredConfig('TENCENT_ASR_APP_ID');
    const secretId =
      this.config.get<string>('TENCENT_ASR_SECRET_ID') ||
      process.env.TENCENT_ASR_SECRET_ID ||
      this.config.get<string>('TENCENT_MPS_SECRET_ID') ||
      process.env.TENCENT_MPS_SECRET_ID ||
      '';
    const secretKey =
      this.config.get<string>('TENCENT_ASR_SECRET_KEY') ||
      process.env.TENCENT_ASR_SECRET_KEY ||
      this.config.get<string>('TENCENT_MPS_SECRET_KEY') ||
      process.env.TENCENT_MPS_SECRET_KEY ||
      '';

    if (!secretId || !secretKey) {
      throw new Error('服务端未配置 TENCENT_ASR_SECRET_ID / TENCENT_ASR_SECRET_KEY');
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const params = new URLSearchParams({
      secretid: secretId,
      timestamp: String(timestamp),
      expired: String(timestamp + 60 * 60),
      nonce: String(Math.floor(Math.random() * 1_000_000_000)),
      engine_model_type: this.resolveEngine(language),
      voice_format: '1',
      voice_id: conn.sessionId,
      needvad: '1',
      filter_dirty: '0',
      filter_modal: '0',
      filter_punc: '0',
      convert_num_mode: '1',
      word_info: '0',
    });
    params.sort();

    const pathWithQuery = `/asr/v2/${appId}?${params.toString()}`;
    const signature = createHmac('sha1', secretKey)
      .update(`${TENCENT_ASR_HOST}${pathWithQuery}`)
      .digest('base64');
    const upstreamUrl = `wss://${TENCENT_ASR_HOST}${pathWithQuery}&signature=${encodeURIComponent(signature)}`;
    const upstream = new WebSocket(upstreamUrl);

    upstream.on('open', () => {
      this.logger.log(`ASR upstream connected: ${conn.sessionId}`);
      this.sendClient(conn, { type: 'ready', language });
    });
    upstream.on('message', (raw) => this.onTencentMessage(conn, raw));
    upstream.on('close', (code, reason) => {
      this.logger.log(
        `ASR upstream closed: ${conn.sessionId} code=${code} reason=${reason?.toString() || ''} audioBytes=${conn.audioBytes} upstreamMessages=${conn.upstreamMessages} transcripts=${conn.transcriptMessages}`,
      );
      this.sendClient(conn, {
        type: 'closed',
        code,
        reason: reason?.toString() || '',
      });
      this.cleanup(conn);
    });
    upstream.on('error', (error) => {
      this.logger.warn(`Tencent ASR websocket error: ${error.message}`);
      this.sendClient(conn, { type: 'error', message: `语音识别服务连接失败：${error.message}` });
      this.cleanup(conn);
    });

    return upstream;
  }

  private onClientMessage(conn: AsrConn, raw: RawData, isBinary: boolean): void {
    if (!conn.upstream || conn.upstream.readyState !== WebSocket.OPEN) return;
    if (isBinary) {
      conn.audioBytes += Buffer.isBuffer(raw)
        ? raw.byteLength
        : Array.isArray(raw)
        ? Buffer.concat(raw).byteLength
        : raw instanceof ArrayBuffer
        ? raw.byteLength
        : Buffer.byteLength(raw as any);
      conn.upstream.send(raw);
      return;
    }

    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg?.type === 'end') {
      conn.upstream.send(JSON.stringify({ type: 'end' }));
    }
  }

  private onTencentMessage(conn: AsrConn, raw: RawData): void {
    conn.upstreamMessages += 1;
    const text = raw.toString();
    let msg: any;
    try {
      msg = JSON.parse(text);
    } catch {
      this.sendClient(conn, { type: 'raw', payload: text });
      return;
    }

    if (msg.code && msg.code !== 0) {
      this.sendClient(conn, {
        type: 'error',
        message: msg.message || `语音识别失败：${msg.code}`,
        payload: msg,
      });
      return;
    }

    const result = msg.result || {};
    const transcript = String(result.voice_text_str || '').trim();
    if (transcript) {
      conn.transcriptMessages += 1;
      this.sendClient(conn, {
        type: 'transcript',
        text: transcript,
        isFinal: result.slice_type === 2,
        payload: result,
      });
    } else if (conn.upstreamMessages <= 5 || conn.upstreamMessages % 20 === 0) {
      this.logger.debug(
        `ASR upstream message without transcript: ${conn.sessionId} keys=${Object.keys(msg || {}).join(',')} resultKeys=${Object.keys(result || {}).join(',')}`,
      );
    }
  }

  private resolveEngine(language: AsrLanguage): string {
    if (language === 'en') {
      return (
        this.config.get<string>('TENCENT_ASR_ENGINE_EN') ||
        process.env.TENCENT_ASR_ENGINE_EN ||
        '16k_en'
      );
    }
    return (
      this.config.get<string>('TENCENT_ASR_ENGINE_ZH') ||
      process.env.TENCENT_ASR_ENGINE_ZH ||
      '16k_zh'
    );
  }

  private normalizeLanguage(value: string | null): AsrLanguage {
    if (value === 'zh' || value === 'en' || value === 'mixed') return value;
    return 'mixed';
  }

  private getRequiredConfig(name: string): string {
    const value = this.config.get<string>(name) || process.env[name] || '';
    if (!value.trim()) throw new Error(`服务端未配置 ${name}`);
    return value.trim();
  }

  private sendClient(conn: AsrConn, payload: Record<string, unknown>): void {
    if (conn.client.readyState !== WebSocket.OPEN) return;
    try {
      conn.client.send(JSON.stringify(payload));
    } catch {}
  }

  private cleanup(conn: AsrConn): void {
    if (!this.conns.has(conn)) return;
    this.conns.delete(conn);
    this.logger.log(
      `ASR session cleanup: ${conn.sessionId} audioBytes=${conn.audioBytes} upstreamMessages=${conn.upstreamMessages} transcripts=${conn.transcriptMessages}`,
    );
    if (conn.closeTimer) clearTimeout(conn.closeTimer);
    conn.closeTimer = null;
    try {
      if (conn.upstream && conn.upstream.readyState === WebSocket.OPEN) {
        conn.upstream.send(JSON.stringify({ type: 'end' }));
      }
    } catch {}
    try {
      conn.upstream?.terminate();
    } catch {}
    try {
      conn.client.terminate();
    } catch {}
  }

  private heartbeat(): void {
    for (const conn of [...this.conns]) {
      if (!conn.isAlive) {
        this.cleanup(conn);
        continue;
      }
      conn.isAlive = false;
      try {
        conn.client.ping();
      } catch {
        this.cleanup(conn);
      }
    }
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    for (const conn of [...this.conns]) this.cleanup(conn);
    try {
      this.wss.close();
    } catch {}
  }
}
