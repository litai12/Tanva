import { buildManagedVideoPricingContext } from "./videoPricingContext";

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
    defaultAvailable?: boolean;
    unavailableReason?: string;
    defaults?: {
      credits?: number;
      priceYuan?: number;
      costYuan?: number;
    };
    formula?: {
      mode?: "additive";
      base?: {
        credits?: number;
        priceYuan?: number;
        costYuan?: number;
      };
      adjustments?: Array<{
        key?: string;
        label?: string;
        when?: Record<string, any>;
        match?: Record<string, any>;
        price?: {
          credits?: number;
          priceYuan?: number;
          costYuan?: number;
        };
        unitPrice?: {
          credits?: number;
          priceYuan?: number;
          costYuan?: number;
        };
        multiplier?: {
          field?: string;
          value?: number;
          min?: number;
          max?: number;
          round?: "none" | "ceil" | "floor" | "round";
        };
      }>;
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
  };
}

export interface ManagedRoutesMetadata {
  modelKey: string;
  defaultVendor?: string;
  vendors: ManagedRouteOption[];
}

const asObject = (value: unknown): Record<string, any> | null => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  return null;
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
  if (selected?.pricing?.defaultAvailable === false) {
    return undefined;
  }
  return typeof selected?.creditsPerCall === "number" ? selected.creditsPerCall : undefined;
};

export const isManagedRoutePricingUnavailable = (pricing?: {
  source?: "vendor_rule" | "vendor_formula" | "vendor_default" | "none";
  defaultAvailable?: boolean;
} | null): boolean => pricing?.source === "none" && pricing?.defaultAvailable === false;

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

const normalizePriceBundle = (value: unknown) => {
  const root = asObject(value);
  if (!root) return null;

  const credits = Number(root.credits);
  const priceYuan = Number(root.priceYuan);
  const costYuan = Number(root.costYuan);
  if (
    !Number.isFinite(credits) &&
    !Number.isFinite(priceYuan) &&
    !Number.isFinite(costYuan)
  ) {
    return null;
  }

  return {
    ...(Number.isFinite(credits) ? { credits } : {}),
    ...(Number.isFinite(priceYuan) ? { priceYuan } : {}),
    ...(Number.isFinite(costYuan) ? { costYuan } : {}),
  };
};

const mergePriceBundles = (
  current: { credits?: number; priceYuan?: number; costYuan?: number },
  extra:
    | { credits?: number; priceYuan?: number; costYuan?: number }
    | null
    | undefined
) => {
  if (!extra) return current;

  return {
    ...(current.credits !== undefined || extra.credits !== undefined
      ? { credits: (current.credits || 0) + (extra.credits || 0) }
      : {}),
    ...(current.priceYuan !== undefined || extra.priceYuan !== undefined
      ? { priceYuan: (current.priceYuan || 0) + (extra.priceYuan || 0) }
      : {}),
    ...(current.costYuan !== undefined || extra.costYuan !== undefined
      ? { costYuan: (current.costYuan || 0) + (extra.costYuan || 0) }
      : {}),
  };
};

const scalePriceBundle = (
  price:
    | { credits?: number; priceYuan?: number; costYuan?: number }
    | null
    | undefined,
  factor: number
) => {
  if (!price || !Number.isFinite(factor)) return null;

  return {
    ...(typeof price.credits === "number" ? { credits: price.credits * factor } : {}),
    ...(typeof price.priceYuan === "number"
      ? { priceYuan: price.priceYuan * factor }
      : {}),
    ...(typeof price.costYuan === "number" ? { costYuan: price.costYuan * factor } : {}),
  };
};

const applyMultiplierRounding = (
  value: number,
  mode?: "none" | "ceil" | "floor" | "round"
) => {
  switch (mode) {
    case "ceil":
      return Math.ceil(value);
    case "floor":
      return Math.floor(value);
    case "round":
      return Math.round(value);
    default:
      return value;
  }
};

const resolveFormulaMultiplier = (
  context: Record<string, any>,
  multiplier?: {
    field?: string;
    value?: number;
    min?: number;
    max?: number;
    round?: "none" | "ceil" | "floor" | "round";
  } | null
) => {
  const raw =
    typeof multiplier?.field === "string" && multiplier.field.trim()
      ? context[multiplier.field.trim()]
      : multiplier?.value;
  const numeric = Number(raw);
  let resolved = Number.isFinite(numeric) ? numeric : 1;

  if (typeof multiplier?.min === "number") {
    resolved = Math.max(resolved, multiplier.min);
  }
  if (typeof multiplier?.max === "number") {
    resolved = Math.min(resolved, multiplier.max);
  }

  return applyMultiplierRounding(resolved, multiplier?.round);
};

const resolveFormulaPricing = (
  pricing:
    | {
        base?: { credits?: number; priceYuan?: number; costYuan?: number };
        adjustments?: Array<{
          key?: string;
          label?: string;
          when?: Record<string, any>;
          match?: Record<string, any>;
          price?: { credits?: number; priceYuan?: number; costYuan?: number };
          unitPrice?: { credits?: number; priceYuan?: number; costYuan?: number };
          multiplier?: {
            field?: string;
            value?: number;
            min?: number;
            max?: number;
            round?: "none" | "ceil" | "floor" | "round";
          };
        }>;
      }
    | undefined,
  context: Record<string, any>
) => {
  if (!pricing) return null;

  let resolvedPrice: { credits?: number; priceYuan?: number; costYuan?: number } = {};
  const breakdown: Array<{
    type: "base" | "adjustment";
    key?: string;
    label?: string;
    multiplier?: number;
    price: { credits?: number; priceYuan?: number; costYuan?: number };
  }> = [];

  const base = normalizePriceBundle(pricing.base);
  if (base) {
    resolvedPrice = mergePriceBundles(resolvedPrice, base);
    breakdown.push({ type: "base", label: "base", price: base });
  }

  for (const adjustment of Array.isArray(pricing.adjustments) ? pricing.adjustments : []) {
    const matcher =
      adjustment?.when && typeof adjustment.when === "object"
        ? adjustment.when
        : adjustment?.match && typeof adjustment.match === "object"
        ? adjustment.match
        : null;
    if (matcher && !matchesRule(context, matcher)) continue;

    let component = mergePriceBundles({}, normalizePriceBundle(adjustment?.price));
    let hasComponent =
      component.credits !== undefined ||
      component.priceYuan !== undefined ||
      component.costYuan !== undefined;
    let multiplierValue: number | undefined;

    const unitPrice = normalizePriceBundle(adjustment?.unitPrice);
    if (unitPrice) {
      multiplierValue = resolveFormulaMultiplier(context, adjustment?.multiplier);
      component = mergePriceBundles(component, scalePriceBundle(unitPrice, multiplierValue));
      hasComponent =
        hasComponent ||
        component.credits !== undefined ||
        component.priceYuan !== undefined ||
        component.costYuan !== undefined;
    }

    if (!hasComponent) continue;

    resolvedPrice = mergePriceBundles(resolvedPrice, component);
    breakdown.push({
      type: "adjustment",
      key: typeof adjustment?.key === "string" ? adjustment.key : undefined,
      label: typeof adjustment?.label === "string" ? adjustment.label : undefined,
      ...(multiplierValue !== undefined ? { multiplier: multiplierValue } : {}),
      price: component,
    });
  }

  if (
    resolvedPrice.credits === undefined &&
    resolvedPrice.priceYuan === undefined &&
    resolvedPrice.costYuan === undefined
  ) {
    return null;
  }

  return {
    ...resolvedPrice,
    breakdown,
  };
};

export const resolveManagedRoutePricing = (
  metadata?: Record<string, any> | null,
  vendorKey?: string | null,
  pricingContext?: Record<string, any> | null
): {
  credits?: number;
  priceYuan?: number;
  ruleKey?: string;
  label?: string;
  source?: "vendor_rule" | "vendor_formula" | "vendor_default" | "none";
  defaultAvailable?: boolean;
  unavailableReason?: string;
  breakdown?: Array<{
    type: "base" | "adjustment";
    key?: string;
    label?: string;
    multiplier?: number;
    price: { credits?: number; priceYuan?: number; costYuan?: number };
  }>;
} | null => {
  const selected = getManagedRouteOption(metadata, vendorKey);
  if (!selected) return null;
  const pricing = selected.pricing;
  const rawContext = pricingContext && typeof pricingContext === "object" ? pricingContext : {};
  const context = buildManagedVideoPricingContext(rawContext);

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
      source: "vendor_rule",
      defaultAvailable: pricing?.defaultAvailable,
    };
  }

  const formulaResult = resolveFormulaPricing(pricing?.formula, context);
  if (formulaResult) {
    return {
      ...(typeof formulaResult.credits === "number"
        ? { credits: formulaResult.credits }
        : {}),
      ...(typeof formulaResult.priceYuan === "number"
        ? { priceYuan: formulaResult.priceYuan }
        : {}),
      source: "vendor_formula",
      defaultAvailable: pricing?.defaultAvailable,
      ...(formulaResult.breakdown ? { breakdown: formulaResult.breakdown } : {}),
    };
  }

  if (pricing?.defaultAvailable === false) {
    return {
      source: "none",
      defaultAvailable: false,
      unavailableReason:
        typeof pricing.unavailableReason === "string" && pricing.unavailableReason.trim()
          ? pricing.unavailableReason.trim()
          : "当前规格未配置价格，请补充条件规则或线性定价。",
    };
  }

  const defaultCredits =
    typeof pricing?.defaults?.credits === "number"
      ? pricing.defaults.credits
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
    source: "vendor_default",
    defaultAvailable: pricing?.defaultAvailable,
  };
};
