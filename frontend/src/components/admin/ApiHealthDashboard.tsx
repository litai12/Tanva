import { useState, useEffect, useRef, Fragment } from "react";
import {
  getApiHealthStatus,
  checkAllApis,
  checkSingleNode,
  getApiHealthNodes,
  getApiConfigs,
  setApiHealthNodeBinding,
  createApiConfig,
  updateApiConfig,
  getScheduleConfig,
  updateScheduleConfig,
  testWebhook,
  getE2EScheduleConfig,
  updateE2EScheduleConfig,
  streamE2ETest,
  getLatestE2ELogs,
  type HealthCheckResult,
  type ApiHealthStatus,
  type ApiHealthNode,
  type ApiConfig,
  type ScheduleConfig,
  type E2EScheduleConfig,
  type LatestE2ELog,
} from "@/services/adminApi";
import { ApiHealthChart } from "./ApiHealthChart";
import { ApiProtocolType, PROTOCOL_DESCRIPTORS } from "@/hooks/useSupplierTest";

const openVideoPreview = (url: string) => {
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#000;display:flex;justify-content:center;align-items:center;height:100vh"><video src="${url}" controls autoplay style="max-width:100%;max-height:100vh"></video></body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);
  window.open(blobUrl, '_blank');
};

const formatNodeDisplayName = ({ name, modelName }: { name: string; modelName?: string | null }): string => {
  const normalizedModelName = modelName?.trim();
  return normalizedModelName ? `${name} [${normalizedModelName}]` : name;
};

const BINDING_STRATEGY_META: Record<
  ApiHealthNode["bindingStrategy"],
  { label: string; className: string; title: string }
> = {
  MANUAL: {
    label: "手动锁定",
    className: "text-amber-700 bg-amber-50 border border-amber-200",
    title: "通过 metadata.apiHealth.configId 显式强制绑定",
  },
  METADATA: {
    label: "元数据匹配",
    className: "text-sky-700 bg-sky-50 border border-sky-200",
    title: "通过 metadata 中的 provider/modelName 自动匹配",
  },
  MATCH: {
    label: "模型匹配",
    className: "text-emerald-700 bg-emerald-50 border border-emerald-200",
    title: "通过 serviceType/modelName 自动匹配",
  },
  FALLBACK: {
    label: "自动推断",
    className: "text-gray-700 bg-gray-50 border border-gray-200",
    title: "通过 provider 推断或兜底策略绑定",
  },
};

// ─── 状态徽章 ────────────────────────────────────────────────
function StatusBadge({ status }: { status: ApiHealthStatus["status"] }) {
  const map = {
    healthy:   { dot: "bg-green-500",  text: "text-green-700",  bg: "bg-green-50",  border: "border-green-200",  label: "正常"  },
    unhealthy: { dot: "bg-red-500",    text: "text-red-700",    bg: "bg-red-50",    border: "border-red-200",    label: "离线" },
    unknown:   { dot: "bg-gray-400",   text: "text-gray-500",   bg: "bg-gray-50",   border: "border-gray-200",   label: "未知" },
  };
  const s = map[status] ?? map.unknown;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${s.bg} ${s.text} ${s.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

// ─── 汇总卡片 ────────────────────────────────────────────────
function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-lg border p-4 text-center shadow-sm">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

// ─── L2 状态单元格 ───────────────────────────────────────────
function L2Cell({ log }: { log: LatestE2ELog | undefined }) {
  if (!log) {
    return <span className="text-gray-300 text-xs">-</span>;
  }
  const ago = formatAgo(log.createdAt);
  if (log.status === "offline") {
    return (
      <div className="space-y-0.5">
        <span className="inline-flex items-center gap-1 text-xs text-red-500">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
          失败
        </span>
        <p className="text-xs text-gray-400">{ago}</p>
        {log.errorDetail && (
          <p className="text-xs text-red-400 max-w-[180px] truncate" title={log.errorDetail}>{log.errorDetail}</p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-0.5">
      <span className="inline-flex items-center gap-1 text-xs text-green-600">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
        成功
      </span>
      <p className="text-xs text-gray-400">
        {ago}{log.e2eDuration != null ? ` · ${log.e2eDuration}s` : ""}
      </p>
      {log.e2eMediaUrl && (
        <button onClick={() => openVideoPreview(log.e2eMediaUrl!)}
          className="text-xs text-blue-500 hover:underline cursor-pointer">查看结果 ↗</button>
      )}
    </div>
  );
}

function formatAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  return `${Math.floor(h / 24)}天前`;
}

// ─── 编辑弹窗 ────────────────────────────────────────────────
function EditModal({ config, onClose, onSaved }: {
  config: ApiConfig;
  onClose: () => void;
  onSaved: (updated: ApiConfig) => void;
}) {
  const [form, setForm] = useState({
    name: config.name,
    apiKey: config.apiKey,
    endpoint: config.endpoint ?? "",
    enabled: config.enabled,
    apiProtocol: config.apiProtocol ?? "",
    modelName: config.modelName ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const normalizedModelName = form.modelName.trim();
      const updated = await updateApiConfig(config.id, {
        name: form.name,
        apiKey: form.apiKey,
        endpoint: form.endpoint || undefined,
        enabled: form.enabled,
        apiProtocol: form.apiProtocol || undefined,
        modelName: normalizedModelName || undefined,
      });
      onSaved({ ...updated, modelName: normalizedModelName || undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-800">编辑 API 配置</h3>
        <div className="space-y-3">
          <Field label="显示名称">
            <input className={inputCls} value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} />
          </Field>
          <Field label="API Key">
            <input className={`${inputCls} font-mono`} value={form.apiKey} onChange={(e) => setForm(p => ({ ...p, apiKey: e.target.value }))} />
          </Field>
          <Field label="代理端点 URL">
            <input className={`${inputCls} font-mono`} value={form.endpoint} placeholder="https://..." onChange={(e) => setForm(p => ({ ...p, endpoint: e.target.value }))} />
          </Field>
          <Field label="底层协议 (深度监测必填)">
            <select className={inputCls} value={form.apiProtocol} onChange={(e) => setForm(p => ({ ...p, apiProtocol: e.target.value }))}>
              <option value="">— 未配置（不支持深度监测）—</option>
              {PROTOCOL_DESCRIPTORS.map(d => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </Field>
          <Field label="模型标识 (modelName)">
            <input
              className={`${inputCls} font-mono`}
              value={form.modelName}
              placeholder="如：kling-2.6-video / viduq2 / doubao-seedance-..."
              onChange={(e) => setForm(p => ({ ...p, modelName: e.target.value }))}
            />
          </Field>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm(p => ({ ...p, enabled: e.target.checked }))} className="w-4 h-4 accent-blue-600" />
            <span className="text-sm text-gray-700">启用此节点</span>
          </label>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <ModalFooter onCancel={onClose} onConfirm={handleSave} loading={saving} confirmText="保存" />
      </div>
    </div>
  );
}

// ─── 添加弹窗 ────────────────────────────────────────────────
function AddModal({ onClose, onAdded }: {
  onClose: () => void;
  onAdded: (cfg: ApiConfig) => void;
}) {
  const [form, setForm] = useState({ name: "", provider: "", apiKey: "", endpoint: "", category: "other", apiProtocol: "", modelName: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!form.name || !form.provider || !form.apiKey) {
      setError("名称、标识符和 API Key 为必填项");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const normalizedModelName = form.modelName.trim();
      const created = await createApiConfig({
        name: form.name,
        provider: form.provider,
        apiKey: form.apiKey,
        endpoint: form.endpoint || undefined,
        category: form.category,
        apiProtocol: form.apiProtocol || undefined,
        modelName: normalizedModelName || undefined,
      });
      onAdded({ ...created, modelName: normalizedModelName || undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : "添加失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-800">添加 API 配置</h3>
        <div className="space-y-3">
          <Field label="显示名称 *">
            <input className={inputCls} placeholder="如：Google Gemini" value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} />
          </Field>
          <Field label="唯一标识符 *">
            <input className={`${inputCls} font-mono`} placeholder="如：gemini（小写英文）" value={form.provider} onChange={(e) => setForm(p => ({ ...p, provider: e.target.value.toLowerCase() }))} />
          </Field>
          <Field label="API Key *">
            <input className={`${inputCls} font-mono`} value={form.apiKey} onChange={(e) => setForm(p => ({ ...p, apiKey: e.target.value }))} />
          </Field>
          <Field label="代理端点 URL">
            <input className={`${inputCls} font-mono`} placeholder="https://..." value={form.endpoint} onChange={(e) => setForm(p => ({ ...p, endpoint: e.target.value }))} />
          </Field>
          <Field label="分类">
            <select className={inputCls} value={form.category} onChange={(e) => setForm(p => ({ ...p, category: e.target.value }))}>
              <option value="image">图像生成</option>
              <option value="video">视频生成</option>
              <option value="other">其他</option>
            </select>
          </Field>
          <Field label="底层协议 (深度监测必填)">
            <select className={inputCls} value={form.apiProtocol} onChange={(e) => setForm(p => ({ ...p, apiProtocol: e.target.value }))}>
              <option value="">— 未配置（不支持深度监测）—</option>
              {PROTOCOL_DESCRIPTORS.map(d => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </Field>
          <Field label="模型标识 (modelName)">
            <input
              className={`${inputCls} font-mono`}
              placeholder="如：kling-2.6-video / viduq2 / doubao-seedance-..."
              value={form.modelName}
              onChange={(e) => setForm(p => ({ ...p, modelName: e.target.value }))}
            />
          </Field>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <ModalFooter onCancel={onClose} onConfirm={handleSave} loading={saving} confirmText="添加" />
      </div>
    </div>
  );
}

function BindingModal({
  node,
  configs,
  onClose,
  onSaved,
}: {
  node: ApiHealthNode;
  configs: ApiConfig[];
  onClose: () => void;
  onSaved: (updated: ApiHealthNode) => void;
}) {
  const AUTO_VALUE = "__AUTO__";
  const [selectedConfigId, setSelectedConfigId] = useState<string>(node.configId ?? AUTO_VALUE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const sortedConfigs = [...configs].sort((a, b) => {
    const providerCmp = a.provider.localeCompare(b.provider);
    if (providerCmp !== 0) return providerCmp;
    return a.name.localeCompare(b.name);
  });

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const updated = await setApiHealthNodeBinding(
        node.nodeKey,
        selectedConfigId === AUTO_VALUE ? null : selectedConfigId,
      );
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存绑定失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-gray-800">切换底层通道</h3>
          <p className="text-xs text-gray-500 mt-1">
            业务节点：{formatNodeDisplayName({ name: node.name, modelName: node.modelName })}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">nodeKey：{node.nodeKey}</p>
        </div>

        <Field label="绑定策略">
          <select
            className={inputCls}
            value={selectedConfigId}
            onChange={(e) => setSelectedConfigId(e.target.value)}
          >
            <option value={AUTO_VALUE}>自动推断（清除 metadata.apiHealth.configId）</option>
            {sortedConfigs.map((cfg) => (
              <option key={cfg.id} value={cfg.id}>
                {cfg.name} ({cfg.provider})
                {cfg.modelName?.trim() ? ` [${cfg.modelName.trim()}]` : ""}
              </option>
            ))}
          </select>
        </Field>

        {error && <p className="text-xs text-red-500">{error}</p>}
        <ModalFooter onCancel={onClose} onConfirm={handleSave} loading={saving} confirmText="保存绑定" />
      </div>
    </div>
  );
}

// ─── Cron 工具函数 ───────────────────────────────────────────
function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  return parts.every((part, i) => {
    if (part === "*") return true;
    if (/^\*\/\d+$/.test(part)) {
      const step = parseInt(part.slice(2));
      return step >= 1 && step <= ranges[i][1];
    }
    const n = parseInt(part);
    return !isNaN(n) && n >= ranges[i][0] && n <= ranges[i][1];
  });
}

function describeCron(expr: string): string {
  const presetMap: Record<string, string> = {
    "0 3 * * *": "每天凌晨 3 点",
    "0 8 * * *": "每天早上 8 点",
    "0 */6 * * *": "每 6 小时",
    "0 * * * *": "每小时",
  };
  if (presetMap[expr.trim()]) return presetMap[expr.trim()];
  const parts = expr.trim().split(/\s+/);
  if (parts.length === 5) {
    const [min, hour] = parts;
    if (min !== "*" && hour !== "*" && !hour.startsWith("*/")) {
      return `每天 ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
    }
    if (hour.startsWith("*/")) return `每 ${hour.slice(2)} 小时`;
    if (min.startsWith("*/")) return `每 ${min.slice(2)} 分钟`;
  }
  return expr;
}

// ─── 定时监测设置弹窗 ────────────────────────────────────────
function ScheduleModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<ScheduleConfig>({ enabled: true, cronExpression: "0 3 * * *", timezone: "Asia/Shanghai" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleTestWebhook = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testWebhook();
      setTestResult(result);
    } catch {
      setTestResult({ success: false, message: "请求失败，请检查网络或后端服务" });
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    getScheduleConfig().then((data) => { setForm(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const presets = [
    { label: "每天凌晨 3 点", value: "0 3 * * *" },
    { label: "每天早上 8 点", value: "0 8 * * *" },
    { label: "每 6 小时", value: "0 */6 * * *" },
    { label: "每小时", value: "0 * * * *" },
  ];

  const handleSave = async () => {
    if (form.enabled && !isValidCron(form.cronExpression)) {
      setError("Cron 表达式格式不正确（示例：0 3 * * *）");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateScheduleConfig(form);
      setSaved(true);
      setTimeout(() => { setSaved(false); onClose(); }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const disabled = !form.enabled;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-800">定时连通性监测设置</h3>
        {loading ? (
          <div className="py-8 text-center text-gray-400 text-sm">加载中...</div>
        ) : (
          <div className="space-y-4">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={form.enabled}
                onChange={(e) => setForm(p => ({ ...p, enabled: e.target.checked }))}
                className="w-4 h-4 accent-blue-600" />
              <span className="text-sm text-gray-700 font-medium">启用定时自动检测</span>
            </label>
            <div className={`space-y-4 transition-opacity ${disabled ? "opacity-40 pointer-events-none" : ""}`}>
              <Field label="Cron 表达式">
                <input className={`${inputCls} font-mono`} value={form.cronExpression} placeholder="0 3 * * *"
                  onChange={(e) => setForm(p => ({ ...p, cronExpression: e.target.value }))} />
              </Field>
              <div>
                <p className="text-xs text-gray-500 mb-2">快速选择</p>
                <div className="flex flex-wrap gap-2">
                  {presets.map((p) => (
                    <button key={p.value} type="button"
                      onClick={() => setForm(prev => ({ ...prev, cronExpression: p.value }))}
                      className={`px-3 py-1 text-xs rounded border transition ${
                        form.cronExpression.trim() === p.value
                          ? "bg-blue-100 text-blue-700 border-blue-300 font-medium"
                          : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                      }`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <Field label="时区">
                <select className={inputCls} value={form.timezone ?? "Asia/Shanghai"}
                  onChange={(e) => setForm(p => ({ ...p, timezone: e.target.value }))}>
                  <option value="Asia/Shanghai">Asia/Shanghai（北京时间）</option>
                  <option value="UTC">UTC</option>
                  <option value="America/New_York">America/New_York</option>
                </select>
              </Field>
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-500">
                  当前设置：<span className="text-gray-700 font-medium">
                    {isValidCron(form.cronExpression) ? describeCron(form.cronExpression) : <span className="text-red-400">Cron 格式有误</span>}
                  </span>
                </p>
                <p className="text-xs text-gray-400 mt-0.5 font-mono">{form.cronExpression}</p>
              </div>
            </div>
            {disabled && (
              <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">当前设置：已禁用，不会自动执行检测</p>
            )}
            <div className="border-t pt-4 space-y-2">
              <Field label="即时通知 Webhook URL">
                <div className="flex gap-2">
                  <input className={`${inputCls} font-mono flex-1`}
                    placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                    value={form.webhookUrl ?? ""}
                    onChange={(e) => setForm(p => ({ ...p, webhookUrl: e.target.value }))} />
                  <button type="button" onClick={handleTestWebhook}
                    disabled={testing || !form.webhookUrl}
                    className="px-3 py-2 text-xs border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 rounded-lg transition whitespace-nowrap">
                    {testing ? "发送中..." : "测试"}
                  </button>
                </div>
              </Field>
              {testResult && (
                <p className={`text-xs ${testResult.success ? "text-green-600" : "text-red-500"}`}>
                  {testResult.success ? "✓ " : "✗ "}{testResult.message}
                </p>
              )}
              <p className="text-xs text-gray-400">支持飞书机器人 Webhook。状态突变时自动推送，连续相同状态不重复告警。</p>
            </div>
          </div>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
        {saved && <p className="text-xs text-green-600">✓ 已保存，正在关闭...</p>}
        <ModalFooter onCancel={onClose} onConfirm={handleSave} loading={saving} confirmText="保存设置" />
      </div>
    </div>
  );
}

// ─── E2E 定时深度监测设置弹窗 ────────────────────────────────
function E2EScheduleModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<E2EScheduleConfig>({
    enabled: false, cronExpression: "0 8 * * *", timezone: "Asia/Shanghai", prompt: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getE2EScheduleConfig().then((data) => { setForm(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const presets = [
    { label: "每天早上 8 点", value: "0 8 * * *" },
    { label: "每天凌晨 2 点", value: "0 2 * * *" },
    { label: "每天中午 12 点", value: "0 12 * * *" },
  ];

  const handleSave = async () => {
    if (form.enabled && !isValidCron(form.cronExpression)) {
      setError("Cron 表达式格式不正确");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateE2EScheduleConfig(form);
      setSaved(true);
      setTimeout(() => { setSaved(false); onClose(); }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-gray-800">定时深度监测设置</h3>
          <p className="text-xs text-gray-400 mt-1">深度监测将真实调用模型 API 并产生费用，请谨慎配置频率</p>
        </div>
        {loading ? (
          <div className="py-8 text-center text-gray-400 text-sm">加载中...</div>
        ) : (
          <div className="space-y-4">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={form.enabled}
                onChange={(e) => setForm(p => ({ ...p, enabled: e.target.checked }))}
                className="w-4 h-4 accent-blue-600" />
              <span className="text-sm text-gray-700 font-medium">启用定时深度监测</span>
            </label>
            <div className={`space-y-4 transition-opacity ${!form.enabled ? "opacity-40 pointer-events-none" : ""}`}>
              <Field label="Cron 表达式">
                <input className={`${inputCls} font-mono`} value={form.cronExpression} placeholder="0 8 * * *"
                  onChange={(e) => setForm(p => ({ ...p, cronExpression: e.target.value }))} />
              </Field>
              <div>
                <p className="text-xs text-gray-500 mb-2">快速选择</p>
                <div className="flex flex-wrap gap-2">
                  {presets.map((p) => (
                    <button key={p.value} type="button"
                      onClick={() => setForm(prev => ({ ...prev, cronExpression: p.value }))}
                      className={`px-3 py-1 text-xs rounded border transition ${
                        form.cronExpression.trim() === p.value
                          ? "bg-purple-100 text-purple-700 border-purple-300 font-medium"
                          : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                      }`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-500">
                  当前设置：<span className="text-gray-700 font-medium">
                    {isValidCron(form.cronExpression) ? describeCron(form.cronExpression) : <span className="text-red-400">格式有误</span>}
                  </span>
                </p>
              </div>
            </div>
            <Field label="深度监测提示词">
              <textarea className={`${inputCls} resize-none`} rows={3}
                placeholder="留空则使用默认提示词：现代极简风格大平层客厅..."
                value={form.prompt ?? ""}
                onChange={(e) => setForm(p => ({ ...p, prompt: e.target.value }))} />
              <p className="text-xs text-gray-400 mt-1">此提示词将用于所有节点的深度监测，留空使用系统默认词</p>
            </Field>
          </div>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
        {saved && <p className="text-xs text-green-600">✓ 已保存</p>}
        <ModalFooter onCancel={onClose} onConfirm={handleSave} loading={saving} confirmText="保存设置" />
      </div>
    </div>
  );
}

// ─── 深度监测 Terminal ────────────────────────────────────────
interface E2ELog { type: "log" | "ttfb" | "poll" | "done" | "error"; message: string; }

function E2ETerminal({ provider, nodeKey, displayName, onClose }: { provider: string; nodeKey: string; displayName: string; onClose: () => void }) {
  const [logs, setLogs] = useState<E2ELog[]>([]);
  const [running, setRunning] = useState(true);
  const [result, setResult] = useState<{ mediaUrl?: string; duration?: number; error?: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    (async () => {
      try {
        const res = await streamE2ETest({ provider, nodeKey }, ctrl.signal);
        if (!res.body) throw new Error("无响应流");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const ev = JSON.parse(line);
              const type = ev.event as E2ELog["type"];
              const msg = ev.data?.message ?? ev.data?.status ?? JSON.stringify(ev.data);
              setLogs(p => [...p, { type, message: msg }]);
              if (type === "done") {
                setResult({ mediaUrl: ev.data?.resultUrl, duration: ev.data?.elapsedMs ? Math.round(ev.data.elapsedMs / 1000) : undefined });
              } else if (type === "error") {
                setResult({ error: msg });
              }
            } catch { /* skip malformed */ }
          }
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          setLogs(p => [...p, { type: "error", message: e.message ?? "连接中断" }]);
          setResult({ error: e.message });
        }
      } finally {
        setRunning(false);
      }
    })();
    return () => ctrl.abort();
  }, [provider, nodeKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const logColor = (type: E2ELog["type"]) => {
    if (type === "done") return "text-green-400";
    if (type === "error") return "text-red-400";
    if (type === "ttfb") return "text-yellow-300";
    if (type === "poll") return "text-cyan-400";
    return "text-blue-300";
  };

  const isVideo = (url?: string) => url && /\.(mp4|webm|mov|m3u8)(\?|$)/i.test(url);

  return (
    <div className="mt-2 rounded-lg overflow-hidden border border-gray-700 shadow-lg w-full max-w-full">
      <div className="bg-gray-900 px-3 py-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 shrink-0" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
          <span className="ml-2 text-xs text-gray-400 font-mono truncate">深度监测 — {displayName} ({provider})</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {running && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
          <button onClick={() => { abortRef.current?.abort(); onClose(); }}
            className="text-gray-500 hover:text-gray-300 text-xs transition">✕</button>
        </div>
      </div>
      <div className="bg-gray-950 px-3 py-2 h-40 overflow-y-auto overflow-x-hidden font-mono text-xs leading-5">
        {logs.map((l, i) => (
          <div key={i} className={`${logColor(l.type)} whitespace-pre-wrap break-all`}>
            <span className="text-gray-600 select-none mr-2">{String(i + 1).padStart(2, "0")}</span>
            {l.message}
          </div>
        ))}
        {running && <div className="text-gray-500 animate-pulse">▋</div>}
        <div ref={bottomRef} />
      </div>
      {result && (
        <div className="bg-gray-900 border-t border-gray-700 px-3 py-2 flex flex-col lg:flex-row items-start gap-3 w-full overflow-hidden">
          {result.error ? (
            <p className="text-xs text-red-400 font-mono whitespace-pre-wrap break-all">✗ {result.error}</p>
          ) : (
            <>
              {result.mediaUrl && (
                isVideo(result.mediaUrl)
                  ? <video src={result.mediaUrl} controls className="h-20 rounded border border-gray-700 shrink-0" />
                  : <img src={result.mediaUrl} alt="result" className="h-20 rounded border border-gray-700 object-cover shrink-0" />
              )}
              <div className="text-xs text-green-400 font-mono space-y-0.5 flex-1 min-w-0">
                <p>✓ 监测成功</p>
                {result.duration != null && <p className="text-gray-400">耗时 {result.duration}s</p>}
                {result.mediaUrl && (
                  <button onClick={() => openVideoPreview(result.mediaUrl!)}
                    className="text-blue-400 hover:underline break-all block cursor-pointer">查看结果 ↗</button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 共用小组件 ──────────────────────────────────────────────
const inputCls = "w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-gray-500 mb-1 block">{label}</label>
      {children}
    </div>
  );
}

function ModalFooter({ onCancel, onConfirm, loading, confirmText }: {
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
  confirmText: string;
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition">取消</button>
      <button onClick={onConfirm} disabled={loading} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg transition">
        {loading ? "处理中..." : confirmText}
      </button>
    </div>
  );
}

// ─── 主组件 ──────────────────────────────────────────────────
export function ApiHealthDashboard({ onEditNodeConfig }: { onEditNodeConfig?: (nodeKey: string) => void }) {
  const [result, setResult] = useState<HealthCheckResult | null>(null);
  const [nodes, setNodes] = useState<ApiHealthNode[]>([]);
  const [e2eLogs, setE2eLogs] = useState<Record<string, LatestE2ELog>>({});
  const [apiConfigs, setApiConfigs] = useState<ApiConfig[]>([]);
  const [configMap, setConfigMap] = useState<Record<string, ApiConfig>>({});
  const [globalLoading, setGlobalLoading] = useState(false);
  const [rowLoading, setRowLoading] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "healthy" | "unhealthy" | "unknown">("all");
  const [showSchedule, setShowSchedule] = useState(false);
  const [showE2ESchedule, setShowE2ESchedule] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ApiConfig | null>(null);
  const [bindingNode, setBindingNode] = useState<ApiHealthNode | null>(null);
  const [e2eOpenNodeKey, setE2eOpenNodeKey] = useState<string | null>(null);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [statusData, nodeData, e2eData, configData] = await Promise.all([
        getApiHealthStatus().catch(() => null),
        getApiHealthNodes(),
        getLatestE2ELogs().catch(() => ({})),
        getApiConfigs().catch(() => []),
      ]);
      if (statusData) setResult(statusData);
      setNodes(nodeData);
      setE2eLogs(e2eData);
      setApiConfigs(configData);
      setConfigMap(Object.fromEntries(configData.map((cfg) => [cfg.id, cfg])));
    } catch { /* 静默 */ }
  };

  const handleCheckAll = async () => {
    setGlobalLoading(true);
    try { setResult(await checkAllApis()); }
    catch (e) { console.error(e); }
    finally { setGlobalLoading(false); }
  };

  const handleCheckSingle = async (nodeKey: string) => {
    setRowLoading(p => ({ ...p, [nodeKey]: true }));
    try {
      const updated = await checkSingleNode(nodeKey);
      setResult(prev => prev ? { ...prev, apis: prev.apis.map(a => a.nodeKey === nodeKey ? updated : a) } : prev);
    } catch (e) { console.error(e); }
    finally { setRowLoading(p => ({ ...p, [nodeKey]: false })); }
  };

  // 深度监测完成后刷新 L2 列
  const handleE2EClose = async () => {
    setE2eOpenNodeKey(null);
    try {
      const fresh = await getLatestE2ELogs();
      setE2eLogs(fresh);
    } catch { /* 静默 */ }
  };

  const mergedRows = nodes.map(node => ({ node, health: result?.apis.find(a => a.nodeKey === node.nodeKey) }));
  const filteredRows = mergedRows.filter(({ node, health }) => {
    const normalizedTerm = searchTerm.toLowerCase();
    const normalizedModelName = node.modelName?.toLowerCase() ?? "";
    const normalizedProvider = node.provider?.toLowerCase() ?? "";
    const normalizedChannelName = node.channelName?.toLowerCase() ?? "";
    const matchSearch = !searchTerm
      || node.name.toLowerCase().includes(normalizedTerm)
      || node.nodeKey.toLowerCase().includes(normalizedTerm)
      || normalizedProvider.includes(normalizedTerm)
      || normalizedChannelName.includes(normalizedTerm)
      || normalizedModelName.includes(normalizedTerm);
    const matchStatus = statusFilter === "all" || (health?.status ?? "unknown") === statusFilter;
    return matchSearch && matchStatus;
  });

  const filterLabels = { all: "全部", healthy: "正常", unhealthy: "异常", unknown: "未知" };

  return (
    <div className="space-y-6">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">API 节点监测</h2>
          {result && (
            <p className="text-xs text-gray-400 mt-0.5">
              最后连通性检查：{new Date(result.timestamp).toLocaleString("zh-CN")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSchedule(true)}
            className="px-3 py-2 text-sm border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg transition">
            定时监测设置
          </button>
          <button onClick={handleCheckAll} disabled={globalLoading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition">
            {globalLoading ? (
              <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />检测中...</>
            ) : "⚡ 一键连通性检测"}
          </button>
          <button onClick={() => setShowE2ESchedule(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg transition">
            🎬 定时深度监测
          </button>
        </div>
      </div>

      {/* 汇总统计 */}
      {result && (
        <div className="grid grid-cols-4 gap-4">
          <SummaryCard label="总节点数" value={result.totalApis} color="text-blue-700" />
          <SummaryCard label="连通正常" value={result.healthyCount} color="text-green-700" />
          <SummaryCard label="连通异常" value={result.unhealthyCount} color="text-red-700" />
          <SummaryCard label="未检测" value={result.unknownCount} color="text-gray-500" />
        </div>
      )}

      {/* 搜索 + 筛选 */}
      <div className="flex gap-3 items-center">
        <input type="text" placeholder="搜索业务节点 / nodeKey / provider / modelName..." value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg w-56 focus:outline-none focus:ring-2 focus:ring-blue-300" />
        <div className="flex gap-1">
          {(["all", "healthy", "unhealthy", "unknown"] as const).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition ${statusFilter === f ? "bg-blue-100 text-blue-700 border border-blue-300" : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"}`}>
              {filterLabels[f]}
            </button>
          ))}
        </div>
      </div>

      {/* 主表格 */}
      <div className="bg-white rounded-lg border shadow-sm overflow-x-hidden">
        {globalLoading && <div className="h-1 bg-blue-500 animate-pulse" />}
        <table className="w-full table-fixed text-xs">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-2 py-2 font-medium text-gray-600 w-[20%]">业务节点</th>
              <th className="text-left px-2 py-2 font-medium text-gray-600 w-[20%]">底层通道</th>
              <th className="text-left px-2 py-2 font-medium text-gray-600 w-[18%]">代理 URL</th>
              <th className="text-left px-2 py-2 font-medium text-gray-600 w-[14%]">
                <span className="inline-flex items-center gap-1">
                  <span className="text-blue-500">📡</span> 连通性 (L1)
                </span>
              </th>
              <th className="text-left px-2 py-2 font-medium text-gray-600 w-[14%]">
                <span className="inline-flex items-center gap-1">
                  <span className="text-purple-500">🎬</span> 最新深度监测 (L2)
                </span>
              </th>
              <th className="text-left px-2 py-2 font-medium text-gray-600 w-[14%]">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-16 text-gray-400 text-sm">
                  {nodes.length === 0 ? "暂无业务节点，请先在「节点管理」中初始化配置" : "暂无匹配节点"}
                </td>
              </tr>
            ) : filteredRows.map(({ node, health }) => (
              <Fragment key={node.nodeKey}>
                <tr className={`hover:bg-gray-50 transition ${health?.status === "unhealthy" ? "bg-red-50/40" : ""} ${!node.monitorable ? "opacity-60" : ""}`}>
                  {/* 业务节点 */}
                  <td className="px-2 py-2 align-top">
                    <div className="font-medium text-gray-800">
                      <span>{node.name}</span>
                      {node.modelName?.trim() && (
                        <span className="text-gray-400 text-sm"> [{node.modelName.trim()}]</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-xs text-gray-400 font-mono">{node.nodeKey}</span>
                      {node.serviceType && (
                        <span className="text-xs text-blue-500 font-mono bg-blue-50 px-1.5 py-0.5 rounded">{node.serviceType}</span>
                      )}
                      {node.nodeStatus !== "normal" && (
                        <span className="text-xs text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded">状态:{node.nodeStatus}</span>
                      )}
                    </div>
                  </td>

                  {/* 底层通道 */}
                  <td className="px-2 py-2 align-top">
                    {(() => {
                      const bindingMeta = BINDING_STRATEGY_META[node.bindingStrategy];
                      return (
                        <span
                          title={bindingMeta.title}
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs mb-1 ${bindingMeta.className}`}
                        >
                          {bindingMeta.label}
                        </span>
                      );
                    })()}
                    {node.configId ? (
                      <div className="space-y-0.5">
                        <div className="font-medium text-gray-700">{node.channelName || "-"}</div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-400 font-mono">{node.provider || "-"}</span>
                          {node.channelType && (
                            <span className="text-xs text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded">{node.channelType}</span>
                          )}
                        </div>
                        {node.apiProtocol && (
                          <span className="text-xs text-purple-500 font-mono bg-purple-50 px-1.5 py-0.5 rounded">{node.apiProtocol}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-red-400">未绑定渠道</span>
                    )}
                  </td>

                  {/* 代理 URL */}
                  <td className="px-2 py-2 text-gray-400 font-mono text-[11px] leading-4 break-all align-top" title={node.endpoint ?? ""}>
                    {node.endpoint || "-"}
                  </td>

                  {/* L1 连通性 */}
                  <td className="px-2 py-2 align-top">
                    {health ? (
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={health.status} />
                          {health.latencyMs != null && (
                            <span className={`text-xs tabular-nums ${health.latencyMs > 3000 ? "text-orange-500 font-medium" : "text-gray-500"}`}>
                              {health.latencyMs} ms
                            </span>
                          )}
                        </div>
                        {health.error && (
                          <p className="text-xs text-red-400 leading-4 break-words" title={health.error}>{health.error}</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-300 text-xs">未检测</span>
                    )}
                  </td>

                  {/* L2 深度监测 */}
                  <td className="px-2 py-2 align-top">
                    {node.apiProtocol && node.configId ? (
                      <L2Cell log={e2eLogs[node.nodeKey]} />
                    ) : (
                      <span className="text-xs text-gray-300">{node.monitorDisabledReason || "未配置协议"}</span>
                    )}
                  </td>

                  {/* 操作 */}
                  <td className="px-2 py-2 align-top">
                    <div className="grid grid-cols-2 gap-1">
                      <button
                        onClick={() => onEditNodeConfig?.(node.nodeKey)}
                        disabled={!onEditNodeConfig}
                        className="px-2 py-1 text-[11px] rounded border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40 transition"
                      >
                        编辑节点
                      </button>
                      <button
                        onClick={() => setBindingNode(node)}
                        className="px-2 py-1 text-[11px] rounded border border-gray-200 text-gray-600 hover:bg-gray-100 transition"
                      >
                        切换通道
                      </button>
                      <button
                        onClick={() => {
                          if (!node.configId) return;
                          const config = configMap[node.configId];
                          if (!config) {
                            window.alert("未找到底层通道配置，请刷新后重试");
                            return;
                          }
                          setEditingConfig(config);
                        }}
                        disabled={!node.configId}
                        className="px-2 py-1 text-[11px] rounded border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40 transition"
                      >
                        编辑通道
                      </button>
                      <button onClick={() => handleCheckSingle(node.nodeKey)}
                        disabled={rowLoading[node.nodeKey] || globalLoading || !node.configId}
                        className="px-2 py-1 text-[11px] rounded border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40 transition">
                        {rowLoading[node.nodeKey] ? "测试中..." : "测连通"}
                      </button>
                      {node.apiProtocol && node.configId && (
                        <button
                          onClick={() => {
                            if (!window.confirm(`此操作将触发模型真实的视频/图像生成过程，并产生实际费用。\n\n节点：${formatNodeDisplayName({ name: node.name, modelName: node.modelName })}\n通道：${node.channelName || "-"} (${node.provider || "-"})\n协议：${node.apiProtocol}\n\n确认继续吗？`)) return;
                            setE2eOpenNodeKey(p => p === node.nodeKey ? null : node.nodeKey);
                          }}
                          className={`col-span-2 px-2 py-1 text-[11px] rounded border transition ${
                            e2eOpenNodeKey === node.nodeKey
                              ? "border-purple-400 bg-purple-100 text-purple-700"
                              : "border-purple-200 text-purple-600 hover:bg-purple-50"
                          }`}>
                          💰 深度监测
                        </button>
                      )}
                    </div>
                  </td>
                </tr>

                {/* 展开行：深度监测 Terminal */}
                {e2eOpenNodeKey === node.nodeKey && (
                  <tr>
                    <td colSpan={6} className="px-4 pb-3">
                      <E2ETerminal
                        nodeKey={node.nodeKey}
                        provider={node.provider || "unknown"}
                        displayName={formatNodeDisplayName({ name: node.name, modelName: node.modelName })}
                        onClose={handleE2EClose}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* 历史趋势折线图 */}
      <ApiHealthChart />

      {/* 弹窗 */}
      {showSchedule && <ScheduleModal onClose={() => setShowSchedule(false)} />}
      {showE2ESchedule && <E2EScheduleModal onClose={() => setShowE2ESchedule(false)} />}
      {bindingNode && (
        <BindingModal
          node={bindingNode}
          configs={apiConfigs}
          onClose={() => setBindingNode(null)}
          onSaved={(updated) => {
            setBindingNode(null);
            setNodes((prev) => prev.map((item) => (item.nodeKey === updated.nodeKey ? updated : item)));
            loadAll();
          }}
        />
      )}
      {editingConfig && (
        <EditModal
          config={editingConfig}
          onClose={() => setEditingConfig(null)}
          onSaved={(updated) => {
            setEditingConfig(null);
            setConfigMap((prev) => ({ ...prev, [updated.id]: updated }));
            loadAll();
          }}
        />
      )}
    </div>
  );
}
