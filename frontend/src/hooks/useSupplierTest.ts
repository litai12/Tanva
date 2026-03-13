import { useState, useRef, useCallback, useEffect } from "react";
import { fetchWithAuth } from "@/services/authFetch";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) || "http://localhost:4000";

// 与后端 ApiProtocolType 枚举保持一致
export enum ApiProtocolType {
  OPENAI_COMPATIBLE = "OPENAI_COMPATIBLE",
  KLING_NATIVE = "KLING_NATIVE",
  VIDU_NATIVE = "VIDU_NATIVE",
  DOUBAO_VOLC_NATIVE = "DOUBAO_VOLC_NATIVE",
  ASYNC_PROXY_STANDARD = "ASYNC_PROXY_STANDARD",
}

// 兼容旧代码
export type ApiProtocol = ApiProtocolType;
export type SupplierProvider = ApiProtocolType;

export interface ProtocolDescriptor {
  value: ApiProtocolType;
  label: string;
  description: string;
}

export const PROTOCOL_DESCRIPTORS: ProtocolDescriptor[] = [
  { value: ApiProtocolType.OPENAI_COMPATIBLE,    label: '通用 OpenAI 兼容协议',              description: '兼容 OpenAI Chat Completions / Images 规范的通用接口' },
  { value: ApiProtocolType.KLING_NATIVE,         label: '可灵原生协议',                      description: '可灵（Kling）官方 API 原生格式' },
  { value: ApiProtocolType.VIDU_NATIVE,          label: 'Vidu 原生协议',                     description: 'Vidu 官方 API 原生格式' },
  { value: ApiProtocolType.DOUBAO_VOLC_NATIVE,   label: '豆包火山引擎原生协议',              description: '豆包 Seedance 火山引擎原生格式' },
  { value: ApiProtocolType.ASYNC_PROXY_STANDARD, label: '通用异步代理标准 (APIMart/新147)',   description: '适用于 APIMart、新147、贞贞等异步代理平台' },
];

export interface SupplierTestRequest {
  agencyName: string;
  apiProtocol: ApiProtocolType;
  baseUrl: string;
  apiKey: string;
  prompt: string;
}

export interface SupplierTestResult {
  success: boolean;
  agencyName: string;
  apiProtocol: ApiProtocolType;
  taskId?: string;
  resultUrl?: string;
  elapsedMs?: number;
  ttfbMs?: number;
  tokens?: number;
  cost?: string;
  error?: string;
  requestPayload?: object;
  responseBody?: object;
}

export interface PollStatus {
  attempt: number;
  status: string;
  rateLimitRemaining?: number;
}

export type TestPhase = "idle" | "submitting" | "polling" | "done";

export interface SupplierTestState {
  phase: TestPhase;
  logs: string[];
  ttfbMs: number | null;
  pollStatuses: PollStatus[];
  result: SupplierTestResult | null;
}

export function useSupplierTest() {
  const [state, setState] = useState<SupplierTestState>({
    phase: "idle",
    logs: [],
    ttfbMs: null,
    pollStatuses: [],
    result: null,
  });

  const abortRef = useRef<AbortController | null>(null);

  const appendLog = (message: string) => {
    const ts = new Date().toLocaleTimeString("zh-CN");
    setState((s) => ({ ...s, logs: [...s.logs, `[${ts}] ${message}`] }));
  };

  const run = useCallback(async (req: SupplierTestRequest) => {
    // 取消上一次未完成的请求
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ phase: "submitting", logs: [], ttfbMs: null, pollStatuses: [], result: null });

    try {
      const response = await fetchWithAuth(`${API_BASE}/api/admin/supplier-test/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        setState((s) => ({
          ...s,
          phase: "done",
          result: { success: false, agencyName: req.agencyName, apiProtocol: req.apiProtocol, error: err.message || `HTTP ${response.status}` },
        }));
        return;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // 最后一段可能不完整，留在 buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let event: { event: string; data: Record<string, any> };
          try {
            event = JSON.parse(trimmed);
          } catch {
            continue;
          }

          switch (event.event) {
            case "log":
              setState((s) => ({
                ...s,
                logs: [...s.logs, event.data.message as string],
              }));
              break;

            case "ttfb":
              setState((s) => ({ ...s, ttfbMs: event.data.ttfbMs as number, phase: "polling" }));
              break;

            case "poll":
              setState((s) => ({
                ...s,
                phase: "polling",
                pollStatuses: [
                  ...s.pollStatuses,
                  {
                    attempt: event.data.attempt as number,
                    status: event.data.status as string,
                    rateLimitRemaining: event.data.rateLimitRemaining as number | undefined,
                  },
                ],
              }));
              break;

            case "done":
              setState((s) => ({
                ...s,
                phase: "done",
                result: event.data as SupplierTestResult,
              }));
              break;

            case "error":
              setState((s) => ({
                ...s,
                phase: "done",
                result: {
                  success: false,
                  agencyName: req.agencyName,
                  apiProtocol: req.apiProtocol,
                  error: event.data.message as string,
                  requestPayload: event.data.requestPayload,
                  responseBody: event.data.responseBody,
                },
              }));
              break;
          }
        }
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setState((s) => ({
        ...s,
        phase: "done",
        result: { success: false, agencyName: req.agencyName, apiProtocol: req.apiProtocol, error: e.message },
      }));
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState((s) => ({ ...s, phase: "idle" }));
  }, []);

  return { state, run, cancel };
}

/**
 * 从后端拉取系统支持的协议列表
 * 供试炼场下拉框和节点管理页面共用
 */
export function useSupportedProtocols() {
  const [protocols, setProtocols] = useState<ProtocolDescriptor[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth(`${API_BASE}/api/admin/supplier-test/supported-protocols`)
      .then((r) => r.json())
      .then((data: ProtocolDescriptor[]) => setProtocols(data))
      .catch(() => {
        // 降级：使用本地枚举兜底，保证页面可用
        setProtocols([
          { value: ApiProtocolType.OPENAI_COMPATIBLE, label: "通用 OpenAI 兼容协议", description: "" },
          { value: ApiProtocolType.KLING_NATIVE, label: "可灵原生协议", description: "" },
          { value: ApiProtocolType.VIDU_NATIVE, label: "Vidu 原生协议", description: "" },
          { value: ApiProtocolType.DOUBAO_VOLC_NATIVE, label: "豆包火山引擎原生协议", description: "" },
          { value: ApiProtocolType.ASYNC_PROXY_STANDARD, label: "通用异步代理标准协议", description: "" },
        ]);
      })
      .finally(() => setLoading(false));
  }, []);

  return { protocols, loading };
}
