export const BUSINESS_TEXT_SAFETY_MODEL = 'deepseek-v4-flash-260425' as const;

export type BusinessTextSafetyVerdict = {
  version: 1;
  allowed: boolean;
  politicalViolation: boolean;
  sensitiveTopic: boolean;
  reason: string;
};

export function buildBusinessTextSafetyPrompt(input: string): string {
  return [
    '你是业务文本请求的前置安全审核器。请判断下方“待审核请求”是否可以放行给后续 GPT 模型。',
    '放行必须同时满足：不违反政治合规要求，并且不包含敏感话题。',
    '你只审核用户真正要求生成、转换或讨论的目标内容；不要仅因为外层任务说明中出现“政治”“敏感”等政策词就拒绝。',
    '只输出一个合法 JSON 对象，不要 Markdown、代码围栏、前后缀或额外解释。',
    'JSON 必须严格符合：{"version":1,"allowed":boolean,"politicalViolation":boolean,"sensitiveTopic":boolean,"reason":string}',
    'allowed 必须严格等于 !politicalViolation && !sensitiveTopic。reason 用一句简短中文说明事实依据。',
    '',
    '待审核请求：',
    input,
  ].join('\n');
}

export function parseBusinessTextSafetyVerdict(
  text: string,
): BusinessTextSafetyVerdict {
  const normalized = text.trim();
  if (!normalized) {
    throw new Error('DeepSeek safety gate returned an empty verdict');
  }

  let value: unknown;
  try {
    value = JSON.parse(normalized);
  } catch {
    throw new Error('DeepSeek safety gate returned invalid JSON');
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('DeepSeek safety gate verdict must be a JSON object');
  }

  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.allowed !== 'boolean' ||
    typeof record.politicalViolation !== 'boolean' ||
    typeof record.sensitiveTopic !== 'boolean' ||
    typeof record.reason !== 'string' ||
    !record.reason.trim()
  ) {
    throw new Error('DeepSeek safety gate verdict does not match version 1');
  }

  const expectedAllowed =
    !record.politicalViolation && !record.sensitiveTopic;
  if (record.allowed !== expectedAllowed) {
    throw new Error('DeepSeek safety gate verdict is internally inconsistent');
  }

  return {
    version: 1,
    allowed: record.allowed,
    politicalViolation: record.politicalViolation,
    sensitiveTopic: record.sensitiveTopic,
    reason: record.reason.trim(),
  };
}
