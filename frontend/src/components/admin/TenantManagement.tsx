import { useEffect, useState } from "react";
import {
  getTenants,
  createTenant,
  updateTenant,
  addTenantDomain,
  removeTenantDomain,
  setTenantApiKeys,
  getTenantPaymentConfig,
  setTenantPaymentConfig,
  type TenantInfo,
  type TenantPaymentConfig,
  type SetTenantPaymentConfigBody,
} from "@/services/adminApi";

// 支付配置表单字段：明文回显，密文留空=不变
type PayForm = {
  wechatAppId: string;
  wechatMchId: string;
  wechatSerialNo: string;
  wechatPrivateKey: string;
  wechatCertificate: string;
  wechatApiV3Key: string;
  alipayAppId: string;
  alipayPrivateKey: string;
  alipayPublicKey: string;
};
const EMPTY_PAY_FORM: PayForm = {
  wechatAppId: "",
  wechatMchId: "",
  wechatSerialNo: "",
  wechatPrivateKey: "",
  wechatCertificate: "",
  wechatApiV3Key: "",
  alipayAppId: "",
  alipayPrivateKey: "",
  alipayPublicKey: "",
};

/** 主站超管的租户管理面板（系统设置 → 租户管理） */
export default function TenantManagement() {
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 新建租户表单
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", host: "" });

  // 给某租户加域名
  const [domainInput, setDomainInput] = useState<Record<string, string>>({});

  // new-api key 配置：展开的租户id + 三档输入
  const [keyPanel, setKeyPanel] = useState<string | null>(null);
  const [keyForm, setKeyForm] = useState<{
    newApiKey: string;
    newApiKeyVip: string;
    newApiKeySvip: string;
  }>({ newApiKey: "", newApiKeyVip: "", newApiKeySvip: "" });
  const [keySaving, setKeySaving] = useState(false);

  // 支付配置：展开的租户id + 当前配置 + 表单
  const [payPanel, setPayPanel] = useState<string | null>(null);
  const [payCfg, setPayCfg] = useState<TenantPaymentConfig | null>(null);
  const [payForm, setPayForm] = useState<PayForm>(EMPTY_PAY_FORM);
  const [paySaving, setPaySaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      setTenants(await getTenants());
    } catch (e: any) {
      setErr(e?.message || "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleCreate = async () => {
    if (!form.name.trim() || !form.slug.trim()) {
      setErr("名称和 slug 必填");
      return;
    }
    try {
      await createTenant({
        name: form.name.trim(),
        slug: form.slug.trim(),
        host: form.host.trim() || undefined,
      });
      setForm({ name: "", slug: "", host: "" });
      setShowCreate(false);
      await load();
    } catch (e: any) {
      setErr(e?.message || "新建失败");
    }
  };

  const toggleStatus = async (t: TenantInfo) => {
    try {
      await updateTenant(t.id, { status: t.status === "active" ? "suspended" : "active" });
      await load();
    } catch (e: any) {
      setErr(e?.message || "更新失败");
    }
  };

  const handleAddDomain = async (tenantId: string) => {
    const host = (domainInput[tenantId] || "").trim();
    if (!host) return;
    try {
      await addTenantDomain(tenantId, { host });
      setDomainInput((s) => ({ ...s, [tenantId]: "" }));
      await load();
    } catch (e: any) {
      setErr(e?.message || "添加域名失败");
    }
  };

  const handleRemoveDomain = async (tenantId: string, domainId: string) => {
    try {
      await removeTenantDomain(tenantId, domainId);
      await load();
    } catch (e: any) {
      setErr(e?.message || "删除域名失败");
    }
  };

  const openKeyPanel = (tenantId: string) => {
    setKeyPanel((cur) => (cur === tenantId ? null : tenantId));
    // 不回填明文（后端不返回），留空表示保持不变
    setKeyForm({ newApiKey: "", newApiKeyVip: "", newApiKeySvip: "" });
  };

  const handleSaveKeys = async (tenantId: string) => {
    setKeySaving(true);
    try {
      // 只提交非空字段；要清除某档请输入单个空格（trim 后为空 → 后端清除）
      const body: Record<string, string> = {};
      if (keyForm.newApiKey !== "") body.newApiKey = keyForm.newApiKey;
      if (keyForm.newApiKeyVip !== "") body.newApiKeyVip = keyForm.newApiKeyVip;
      if (keyForm.newApiKeySvip !== "") body.newApiKeySvip = keyForm.newApiKeySvip;
      await setTenantApiKeys(tenantId, body);
      setKeyPanel(null);
      await load();
    } catch (e: any) {
      setErr(e?.message || "保存 key 失败");
    } finally {
      setKeySaving(false);
    }
  };

  const openPayPanel = async (tenantId: string) => {
    if (payPanel === tenantId) {
      setPayPanel(null);
      return;
    }
    setPayPanel(tenantId);
    setPayCfg(null);
    setPayForm(EMPTY_PAY_FORM);
    try {
      const cfg = await getTenantPaymentConfig(tenantId);
      setPayCfg(cfg);
      // 明文字段回显，便于核对；密文字段留空表示保持不变
      setPayForm({
        ...EMPTY_PAY_FORM,
        wechatAppId: cfg.wechat.appId || "",
        wechatMchId: cfg.wechat.mchId || "",
        wechatSerialNo: cfg.wechat.serialNo || "",
        alipayAppId: cfg.alipay.appId || "",
      });
    } catch (e: any) {
      setErr(e?.message || "加载支付配置失败");
    }
  };

  const handleSavePayment = async (tenantId: string) => {
    setPaySaving(true);
    try {
      // 只提交有变化/有值的字段；要清除某项请输入一个空格
      const body: SetTenantPaymentConfigBody = {};
      (Object.keys(payForm) as (keyof PayForm)[]).forEach((k) => {
        if (payForm[k] !== "") body[k] = payForm[k];
      });
      await setTenantPaymentConfig(tenantId, body);
      setPayPanel(null);
      await load();
    } catch (e: any) {
      setErr(e?.message || "保存支付配置失败");
    } finally {
      setPaySaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">租户管理</h3>
        <div className="flex gap-2">
          <button
            onClick={() => void load()}
            className="rounded-md border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            刷新
          </button>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            {showCreate ? "取消" : "+ 新建租户"}
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>
      )}

      {showCreate && (
        <div className="rounded-lg border bg-gray-50 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input
              className="rounded-md border px-3 py-2 text-sm"
              placeholder="名称（如 Acme公司）"
              value={form.name}
              onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
            />
            <input
              className="rounded-md border px-3 py-2 text-sm"
              placeholder="slug（小写字母/数字/-）"
              value={form.slug}
              onChange={(e) => setForm((s) => ({ ...s, slug: e.target.value }))}
            />
            <input
              className="rounded-md border px-3 py-2 text-sm"
              placeholder="首个域名（可选，如 acme.localhost）"
              value={form.host}
              onChange={(e) => setForm((s) => ({ ...s, host: e.target.value }))}
            />
          </div>
          <div className="mt-3">
            <button
              onClick={() => void handleCreate()}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              创建
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-sm text-gray-400">加载中…</div>
      ) : (
        <div className="space-y-3">
          {tenants.map((t) => (
            <div key={t.id} className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{t.name}</span>
                  <span className="text-xs text-gray-400">@{t.slug}</span>
                  {t.isPlatform && (
                    <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700">
                      主站
                    </span>
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      t.status === "active"
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-200 text-gray-600"
                    }`}
                  >
                    {t.status === "active" ? "启用" : "停用"}
                  </span>
                  <span className="text-xs text-gray-500">{t.userCount} 用户</span>
                </div>
                {!t.isPlatform && (
                  <button
                    onClick={() => void toggleStatus(t)}
                    className="rounded-md border px-3 py-1 text-xs text-gray-600 hover:bg-gray-100"
                  >
                    {t.status === "active" ? "停用" : "启用"}
                  </button>
                )}
              </div>

              <div className="mt-3">
                <div className="mb-1 text-xs font-medium text-gray-500">域名</div>
                <div className="flex flex-wrap gap-2">
                  {t.domains.map((d) => (
                    <span
                      key={d.id}
                      className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs"
                    >
                      {d.host}
                      {d.isPrimary && <span className="text-blue-600">主</span>}
                      <button
                        onClick={() => void handleRemoveDomain(t.id, d.id)}
                        className="text-gray-400 hover:text-red-500"
                        title="删除域名"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {t.domains.length === 0 && (
                    <span className="text-xs text-gray-400">暂无域名</span>
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    className="rounded-md border px-2 py-1 text-xs"
                    placeholder="添加域名，如 acme.localhost"
                    value={domainInput[t.id] || ""}
                    onChange={(e) =>
                      setDomainInput((s) => ({ ...s, [t.id]: e.target.value }))
                    }
                  />
                  <button
                    onClick={() => void handleAddDomain(t.id)}
                    className="rounded-md border px-3 py-1 text-xs text-gray-600 hover:bg-gray-100"
                  >
                    添加
                  </button>
                </div>
              </div>

              {/* new-api 三组 key 配置 */}
              {!t.isPlatform && (
                <div className="mt-3 border-t pt-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
                      <span>new-api Key</span>
                      {(["normal", "vip", "svip"] as const).map((k) => (
                        <span
                          key={k}
                          className={`rounded px-1.5 py-0.5 ${
                            t.apiKeys?.[k]
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-400"
                          }`}
                          title={t.apiKeys?.[k] ? "已配置" : "未配置(回落平台key)"}
                        >
                          {k}
                          {t.apiKeys?.[k] ? "✓" : "·"}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => openKeyPanel(t.id)}
                      className="rounded-md border px-3 py-1 text-xs text-gray-600 hover:bg-gray-100"
                    >
                      {keyPanel === t.id ? "收起" : "配置 key"}
                    </button>
                  </div>

                  {keyPanel === t.id && (
                    <div className="mt-2 space-y-2 rounded-md bg-gray-50 p-3">
                      <p className="text-xs text-gray-400">
                        留空=保持不变；要清除某档请输入一个空格。未配置则回落平台共享 key。
                      </p>
                      {(
                        [
                          ["newApiKey", "普通 (normal)"],
                          ["newApiKeyVip", "VIP"],
                          ["newApiKeySvip", "SVIP"],
                        ] as const
                      ).map(([field, label]) => (
                        <div key={field} className="flex items-center gap-2">
                          <span className="w-24 shrink-0 text-xs text-gray-500">{label}</span>
                          <input
                            className="flex-1 rounded-md border px-2 py-1 font-mono text-xs"
                            placeholder="sk-..."
                            value={keyForm[field]}
                            onChange={(e) =>
                              setKeyForm((s) => ({ ...s, [field]: e.target.value }))
                            }
                          />
                        </div>
                      ))}
                      <button
                        onClick={() => void handleSaveKeys(t.id)}
                        disabled={keySaving}
                        className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {keySaving ? "保存中…" : "保存 key"}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 支付商户配置（独立商户号/证书，未配则回落主站） */}
              {!t.isPlatform && (
                <div className="mt-3 border-t pt-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
                      <span>支付商户</span>
                      {(["wechat", "alipay"] as const).map((c) => (
                        <span
                          key={c}
                          className={`rounded px-1.5 py-0.5 ${
                            t.payment?.[c]
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-400"
                          }`}
                          title={t.payment?.[c] ? "已配置独立商户" : "未配置(回落主站)"}
                        >
                          {c === "wechat" ? "微信" : "支付宝"}
                          {t.payment?.[c] ? "✓" : "·"}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => void openPayPanel(t.id)}
                      className="rounded-md border px-3 py-1 text-xs text-gray-600 hover:bg-gray-100"
                    >
                      {payPanel === t.id ? "收起" : "配置支付"}
                    </button>
                  </div>

                  {payPanel === t.id && (
                    <div className="mt-2 space-y-3 rounded-md bg-gray-50 p-3">
                      <p className="text-xs text-gray-400">
                        明文(appid/商户号/序列号)回显当前值；私钥/证书/APIv3 key 留空=保持不变，
                        要清除请输入一个空格。整渠道未配则回落主站。
                      </p>

                      {(
                        [
                          {
                            title: "微信支付",
                            fields: [
                              ["wechatAppId", "AppID", false, false],
                              ["wechatMchId", "商户号 mchid", false, false],
                              ["wechatSerialNo", "证书序列号", false, false],
                              ["wechatPrivateKey", "商户私钥", true, payCfg?.wechat.privateKey],
                              ["wechatCertificate", "平台证书", true, payCfg?.wechat.certificate],
                              ["wechatApiV3Key", "APIv3 Key", true, payCfg?.wechat.apiV3Key],
                            ] as const,
                          },
                          {
                            title: "支付宝",
                            fields: [
                              ["alipayAppId", "AppID", false, false],
                              ["alipayPrivateKey", "应用私钥", true, payCfg?.alipay.privateKey],
                              ["alipayPublicKey", "支付宝公钥", true, payCfg?.alipay.publicKey],
                            ] as const,
                          },
                        ] as const
                      ).map((group) => (
                        <div key={group.title} className="space-y-2">
                          <div className="text-xs font-semibold text-gray-600">{group.title}</div>
                          {group.fields.map(([field, label, isSecret, configured]) => (
                            <div key={field} className="flex items-start gap-2">
                              <span className="mt-1 w-24 shrink-0 text-xs text-gray-500">{label}</span>
                              {isSecret ? (
                                <textarea
                                  className="flex-1 rounded-md border px-2 py-1 font-mono text-xs"
                                  rows={2}
                                  placeholder={configured ? "已配置，留空=保持不变" : "未配置"}
                                  value={payForm[field as keyof PayForm]}
                                  onChange={(e) =>
                                    setPayForm((s) => ({ ...s, [field]: e.target.value }))
                                  }
                                />
                              ) : (
                                <input
                                  className="flex-1 rounded-md border px-2 py-1 font-mono text-xs"
                                  placeholder={label}
                                  value={payForm[field as keyof PayForm]}
                                  onChange={(e) =>
                                    setPayForm((s) => ({ ...s, [field]: e.target.value }))
                                  }
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      ))}

                      <button
                        onClick={() => void handleSavePayment(t.id)}
                        disabled={paySaving}
                        className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {paySaving ? "保存中…" : "保存支付配置"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
