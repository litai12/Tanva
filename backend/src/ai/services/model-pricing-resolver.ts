export interface ManagedPriceBundle {
  credits?: number;
  priceYuan?: number;
  costYuan?: number;
}

export interface ManagedPricingFormulaMultiplier {
  field?: string;
  value?: number;
  min?: number;
  max?: number;
  round?: 'none' | 'ceil' | 'floor' | 'round';
}

export interface ManagedPricingFormulaAdjustment {
  key?: string;
  label?: string;
  when?: Record<string, any>;
  match?: Record<string, any>;
  price?: ManagedPriceBundle;
  unitPrice?: ManagedPriceBundle;
  multiplier?: ManagedPricingFormulaMultiplier;
}

export interface ManagedPricingFormula {
  mode?: 'additive';
  base?: ManagedPriceBundle;
  adjustments?: ManagedPricingFormulaAdjustment[];
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
  defaultAvailable?: boolean;
  unavailableReason?: string;
  defaults?: ManagedPriceBundle;
  rules?: ManagedPricingRule[];
  formula?: ManagedPricingFormula;
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
  source:
    | 'vendor_rule'
    | 'vendor_formula'
    | 'vendor_default'
    | 'legacy_rule'
    | 'legacy_default'
    | 'none';
  vendorKey?: string;
  ruleKey?: string;
  label?: string;
  defaultAvailable?: boolean;
  unavailableReason?: string;
  price: ManagedPriceBundle;
  breakdown?: Array<{
    type: 'base' | 'adjustment';
    key?: string;
    label?: string;
    multiplier?: number;
    price: ManagedPriceBundle;
  }>;
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
  const formulaRoot = asObject(book?.formula);
  const formulaAdjustments = Array.isArray(formulaRoot?.adjustments)
    ? formulaRoot.adjustments
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
          const current = item as Record<string, any>;
          return {
            key:
              typeof current.key === 'string' && current.key.trim()
                ? current.key.trim()
                : undefined,
            label:
              typeof current.label === 'string' && current.label.trim()
                ? current.label.trim()
                : undefined,
            when:
              asObject(current.when) || asObject(current.match) || undefined,
            price: normalizePriceBundle(current.price) || undefined,
            unitPrice: normalizePriceBundle(current.unitPrice) || undefined,
            multiplier: asObject(current.multiplier)
              ? {
                  field:
                    typeof current.multiplier.field === 'string' &&
                    current.multiplier.field.trim()
                      ? current.multiplier.field.trim()
                      : undefined,
                  value: toFiniteNumber(current.multiplier.value),
                  min: toFiniteNumber(current.multiplier.min),
                  max: toFiniteNumber(current.multiplier.max),
                  round:
                    current.multiplier.round === 'ceil' ||
                    current.multiplier.round === 'floor' ||
                    current.multiplier.round === 'round' ||
                    current.multiplier.round === 'none'
                      ? current.multiplier.round
                      : undefined,
                }
              : undefined,
          } satisfies ManagedPricingFormulaAdjustment;
        })
        .filter((item) => item.price || item.unitPrice)
    : [];
  const formula =
    formulaRoot && (normalizePriceBundle(formulaRoot.base) || formulaAdjustments.length > 0)
      ? {
          mode: 'additive' as const,
          base: normalizePriceBundle(formulaRoot.base) || undefined,
          adjustments: formulaAdjustments,
        }
      : undefined;
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

  if (!mergedDefaults && rules.length === 0 && !formula) {
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
    defaultAvailable:
      typeof book?.defaultAvailable === 'boolean' ? book.defaultAvailable : undefined,
    unavailableReason:
      typeof book?.unavailableReason === 'string' && book.unavailableReason.trim()
        ? book.unavailableReason.trim()
        : undefined,
    defaults: mergedDefaults || undefined,
    rules,
    formula,
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

const scalePriceBundle = (
  price: ManagedPriceBundle | undefined,
  factor: number,
): ManagedPriceBundle | null => {
  if (!price || !Number.isFinite(factor)) return null;

  const credits =
    typeof price.credits === 'number' ? price.credits * factor : undefined;
  const priceYuan =
    typeof price.priceYuan === 'number' ? price.priceYuan * factor : undefined;
  const costYuan =
    typeof price.costYuan === 'number' ? price.costYuan * factor : undefined;

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

const mergePriceBundles = (
  current: ManagedPriceBundle,
  extra: ManagedPriceBundle | null,
): ManagedPriceBundle => {
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

const applyMultiplierRounding = (
  value: number,
  roundMode?: ManagedPricingFormulaMultiplier['round'],
): number => {
  switch (roundMode) {
    case 'ceil':
      return Math.ceil(value);
    case 'floor':
      return Math.floor(value);
    case 'round':
      return Math.round(value);
    default:
      return value;
  }
};

const resolveFormulaMultiplier = (
  multiplier: ManagedPricingFormulaMultiplier | undefined,
  pricingContext: Record<string, any>,
): number => {
  const raw =
    typeof multiplier?.field === 'string' && multiplier.field.trim()
      ? pricingContext[multiplier.field.trim()]
      : multiplier?.value;
  const numeric = Number(raw);
  let resolved = Number.isFinite(numeric) ? numeric : 1;

  if (typeof multiplier?.min === 'number') {
    resolved = Math.max(resolved, multiplier.min);
  }
  if (typeof multiplier?.max === 'number') {
    resolved = Math.min(resolved, multiplier.max);
  }

  return applyMultiplierRounding(resolved, multiplier?.round);
};

const computeFormulaPricing = (
  formula: ManagedPricingFormula | undefined,
  pricingContext: Record<string, any>,
): Pick<ResolvedManagedPricing, 'price' | 'label' | 'breakdown'> | null => {
  if (!formula) return null;

  let price: ManagedPriceBundle = {};
  const breakdown: NonNullable<ResolvedManagedPricing['breakdown']> = [];

  if (formula.base) {
    price = mergePriceBundles(price, formula.base);
    breakdown.push({
      type: 'base',
      label: 'base',
      price: formula.base,
    });
  }

  for (const adjustment of formula.adjustments || []) {
    const matcher = asObject(adjustment.when) || asObject(adjustment.match);
    if (matcher && !matchesPricingCondition(pricingContext, matcher)) {
      continue;
    }

    let component: ManagedPriceBundle = {};
    let hasComponent = false;

    if (adjustment.price) {
      component = mergePriceBundles(component, adjustment.price);
      hasComponent = true;
    }

    let multiplierValue: number | undefined;
    if (adjustment.unitPrice) {
      multiplierValue = resolveFormulaMultiplier(adjustment.multiplier, pricingContext);
      const scaled = scalePriceBundle(adjustment.unitPrice, multiplierValue);
      component = mergePriceBundles(component, scaled);
      hasComponent = hasComponent || Boolean(scaled);
    }

    if (!hasComponent) continue;

    price = mergePriceBundles(price, component);
    breakdown.push({
      type: 'adjustment',
      key: adjustment.key,
      label: adjustment.label,
      multiplier: multiplierValue,
      price: component,
    });
  }

  if (
    price.credits === undefined &&
    price.priceYuan === undefined &&
    price.costYuan === undefined
  ) {
    return null;
  }

  return {
    price,
    label:
      breakdown
        .map((item) => item.label)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' + ') || undefined,
    breakdown,
  };
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

  const formulaResult = computeFormulaPricing(book.formula, pricingContext);
  if (formulaResult) {
    return {
      source: 'vendor_formula',
      vendorKey,
      defaultAvailable: book.defaultAvailable,
      label: formulaResult.label,
      price: formulaResult.price,
      breakdown: formulaResult.breakdown,
    };
  }

  if (book.defaultAvailable === false) {
    return {
      source: 'none',
      vendorKey,
      defaultAvailable: false,
      unavailableReason:
        book.unavailableReason || '当前规格未配置价格，请补充条件规则或线性定价。',
      price: {},
    };
  }

  if (book.defaults) {
    const hasStructuredPricing = !!asObject(vendor?.pricing);
    return {
      source: hasStructuredPricing ? 'vendor_default' : 'legacy_default',
      vendorKey,
      defaultAvailable: book.defaultAvailable,
      price: book.defaults,
    };
  }

  return {
    source: 'none',
    vendorKey,
    defaultAvailable: book.defaultAvailable,
    price: {},
  };
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
