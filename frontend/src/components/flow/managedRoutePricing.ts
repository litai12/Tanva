import { isSeedance20FreeEnabled } from "@/utils/seedanceFree";

export interface ManagedRouteOption {
  vendorKey: string;
  platformKey?: string;
  label?: string;
  provider?: string;
  route?: string;
  modelName?: string;
  modelVersion?: string;
  creditsPerCall?: number;
  pricing?: {
    version?: string;
    dimensions?: Array<
      | string
      | {
          key: string;
          label?: string;
          type?: "string" | "number" | "boolean" | "enum";
          required?: boolean;
          options?: Array<{
            value: string | number | boolean;
            label?: string;
          }>;
          description?: string;
        }
    >;
    defaults?: {
      credits?: number;
      priceYuan?: number;
      costYuan?: number;
    };
    rules?: Array<{
      ruleKey?: string;
      label?: string;
      priority?: number;
      when?: Record<string, any>;
      match?: Record<string, any>;
      price?: {
        credits?: number;
        priceYuan?: number;
        costYuan?: number;
      };
      creditsPerCall?: number;
      priceYuan?: number;
      costYuan?: number;
    }>;
    formula?: {
      mode?: "additive";
      adjustments?: Array<{
        key?: string;
        label?: string;
        when?: Record<string, any>;
        unitPrice?: {
          credits?: number;
          priceYuan?: number;
          costYuan?: number;
        };
        multiplier?: {
          field?: string;
        };
      }>;
    };
    matchingRules?: Array<{
      ruleKey?: string;
      label?: string;
      enabled?: boolean;
      priority?: number;
      evaluatorKey?: string;
      conditions?: {
        all?: Array<{
          field?: string;
          op?: "eq" | "in" | "gt" | "gte" | "lt" | "lte" | "exists";
          value?: unknown;
        }>;
        any?: Array<{
          field?: string;
          op?: "eq" | "in" | "gt" | "gte" | "lt" | "lte" | "exists";
          value?: unknown;
        }>;
      };
    }>;
    evaluators?: Record<
      string,
      {
        type?: "fixed" | "linear" | "base_plus_linear" | "lookup_matrix";
        priceYuan?: number;
        credits?: number;
        costYuan?: number;
        unitField?: string;
        unitPriceYuan?: number;
        basePriceYuan?: number;
        includedUnits?: number;
        extraUnitPriceYuan?: number;
        axes?: string[];
        matrix?: Record<string, unknown>;
      }
    >;
    displayConfig?: Record<string, unknown>;
  };
}

export interface ManagedRoutesMetadata {
  modelKey: string;
  defaultVendor?: string;
  vendors: ManagedRouteOption[];
}

const CREDITS_PER_YUAN = 100;

const asObject = (value: unknown): Record<string, any> | null => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  return null;
};

// Tencent VOD route keys. Video models (vidu/kling) must no longer pin the
// channel to Tencent in the frontend — requests follow the token and let new-api
// pick the upstream per route. These helpers strip the Tencent route from any
// admin-configured managed routes so it is never auto-selected, displayed, or
// sent. (The Tencent VOD upstream is still reachable, but only when new-api's own
// tencent-vod channel selects it — not because the frontend forced it.)
const TENCENT_VENDOR_KEYS = new Set(["tencent_vod", "tengxun"]);

export const isTencentVendorKey = (vendorKey?: string | null): boolean => {
  if (typeof vendorKey !== "string") return false;
  return TENCENT_VENDOR_KEYS.has(vendorKey.trim().toLowerCase());
};

/**
 * 尊享(tencent_vod)线路已恢复：不再把腾讯 vendorKey 当空值剥离，让用户能在
 * vidu/kling 节点选择「腾讯 VOD」尊享线路，vendorKey 据此下发给后端，
 * 后端再据其映射到 new-api 的 vip 分组(腾讯 VOD channel)。仅保留 trim/空值归一。
 */
export const sanitizeVideoVendorKey = (
  vendorKey?: string | null
): string | undefined => {
  if (typeof vendorKey !== "string") return undefined;
  const trimmed = vendorKey.trim();
  if (!trimmed) return undefined;
  return trimmed;
};

/**
 * Return a copy of node config metadata with all Tencent (tencent_vod) managed
 * routes removed. defaultVendor is rewritten to the first surviving vendor when
 * the configured default was Tencent. Metadata without managedRoutes (or without
 * any Tencent vendor) is returned unchanged. When every vendor was Tencent the
 * resulting vendors array is empty, so getManagedRoutesMetadata returns null and
 * the node falls back to its plain creditsPerCall — and sends no vendor at all.
 */
export const sanitizeVideoManagedRoutes = <T extends Record<string, any> | null | undefined>(
  metadata: T
): T => {
  // 尊享(tencent_vod)线路已恢复：保留后端下发的全部 managed routes（含腾讯 VOD vendor），
  // 不再过滤腾讯线路或改写 defaultVendor，让用户可在节点上选择普通(kapon)/尊享(腾讯)。
  return metadata;
};

export const getManagedRoutesMetadata = (
  metadata?: Record<string, any> | null
): ManagedRoutesMetadata | null => {
  const root = asObject(metadata);
  const managedRoutes = asObject(root?.managedRoutes);
  const modelKey =
    typeof managedRoutes?.modelKey === "string" ? managedRoutes.modelKey.trim() : "";
  const vendors = Array.isArray(managedRoutes?.vendors)
    ? managedRoutes.vendors
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const vendor = item as Record<string, any>;
          const vendorKey =
            typeof vendor.vendorKey === "string" ? vendor.vendorKey.trim() : "";
          if (!vendorKey) return null;
          const credits = Number(vendor.creditsPerCall);
          return {
            vendorKey,
            platformKey:
              typeof vendor.platformKey === "string" && vendor.platformKey.trim()
                ? vendor.platformKey.trim()
                : undefined,
            label:
              typeof vendor.label === "string" && vendor.label.trim()
                ? vendor.label.trim()
                : undefined,
            provider:
              typeof vendor.provider === "string" && vendor.provider.trim()
                ? vendor.provider.trim()
                : undefined,
            route:
              typeof vendor.route === "string" && vendor.route.trim()
                ? vendor.route.trim()
                : undefined,
            modelName:
              typeof vendor.modelName === "string" && vendor.modelName.trim()
                ? vendor.modelName.trim()
                : undefined,
            modelVersion:
              typeof vendor.modelVersion === "string" && vendor.modelVersion.trim()
                ? vendor.modelVersion.trim()
                : undefined,
            creditsPerCall:
              Number.isFinite(credits) && credits >= 0 ? credits : undefined,
            pricing:
              vendor.pricing && typeof vendor.pricing === "object"
                ? (vendor.pricing as ManagedRouteOption["pricing"])
                : undefined,
          } satisfies ManagedRouteOption;
        })
        .filter(Boolean) as ManagedRouteOption[]
    : [];

  if (!modelKey || vendors.length === 0) return null;

  return {
    modelKey,
    defaultVendor:
      typeof managedRoutes?.defaultVendor === "string" && managedRoutes.defaultVendor.trim()
        ? managedRoutes.defaultVendor.trim()
        : undefined,
    vendors,
  };
};

export const getManagedRouteOption = (
  metadata?: Record<string, any> | null,
  vendorKey?: string | null
): ManagedRouteOption | null => {
  const managedRoutes = getManagedRoutesMetadata(metadata);
  if (!managedRoutes) return null;
  const normalizedVendorKey = typeof vendorKey === "string" ? vendorKey.trim() : "";
  return (
    (normalizedVendorKey
      ? managedRoutes.vendors.find((item) => item.vendorKey === normalizedVendorKey)
      : undefined) ||
    managedRoutes.vendors.find((item) => item.vendorKey === managedRoutes.defaultVendor) ||
    managedRoutes.vendors[0] ||
    null
  );
};

export const getManagedRouteCredits = (
  metadata?: Record<string, any> | null,
  vendorKey?: string | null
): number | undefined => {
  const selected = getManagedRouteOption(metadata, vendorKey);
  if (typeof selected?.creditsPerCall === "number") return selected.creditsPerCall;
  if (!selected?.pricing) return undefined;

  const defaultSelections =
    selected.pricing.displayConfig &&
    typeof selected.pricing.displayConfig === "object" &&
    !Array.isArray(selected.pricing.displayConfig) &&
    selected.pricing.displayConfig.defaultSelections &&
    typeof selected.pricing.displayConfig.defaultSelections === "object" &&
    !Array.isArray(selected.pricing.displayConfig.defaultSelections)
      ? (selected.pricing.displayConfig.defaultSelections as Record<string, any>)
      : {};

  const resolved = resolveManagedRoutePricing(metadata, vendorKey, defaultSelections);
  return typeof resolved?.credits === "number" ? resolved.credits : undefined;
};

const normalizeComparable = (value: unknown): string | number | boolean | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const lowered = trimmed.toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && `${numeric}` === trimmed) {
      return numeric;
    }
    return lowered;
  }
  return null;
};

const toFiniteNumber = (value: unknown): number | undefined => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
};

const toCreditsByPriceYuan = (priceYuan: number | undefined): number | undefined => {
  if (!Number.isFinite(Number(priceYuan))) return undefined;
  return Math.ceil(Number(priceYuan) * CREDITS_PER_YUAN);
};

export const resolveSeedance20DiscountCredits = (
  pricingContext?: Record<string, any> | null
): number | undefined => {
  if (!pricingContext || typeof pricingContext !== "object") return undefined;

  const model = String(pricingContext.seedanceModel || "")
    .trim()
    .toLowerCase();
  const normalizedModel =
    model === "2.0"
      ? "seedance-2.0"
      : model === "2.0-fast"
      ? "seedance-2.0-fast"
      : model;
  if (normalizedModel !== "seedance-2.0" && normalizedModel !== "seedance-2.0-fast") {
    return undefined;
  }

  // 限时免费活动：开启时 seedance-2.0 / seedance-2.0-fast 全分辨率均为 0 积分。
  // 与后端 SEEDANCE20_FREE 同步，实扣以后端为准。
  if (isSeedance20FreeEnabled()) {
    return 0;
  }

  const resolution = String(pricingContext.resolution || "720P")
    .trim()
    .toUpperCase();
  const duration = toFiniteNumber(
    pricingContext.duration ?? pricingContext.durationSec
  );
  if (duration === undefined || duration <= 0) return undefined;

  const unitPriceYuanByResolution =
    normalizedModel === "seedance-2.0-fast"
      ? {
          "480P": 0.806,
          "720P": 0.966,
        }
      : {
          "480P": 1.0,
          "720P": 1.2,
          "1080P": 3.0,
        };
  const unitPriceYuan =
    unitPriceYuanByResolution[resolution as keyof typeof unitPriceYuanByResolution];
  if (unitPriceYuan === undefined) return undefined;

  return toCreditsByPriceYuan(Number((unitPriceYuan * duration).toFixed(3)));
};

const matchesCondition = (
  context: Record<string, any>,
  condition?: {
    field?: string;
    op?: "eq" | "in" | "gt" | "gte" | "lt" | "lte" | "exists";
    value?: unknown;
  } | null
): boolean => {
  const field = String(condition?.field || "").trim();
  if (!field) return false;
  const op = condition?.op || "eq";

  if (op === "exists") {
    const raw = context[field];
    return raw !== undefined && raw !== null && raw !== "";
  }

  const actual = normalizeComparable(context[field]);
  if (actual === null) return false;

  if (op === "in") {
    const expectedList = Array.isArray(condition?.value) ? condition?.value : [];
    return expectedList.some((candidate) => normalizeComparable(candidate) === actual);
  }

  if (op === "eq") {
    return normalizeComparable(condition?.value) === actual;
  }

  if (typeof actual !== "number") return false;
  const expectedNumber = toFiniteNumber(condition?.value);
  if (expectedNumber === undefined) return false;
  if (op === "gt") return actual > expectedNumber;
  if (op === "gte") return actual >= expectedNumber;
  if (op === "lt") return actual < expectedNumber;
  if (op === "lte") return actual <= expectedNumber;
  return false;
};

const resolveLookupMatrixValue = (
  matrix: Record<string, unknown> | undefined,
  axes: string[],
  context: Record<string, any>
): number | undefined => {
  let current: unknown = matrix;
  for (const axis of axes) {
    const axisValue = context[axis];
    const key = String(axisValue);
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : undefined;
};

const resolveEvaluatorPricing = (
  evaluator:
    | {
        type?: "fixed" | "linear" | "base_plus_linear" | "lookup_matrix";
        priceYuan?: number;
        credits?: number;
        unitField?: string;
        unitPriceYuan?: number;
        basePriceYuan?: number;
        includedUnits?: number;
        extraUnitPriceYuan?: number;
        axes?: string[];
        matrix?: Record<string, unknown>;
      }
    | undefined,
  context: Record<string, any>
): { credits?: number; priceYuan?: number } | null => {
  if (!evaluator?.type) return null;

  if (evaluator.type === "fixed") {
    const priceYuan = toFiniteNumber(evaluator.priceYuan);
    const credits = toFiniteNumber(evaluator.credits) ?? toCreditsByPriceYuan(priceYuan);
    return priceYuan !== undefined || credits !== undefined
      ? {
          ...(priceYuan !== undefined ? { priceYuan } : {}),
          ...(credits !== undefined ? { credits } : {}),
        }
      : null;
  }

  if (evaluator.type === "linear") {
    const unitField = String(evaluator.unitField || "").trim();
    const unitPriceYuan = toFiniteNumber(evaluator.unitPriceYuan);
    const unitValue = toFiniteNumber(context[unitField]);
    if (!unitField || unitPriceYuan === undefined || unitValue === undefined) return null;
    const priceYuan = Number((unitValue * unitPriceYuan).toFixed(3));
    return { priceYuan, credits: toCreditsByPriceYuan(priceYuan) };
  }

  if (evaluator.type === "base_plus_linear") {
    const unitField = String(evaluator.unitField || "").trim();
    const basePriceYuan = toFiniteNumber(evaluator.basePriceYuan);
    const includedUnits = toFiniteNumber(evaluator.includedUnits);
    const extraUnitPriceYuan = toFiniteNumber(evaluator.extraUnitPriceYuan);
    const unitValue = toFiniteNumber(context[unitField]);
    if (
      !unitField ||
      basePriceYuan === undefined ||
      includedUnits === undefined ||
      extraUnitPriceYuan === undefined ||
      unitValue === undefined
    ) {
      return null;
    }
    const extraUnits = Math.max(0, unitValue - includedUnits);
    const priceYuan = Number((basePriceYuan + extraUnits * extraUnitPriceYuan).toFixed(3));
    return { priceYuan, credits: toCreditsByPriceYuan(priceYuan) };
  }

  if (evaluator.type === "lookup_matrix") {
    const axes = Array.isArray(evaluator.axes)
      ? evaluator.axes.map((item) => String(item).trim()).filter(Boolean)
      : [];
    if (axes.length === 0) return null;
    const priceYuan = resolveLookupMatrixValue(
      evaluator.matrix && typeof evaluator.matrix === "object" ? evaluator.matrix : undefined,
      axes,
      context
    );
    if (priceYuan === undefined) return null;
    return { priceYuan, credits: toCreditsByPriceYuan(priceYuan) };
  }

  return null;
};

const matchesRule = (
  context: Record<string, any>,
  matcher?: Record<string, any> | null
): boolean => {
  if (!matcher || typeof matcher !== "object") return false;
  const entries = Object.entries(matcher);
  if (entries.length === 0) return false;
  return entries.every(([field, expected]) => {
    const actual = normalizeComparable(context[field]);
    if (actual === null) return false;
    if (Array.isArray(expected)) {
      return expected.some((candidate) => normalizeComparable(candidate) === actual);
    }
    return normalizeComparable(expected) === actual;
  });
};

const resolveFormulaPricing = (
  pricing: ManagedRouteOption["pricing"] | undefined,
  context: Record<string, any>
): { credits?: number; priceYuan?: number; ruleKey?: string; label?: string } | null => {
  const adjustments = Array.isArray(pricing?.formula?.adjustments)
    ? pricing?.formula?.adjustments
    : [];
  if (adjustments.length === 0) return null;

  let totalPriceYuan = 0;
  let matchedAny = false;
  const matchedKeys: string[] = [];
  const matchedLabels: string[] = [];

  for (const adjustment of adjustments) {
    const matcher =
      adjustment?.when && typeof adjustment.when === "object" ? adjustment.when : null;
    if (!matchesRule(context, matcher)) continue;

    const unitPriceYuan = toFiniteNumber(adjustment?.unitPrice?.priceYuan);
    const multiplierField =
      typeof adjustment?.multiplier?.field === "string"
        ? adjustment.multiplier.field.trim()
        : "";
    const multiplierValue = multiplierField ? toFiniteNumber(context[multiplierField]) : undefined;
    const priceYuan =
      unitPriceYuan === undefined
        ? undefined
        : multiplierField
        ? multiplierValue === undefined
          ? undefined
          : Number((unitPriceYuan * multiplierValue).toFixed(3))
        : unitPriceYuan;
    if (priceYuan === undefined) continue;

    matchedAny = true;
    totalPriceYuan = Number((totalPriceYuan + priceYuan).toFixed(3));
    if (typeof adjustment?.key === "string" && adjustment.key.trim()) {
      matchedKeys.push(adjustment.key.trim());
    }
    if (typeof adjustment?.label === "string" && adjustment.label.trim()) {
      matchedLabels.push(adjustment.label.trim());
    }
  }

  if (!matchedAny) return null;
  return {
    priceYuan: totalPriceYuan,
    credits: toCreditsByPriceYuan(totalPriceYuan),
    ...(matchedKeys.length > 0 ? { ruleKey: matchedKeys.join("+") } : {}),
    ...(matchedLabels.length > 0 ? { label: matchedLabels.join(" + ") } : {}),
  };
};

export const resolveManagedRoutePricing = (
  metadata?: Record<string, any> | null,
  vendorKey?: string | null,
  pricingContext?: Record<string, any> | null
): { credits?: number; priceYuan?: number; ruleKey?: string; label?: string } | null => {
  const selected = getManagedRouteOption(metadata, vendorKey);
  if (!selected) return null;
  const pricing = selected.pricing;
  const context = pricingContext && typeof pricingContext === "object" ? pricingContext : {};

  const matchingRules = Array.isArray(pricing?.matchingRules) ? [...pricing.matchingRules] : [];
  const evaluators =
    pricing?.evaluators && typeof pricing.evaluators === "object" ? pricing.evaluators : undefined;
  if (matchingRules.length > 0 && evaluators && Object.keys(evaluators).length > 0) {
    matchingRules.sort((a, b) => Number(b?.priority ?? 0) - Number(a?.priority ?? 0));
    for (const rule of matchingRules) {
      if (!rule || rule.enabled === false || !rule.evaluatorKey) continue;
      const all = Array.isArray(rule.conditions?.all) ? rule.conditions.all : [];
      const any = Array.isArray(rule.conditions?.any) ? rule.conditions.any : [];
      const allMatched = all.every((condition) => matchesCondition(context, condition));
      const anyMatched = any.length === 0 || any.some((condition) => matchesCondition(context, condition));
      if (!allMatched || !anyMatched) continue;
      const evaluatorKey = String(rule.evaluatorKey || "").trim();
      const resolved = resolveEvaluatorPricing(
        evaluatorKey ? evaluators[evaluatorKey] : undefined,
        context
      );
      if (!resolved) continue;
      return {
        ...(typeof resolved.credits === "number" ? { credits: resolved.credits } : {}),
        ...(typeof resolved.priceYuan === "number" ? { priceYuan: resolved.priceYuan } : {}),
        ...(typeof rule.ruleKey === "string" ? { ruleKey: rule.ruleKey } : {}),
        ...(typeof rule.label === "string" ? { label: rule.label } : {}),
      };
    }
  }

  const rules = Array.isArray(pricing?.rules) ? [...pricing.rules] : [];
  rules.sort((a, b) => {
    const pa = Number(a?.priority ?? 0);
    const pb = Number(b?.priority ?? 0);
    return pb - pa;
  });

  for (const rule of rules) {
    const matcher =
      rule?.when && typeof rule.when === "object"
        ? rule.when
        : rule?.match && typeof rule.match === "object"
        ? rule.match
        : null;
    if (!matchesRule(context, matcher)) continue;
    const credits =
      typeof rule?.price?.credits === "number"
        ? rule.price.credits
        : typeof rule?.creditsPerCall === "number"
        ? rule.creditsPerCall
        : undefined;
    const priceYuan =
      typeof rule?.price?.priceYuan === "number"
        ? rule.price.priceYuan
        : typeof rule?.priceYuan === "number"
        ? rule.priceYuan
        : undefined;
    return {
      ...(typeof credits === "number" ? { credits } : {}),
      ...(typeof priceYuan === "number" ? { priceYuan } : {}),
      ...(typeof rule?.ruleKey === "string" ? { ruleKey: rule.ruleKey } : {}),
      ...(typeof rule?.label === "string" ? { label: rule.label } : {}),
    };
  }

  const formulaResolved = resolveFormulaPricing(pricing, context);
  if (formulaResolved) {
    return formulaResolved;
  }

  const defaultCredits =
    typeof pricing?.defaults?.credits === "number"
      ? pricing.defaults.credits
      : typeof pricing?.defaults?.priceYuan === "number"
      ? toCreditsByPriceYuan(pricing.defaults.priceYuan)
      : selected.creditsPerCall;
  const defaultPriceYuan =
    typeof pricing?.defaults?.priceYuan === "number"
      ? pricing.defaults.priceYuan
      : undefined;

  if (typeof defaultCredits !== "number" && typeof defaultPriceYuan !== "number") {
    return null;
  }

  return {
    ...(typeof defaultCredits === "number" ? { credits: defaultCredits } : {}),
    ...(typeof defaultPriceYuan === "number" ? { priceYuan: defaultPriceYuan } : {}),
  };
};
