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
  return typeof selected?.creditsPerCall === "number" ? selected.creditsPerCall : undefined;
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

export const resolveManagedRoutePricing = (
  metadata?: Record<string, any> | null,
  vendorKey?: string | null,
  pricingContext?: Record<string, any> | null
): { credits?: number; priceYuan?: number; ruleKey?: string; label?: string } | null => {
  const selected = getManagedRouteOption(metadata, vendorKey);
  if (!selected) return null;
  const pricing = selected.pricing;
  const context = pricingContext && typeof pricingContext === "object" ? pricingContext : {};

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
  };
};
