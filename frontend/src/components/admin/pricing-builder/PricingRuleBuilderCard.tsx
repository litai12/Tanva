import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type DimensionType = "string" | "number" | "boolean" | "enum";
type ConditionOp = "eq" | "in" | "gt" | "gte" | "lt" | "lte" | "exists";

export type PricingDimensionDefinition = {
  key: string;
  label?: string;
  type?: DimensionType;
  required?: boolean;
  options?: Array<{
    value: string | number | boolean;
    label?: string;
  }>;
  description?: string;
};

export type PricingConditionRow = {
  field: string;
  op: ConditionOp;
  value: string | number | boolean | Array<string | number | boolean>;
};

export type PricingMatchingRule = {
  ruleKey: string;
  label: string;
  enabled: boolean;
  priority: number;
  evaluatorKey: string;
  conditions: {
    all: PricingConditionRow[];
    any: PricingConditionRow[];
  };
};

export type PricingEvaluator =
  | {
      type: "fixed";
      priceYuan?: number;
      credits?: number;
      costYuan?: number;
    }
  | {
      type: "linear";
      unitField?: string;
      unitPriceYuan?: number;
      costYuan?: number;
    }
  | {
      type: "base_plus_linear";
      basePriceYuan?: number;
      includedUnits?: number;
      unitField?: string;
      extraUnitPriceYuan?: number;
      costYuan?: number;
    }
  | {
      type: "lookup_matrix";
      axes?: string[];
      matrix?: Record<string, unknown>;
      costYuan?: number;
    };

export type PricingV2State = {
  version: string;
  dimensions: PricingDimensionDefinition[];
  matchingRules: PricingMatchingRule[];
  evaluators: Record<string, PricingEvaluator>;
  displayConfig: {
    specAxes: string[];
    labels: Record<string, string>;
    presets: Array<Record<string, string | number | boolean>>;
    defaultSelections: Record<string, string | number | boolean>;
  };
};

export type PricingPreviewResponse = {
  modelKey: string;
  vendorKey: string;
  pricingContext: Record<string, any>;
  matchedRuleKey?: string;
  label?: string;
  evaluatorKey?: string;
  evaluatorType?: string;
  pricingVersion?: string;
  price: {
    credits?: number;
    priceYuan?: number;
    costYuan?: number;
  };
  calcTrace?: Record<string, any>;
  source: string;
};

type Props = {
  vendor: {
    pricing?: Record<string, any>;
  };
  vendorIndex: number;
  pricingV2: PricingV2State;
  previewResult: PricingPreviewResponse | null;
  previewLoading: boolean;
  presetPreviewResults: PricingPreviewResponse[];
  presetPreviewLoading: boolean;
  createEmptyPricingDimension: () => PricingDimensionDefinition;
  createEmptyMatchingRule: () => PricingMatchingRule;
  createEmptyConditionRow: () => PricingConditionRow;
  createEvaluatorByType: (
    type: "fixed" | "linear" | "base_plus_linear" | "lookup_matrix"
  ) => PricingEvaluator;
  updateVendorPricingV2: (
    vendorIndex: number,
    mutator: (current: PricingV2State) => PricingV2State
  ) => void;
  previewVendorPricing: (vendorIndex: number, vendor: any) => void;
  previewVendorPricingPresets: (vendorIndex: number, vendor: any) => void;
};

const stringifyConditionValue = (value: PricingConditionRow["value"]) => {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value ?? "");
};

const parseConditionValue = (
  raw: string,
  type?: DimensionType,
  op?: string
): PricingConditionRow["value"] => {
  if (op === "in") {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        if (type === "number") return Number(item);
        if (type === "boolean") return item === "true";
        return item;
      });
  }
  if (type === "number") return raw.trim() === "" ? "" : Number(raw);
  if (type === "boolean") return raw === "true";
  return raw;
};

const getDimensionOptionValues = (dimension?: PricingDimensionDefinition) => {
  if (!dimension || !Array.isArray(dimension.options)) return [];
  return dimension.options.map((option) => option.value);
};

const getLookupMatrixValue = (
  matrix: Record<string, unknown> | undefined,
  path: Array<string>
) => {
  let current: unknown = matrix;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
};

const setLookupMatrixValue = (
  matrix: Record<string, unknown> | undefined,
  path: Array<string>,
  value: number | undefined
): Record<string, unknown> => {
  const next =
    matrix && typeof matrix === "object" && !Array.isArray(matrix)
      ? JSON.parse(JSON.stringify(matrix))
      : {};
  let current: Record<string, unknown> = next;
  path.forEach((key, index) => {
    if (index === path.length - 1) {
      if (value === undefined || Number.isNaN(value)) {
        delete current[key];
      } else {
        current[key] = value;
      }
      return;
    }
    const child =
      current[key] && typeof current[key] === "object" && !Array.isArray(current[key])
        ? (current[key] as Record<string, unknown>)
        : {};
    current[key] = child;
    current = child;
  });
  return next;
};

export function PricingRuleBuilderCard({
  vendor,
  vendorIndex,
  pricingV2,
  previewResult,
  previewLoading,
  presetPreviewResults,
  presetPreviewLoading,
  createEmptyPricingDimension,
  createEmptyMatchingRule,
  createEmptyConditionRow,
  createEvaluatorByType,
  updateVendorPricingV2,
  previewVendorPricing,
  previewVendorPricingPresets,
}: Props) {
  const dimensionOptions = pricingV2.dimensions.map((dimension) => ({
    value: dimension.key,
    label: dimension.label || dimension.key,
    type: dimension.type || "string",
  }));
  const evaluatorEntries = Object.entries(pricingV2.evaluators || {});

  return (
    <div className='mb-4 rounded-lg border border-blue-100 bg-blue-50 p-4'>
      <div className='mb-3 flex items-center justify-between gap-3'>
        <div>
          <div className='font-medium text-blue-900'>Pricing Rule Builder v2</div>
          <div className='text-xs text-blue-700'>
            通用规则搭建器：定义维度、匹配规则、evaluator，并通过试算接口验证最终价格与积分。
          </div>
        </div>
        <div className='flex items-center gap-2'>
          <span className='rounded bg-white px-2 py-1 text-xs text-gray-600'>
            version: {pricingV2.version}
          </span>
          <Button
            size='sm'
            variant='outline'
            onClick={() => previewVendorPricing(vendorIndex, vendor)}
            disabled={previewLoading}
          >
            {previewLoading ? "试算中..." : "试算 v2"}
          </Button>
        </div>
      </div>

      <div className='space-y-4'>
        <div className='rounded-lg border bg-white p-3'>
          <div className='mb-3 flex items-center justify-between'>
            <div className='font-medium text-gray-800'>1. 维度定义</div>
            <Button
              size='sm'
              variant='outline'
              onClick={() =>
                updateVendorPricingV2(vendorIndex, (current) => ({
                  ...current,
                  dimensions: [...current.dimensions, createEmptyPricingDimension()],
                }))
              }
            >
              新增维度
            </Button>
          </div>
          <div className='space-y-3'>
            {pricingV2.dimensions.length === 0 ? (
              <div className='rounded border border-dashed px-3 py-4 text-sm text-gray-500'>
                暂无 v2 维度。先定义报价上下文维度，例如 `generationMode / durationSec / hasAudio`。
              </div>
            ) : (
              pricingV2.dimensions.map((dimension, dimensionIndex) => (
                <div key={`${dimension.key || "dimension"}-${dimensionIndex}`} className='rounded border p-3'>
                  <div className='grid gap-3 md:grid-cols-4'>
                    <div>
                      <label className='block text-xs text-gray-600 mb-1'>key</label>
                      <Input
                        value={dimension.key || ""}
                        onChange={(e) =>
                          updateVendorPricingV2(vendorIndex, (current) => {
                            const next = [...current.dimensions];
                            next[dimensionIndex] = { ...next[dimensionIndex], key: e.target.value };
                            return { ...current, dimensions: next };
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className='block text-xs text-gray-600 mb-1'>label</label>
                      <Input
                        value={dimension.label || ""}
                        onChange={(e) =>
                          updateVendorPricingV2(vendorIndex, (current) => {
                            const next = [...current.dimensions];
                            next[dimensionIndex] = { ...next[dimensionIndex], label: e.target.value };
                            return { ...current, dimensions: next };
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className='block text-xs text-gray-600 mb-1'>type</label>
                      <select
                        value={dimension.type || "string"}
                        onChange={(e) =>
                          updateVendorPricingV2(vendorIndex, (current) => {
                            const next = [...current.dimensions];
                            next[dimensionIndex] = {
                              ...next[dimensionIndex],
                              type: e.target.value as DimensionType,
                            };
                            return { ...current, dimensions: next };
                          })
                        }
                        className='w-full rounded border px-3 py-2'
                      >
                        <option value='string'>string</option>
                        <option value='number'>number</option>
                        <option value='boolean'>boolean</option>
                        <option value='enum'>enum</option>
                      </select>
                    </div>
                    <div className='flex items-end justify-between gap-2'>
                      <label className='inline-flex items-center gap-2 text-xs text-gray-600'>
                        <input
                          type='checkbox'
                          checked={dimension.required === true}
                          onChange={(e) =>
                            updateVendorPricingV2(vendorIndex, (current) => {
                              const next = [...current.dimensions];
                              next[dimensionIndex] = {
                                ...next[dimensionIndex],
                                required: e.target.checked,
                              };
                              return { ...current, dimensions: next };
                            })
                          }
                        />
                        required
                      </label>
                      <Button
                        size='sm'
                        variant='outline'
                        className='text-red-600 hover:text-red-700'
                        onClick={() =>
                          updateVendorPricingV2(vendorIndex, (current) => ({
                            ...current,
                            dimensions: current.dimensions.filter((_, index) => index !== dimensionIndex),
                          }))
                        }
                      >
                        删除
                      </Button>
                    </div>
                  </div>
                  {(dimension.type === "enum" || dimension.type === "boolean") && (
                    <div className='mt-3'>
                      <label className='block text-xs text-gray-600 mb-1'>options</label>
                      <Input
                        value={(dimension.options || [])
                          .map((option) => `${option.value}:${option.label || option.value}`)
                          .join(", ")}
                        onChange={(e) =>
                          updateVendorPricingV2(vendorIndex, (current) => {
                            const next = [...current.dimensions];
                            next[dimensionIndex] = {
                              ...next[dimensionIndex],
                              options: e.target.value
                                .split(",")
                                .map((item) => item.trim())
                                .filter(Boolean)
                                .map((item) => {
                                  const [rawValue, rawLabel] = item.split(":");
                                  const normalizedValue =
                                    dimension.type === "boolean"
                                      ? rawValue.trim() === "true"
                                      : rawValue.trim();
                                  return {
                                    value: normalizedValue,
                                    label: (rawLabel || rawValue).trim(),
                                  };
                                }),
                            };
                            return { ...current, dimensions: next };
                          })
                        }
                        placeholder='例如：t2v:文生视频, i2v:图生视频'
                      />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className='rounded-lg border bg-white p-3'>
          <div className='mb-3 flex items-center justify-between'>
            <div className='font-medium text-gray-800'>2. 匹配规则</div>
            <Button
              size='sm'
              variant='outline'
              onClick={() =>
                updateVendorPricingV2(vendorIndex, (current) => ({
                  ...current,
                  matchingRules: [...current.matchingRules, createEmptyMatchingRule()],
                }))
              }
            >
              新增规则
            </Button>
          </div>
          <div className='space-y-3'>
            {pricingV2.matchingRules.length === 0 ? (
              <div className='rounded border border-dashed px-3 py-4 text-sm text-gray-500'>
                暂无 v2 匹配规则。命中规则后会通过 evaluatorKey 跳转到价格求值器。
              </div>
            ) : (
              pricingV2.matchingRules.map((rule, ruleIndex) => (
                <div key={`${rule.ruleKey || "rule"}-${ruleIndex}`} className='rounded border p-3 space-y-3'>
                  <div className='grid gap-3 md:grid-cols-5'>
                    <div>
                      <label className='block text-xs text-gray-600 mb-1'>ruleKey</label>
                      <Input
                        value={rule.ruleKey}
                        onChange={(e) =>
                          updateVendorPricingV2(vendorIndex, (current) => {
                            const next = [...current.matchingRules];
                            next[ruleIndex] = { ...next[ruleIndex], ruleKey: e.target.value };
                            return { ...current, matchingRules: next };
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className='block text-xs text-gray-600 mb-1'>label</label>
                      <Input
                        value={rule.label}
                        onChange={(e) =>
                          updateVendorPricingV2(vendorIndex, (current) => {
                            const next = [...current.matchingRules];
                            next[ruleIndex] = { ...next[ruleIndex], label: e.target.value };
                            return { ...current, matchingRules: next };
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className='block text-xs text-gray-600 mb-1'>priority</label>
                      <Input
                        type='number'
                        value={rule.priority}
                        onChange={(e) =>
                          updateVendorPricingV2(vendorIndex, (current) => {
                            const next = [...current.matchingRules];
                            next[ruleIndex] = {
                              ...next[ruleIndex],
                              priority: Number(e.target.value) || 0,
                            };
                            return { ...current, matchingRules: next };
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className='block text-xs text-gray-600 mb-1'>evaluatorKey</label>
                      <select
                        value={rule.evaluatorKey}
                        onChange={(e) =>
                          updateVendorPricingV2(vendorIndex, (current) => {
                            const next = [...current.matchingRules];
                            next[ruleIndex] = { ...next[ruleIndex], evaluatorKey: e.target.value };
                            return { ...current, matchingRules: next };
                          })
                        }
                        className='w-full rounded border px-3 py-2'
                      >
                        <option value=''>请选择 evaluator</option>
                        {evaluatorEntries.map(([key, evaluator]) => (
                          <option key={key} value={key}>
                            {key} ({evaluator.type})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className='flex items-end justify-between gap-2'>
                      <label className='inline-flex items-center gap-2 text-xs text-gray-600'>
                        <input
                          type='checkbox'
                          checked={rule.enabled}
                          onChange={(e) =>
                            updateVendorPricingV2(vendorIndex, (current) => {
                              const next = [...current.matchingRules];
                              next[ruleIndex] = { ...next[ruleIndex], enabled: e.target.checked };
                              return { ...current, matchingRules: next };
                            })
                          }
                        />
                        enabled
                      </label>
                      <Button
                        size='sm'
                        variant='outline'
                        className='text-red-600 hover:text-red-700'
                        onClick={() =>
                          updateVendorPricingV2(vendorIndex, (current) => ({
                            ...current,
                            matchingRules: current.matchingRules.filter((_, index) => index !== ruleIndex),
                          }))
                        }
                      >
                        删除
                      </Button>
                    </div>
                  </div>

                  {(["all", "any"] as const).map((groupName) => (
                    <div key={groupName} className='space-y-2'>
                      <div className='flex items-center justify-between'>
                        <div className='text-xs font-medium text-gray-600'>
                          {groupName.toUpperCase()} 条件
                        </div>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() =>
                            updateVendorPricingV2(vendorIndex, (current) => {
                              const next = [...current.matchingRules];
                              const target = next[ruleIndex];
                              next[ruleIndex] = {
                                ...target,
                                conditions: {
                                  ...target.conditions,
                                  [groupName]: [...target.conditions[groupName], createEmptyConditionRow()],
                                },
                              };
                              return { ...current, matchingRules: next };
                            })
                          }
                        >
                          新增条件
                        </Button>
                      </div>
                      {rule.conditions[groupName].map((condition, conditionIndex) => {
                        const dimension = pricingV2.dimensions.find((item) => item.key === condition.field);
                        return (
                          <div
                            key={`${groupName}-${condition.field || "condition"}-${conditionIndex}`}
                            className='grid gap-2 md:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)_72px]'
                          >
                            <select
                              value={condition.field}
                              onChange={(e) =>
                                updateVendorPricingV2(vendorIndex, (current) => {
                                  const next = [...current.matchingRules];
                                  const target = next[ruleIndex];
                                  const rows = [...target.conditions[groupName]];
                                  rows[conditionIndex] = { ...rows[conditionIndex], field: e.target.value };
                                  next[ruleIndex] = {
                                    ...target,
                                    conditions: { ...target.conditions, [groupName]: rows },
                                  };
                                  return { ...current, matchingRules: next };
                                })
                              }
                              className='w-full rounded border px-3 py-2'
                            >
                              <option value=''>选择字段</option>
                              {dimensionOptions.map((option) => (
                                <option key={`${groupName}-${option.value}`} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <select
                              value={condition.op}
                              onChange={(e) =>
                                updateVendorPricingV2(vendorIndex, (current) => {
                                  const next = [...current.matchingRules];
                                  const target = next[ruleIndex];
                                  const rows = [...target.conditions[groupName]];
                                  rows[conditionIndex] = {
                                    ...rows[conditionIndex],
                                    op: e.target.value as ConditionOp,
                                  };
                                  next[ruleIndex] = {
                                    ...target,
                                    conditions: { ...target.conditions, [groupName]: rows },
                                  };
                                  return { ...current, matchingRules: next };
                                })
                              }
                              className='w-full rounded border px-3 py-2'
                            >
                              <option value='eq'>eq</option>
                              <option value='in'>in</option>
                              <option value='gt'>gt</option>
                              <option value='gte'>gte</option>
                              <option value='lt'>lt</option>
                              <option value='lte'>lte</option>
                            </select>
                            <Input
                              value={stringifyConditionValue(condition.value)}
                              onChange={(e) =>
                                updateVendorPricingV2(vendorIndex, (current) => {
                                  const next = [...current.matchingRules];
                                  const target = next[ruleIndex];
                                  const rows = [...target.conditions[groupName]];
                                  rows[conditionIndex] = {
                                    ...rows[conditionIndex],
                                    value: parseConditionValue(
                                      e.target.value,
                                      dimension?.type,
                                      rows[conditionIndex]?.op
                                    ),
                                  };
                                  next[ruleIndex] = {
                                    ...target,
                                    conditions: { ...target.conditions, [groupName]: rows },
                                  };
                                  return { ...current, matchingRules: next };
                                })
                              }
                              placeholder={condition.op === "in" ? "逗号分隔多个值" : "值"}
                            />
                            <Button
                              size='sm'
                              variant='outline'
                              className='text-red-600 hover:text-red-700'
                              onClick={() =>
                                updateVendorPricingV2(vendorIndex, (current) => {
                                  const next = [...current.matchingRules];
                                  const target = next[ruleIndex];
                                  next[ruleIndex] = {
                                    ...target,
                                    conditions: {
                                      ...target.conditions,
                                      [groupName]: target.conditions[groupName].filter(
                                        (_, index) => index !== conditionIndex
                                      ),
                                    },
                                  };
                                  return { ...current, matchingRules: next };
                                })
                              }
                            >
                              删除
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>

        <div className='rounded-lg border bg-white p-3'>
          <div className='mb-3 flex items-center justify-between'>
            <div className='font-medium text-gray-800'>3. Evaluator</div>
            <div className='flex gap-2'>
              {(["fixed", "linear", "base_plus_linear", "lookup_matrix"] as const).map((type) => (
                <Button
                  key={type}
                  size='sm'
                  variant='outline'
                  onClick={() =>
                    updateVendorPricingV2(vendorIndex, (current) => ({
                      ...current,
                      evaluators: {
                        ...current.evaluators,
                        [`eval_${type}_${Object.keys(current.evaluators || {}).length + 1}`]:
                          createEvaluatorByType(type),
                      },
                    }))
                  }
                >
                  新增 {type}
                </Button>
              ))}
            </div>
          </div>
          <div className='space-y-3'>
            {evaluatorEntries.length === 0 ? (
              <div className='rounded border border-dashed px-3 py-4 text-sm text-gray-500'>
                暂无 evaluator。建议先创建 `lookup_matrix` 或 `linear`。
              </div>
            ) : (
              evaluatorEntries.map(([evaluatorKey, evaluator]) => (
                <div key={evaluatorKey} className='rounded border p-3 space-y-3'>
                  <div className='flex items-center justify-between gap-3'>
                    <div className='font-medium text-gray-800'>{evaluatorKey}</div>
                    <div className='flex items-center gap-2'>
                      <span className='rounded bg-gray-100 px-2 py-1 text-xs text-gray-600'>
                        {evaluator.type}
                      </span>
                      <Button
                        size='sm'
                        variant='outline'
                        className='text-red-600 hover:text-red-700'
                        onClick={() =>
                          updateVendorPricingV2(vendorIndex, (current) => {
                            const nextEvaluators = { ...current.evaluators };
                            delete nextEvaluators[evaluatorKey];
                            return { ...current, evaluators: nextEvaluators };
                          })
                        }
                      >
                        删除
                      </Button>
                    </div>
                  </div>

                  {evaluator.type === "fixed" && (
                    <div className='grid gap-3 md:grid-cols-2'>
                      <div>
                        <label className='block text-xs text-gray-600 mb-1'>priceYuan</label>
                        <Input
                          type='number'
                          step='0.001'
                          value={evaluator.priceYuan ?? 0}
                          onChange={(e) =>
                            updateVendorPricingV2(vendorIndex, (current) => ({
                              ...current,
                              evaluators: {
                                ...current.evaluators,
                                [evaluatorKey]: { ...evaluator, priceYuan: Number(e.target.value) || 0 },
                              },
                            }))
                          }
                        />
                      </div>
                    </div>
                  )}

                  {evaluator.type === "linear" && (
                    <div className='grid gap-3 md:grid-cols-2'>
                      <div>
                        <label className='block text-xs text-gray-600 mb-1'>unitField</label>
                        <select
                          value={evaluator.unitField || ""}
                          onChange={(e) =>
                            updateVendorPricingV2(vendorIndex, (current) => ({
                              ...current,
                              evaluators: {
                                ...current.evaluators,
                                [evaluatorKey]: { ...evaluator, unitField: e.target.value },
                              },
                            }))
                          }
                          className='w-full rounded border px-3 py-2'
                        >
                          <option value=''>选择字段</option>
                          {dimensionOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className='block text-xs text-gray-600 mb-1'>unitPriceYuan</label>
                        <Input
                          type='number'
                          step='0.001'
                          value={evaluator.unitPriceYuan ?? 0}
                          onChange={(e) =>
                            updateVendorPricingV2(vendorIndex, (current) => ({
                              ...current,
                              evaluators: {
                                ...current.evaluators,
                                [evaluatorKey]: {
                                  ...evaluator,
                                  unitPriceYuan: Number(e.target.value) || 0,
                                },
                              },
                            }))
                          }
                        />
                      </div>
                    </div>
                  )}

                  {evaluator.type === "base_plus_linear" && (
                    <div className='grid gap-3 md:grid-cols-4'>
                      <Input
                        type='number'
                        value={evaluator.basePriceYuan ?? 0}
                        onChange={(e) =>
                          updateVendorPricingV2(vendorIndex, (current) => ({
                            ...current,
                            evaluators: {
                              ...current.evaluators,
                              [evaluatorKey]: { ...evaluator, basePriceYuan: Number(e.target.value) || 0 },
                            },
                          }))
                        }
                        placeholder='basePriceYuan'
                      />
                      <Input
                        type='number'
                        value={evaluator.includedUnits ?? 1}
                        onChange={(e) =>
                          updateVendorPricingV2(vendorIndex, (current) => ({
                            ...current,
                            evaluators: {
                              ...current.evaluators,
                              [evaluatorKey]: { ...evaluator, includedUnits: Number(e.target.value) || 1 },
                            },
                          }))
                        }
                        placeholder='includedUnits'
                      />
                      <select
                        value={evaluator.unitField || ""}
                        onChange={(e) =>
                          updateVendorPricingV2(vendorIndex, (current) => ({
                            ...current,
                            evaluators: {
                              ...current.evaluators,
                              [evaluatorKey]: { ...evaluator, unitField: e.target.value },
                            },
                          }))
                        }
                        className='w-full rounded border px-3 py-2'
                      >
                        <option value=''>选择字段</option>
                        {dimensionOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <Input
                        type='number'
                        step='0.001'
                        value={evaluator.extraUnitPriceYuan ?? 0}
                        onChange={(e) =>
                          updateVendorPricingV2(vendorIndex, (current) => ({
                            ...current,
                            evaluators: {
                              ...current.evaluators,
                              [evaluatorKey]: {
                                ...evaluator,
                                extraUnitPriceYuan: Number(e.target.value) || 0,
                              },
                            },
                          }))
                        }
                        placeholder='extraUnitPriceYuan'
                      />
                    </div>
                  )}

                  {evaluator.type === "lookup_matrix" && (
                    <div className='space-y-3'>
                      <div>
                        <label className='block text-xs text-gray-600 mb-1'>axes</label>
                        <Input
                          value={(evaluator.axes || []).join(", ")}
                          onChange={(e) =>
                            updateVendorPricingV2(vendorIndex, (current) => ({
                              ...current,
                              evaluators: {
                                ...current.evaluators,
                                [evaluatorKey]: {
                                  ...evaluator,
                                  axes: e.target.value
                                    .split(",")
                                    .map((item) => item.trim())
                                    .filter(Boolean),
                                },
                              },
                            }))
                          }
                          placeholder='例如：hasAudio, qualityMode, durationSec'
                        />
                      </div>
                      {(() => {
                        const axes = Array.isArray(evaluator.axes)
                          ? (evaluator.axes.filter(Boolean) as string[])
                          : [];
                        const axisDimensions = axes.map((axis: string) =>
                          pricingV2.dimensions.find((dimension) => dimension.key === axis)
                        );
                        const axisValues = axisDimensions.map(
                          (dimension: PricingDimensionDefinition | undefined) =>
                            getDimensionOptionValues(dimension).map((value) => String(value))
                        );
                        const canRenderMatrix =
                          (axes.length === 2 || axes.length === 3) &&
                          axisValues.every((values: string[]) => values.length > 0);

                        if (!canRenderMatrix) {
                          return (
                            <div className='rounded border border-dashed px-3 py-4 text-xs text-gray-500'>
                              可视化矩阵编辑需要先满足两个条件：1. `axes` 为 2 或 3 个字段；2.
                              每个轴字段都已经在维度定义里配置离散 options。
                            </div>
                          );
                        }

                        if (axes.length === 2) {
                          const rowAxis = axes[0];
                          const colAxis = axes[1];
                          const rowValues = axisValues[0];
                          const colValues = axisValues[1];
                          return (
                            <div className='overflow-x-auto rounded border'>
                              <table className='min-w-full border-separate border-spacing-0 text-xs'>
                                <thead>
                                  <tr>
                                    <th className='bg-gray-50 border px-3 py-2 text-left'>
                                      {rowAxis} \ {colAxis}
                                    </th>
                                    {colValues.map((colValue: string) => (
                                      <th key={colValue} className='bg-gray-50 border px-3 py-2 text-center'>
                                        {colValue}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {rowValues.map((rowValue: string) => (
                                    <tr key={rowValue}>
                                      <td className='border px-3 py-2 font-medium bg-white'>{rowValue}</td>
                                      {colValues.map((colValue: string) => {
                                        const currentValue = getLookupMatrixValue(evaluator.matrix, [
                                          rowValue,
                                          colValue,
                                        ]);
                                        return (
                                          <td key={`${rowValue}-${colValue}`} className='border px-2 py-2'>
                                            <Input
                                              type='number'
                                              step='0.001'
                                              value={typeof currentValue === "number" ? currentValue : ""}
                                              onChange={(e) =>
                                                updateVendorPricingV2(vendorIndex, (current) => ({
                                                  ...current,
                                                  evaluators: {
                                                    ...current.evaluators,
                                                    [evaluatorKey]: {
                                                      ...evaluator,
                                                      matrix: setLookupMatrixValue(
                                                        evaluator.matrix,
                                                        [rowValue, colValue],
                                                        e.target.value.trim() === ""
                                                          ? undefined
                                                          : Number(e.target.value)
                                                      ),
                                                    },
                                                  },
                                                }))
                                              }
                                              placeholder='-'
                                              className='min-w-[92px]'
                                            />
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          );
                        }

                        const groupAxis = axes[0];
                        const rowAxis = axes[1];
                        const colAxis = axes[2];
                        const groupValues = axisValues[0];
                        const rowValues = axisValues[1];
                        const colValues = axisValues[2];
                        return (
                          <div className='space-y-3'>
                            {groupValues.map((groupValue: string) => (
                              <div key={groupValue} className='rounded border'>
                                <div className='border-b bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700'>
                                  {groupAxis}: {groupValue}
                                </div>
                                <div className='overflow-x-auto'>
                                  <table className='min-w-full border-separate border-spacing-0 text-xs'>
                                    <thead>
                                      <tr>
                                        <th className='bg-gray-50 border px-3 py-2 text-left'>
                                          {rowAxis} \ {colAxis}
                                        </th>
                                        {colValues.map((colValue: string) => (
                                          <th key={colValue} className='bg-gray-50 border px-3 py-2 text-center'>
                                            {colValue}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {rowValues.map((rowValue: string) => (
                                        <tr key={`${groupValue}-${rowValue}`}>
                                          <td className='border px-3 py-2 font-medium bg-white'>{rowValue}</td>
                                          {colValues.map((colValue: string) => {
                                            const currentValue = getLookupMatrixValue(evaluator.matrix, [
                                              groupValue,
                                              rowValue,
                                              colValue,
                                            ]);
                                            return (
                                              <td
                                                key={`${groupValue}-${rowValue}-${colValue}`}
                                                className='border px-2 py-2'
                                              >
                                                <Input
                                                  type='number'
                                                  step='0.001'
                                                  value={typeof currentValue === "number" ? currentValue : ""}
                                                  onChange={(e) =>
                                                    updateVendorPricingV2(vendorIndex, (current) => ({
                                                      ...current,
                                                      evaluators: {
                                                        ...current.evaluators,
                                                        [evaluatorKey]: {
                                                          ...evaluator,
                                                          matrix: setLookupMatrixValue(
                                                            evaluator.matrix,
                                                            [groupValue, rowValue, colValue],
                                                            e.target.value.trim() === ""
                                                              ? undefined
                                                              : Number(e.target.value)
                                                          ),
                                                        },
                                                      },
                                                    }))
                                                  }
                                                  placeholder='-'
                                                  className='min-w-[92px]'
                                                />
                                              </td>
                                            );
                                          })}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                      <div>
                        <label className='block text-xs text-gray-600 mb-1'>matrix(JSON)</label>
                        <textarea
                          value={JSON.stringify(evaluator.matrix || {}, null, 2)}
                          onChange={(e) => {
                            try {
                              const parsed = e.target.value.trim() ? JSON.parse(e.target.value) : {};
                              updateVendorPricingV2(vendorIndex, (current) => ({
                                ...current,
                                evaluators: {
                                  ...current.evaluators,
                                  [evaluatorKey]: { ...evaluator, matrix: parsed },
                                },
                              }));
                            } catch {
                              // keep editing text until valid json by ignoring invalid patch
                            }
                          }}
                          rows={8}
                          className='w-full rounded border border-gray-200 px-3 py-2 font-mono text-xs'
                          spellCheck={false}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className='rounded-lg border bg-white p-3'>
          <div className='mb-3 font-medium text-gray-800'>4. 展示配置</div>
          <div className='grid gap-3 md:grid-cols-2'>
            <div>
              <label className='block text-xs text-gray-600 mb-1'>specAxes</label>
              <Input
                value={(pricingV2.displayConfig.specAxes || []).join(", ")}
                onChange={(e) =>
                  updateVendorPricingV2(vendorIndex, (current) => ({
                    ...current,
                    displayConfig: {
                      ...current.displayConfig,
                      specAxes: e.target.value.split(",").map((item) => item.trim()).filter(Boolean),
                    },
                  }))
                }
                placeholder='例如：qualityMode, durationSec'
              />
            </div>
            <div>
              <label className='block text-xs text-gray-600 mb-1'>默认规格选择</label>
              <div className='grid gap-2 md:grid-cols-2'>
                {pricingV2.dimensions.map((dimension) => (
                  <div key={`default-${dimension.key}`}>
                    <label className='block text-[11px] text-gray-500 mb-1'>
                      {dimension.label || dimension.key}
                    </label>
                    {dimension.type === "enum" || dimension.type === "boolean" ? (
                      <select
                        value={String(pricingV2.displayConfig.defaultSelections?.[dimension.key] ?? "")}
                        onChange={(e) =>
                          updateVendorPricingV2(vendorIndex, (current) => ({
                            ...current,
                            displayConfig: {
                              ...current.displayConfig,
                              defaultSelections: {
                                ...current.displayConfig.defaultSelections,
                                [dimension.key]:
                                  dimension.type === "boolean"
                                    ? e.target.value === "true"
                                    : e.target.value,
                              },
                            },
                          }))
                        }
                        className='w-full rounded border px-3 py-2'
                      >
                        <option value=''>未设置</option>
                        {(dimension.options || []).map((option) => (
                          <option
                            key={`${dimension.key}-${String(option.value)}`}
                            value={String(option.value)}
                          >
                            {option.label || String(option.value)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        value={String(pricingV2.displayConfig.defaultSelections?.[dimension.key] ?? "")}
                        onChange={(e) =>
                          updateVendorPricingV2(vendorIndex, (current) => ({
                            ...current,
                            displayConfig: {
                              ...current.displayConfig,
                              defaultSelections: {
                                ...current.displayConfig.defaultSelections,
                                [dimension.key]:
                                  dimension.type === "number"
                                    ? e.target.value.trim() === ""
                                      ? ""
                                      : Number(e.target.value)
                                    : e.target.value,
                              },
                            },
                          }))
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className='mt-3'>
            <label className='block text-xs text-gray-600 mb-2'>标签映射</label>
            <div className='grid gap-2 md:grid-cols-2'>
              {pricingV2.dimensions.flatMap((dimension) =>
                (dimension.options || []).map((option) => {
                  const labelKey = `${dimension.key}.${String(option.value)}`;
                  return (
                    <div key={labelKey}>
                      <label className='block text-[11px] text-gray-500 mb-1'>{labelKey}</label>
                      <Input
                        value={pricingV2.displayConfig.labels?.[labelKey] || ""}
                        onChange={(e) =>
                          updateVendorPricingV2(vendorIndex, (current) => ({
                            ...current,
                            displayConfig: {
                              ...current.displayConfig,
                              labels: {
                                ...current.displayConfig.labels,
                                [labelKey]: e.target.value,
                              },
                            },
                          }))
                        }
                        placeholder={option.label || String(option.value)}
                      />
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className='mt-4'>
            <div className='mb-2 flex items-center justify-between'>
              <label className='block text-xs text-gray-600'>预设规格 presets</label>
              <div className='flex gap-2'>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() =>
                    updateVendorPricingV2(vendorIndex, (current) => ({
                      ...current,
                      displayConfig: {
                        ...current.displayConfig,
                        presets: [
                          ...(current.displayConfig.presets || []),
                          Object.fromEntries(
                            current.dimensions.map((dimension) => [
                              dimension.key,
                              Array.isArray(dimension.options) && dimension.options.length > 0
                                ? dimension.options[0]?.value
                                : dimension.type === "boolean"
                                  ? false
                                  : dimension.type === "number"
                                    ? 0
                                    : "",
                            ])
                          ),
                        ],
                      },
                    }))
                  }
                >
                  新增 preset
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => previewVendorPricingPresets(vendorIndex, vendor)}
                  disabled={presetPreviewLoading || (pricingV2.displayConfig.presets || []).length === 0}
                >
                  {presetPreviewLoading ? "试算中..." : "批量试算"}
                </Button>
              </div>
            </div>
            <div className='space-y-3'>
              {(pricingV2.displayConfig.presets || []).length === 0 ? (
                <div className='rounded border border-dashed px-3 py-4 text-sm text-gray-500'>
                  暂无展示预设。可添加一组默认规格用于价格一览和推荐组合展示。
                </div>
              ) : (
                (pricingV2.displayConfig.presets || []).map((preset, presetIndex) => (
                  <div key={`preset-${presetIndex}`} className='rounded border p-3'>
                    <div className='mb-2 flex items-center justify-between'>
                      <div className='text-xs font-medium text-gray-600'>Preset {presetIndex + 1}</div>
                      <Button
                        size='sm'
                        variant='outline'
                        className='text-red-600 hover:text-red-700'
                        onClick={() =>
                          updateVendorPricingV2(vendorIndex, (current) => ({
                            ...current,
                            displayConfig: {
                              ...current.displayConfig,
                              presets: (current.displayConfig.presets || []).filter(
                                (_, index) => index !== presetIndex
                              ),
                            },
                          }))
                        }
                      >
                        删除
                      </Button>
                    </div>
                    <div className='grid gap-2 md:grid-cols-2 xl:grid-cols-3'>
                      {pricingV2.dimensions.map((dimension) => (
                        <div key={`preset-${presetIndex}-${dimension.key}`}>
                          <label className='block text-[11px] text-gray-500 mb-1'>
                            {dimension.label || dimension.key}
                          </label>
                          {dimension.type === "enum" || dimension.type === "boolean" ? (
                            <select
                              value={String(preset?.[dimension.key] ?? "")}
                              onChange={(e) =>
                                updateVendorPricingV2(vendorIndex, (current) => {
                                  const nextPresets = [...(current.displayConfig.presets || [])];
                                  const currentPreset = { ...(nextPresets[presetIndex] || {}) };
                                  currentPreset[dimension.key] =
                                    dimension.type === "boolean" ? e.target.value === "true" : e.target.value;
                                  nextPresets[presetIndex] = currentPreset;
                                  return {
                                    ...current,
                                    displayConfig: {
                                      ...current.displayConfig,
                                      presets: nextPresets,
                                    },
                                  };
                                })
                              }
                              className='w-full rounded border px-3 py-2'
                            >
                              <option value=''>未设置</option>
                              {(dimension.options || []).map((option) => (
                                <option
                                  key={`preset-${presetIndex}-${dimension.key}-${String(option.value)}`}
                                  value={String(option.value)}
                                >
                                  {option.label || String(option.value)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <Input
                              value={String(preset?.[dimension.key] ?? "")}
                              onChange={(e) =>
                                updateVendorPricingV2(vendorIndex, (current) => {
                                  const nextPresets = [...(current.displayConfig.presets || [])];
                                  const currentPreset = { ...(nextPresets[presetIndex] || {}) };
                                  currentPreset[dimension.key] =
                                    dimension.type === "number"
                                      ? e.target.value.trim() === ""
                                        ? ""
                                        : Number(e.target.value)
                                      : e.target.value;
                                  nextPresets[presetIndex] = currentPreset;
                                  return {
                                    ...current,
                                    displayConfig: {
                                      ...current.displayConfig,
                                      presets: nextPresets,
                                    },
                                  };
                                })
                              }
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className='rounded-lg border bg-white p-3'>
          <div className='mb-2 flex items-center justify-between gap-3'>
            <div className='font-medium text-gray-800'>5. 试算结果</div>
            {presetPreviewResults.length > 0 && (
              <span className='text-xs text-gray-500'>
                已缓存 {presetPreviewResults.length} 条 preset 试算结果
              </span>
            )}
          </div>
          {!previewResult ? (
            <div className='rounded border border-dashed px-3 py-4 text-sm text-gray-500'>
              点击“试算 v2”后，这里会显示命中的规则、evaluator 和最终积分。
            </div>
          ) : (
            <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-sm'>
              <div className='rounded border bg-gray-50 p-3'>
                <div className='text-xs text-gray-500'>matchedRuleKey</div>
                <div className='font-medium'>{previewResult.matchedRuleKey || "-"}</div>
              </div>
              <div className='rounded border bg-gray-50 p-3'>
                <div className='text-xs text-gray-500'>evaluator</div>
                <div className='font-medium'>
                  {previewResult.evaluatorKey || "-"}{" "}
                  {previewResult.evaluatorType ? `(${previewResult.evaluatorType})` : ""}
                </div>
              </div>
              <div className='rounded border bg-gray-50 p-3'>
                <div className='text-xs text-gray-500'>priceYuan</div>
                <div className='font-medium'>{previewResult.price?.priceYuan ?? "-"}</div>
              </div>
              <div className='rounded border bg-gray-50 p-3'>
                <div className='text-xs text-gray-500'>credits</div>
                <div className='font-medium'>{previewResult.price?.credits ?? "-"}</div>
              </div>
            </div>
          )}

          {presetPreviewResults.length > 0 && (
            <div className='mt-4 overflow-x-auto rounded border'>
              <table className='min-w-full text-xs'>
                <thead className='bg-gray-50'>
                  <tr>
                    <th className='border px-3 py-2 text-left'>Preset</th>
                    <th className='border px-3 py-2 text-left'>规则</th>
                    <th className='border px-3 py-2 text-left'>Evaluator</th>
                    <th className='border px-3 py-2 text-right'>价格(元)</th>
                    <th className='border px-3 py-2 text-right'>积分</th>
                  </tr>
                </thead>
                <tbody>
                  {presetPreviewResults.map((result, presetIndex) => {
                    const presetSource = (pricingV2.displayConfig.presets || [])[presetIndex] || {};
                    return (
                      <tr key={`preset-preview-${presetIndex}`}>
                        <td className='border px-3 py-2 align-top text-gray-600'>
                          <div className='font-medium text-gray-800'>Preset {presetIndex + 1}</div>
                          <div className='mt-1 whitespace-pre-wrap break-all'>
                            {Object.entries(presetSource)
                              .map(([key, value]) => `${key}: ${String(value)}`)
                              .join(" · ")}
                          </div>
                        </td>
                        <td className='border px-3 py-2 align-top'>{result.matchedRuleKey || "-"}</td>
                        <td className='border px-3 py-2 align-top'>
                          {result.evaluatorKey || "-"}
                          {result.evaluatorType ? ` (${result.evaluatorType})` : ""}
                        </td>
                        <td className='border px-3 py-2 align-top text-right'>
                          {result.price?.priceYuan ?? "-"}
                        </td>
                        <td className='border px-3 py-2 align-top text-right font-medium'>
                          {result.price?.credits ?? "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
