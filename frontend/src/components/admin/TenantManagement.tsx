import { useEffect, useState } from "react";
import {
  getTenants,
  createTenant,
  updateTenant,
  addTenantDomain,
  removeTenantDomain,
  type TenantInfo,
} from "@/services/adminApi";

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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
