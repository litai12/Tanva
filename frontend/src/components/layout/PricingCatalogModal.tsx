import React from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import {
  getManagedPricingCatalog,
  type ManagedPricingCatalogCondition,
  type ManagedPricingCatalogItem,
  type ManagedPricingCatalogRule,
  type ManagedPricingCatalogVendor,
} from "@/services/adminApi";

const ALL_MODELS_KEY = "__all_models__";

const formatDefaultPrice = (vendor: ManagedPricingCatalogVendor) => {
  if (typeof vendor.defaultPrice?.credits === "number") {
    return `${vendor.defaultPrice.credits} 积分`;
  }
  return "未配置";
};

const formatCondition = (condition: ManagedPricingCatalogCondition) => {
  const opMap: Record<string, string> = {
    eq: "=",
    in: "in",
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
    exists: "exists",
  };
  const operator = opMap[condition.op] || condition.op;
  const value = Array.isArray(condition.value)
    ? `[${condition.value.join(", ")}]`
    : condition.value === undefined
    ? ""
    : String(condition.value);
  return value ? `${condition.field} ${operator} ${value}` : `${condition.field} ${operator}`;
};

const RuleCard: React.FC<{ rule: ManagedPricingCatalogRule }> = ({ rule }) => (
  <div className='rounded-2xl border border-slate-200 bg-slate-50/80 p-3'>
    <div className='flex flex-wrap items-center gap-2'>
      <div className='text-sm font-semibold text-slate-900'>
        {rule.label || rule.ruleKey || "未命名规则"}
      </div>
      {rule.evaluatorType && (
        <span className='rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 border border-slate-200'>
          {rule.evaluatorType}
        </span>
      )}
    </div>
    {rule.formula && (
      <div className='mt-2 rounded-xl bg-slate-900 px-3 py-2 font-mono text-[11px] leading-5 text-slate-100'>
        {rule.formula}
      </div>
    )}
    {(rule.conditions.all.length > 0 || rule.conditions.any.length > 0) && (
      <div className='mt-2 space-y-1 text-xs text-slate-600'>
        {rule.conditions.all.length > 0 && (
          <div>
            <span className='font-medium text-slate-800'>命中条件：</span>
            {rule.conditions.all.map((condition, index) => (
              <span key={`${condition.field}-${index}`} className='ml-2 inline-block'>
                {formatCondition(condition)}
              </span>
            ))}
          </div>
        )}
        {rule.conditions.any.length > 0 && (
          <div>
            <span className='font-medium text-slate-800'>任一条件：</span>
            {rule.conditions.any.map((condition, index) => (
              <span key={`${condition.field}-${index}`} className='ml-2 inline-block'>
                {formatCondition(condition)}
              </span>
            ))}
          </div>
        )}
      </div>
    )}
  </div>
);

const VendorCard: React.FC<{ vendor: ManagedPricingCatalogVendor; isDefault: boolean }> = ({
  vendor,
  isDefault,
}) => (
  <div className='rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.06)]'>
    <div className='flex flex-wrap items-center gap-2'>
      <div className='text-base font-semibold text-slate-900'>
        {vendor.label || vendor.vendorKey}
      </div>
      {isDefault && (
        <span className='rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 border border-emerald-200'>
          默认线路
        </span>
      )}
      {!vendor.enabled && (
        <span className='rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 border border-slate-200'>
          已停用
        </span>
      )}
    </div>
    <div className='mt-2 flex flex-wrap gap-2 text-xs text-slate-600'>
      {vendor.provider && (
        <span className='rounded-full bg-slate-100 px-2 py-1 border border-slate-200'>
          Provider: {vendor.provider}
        </span>
      )}
      {vendor.platformKey && (
        <span className='rounded-full bg-slate-100 px-2 py-1 border border-slate-200'>
          Platform: {vendor.platformKey}
        </span>
      )}
      {vendor.pricingVersion && (
        <span className='rounded-full bg-slate-100 px-2 py-1 border border-slate-200'>
          {vendor.pricingVersion}
        </span>
      )}
    </div>

    <div className='mt-4 grid gap-3 md:grid-cols-[220px_1fr]'>
      <div className='rounded-2xl bg-slate-50 p-3'>
        <div className='text-xs font-medium text-slate-500'>默认定价</div>
        <div className='mt-1 text-sm font-semibold text-slate-900'>
          {formatDefaultPrice(vendor)}
        </div>
        {vendor.dimensions.length > 0 && (
          <>
            <div className='mt-4 text-xs font-medium text-slate-500'>计费维度</div>
            <div className='mt-2 flex flex-wrap gap-2'>
              {vendor.dimensions.map((dimension) => (
                <span
                  key={dimension.key}
                  className='rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600'
                >
                  {dimension.label || dimension.key}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <div className='space-y-3'>
        {vendor.rules.length > 0 ? (
          vendor.rules.map((rule, index) => (
            <RuleCard key={`${rule.ruleKey || rule.label || "rule"}-${index}`} rule={rule} />
          ))
        ) : (
          <div className='rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-500'>
            当前线路仅配置默认价，未配置规则。
          </div>
        )}
      </div>
    </div>
  </div>
);

const ModelSection: React.FC<{ item: ManagedPricingCatalogItem }> = ({ item }) => (
  <section className='rounded-[28px] border border-slate-200 bg-white/92 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]'>
    <div className='flex flex-wrap items-center gap-2'>
      <h3 className='text-lg font-semibold text-slate-950'>
        {item.modelName || item.modelKey}
      </h3>
      <span className='rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 border border-slate-200'>
        {item.modelKey}
      </span>
      {item.taskType && (
        <span className='rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 border border-slate-200'>
          {item.taskType}
        </span>
      )}
      {!item.enabled && (
        <span className='rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 border border-amber-200'>
          模型已停用
        </span>
      )}
    </div>
    <div className='mt-4 space-y-4'>
      {item.vendors.map((vendor) => (
        <VendorCard
          key={`${item.modelKey}-${vendor.vendorKey}`}
          vendor={vendor}
          isDefault={item.defaultVendor === vendor.vendorKey}
        />
      ))}
    </div>
  </section>
);

const PricingCatalogModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [catalogItems, setCatalogItems] = React.useState<ManagedPricingCatalogItem[]>([]);
  const [displayItems, setDisplayItems] = React.useState<ManagedPricingCatalogItem[]>([]);
  const [search, setSearch] = React.useState("");
  const [selectedModelKey, setSelectedModelKey] = React.useState<string>(ALL_MODELS_KEY);

  React.useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getManagedPricingCatalog()
      .then((data) => {
        if (cancelled) return;
        const nextItems = Array.isArray(data) ? data : [];
        setCatalogItems(nextItems);
        setDisplayItems(nextItems);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "加载定价失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const run = async () => {
      try {
        if (selectedModelKey === ALL_MODELS_KEY) {
          if (!cancelled) setDisplayItems(catalogItems);
          return;
        }

        const data = await getManagedPricingCatalog({ modelKey: selectedModelKey });
        if (cancelled) return;
        setDisplayItems(Array.isArray(data) ? data : []);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "加载定价失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedModelKey, catalogItems]);

  const filteredSidebarItems = React.useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return catalogItems;
    return catalogItems.filter((item) => {
      const haystack = [item.modelKey, item.modelName, item.taskType]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(keyword);
    });
  }, [catalogItems, search]);

  React.useEffect(() => {
    if (!isOpen || typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div
      className='fixed inset-0 z-[1350] flex items-center justify-center bg-black/30 px-4 py-6 backdrop-blur-[3px]'
      onClick={onClose}
    >
      <div
        className='relative flex h-[88vh] max-h-[820px] w-full max-w-[1220px] overflow-hidden rounded-[32px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] shadow-[0_40px_120px_rgba(15,23,42,0.18)]'
        onClick={(event) => event.stopPropagation()}
      >
        <aside className='hidden w-[280px] shrink-0 border-r border-slate-200 bg-white/88 p-4 md:flex md:flex-col'>
          <div className='text-lg font-semibold text-slate-950'>定价一览</div>
          <div className='mt-1 text-sm text-slate-500'>查看全部模型定价，或聚焦单个模型。</div>
          <div className='relative mt-4'>
            <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400' />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder='搜索模型 key / 名称'
              className='h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:border-slate-300 focus:bg-white'
            />
          </div>
          <div className='mt-4 flex-1 overflow-y-auto space-y-2 pr-1'>
            <button
              type='button'
              onClick={() => setSelectedModelKey(ALL_MODELS_KEY)}
              className={`w-full rounded-2xl border px-3 py-3 text-left text-sm transition ${
                selectedModelKey === ALL_MODELS_KEY
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
              }`}
            >
              全部模型
            </button>
            {filteredSidebarItems.map((item) => (
              <button
                key={item.modelKey}
                type='button'
                onClick={() => setSelectedModelKey(item.modelKey)}
                className={`w-full rounded-2xl border px-3 py-3 text-left text-sm transition ${
                  selectedModelKey === item.modelKey
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
              >
                <div className='font-medium'>{item.modelName || item.modelKey}</div>
                <div className='mt-0.5 text-xs opacity-70'>{item.modelKey}</div>
              </button>
            ))}
          </div>
        </aside>

        <div className='flex min-w-0 flex-1 flex-col'>
          <div className='flex items-start justify-between border-b border-slate-200 px-5 py-4 md:px-6'>
            <div>
              <div className='text-lg font-semibold text-slate-950'>定价一览</div>
              <div className='mt-1 text-sm text-slate-500'>
                线性计费会直接展示积分公式，例如 `credits = durationSec × 80`。
              </div>
            </div>
            <button
              type='button'
              onClick={onClose}
              className='flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-800'
            >
              <X className='h-4 w-4' />
            </button>
          </div>

          <div className='border-b border-slate-200 px-5 py-4 md:hidden'>
            <div className='relative'>
              <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400' />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder='搜索模型 key / 名称'
                className='h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:border-slate-300 focus:bg-white'
              />
            </div>
            <div className='mt-3 flex gap-2 overflow-x-auto pb-1'>
              <button
                type='button'
                onClick={() => setSelectedModelKey(ALL_MODELS_KEY)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${
                  selectedModelKey === ALL_MODELS_KEY
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700"
                }`}
              >
                全部模型
              </button>
              {filteredSidebarItems.map((item) => (
                <button
                  key={item.modelKey}
                  type='button'
                  onClick={() => setSelectedModelKey(item.modelKey)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${
                    selectedModelKey === item.modelKey
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  {item.modelName || item.modelKey}
                </button>
              ))}
            </div>
          </div>

          <div className='min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6'>
            {loading ? (
              <div className='rounded-[28px] border border-slate-200 bg-white p-6 text-sm text-slate-500'>
                正在加载模型定价...
              </div>
            ) : error ? (
              <div className='rounded-[28px] border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700'>
                {error}
              </div>
            ) : displayItems.length === 0 ? (
              <div className='rounded-[28px] border border-slate-200 bg-white p-6 text-sm text-slate-500'>
                没有找到匹配的模型定价。
              </div>
            ) : (
              <div className='space-y-5'>
                {displayItems.map((item) => (
                  <ModelSection key={item.modelKey} item={item} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default PricingCatalogModal;
