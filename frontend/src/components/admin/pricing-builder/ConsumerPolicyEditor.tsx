import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ConsumerPolicyCondition = {
  field: string;
  op: "eq" | "in" | "gt" | "gte" | "lt" | "lte" | "exists";
  value: string | number | boolean | Array<string | number | boolean>;
};

export type ConsumerPolicy = {
  policyKey: string;
  label: string;
  enabled: boolean;
  priority: number;
  startsAt?: string;
  endsAt?: string;
  conditions: { all: ConsumerPolicyCondition[]; any: ConsumerPolicyCondition[] };
  availability?: { available: boolean; message?: string };
  discount?: { multiplier: number };
};

type PricingDimension = {
  key: string;
  label?: string;
  type?: "string" | "number" | "boolean" | "enum";
  options?: Array<{ value: string | number | boolean; label?: string }>;
};

type Props = {
  dimensions: PricingDimension[];
  policies: ConsumerPolicy[];
  onChange: (policies: ConsumerPolicy[]) => void;
};

const toTaipeiDateTimeLocal = (value?: string): string => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
};

const fromTaipeiDateTimeLocal = (value: string): string | undefined =>
  value ? `${value}:00+08:00` : undefined;

const parseValue = (
  raw: string,
  type?: PricingDimension["type"],
  op?: ConsumerPolicyCondition["op"]
): ConsumerPolicyCondition["value"] => {
  if (op === "in") {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => (type === "number" ? Number(item) : item));
  }
  if (type === "number") return raw === "" ? "" : Number(raw);
  if (type === "boolean") return raw === "true";
  return raw;
};

const stringifyValue = (value: ConsumerPolicyCondition["value"]): string =>
  Array.isArray(value) ? value.join(", ") : String(value ?? "");

export function ConsumerPolicyEditor({ dimensions, policies, onChange }: Props) {
  const updatePolicy = (index: number, patch: Partial<ConsumerPolicy>) => {
    const next = [...policies];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  return (
    <div className='rounded-lg border border-violet-200 bg-violet-50 p-4'>
      <div className='mb-3 flex items-center justify-between gap-3'>
        <div>
          <div className='font-medium text-violet-950'>用户消费运营</div>
          <div className='text-xs text-violet-700'>
            只影响用户最终扣减积分，不改变刊例价、上游成本或请求参数。结束时间到达后自动恢复原价。
          </div>
        </div>
        <Button
          size='sm'
          variant='outline'
          onClick={() =>
            onChange([
              ...policies,
              {
                policyKey: `consumer_policy_${Date.now()}`,
                label: "新运营策略",
                enabled: true,
                priority: 100,
                conditions: { all: [], any: [] },
                discount: { multiplier: 1 },
              },
            ])
          }
        >
          新增策略
        </Button>
      </div>

      {policies.length === 0 ? (
        <div className='rounded border border-dashed border-violet-200 bg-white px-3 py-5 text-sm text-gray-500'>
          暂无消费策略，当前所有规格均按刊例积分扣减。
        </div>
      ) : (
        <div className='space-y-3'>
          {policies.map((policy, policyIndex) => {
            const scoped =
              policy.conditions.all.length > 0 || policy.conditions.any.length > 0;
            const isDiscount = !!policy.discount;
            const isUnavailable = policy.availability?.available === false;
            return (
              <div key={policy.policyKey || policyIndex} className='space-y-3 rounded-lg border border-violet-200 bg-white p-3'>
                <div className='grid gap-3 md:grid-cols-[minmax(220px,2fr)_100px_110px_80px]'>
                  <div>
                    <label className='mb-1 block text-xs text-gray-600'>策略名称</label>
                    <Input
                      value={policy.label}
                      onChange={(event) => updatePolicy(policyIndex, { label: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className='mb-1 block text-xs text-gray-600'>优先级</label>
                    <Input
                      type='number'
                      value={policy.priority}
                      onChange={(event) =>
                        updatePolicy(policyIndex, { priority: Number(event.target.value) || 0 })
                      }
                    />
                  </div>
                  <label className='flex items-end gap-2 pb-2 text-sm text-gray-700'>
                    <input
                      type='checkbox'
                      checked={policy.enabled}
                      onChange={(event) => updatePolicy(policyIndex, { enabled: event.target.checked })}
                    />
                    启用策略
                  </label>
                  <div className='flex items-end'>
                    <Button
                      size='sm'
                      variant='outline'
                      className='text-red-600'
                      onClick={() => onChange(policies.filter((_, index) => index !== policyIndex))}
                    >
                      删除
                    </Button>
                  </div>
                </div>

                <div className='rounded border bg-slate-50 p-3'>
                  <div className='mb-2 flex items-center justify-between gap-3'>
                    <div>
                      <div className='text-sm font-medium text-gray-800'>作用范围</div>
                      <div className='text-xs text-gray-500'>
                        可作用于整条节点线路，也可按型号、分辨率等规格精确筛选。
                      </div>
                    </div>
                    <select
                      value={scoped ? "spec" : "all"}
                      onChange={(event) =>
                        updatePolicy(policyIndex, {
                          conditions:
                            event.target.value === "all"
                              ? { all: [], any: [] }
                              : {
                                  all: [{ field: dimensions[0]?.key || "", op: "eq", value: "" }],
                                  any: [],
                                },
                        })
                      }
                      className='rounded border px-3 py-2 text-sm'
                    >
                      <option value='all'>整条节点线路</option>
                      <option value='spec'>指定规格</option>
                    </select>
                  </div>
                  {scoped && (
                    <div className='space-y-2'>
                      {policy.conditions.all.map((condition, conditionIndex) => {
                        const dimension = dimensions.find((item) => item.key === condition.field);
                        const options = Array.isArray(dimension?.options) ? dimension.options : [];
                        const updateCondition = (patch: Partial<ConsumerPolicyCondition>) => {
                          const rows = [...policy.conditions.all];
                          rows[conditionIndex] = { ...rows[conditionIndex], ...patch };
                          updatePolicy(policyIndex, {
                            conditions: { ...policy.conditions, all: rows },
                          });
                        };
                        return (
                          <div key={`${condition.field}-${conditionIndex}`} className='grid gap-2 md:grid-cols-[minmax(160px,1fr)_110px_minmax(180px,1fr)_70px]'>
                            <select
                              value={condition.field}
                              onChange={(event) =>
                                updateCondition({ field: event.target.value, op: "eq", value: "" })
                              }
                              className='rounded border px-3 py-2 text-sm'
                            >
                              <option value=''>选择规格字段</option>
                              {dimensions.map((item) => (
                                <option key={item.key} value={item.key}>{item.label || item.key}</option>
                              ))}
                            </select>
                            <select
                              value={condition.op}
                              onChange={(event) =>
                                updateCondition({
                                  op: event.target.value as ConsumerPolicyCondition["op"],
                                  value: "",
                                })
                              }
                              className='rounded border px-3 py-2 text-sm'
                            >
                              <option value='eq'>等于</option>
                              <option value='in'>属于</option>
                              <option value='gt'>大于</option>
                              <option value='gte'>大于等于</option>
                              <option value='lt'>小于</option>
                              <option value='lte'>小于等于</option>
                            </select>
                            {options.length > 0 && condition.op === "eq" ? (
                              <select
                                value={String(condition.value ?? "")}
                                onChange={(event) =>
                                  updateCondition({
                                    value: parseValue(event.target.value, dimension?.type, condition.op),
                                  })
                                }
                                className='rounded border px-3 py-2 text-sm'
                              >
                                <option value=''>选择规格值</option>
                                {options.map((option) => (
                                  <option key={String(option.value)} value={String(option.value)}>
                                    {option.label || String(option.value)}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <Input
                                value={stringifyValue(condition.value)}
                                onChange={(event) =>
                                  updateCondition({
                                    value: parseValue(event.target.value, dimension?.type, condition.op),
                                  })
                                }
                                placeholder={condition.op === "in" ? "多个值用逗号分隔" : "规格值"}
                              />
                            )}
                            <Button
                              size='sm'
                              variant='outline'
                              className='text-red-600'
                              onClick={() =>
                                updatePolicy(policyIndex, {
                                  conditions: {
                                    ...policy.conditions,
                                    all: policy.conditions.all.filter((_, index) => index !== conditionIndex),
                                  },
                                })
                              }
                            >
                              删除
                            </Button>
                          </div>
                        );
                      })}
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() =>
                          updatePolicy(policyIndex, {
                            conditions: {
                              ...policy.conditions,
                              all: [
                                ...policy.conditions.all,
                                { field: dimensions[0]?.key || "", op: "eq", value: "" },
                              ],
                            },
                          })
                        }
                      >
                        增加规格条件
                      </Button>
                    </div>
                  )}
                </div>

                <div className='grid gap-3 md:grid-cols-2'>
                  <div className='rounded border p-3'>
                    <label className='mb-3 flex items-center gap-2 text-sm font-medium text-gray-800'>
                      <input
                        type='checkbox'
                        checked={isDiscount}
                        onChange={(event) =>
                          updatePolicy(policyIndex, {
                            discount: event.target.checked ? { multiplier: 1 } : undefined,
                          })
                        }
                      />
                      按折扣扣减积分
                    </label>
                    <div className='flex items-center gap-2'>
                      <Input
                        type='number'
                        min='0.01'
                        max='100'
                        step='0.01'
                        disabled={!isDiscount}
                        value={isDiscount ? Number((policy.discount!.multiplier * 100).toFixed(2)) : ""}
                        onChange={(event) =>
                          updatePolicy(policyIndex, {
                            discount: { multiplier: Number(event.target.value) / 100 },
                          })
                        }
                      />
                      <span className='whitespace-nowrap text-sm text-gray-600'>% 刊例积分</span>
                    </div>
                  </div>
                  <div className='rounded border p-3'>
                    <label className='mb-3 flex items-center gap-2 text-sm font-medium text-gray-800'>
                      <input
                        type='checkbox'
                        checked={isUnavailable}
                        onChange={(event) =>
                          updatePolicy(policyIndex, {
                            availability: event.target.checked
                              ? { available: false, message: "暂未开放" }
                              : undefined,
                          })
                        }
                      />
                      禁用命中规格
                    </label>
                    <Input
                      disabled={!isUnavailable}
                      value={policy.availability?.message || ""}
                      onChange={(event) =>
                        updatePolicy(policyIndex, {
                          availability: { available: false, message: event.target.value },
                        })
                      }
                      placeholder='前端提示，例如：暂未开放'
                    />
                  </div>
                </div>

                <div className='grid gap-3 md:grid-cols-2'>
                  <div>
                    <label className='mb-1 block text-xs text-gray-600'>开始时间（台北时间，可留空）</label>
                    <Input
                      type='datetime-local'
                      value={toTaipeiDateTimeLocal(policy.startsAt)}
                      onChange={(event) =>
                        updatePolicy(policyIndex, { startsAt: fromTaipeiDateTimeLocal(event.target.value) })
                      }
                    />
                  </div>
                  <div>
                    <label className='mb-1 block text-xs text-gray-600'>结束时间（台北时间，到点自动失效）</label>
                    <Input
                      type='datetime-local'
                      value={toTaipeiDateTimeLocal(policy.endsAt)}
                      onChange={(event) =>
                        updatePolicy(policyIndex, { endsAt: fromTaipeiDateTimeLocal(event.target.value) })
                      }
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
