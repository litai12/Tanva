import { getAccessToken } from "./authTokenStorage";
import { getApiBaseUrl } from "@/utils/assetProxy";

export type AsrLanguageMode = "mixed" | "zh" | "en";

export type RealtimeAsrClientOptions = {
  language: AsrLanguageMode;
  onReady?: () => void;
  onCaptureStart?: () => void;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
};

const TARGET_SAMPLE_RATE = 16_000;
const PCM_CHUNK_BYTES = 6_400;

function resolveWsBaseUrl(): string {
  const apiBase = getApiBaseUrl();
  const base =
    apiBase ||
    (typeof window !== "undefined" ? window.location.origin : "http://localhost:4000");
  return base.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
}

export class RealtimeAsrClient {
  private ws: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private pendingPcmBytes: Uint8Array[] = [];
  private pendingPcmByteLength = 0;
  private stopped = false;

  constructor(private readonly options: RealtimeAsrClientOptions) {}

  async start(): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前浏览器不支持麦克风录音");
    }
    const AudioContextCtor =
      typeof AudioContext !== "undefined"
        ? AudioContext
        : (window as any).webkitAudioContext;
    if (typeof WebSocket === "undefined" || typeof AudioContextCtor === "undefined") {
      throw new Error("当前浏览器不支持实时语音输入");
    }

    const token = getAccessToken();
    if (!token) throw new Error("请先登录后再使用语音输入");

    this.stopped = false;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });

    const url = new URL(`${resolveWsBaseUrl()}/ws/asr/realtime`);
    url.searchParams.set("token", token);
    url.searchParams.set("lang", this.options.language);

    this.ws = new WebSocket(url.toString());
    this.ws.binaryType = "arraybuffer";
    this.ws.onmessage = (event) => this.handleMessage(event);
    this.ws.onerror = () => {
      this.options.onError?.("语音识别连接异常");
    };
    this.ws.onclose = () => {
      this.options.onClose?.();
      this.stopLocal();
    };

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error("语音识别连接未创建"));
      const timeout = window.setTimeout(() => {
        reject(new Error("语音识别连接超时"));
      }, 10_000);
      this.ws.onopen = () => {
        window.clearTimeout(timeout);
        this.startPcmCapture()
          .then(() => resolve())
          .catch((error) => reject(error));
      };
      this.ws.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("语音识别连接失败"));
      };
    });
  }

  stop(): void {
    this.stopped = true;
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "end" }));
      }
    } catch {}
    this.stopLocal();
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
  }

  private async startPcmCapture(): Promise<void> {
    if (!this.stream) return;
    const AudioContextCtor =
      typeof AudioContext !== "undefined"
        ? AudioContext
        : (window as any).webkitAudioContext;
    const context: AudioContext = new AudioContextCtor();
    this.audioContext = context;
    if (context.state === "suspended") {
      await context.resume();
    }
    this.sourceNode = context.createMediaStreamSource(this.stream);
    this.processorNode = context.createScriptProcessor(4096, 1, 1);
    this.processorNode.onaudioprocess = (event) => {
      if (this.stopped) return;
      const input = event.inputBuffer.getChannelData(0);
      const pcm = this.floatTo16kPcm(input, context.sampleRate);
      this.enqueuePcm(pcm);
    };
    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(context.destination);
    this.options.onCaptureStart?.();
  }

  private floatTo16kPcm(input: Float32Array, sourceSampleRate: number): Uint8Array {
    const ratio = sourceSampleRate / TARGET_SAMPLE_RATE;
    const outputLength = Math.floor(input.length / ratio);
    const bytes = new Uint8Array(outputLength * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < outputLength; i++) {
      const sourceIndex = Math.floor(i * ratio);
      const sample = Math.max(-1, Math.min(1, input[sourceIndex] || 0));
      view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return bytes;
  }

  private enqueuePcm(bytes: Uint8Array): void {
    if (!bytes.byteLength) return;
    this.pendingPcmBytes.push(bytes);
    this.pendingPcmByteLength += bytes.byteLength;
    while (this.pendingPcmByteLength >= PCM_CHUNK_BYTES) {
      const chunk = new Uint8Array(PCM_CHUNK_BYTES);
      let offset = 0;
      while (offset < PCM_CHUNK_BYTES && this.pendingPcmBytes.length > 0) {
        const first = this.pendingPcmBytes[0];
        const take = Math.min(first.byteLength, PCM_CHUNK_BYTES - offset);
        chunk.set(first.subarray(0, take), offset);
        offset += take;
        if (take === first.byteLength) {
          this.pendingPcmBytes.shift();
        } else {
          this.pendingPcmBytes[0] = first.subarray(take);
        }
        this.pendingPcmByteLength -= take;
      }
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(chunk);
      }
    }
  }

  private handleMessage(event: MessageEvent): void {
    let msg: any;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (msg?.type === "ready") {
      this.options.onReady?.();
      return;
    }
    if (msg?.type === "transcript") {
      this.options.onTranscript?.(String(msg.text || ""), Boolean(msg.isFinal));
      return;
    }
    if (msg?.type === "error") {
      this.options.onError?.(String(msg.message || "语音识别失败"));
    }
  }

  private stopLocal(): void {
    try {
      this.processorNode?.disconnect();
    } catch {}
    try {
      this.sourceNode?.disconnect();
    } catch {}
    try {
      void this.audioContext?.close();
    } catch {}
    this.processorNode = null;
    this.sourceNode = null;
    this.audioContext = null;
    this.pendingPcmBytes = [];
    this.pendingPcmByteLength = 0;
    try {
      this.stream?.getTracks().forEach((track) => track.stop());
    } catch {}
    this.stream = null;
  }
}
