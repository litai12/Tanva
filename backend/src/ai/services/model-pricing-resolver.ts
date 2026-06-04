import { Engine } from 'json-rules-engine';

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
  dimensions?: Array<string | ManagedPricingDimensionDefinition>;
  defaults?: ManagedPriceBundle;
  rules?: ManagedPricingRule[];
  formula?: {
    mode?: 'additive';
    adjustments?: Array<{
      key?: string;
      label?: string;
      when?: Record<string, any>;
      unitPrice?: ManagedPriceBundle;
      multiplier?: {
        field?: string;
      };
    }>;
  };
  matchingRules?: ManagedPricingMatchingRule[];
  evaluators?: Record<string, ManagedPricingEvaluator>;
  displayConfig?: Record<string, unknown>;
}

export interface ManagedPricingDimensionOption {
  value: string | number | boolean;
  label?: string;
}

export interface ManagedPricingDimensionDefinition {
  key: string;
  label?: string;
  type?: 'string' | 'number' | 'boolean' | 'enum';
  required?: boolean;
  options?: ManagedPricingDimensionOption[];
  description?: string;
}

export interface ManagedPricingCondition {
  field?: string;
  op?: 'eq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists';
  value?: string | number | boolean | Array<string | number | boolean>;
}

export interface ManagedPricingConditionGroup {
  all?: ManagedPricingCondition[];
  any?: ManagedPricingCondition[];
}

export interface ManagedPricingMatchingRule {
  ruleKey: string;
  label?: string;
  enabled?: boolean;
  priority?: number;
  evaluatorKey: string;
  conditions: ManagedPricingConditionGroup;
}

export interface ManagedPricingFixedEvaluator {
  type: 'fixed';
  priceYuan?: number;
  credits?: number;
  costYuan?: number;
}

export interface ManagedPricingLinearEvaluator {
  type: 'linear';
  unitField: string;
  unitPriceYuan: number;
  costYuan?: number;
}

export interface ManagedPricingBasePlusLinearEvaluator {
  type: 'base_plus_linear';
  basePriceYuan: number;
  includedUnits: number;
  unitField: string;
  extraUnitPriceYuan: number;
  costYuan?: number;
}

export interface ManagedPricingLookupMatrixEvaluator {
  type: 'lookup_matrix';
  axes: string[];
  matrix: Record<string, unknown>;
  costYuan?: number;
}

export type ManagedPricingEvaluator =
  | ManagedPricingFixedEvaluator
  | ManagedPricingLinearEvaluator
  | ManagedPricingBasePlusLinearEvaluator
  | ManagedPricingLookupMatrixEvaluator;

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
  evaluatorKey?: string;
  evaluatorType?: string;
  pricingVersion?: string;
  calcTrace?: Record<string, unknown>;
}

const CREDITS_PER_YUAN = 100;

const buildManagedPricingDefaultContext = (
  book: ManagedPricingBook | null | undefined,
): Record<string, any> => {
  const displayConfig = asObject(book?.displayConfig);
  const defaultSelections = asObject(displayConfig?.defaultSelections);
  if (defaultSelections && Object.keys(defaultSelections).length > 0) {
    return { ...defaultSelections };
  }

  const dimensions = Array.isArray(book?.dimensions) ? book.dimensions : [];
  const context: Record<string, any> = {};
  for (const dimension of dimensions) {
    const normalizedDimension =
      typeof dimension === 'string'
        ? ({ key: dimension, type: 'string' } as ManagedPricingDimensionDefinition)
        : dimension;
    const key = String(normalizedDimension?.key || '').trim();
    if (!key) continue;
    const firstOption = Array.isArray(normalizedDimension?.options)
      ? normalizedDimension.options[0]
      : undefined;
    if (firstOption && firstOption.value !== undefined) {
      context[key] = firstOption.value;
      continue;
    }
    if (normalizedDimension?.type === 'boolean') {
      context[key] = false;
      continue;
    }
    if (normalizedDimension?.type === 'number') {
      context[key] = key === 'duration' || key === 'durationSec' ? 5 : 0;
      continue;
    }
    context[key] = '';
  }
  return context;
};

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

const matchesManagedCondition = (
  pricingContext: Record<string, any>,
  condition?: ManagedPricingCondition,
): boolean => {
  const field = String(condition?.field || '').trim();
  if (!field) return false;
  const op = condition?.op || 'eq';

  if (op === 'exists') {
    const raw = pricingContext[field];
    return raw !== undefined && raw !== null && raw !== '';
  }

  const actual = normalizeComparableValue(pricingContext[field]);
  if (actual === null) return false;

  if (op === 'in') {
    const expectedList = Array.isArray(condition?.value) ? condition?.value : [];
    return expectedList.some((candidate) => normalizeComparableValue(candidate) === actual);
  }

  if (op === 'eq') {
    return normalizeComparableValue(condition?.value) === actual;
  }

  if (typeof actual !== 'number') return false;
  const expectedNumber = toFiniteNumber(condition?.value);
  if (expectedNumber === undefined) return false;
  if (op === 'gt') return actual > expectedNumber;
  if (op === 'gte') return actual >= expectedNumber;
  if (op === 'lt') return actual < expectedNumber;
  if (op === 'lte') return actual <= expectedNumber;
  return false;
};

const toFiniteNumber = (value: unknown): number | undefined => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
};

const toCreditsByPriceYuan = (priceYuan: number | undefined): number | undefined => {
  if (!Number.isFinite(Number(priceYuan))) return undefined;
  return Math.ceil(Number(priceYuan) * CREDITS_PER_YUAN);
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

  const hasV2Rules =
    Array.isArray(book?.matchingRules) && book.matchingRules.some((item) => item && typeof item === 'object');
  const hasV2Evaluators =
    !!(book?.evaluators && typeof book.evaluators === 'object' && !Array.isArray(book.evaluators) && Object.keys(book.evaluators).length > 0);

  if (!mergedDefaults && rules.length === 0 && !hasV2Rules && !hasV2Evaluators) {
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
    formula:
      book?.formula && typeof book.formula === 'object' && !Array.isArray(book.formula)
        ? (book.formula as ManagedPricingBook['formula'])
        : undefined,
    matchingRules: Array.isArray(book?.matchingRules)
      ? (book.matchingRules.filter((item) => item && typeof item === 'object') as ManagedPricingMatchingRule[])
      : undefined,
    evaluators:
      book?.evaluators && typeof book.evaluators === 'object' && !Array.isArray(book.evaluators)
        ? (book.evaluators as Record<string, ManagedPricingEvaluator>)
        : undefined,
    displayConfig:
      book?.displayConfig && typeof book.displayConfig === 'object' && !Array.isArray(book.displayConfig)
        ? (book.displayConfig as Record<string, unknown>)
        : undefined,
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

const resolveFormulaPrice = (
  formula: ManagedPricingBook['formula'] | undefined,
  pricingContext: Record<string, any>,
): {
  price: ManagedPriceBundle;
  ruleKey?: string;
  label?: string;
  calcTrace?: Record<string, unknown>;
} | null => {
  const adjustments = Array.isArray(formula?.adjustments) ? formula.adjustments : [];
  if (adjustments.length === 0) return null;

  let totalPriceYuan = 0;
  let matchedAny = false;
  const matchedKeys: string[] = [];
  const matchedLabels: string[] = [];

  for (const adjustment of adjustments) {
    const matcher = asObject(adjustment?.when);
    if (!matcher || !matchesPricingCondition(pricingContext, matcher)) continue;

    const unitPriceYuan = toFiniteNumber(adjustment?.unitPrice?.priceYuan);
    const multiplierField =
      typeof adjustment?.multiplier?.field === 'string' ? adjustment.multiplier.field.trim() : '';
    const multiplierValue = multiplierField ? toFiniteNumber(pricingContext[multiplierField]) : undefined;
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
    if (typeof adjustment?.key === 'string' && adjustment.key.trim()) {
      matchedKeys.push(adjustment.key.trim());
    }
    if (typeof adjustment?.label === 'string' && adjustment.label.trim()) {
      matchedLabels.push(adjustment.label.trim());
    }
  }

  if (!matchedAny) return null;
  return {
    price: {
      priceYuan: totalPriceYuan,
      credits: toCreditsByPriceYuan(totalPriceYuan),
    },
    ...(matchedKeys.length > 0 ? { ruleKey: matchedKeys.join('+') } : {}),
    ...(matchedLabels.length > 0 ? { label: matchedLabels.join(' + ') } : {}),
    calcTrace: {
      evaluatorType: 'formula',
      mode: formula?.mode || 'additive',
    },
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

  const matchingRules = Array.isArray(book.matchingRules) ? [...book.matchingRules] : [];
  const evaluators =
    book.evaluators && typeof book.evaluators === 'object' ? book.evaluators : undefined;
  if (matchingRules.length > 0 && evaluators && Object.keys(evaluators).length > 0) {
    matchingRules.sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
    for (const rule of matchingRules) {
      if (!rule || rule.enabled === false || !rule.evaluatorKey) continue;
      const all = Array.isArray(rule.conditions?.all) ? rule.conditions.all : [];
      const any = Array.isArray(rule.conditions?.any) ? rule.conditions.any : [];
      const allMatched = all.every((condition) => matchesManagedCondition(pricingContext, condition));
      const anyMatched =
        any.length === 0 || any.some((condition) => matchesManagedCondition(pricingContext, condition));
      if (!allMatched || !anyMatched) continue;
      const evaluator = evaluators[String(rule.evaluatorKey).trim()];
      const resolved = resolveEvaluatorPrice(evaluator, pricingContext);
      if (!resolved) continue;
      return {
        source: 'vendor_rule',
        vendorKey,
        ruleKey: rule.ruleKey,
        label: rule.label,
        price: resolved.price,
        evaluatorKey: String(rule.evaluatorKey).trim() || undefined,
        evaluatorType: evaluator?.type,
        pricingVersion: book.version || 'v2',
        calcTrace: resolved.calcTrace,
      };
    }
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

  const formulaPrice = resolveFormulaPrice(book.formula, pricingContext);
  if (formulaPrice) {
    const hasStructuredPricing = !!asObject(vendor?.pricing) && !!asObject(asObject(vendor?.pricing)?.formula);
    return {
      source: hasStructuredPricing ? 'vendor_rule' : 'legacy_rule',
      vendorKey,
      ruleKey: formulaPrice.ruleKey,
      label: formulaPrice.label,
      price: formulaPrice.price,
      calcTrace: formulaPrice.calcTrace,
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

const convertConditionOperator = (
  op: ManagedPricingCondition['op'],
): 'equal' | 'in' | 'greaterThan' | 'greaterThanInclusive' | 'lessThan' | 'lessThanInclusive' => {
  switch (op) {
    case 'in':
      return 'in';
    case 'gt':
      return 'greaterThan';
    case 'gte':
      return 'greaterThanInclusive';
    case 'lt':
      return 'lessThan';
    case 'lte':
      return 'lessThanInclusive';
    case 'eq':
    default:
      return 'equal';
  }
};

const normalizeConditionGroup = (input: unknown): ManagedPricingConditionGroup | null => {
  const root = asObject(input);
  if (!root) return null;
  const normalizeRows = (value: unknown): ManagedPricingCondition[] => {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item) => item && typeof item === 'object')
      .map((item) => item as ManagedPricingCondition)
      .filter((item) => typeof item.field === 'string' && item.field.trim());
  };
  const all = normalizeRows(root.all);
  const any = normalizeRows(root.any);
  if (all.length === 0 && any.length === 0) return null;
  return {
    ...(all.length > 0 ? { all } : {}),
    ...(any.length > 0 ? { any } : {}),
  };
};

const buildJsonRulesCondition = (group: ManagedPricingConditionGroup): any => {
  const convertRow = (row: ManagedPricingCondition) => {
    const field = String(row.field || '').trim();
    const op = row.op || 'eq';
    if (op === 'exists') {
      return {
        fact: field,
        operator: 'notEqual',
        value: undefined,
      };
    }
    return {
      fact: field,
      operator: convertConditionOperator(op),
      value: row.value,
    };
  };
  const all = Array.isArray(group.all) ? group.all.map(convertRow) : [];
  const any = Array.isArray(group.any) ? group.any.map(convertRow) : [];
  return {
    ...(all.length > 0 ? { all } : {}),
    ...(any.length > 0 ? { any } : {}),
  };
};

const getMatrixPrice = (
  matrix: Record<string, unknown>,
  axes: string[],
  pricingContext: Record<string, any>,
): number | undefined => {
  let current: unknown = matrix;
  const tracePath: Array<string | number | boolean> = [];
  for (const axis of axes) {
    const axisValue = pricingContext[axis];
    const key =
      typeof axisValue === 'boolean'
        ? String(axisValue)
        : typeof axisValue === 'number'
        ? String(axisValue)
        : String(axisValue ?? '').trim();
    tracePath.push(key);
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return toFiniteNumber(current);
};

const resolveEvaluatorPrice = (
  evaluator: ManagedPricingEvaluator | undefined,
  pricingContext: Record<string, any>,
): { price: ManagedPriceBundle; calcTrace?: Record<string, unknown> } | null => {
  if (!evaluator || typeof evaluator !== 'object') return null;

  if (evaluator.type === 'fixed') {
    const priceYuan = toFiniteNumber(evaluator.priceYuan);
    const credits = toFiniteNumber(evaluator.credits) ?? toCreditsByPriceYuan(priceYuan);
    const costYuan = toFiniteNumber(evaluator.costYuan);
    return {
      price: {
        ...(priceYuan !== undefined ? { priceYuan } : {}),
        ...(credits !== undefined ? { credits } : {}),
        ...(costYuan !== undefined ? { costYuan } : {}),
      },
      calcTrace: { evaluatorType: 'fixed' },
    };
  }

  if (evaluator.type === 'linear') {
    const unitField = String(evaluator.unitField || '').trim();
    const unitPriceYuan = toFiniteNumber(evaluator.unitPriceYuan);
    const unitValue = toFiniteNumber(pricingContext[unitField]);
    if (!unitField || unitPriceYuan === undefined || unitValue === undefined) return null;
    const priceYuan = Number((unitValue * unitPriceYuan).toFixed(3));
    return {
      price: {
        priceYuan,
        credits: toCreditsByPriceYuan(priceYuan),
        ...(toFiniteNumber(evaluator.costYuan) !== undefined ? { costYuan: toFiniteNumber(evaluator.costYuan) } : {}),
      },
      calcTrace: { evaluatorType: 'linear', unitField, unitPriceYuan, unitValue },
    };
  }

  if (evaluator.type === 'base_plus_linear') {
    const unitField = String(evaluator.unitField || '').trim();
    const basePriceYuan = toFiniteNumber(evaluator.basePriceYuan);
    const includedUnits = toFiniteNumber(evaluator.includedUnits);
    const extraUnitPriceYuan = toFiniteNumber(evaluator.extraUnitPriceYuan);
    const unitValue = toFiniteNumber(pricingContext[unitField]);
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
    return {
      price: {
        priceYuan,
        credits: toCreditsByPriceYuan(priceYuan),
        ...(toFiniteNumber(evaluator.costYuan) !== undefined ? { costYuan: toFiniteNumber(evaluator.costYuan) } : {}),
      },
      calcTrace: {
        evaluatorType: 'base_plus_linear',
        unitField,
        basePriceYuan,
        includedUnits,
        extraUnitPriceYuan,
        unitValue,
        extraUnits,
      },
    };
  }

  if (evaluator.type === 'lookup_matrix') {
    const axes = Array.isArray(evaluator.axes)
      ? evaluator.axes.map((item) => String(item).trim()).filter(Boolean)
      : [];
    const matrix =
      evaluator.matrix && typeof evaluator.matrix === 'object' && !Array.isArray(evaluator.matrix)
        ? evaluator.matrix
        : null;
    if (!matrix || axes.length === 0) return null;
    const priceYuan = getMatrixPrice(matrix, axes, pricingContext);
    if (priceYuan === undefined) return null;
    return {
      price: {
        priceYuan,
        credits: toCreditsByPriceYuan(priceYuan),
        ...(toFiniteNumber(evaluator.costYuan) !== undefined ? { costYuan: toFiniteNumber(evaluator.costYuan) } : {}),
      },
      calcTrace: {
        evaluatorType: 'lookup_matrix',
        axes,
      },
    };
  }

  return null;
};

export const resolveManagedVendorPricingV2 = async (
  vendor: ManagedPricingVendorLike | undefined,
  pricingContext: Record<string, any>,
): Promise<ResolvedManagedPricing> => {
  const vendorKey =
    typeof vendor?.vendorKey === 'string' && vendor.vendorKey.trim()
      ? vendor.vendorKey.trim()
      : undefined;
  const book = normalizePricingBook(vendor);
  if (!book) {
    return { source: 'none', vendorKey, price: {} };
  }

  const matchingRules = Array.isArray(book.matchingRules) ? book.matchingRules : [];
  const evaluators =
    book.evaluators && typeof book.evaluators === 'object' ? book.evaluators : {};

  if (matchingRules.length === 0 || Object.keys(evaluators).length === 0) {
    return resolveManagedVendorPricing(vendor, pricingContext);
  }

  const engine = new Engine([], { allowUndefinedFacts: true });
  const activeRules = matchingRules
    .filter((rule) => rule && rule.enabled !== false && rule.ruleKey && rule.evaluatorKey)
    .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));

  for (const rule of activeRules) {
    const normalizedGroup = normalizeConditionGroup(rule.conditions);
    if (!normalizedGroup) continue;
    engine.addRule({
      name: rule.ruleKey,
      priority: Number(rule.priority) || 1,
      conditions: buildJsonRulesCondition(normalizedGroup),
      event: {
        type: 'pricing_rule_matched',
        params: {
          ruleKey: rule.ruleKey,
          evaluatorKey: rule.evaluatorKey,
          label: rule.label,
        },
      },
    });
  }

  const runResult = await engine.run(pricingContext);
  const matchedEvent = runResult.events[0];
  if (!matchedEvent) {
    if (book.defaults) {
      return {
        source: 'vendor_default',
        vendorKey,
        price: {
          ...book.defaults,
          ...(book.defaults.credits === undefined && book.defaults.priceYuan !== undefined
            ? { credits: toCreditsByPriceYuan(book.defaults.priceYuan) }
            : {}),
        },
        pricingVersion: book.version || 'v2',
      };
    }
    return { source: 'none', vendorKey, price: {} };
  }

  const evaluatorKey = String(matchedEvent.params?.evaluatorKey || '').trim();
  const evaluator = evaluatorKey ? evaluators[evaluatorKey] : undefined;
  const resolvedPrice = resolveEvaluatorPrice(evaluator, pricingContext);
  if (!resolvedPrice) {
    return { source: 'none', vendorKey, price: {} };
  }

  return {
    source: 'vendor_rule',
    vendorKey,
    ruleKey: String(matchedEvent.params?.ruleKey || '').trim() || undefined,
    label: typeof matchedEvent.params?.label === 'string' ? matchedEvent.params.label : undefined,
    price: resolvedPrice.price,
    evaluatorKey,
    evaluatorType: evaluator?.type,
    pricingVersion: book.version || 'v2',
    calcTrace: resolvedPrice.calcTrace,
  };
};

export const resolveManagedVendorDefaultPricingV2 = async (
  vendor: ManagedPricingVendorLike | undefined,
): Promise<ResolvedManagedPricing> => {
  const book = normalizePricingBook(vendor);
  const defaultContext = buildManagedPricingDefaultContext(book);
  return resolveManagedVendorPricingV2(vendor, defaultContext);
};

export const resolveManagedVendorDefaultPricing = (
  vendor: ManagedPricingVendorLike | undefined,
): ResolvedManagedPricing => {
  const book = normalizePricingBook(vendor);
  const defaultContext = buildManagedPricingDefaultContext(book);
  return resolveManagedVendorPricing(vendor, defaultContext);
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

export const resolveManagedModelPricingV2 = async (
  mapping: ManagedPricingMappingLike | undefined,
  modelKey: string,
  vendorKey: string,
  pricingContext: Record<string, any>,
): Promise<ResolvedManagedPricing> => {
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

  return resolveManagedVendorPricingV2(vendor, pricingContext);
};
