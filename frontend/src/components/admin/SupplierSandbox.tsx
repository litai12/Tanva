import { useRef, useEffect, useState } from "react";
import {
  useSupplierTest,
  useSupportedProtocols,
  type ApiProtocolType,
} from "@/hooks/useSupplierTest";

const inputCls =
  "w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300";

export function SupplierSandbox() {
  const [form, setForm] = useState({
    agencyName: "",
    apiProtocol: "" as ApiProtocolType,
    baseUrl: "",
    apiKey: "",
    prompt: "一只可爱的小猫，镜头推进，高清",
  });

  const { state, run, cancel } = useSupplierTest();
  const { protocols, loading: protocolsLoading } = useSupportedProtocols();
  const { phase, logs, ttfbMs, pollStatuses, result } = state;
  const loading = phase === "submitting" || phase === "polling";

  // 协议列表加载完成后设置默认值
  useEffect(() => {
    if (protocols.length > 0 && !form.apiProtocol) {
      setForm((p) => ({ ...p, apiProtocol: protocols[0].value }));
    }
  }, [protocols]);

  const logsEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleRun = () => {
    if (!form.baseUrl || !form.apiKey || !form.prompt) return;
    run(form);
  };

  const elapsedSec = result?.elapsedMs != null ? (result.elapsedMs / 1000).toFixed(1) : null;
  const isVideo = result?.resultUrl && !result.resultUrl.match(/\.(png|jpg|jpeg|gif|webp)(\?|$)/i);
  const lastPoll = pollStatuses[pollStatuses.length - 1];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-800">供应商 API 测试</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          手动发起真实生成测试，评估新供应商的出图质量、成功率与完整耗时
        </p>
      </div>

      <div className="flex gap-6 items-start">
        {/* ── 左侧表单 ── */}
        <div className="bg-white rounded-lg border shadow-sm p-6 space-y-4 w-96 flex-shrink-0">
          {/* 渠道名 + 底层协议 — 并排一行 */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">渠道 / 代理商名称</label>
              <input
                className={inputCls}
                placeholder="例如：深圳某算力平台"
                value={form.agencyName}
                onChange={(e) => setForm((p) => ({ ...p, agencyName: e.target.value }))}
                disabled={loading}
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">底层模型协议</label>
              <select
                className={inputCls}
                value={form.apiProtocol}
                onChange={(e) => setForm((p) => ({ ...p, apiProtocol: e.target.value as ApiProtocolType }))}
                disabled={loading || protocolsLoading}
              >
                {protocolsLoading && <option value="">加载中...</option>}
                {protocols.map((p) => (
                  <option key={p.value} value={p.value} title={p.description}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">代理地址 (Base URL)</label>
            <input
              className={`${inputCls} font-mono`}
              placeholder="https://api.example.com"
              value={form.baseUrl}
              onChange={(e) => setForm((p) => ({ ...p, baseUrl: e.target.value }))}
              disabled={loading}
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">API Key</label>
            <input
              className={`${inputCls} font-mono`}
              placeholder="sk-..."
              value={form.apiKey}
              onChange={(e) => setForm((p) => ({ ...p, apiKey: e.target.value }))}
              disabled={loading}
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">测试提示词</label>
            <textarea
              className={`${inputCls} resize-none`}
              rows={3}
              value={form.prompt}
              onChange={(e) => setForm((p) => ({ ...p, prompt: e.target.value }))}
              disabled={loading}
            />
          </div>

          {loading ? (
            <button
              onClick={cancel}
              className="w-full py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition"
            >
              取消测试
            </button>
          ) : (
            <button
              onClick={handleRun}
              disabled={!form.baseUrl || !form.apiKey}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition"
            >
              发起真实测试
            </button>
          )}
        </div>

        {/* ── 右侧看板 ── */}
        <div className="flex-1 space-y-4 min-w-0">

          {/* 空状态 */}
          {phase === "idle" && !result && (
            <div className="bg-white rounded-lg border border-dashed border-gray-200 p-12 text-center">
              <p className="text-sm text-gray-400">填写左侧表单后点击「发起真实测试」</p>
              <p className="text-xs text-gray-300 mt-1">测试将实时推送轮询进度，等待视频生成完成</p>
            </div>
          )}

          {/* 轮询日志 Terminal — 测试中始终显示，完成后保留 */}
          {(loading || logs.length > 0) && (
            <div className="bg-gray-900 rounded-lg border border-gray-700">
              <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-gray-700">
                <span className="w-3 h-3 rounded-full bg-red-500" />
                <span className="w-3 h-3 rounded-full bg-yellow-500" />
                <span className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-xs text-gray-500 ml-2 font-mono">supplier-test — stream</span>
                {loading && (
                  <span className="ml-auto flex items-center gap-1.5 text-xs text-yellow-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                    {phase === "submitting" ? "提交中" : `轮询中 [${pollStatuses.length}]`}
                  </span>
                )}
              </div>
              <div className="p-4 font-mono text-sm text-green-400 space-y-0.5 h-52 overflow-y-auto">
                {logs.map((line, i) => (
                  <div key={i} className="leading-relaxed whitespace-pre-wrap break-all">{line}</div>
                ))}
                {loading && <div className="text-green-400 animate-pulse">█</div>}
                <div ref={logsEndRef} />
              </div>
            </div>
          )}

          {/* ── 测试战果卡片（完成后展示）── */}
          {phase === "done" && result && (
            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">

              {/* 1. 核心状态栏 */}
              <div className={`px-5 py-4 flex items-center gap-3 ${result.success ? "bg-green-50 border-b border-green-100" : "bg-red-50 border-b border-red-100"}`}>
                <span className="text-xl">{result.success ? "✅" : "❌"}</span>
                <div className="flex-1 min-w-0">
                  <span className={`text-sm font-semibold ${result.success ? "text-green-800" : "text-red-700"}`}>
                    {result.success ? "测试完成" : "任务失败"}
                  </span>
                  <span className="text-xs text-gray-500 ml-3">
                    {elapsedSec && `⏳ 总时长: ${elapsedSec}s`}
                    {ttfbMs != null && `　TTFB: ${ttfbMs}ms`}
                    {result.tokens != null && `　Tokens: ${result.tokens.toLocaleString()}`}
                    {pollStatuses.length > 0 && `　轮询: ${pollStatuses.length}次`}
                  </span>
                </div>
                {result.taskId && (
                  <span className="text-xs text-gray-400 font-mono truncate max-w-[160px]">
                    {result.taskId}
                  </span>
                )}
              </div>

              {/* 失败原因 */}
              {!result.success && result.error && (
                <div className="px-5 py-3 bg-red-50 border-b border-red-100">
                  <p className="text-xs text-red-600 font-mono break-words">{result.error}</p>
                </div>
              )}

              {/* 2. Raw JSON Viewer */}
              {result.responseBody && (
                <div className="border-b">
                  <div className="px-5 py-2.5 bg-gray-50 border-b flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500">响应结果 (Raw JSON)</span>
                    {result.requestPayload && (
                      <details className="group">
                        <summary className="text-xs text-blue-500 cursor-pointer select-none list-none hover:text-blue-700">
                          查看 Request Payload
                        </summary>
                        <div className="absolute z-10 mt-1 right-4 w-96 bg-white border rounded-lg shadow-lg p-3">
                          <pre className="text-xs text-gray-700 overflow-x-auto font-mono leading-relaxed max-h-48 overflow-y-auto">
                            <code>{JSON.stringify(result.requestPayload, null, 2)}</code>
                          </pre>
                        </div>
                      </details>
                    )}
                  </div>
                  <div className="bg-gray-50 h-56 overflow-y-auto overflow-x-auto px-5 py-3">
                    <pre className="text-xs text-gray-700 font-mono leading-relaxed whitespace-pre">
                      <code>{JSON.stringify(result.responseBody, null, 2)}</code>
                    </pre>
                  </div>
                </div>
              )}

              {/* 3. 媒体播放区 */}
              {result.success && result.resultUrl && (
                <div className="p-5 space-y-3">
                  <p className="text-xs font-medium text-gray-500">业务交付预览</p>
                  {isVideo ? (
                    <video
                      src={result.resultUrl}
                      controls
                      className="w-full rounded-lg shadow-md bg-black"
                      style={{ maxHeight: 380 }}
                    />
                  ) : (
                    <img
                      src={result.resultUrl}
                      alt="生成结果"
                      className="w-full rounded-lg shadow-md object-contain"
                      style={{ maxHeight: 380 }}
                    />
                  )}
                  <a
                    href={result.resultUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-500 hover:underline break-all block"
                  >
                    {result.resultUrl}
                  </a>
                </div>
              )}

            </div>
          )}

        </div>
      </div>
    </div>
  );
}
