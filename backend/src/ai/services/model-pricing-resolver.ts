export interface ManagedPriceBundle {
  credits?: number;
  priceYuan?: number;
  costYuan?: number;
}

export interface ManagedPricingRule {
  ruleKey?: string;
  label?: string;
  priority?: number;
  when?: Record<string, any>;
  match?: Record<string, any>;
  price?: ManagedPriceBundle;
  creditsPerCall?: number;
  priceYuan?: number;
  costYuan?: number;
}

export interface ManagedPricingBook {
  version?: string;
  dimensions?: string[];
  defaults?: ManagedPriceBundle;
  rules?: ManagedPricingRule[];
}

export interface ManagedPricingVendorLike {
  vendorKey?: string;
  creditsPerCall?: number;
  priceYuan?: number;
  pricing?: ManagedPricingBook;
  metadata?: Record<string, any>;
}

export interface ManagedPricingModelLike {
  modelKey?: string;
  vendors?: ManagedPricingVendorLike[];
}

export interface ManagedPricingMappingLike {
  models?: ManagedPricingModelLike[];
}

export interface ResolvedManagedPricing {
  source: 'vendor_rule' | 'vendor_default' | 'legacy_rule' | 'legacy_default' | 'none';
  vendorKey?: string;
  ruleKey?: string;
  label?: string;
  price: ManagedPriceBundle;
}

const asObject = (value: unknown): Record<string, any> | null => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  return null;
};

const normalizeComparableValue = (value: unknown): string | number | boolean | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed.toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && `${numeric}` === trimmed) {
      return numeric;
    }

    return normalized;
  }
  return null;
};

const matchesPricingCondition = (
  pricingContext: Record<string, any>,
  matcher: Record<string, any>,
): boolean => {
  const entries = Object.entries(matcher);
  if (!entries.length) return false;

  return entries.every(([field, expected]) => {
    const actual = normalizeComparableValue(pricingContext[field]);
    if (actual === null) return false;

    if (Array.isArray(expected)) {
      return expected.some(
        (candidate) => normalizeComparableValue(candidate) === actual,
      );
    }

    return normalizeComparableValue(expected) === actual;
  });
};

const toFiniteNumber = (value: unknown): number | undefined => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
};

const normalizePriceBundle = (value: unknown): ManagedPriceBundle | null => {
  const root = asObject(value);
  if (!root) return null;

  const credits = toFiniteNumber(root.credits);
  const priceYuan = toFiniteNumber(root.priceYuan);
  const costYuan = toFiniteNumber(root.costYuan);
  if (
    credits === undefined &&
    priceYuan === undefined &&
    costYuan === undefined
  ) {
    return null;
  }

  return {
    ...(credits !== undefined ? { credits } : {}),
    ...(priceYuan !== undefined ? { priceYuan } : {}),
    ...(costYuan !== undefined ? { costYuan } : {}),
  };
};

const normalizeLegacySpecRules = (
  vendor: ManagedPricingVendorLike | undefined,
): ManagedPricingRule[] => {
  const rules = Array.isArray(vendor?.metadata?.specPricing)
    ? vendor.metadata.specPricing
    : [];

  return rules
    .filter((rule) => rule && typeof rule === 'object')
    .map((rule) => {
      const currentRule = rule as Record<string, any>;
      const price = normalizePriceBundle({
        credits: currentRule.creditsPerCall,
        priceYuan: currentRule.priceYuan,
        costYuan: currentRule.costYuan,
      });

      return {
        ruleKey:
          typeof currentRule.ruleKey === 'string' && currentRule.ruleKey.trim()
            ? currentRule.ruleKey.trim()
            : undefined,
        label:
          typeof currentRule.label === 'string' && currentRule.label.trim()
            ? currentRule.label.trim()
            : undefined,
        when:
          asObject(currentRule.when) || asObject(currentRule.match) || undefined,
        price: price || undefined,
        creditsPerCall: toFiniteNumber(currentRule.creditsPerCall),
        priceYuan: toFiniteNumber(currentRule.priceYuan),
        costYuan: toFiniteNumber(currentRule.costYuan),
      } satisfies ManagedPricingRule;
    });
};

const normalizePricingBook = (
  vendor: ManagedPricingVendorLike | undefined,
): ManagedPricingBook | null => {
  const book = asObject(vendor?.pricing);
  const defaults = normalizePriceBundle(book?.defaults);
  const normalizedRules = Array.isArray(book?.rules)
    ? book.rules
        .filter((rule) => rule && typeof rule === 'object')
        .map((rule) => {
          const currentRule = rule as Record<string, any>;
          return {
            ruleKey:
              typeof currentRule.ruleKey === 'string' && currentRule.ruleKey.trim()
                ? currentRule.ruleKey.trim()
                : undefined,
            label:
              typeof currentRule.label === 'string' && currentRule.label.trim()
                ? currentRule.label.trim()
                : undefined,
            priority: toFiniteNumber(currentRule.priority),
            when:
              asObject(currentRule.when) || asObject(currentRule.match) || undefined,
            price:
              normalizePriceBundle(currentRule.price) ||
              normalizePriceBundle({
                credits: currentRule.creditsPerCall,
                priceYuan: currentRule.priceYuan,
                costYuan: currentRule.costYuan,
              }) ||
              undefined,
          } satisfies ManagedPricingRule;
        })
    : [];

  const legacyDefaults = normalizePriceBundle({
    credits: vendor?.creditsPerCall,
    priceYuan: vendor?.priceYuan,
  });

  const rules = normalizedRules.length > 0
    ? normalizedRules
    : normalizeLegacySpecRules(vendor);

  const mergedDefaults =
    defaults ||
    legacyDefaults ||
    null;

  if (!mergedDefaults && rules.length === 0) {
    return null;
  }

  return {
    version:
      typeof book?.version === 'string' && book.version.trim()
        ? book.version.trim()
        : 'v1',
    dimensions: Array.isArray(book?.dimensions)
      ? book.dimensions.map((item) => String(item).trim()).filter(Boolean)
      : undefined,
    defaults: mergedDefaults || undefined,
    rules,
  };
};

const buildLegacyRulePrice = (
  rule: ManagedPricingRule,
): ManagedPriceBundle | null => {
  return (
    rule.price ||
    normalizePriceBundle({
      credits: rule.creditsPerCall,
      priceYuan: rule.priceYuan,
      costYuan: rule.costYuan,
    })
  );
};

export const resolveManagedVendorPricing = (
  vendor: ManagedPricingVendorLike | undefined,
  pricingContext: Record<string, any>,
): ResolvedManagedPricing => {
  const book = normalizePricingBook(vendor);
  const vendorKey =
    typeof vendor?.vendorKey === 'string' && vendor.vendorKey.trim()
      ? vendor.vendorKey.trim()
      : undefined;
  if (!book) {
    return { source: 'none', vendorKey, price: {} };
  }

  const sortedRules = [...(book.rules || [])].sort((a, b) => {
    const priorityA = Number.isFinite(Number(a.priority)) ? Number(a.priority) : 0;
    const priorityB = Number.isFinite(Number(b.priority)) ? Number(b.priority) : 0;
    return priorityB - priorityA;
  });

  for (const rule of sortedRules) {
    const matcher = asObject(rule.when) || asObject(rule.match);
    const price = buildLegacyRulePrice(rule);
    if (!matcher || !price) continue;
    if (!matchesPricingCondition(pricingContext, matcher)) continue;

    const hasStructuredPricing =
      !!asObject(vendor?.pricing) && Array.isArray(asObject(vendor?.pricing)?.rules);

    return {
      source: hasStructuredPricing ? 'vendor_rule' : 'legacy_rule',
      vendorKey,
      ruleKey: rule.ruleKey,
      label: rule.label,
      price,
    };
  }

  if (book.defaults) {
    const hasStructuredPricing = !!asObject(vendor?.pricing);
    return {
      source: hasStructuredPricing ? 'vendor_default' : 'legacy_default',
      vendorKey,
      price: book.defaults,
    };
  }

  return { source: 'none', vendorKey, price: {} };
};

export const resolveManagedModelPricing = (
  mapping: ManagedPricingMappingLike | undefined,
  modelKey: string,
  vendorKey: string,
  pricingContext: Record<string, any>,
): ResolvedManagedPricing => {
  const normalizedModelKey = String(modelKey || '').trim();
  const normalizedVendorKey = String(vendorKey || '').trim();
  if (!normalizedModelKey || !normalizedVendorKey) {
    return { source: 'none', price: {} };
  }

  const model = Array.isArray(mapping?.models)
    ? mapping.models.find(
        (item) =>
          item &&
          typeof item.modelKey === 'string' &&
          item.modelKey.trim() === normalizedModelKey,
      )
    : undefined;
  const vendor = Array.isArray(model?.vendors)
    ? model.vendors.find(
        (item) =>
          item &&
          typeof item.vendorKey === 'string' &&
          item.vendorKey.trim() === normalizedVendorKey,
      )
    : undefined;

  return resolveManagedVendorPricing(vendor, pricingContext);
};
