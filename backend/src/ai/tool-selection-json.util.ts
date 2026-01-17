export type ToolSelectionJsonPayload = {
  selectedTool?: unknown;
  reasoning?: unknown;
  confidence?: unknown;
};

const KNOWN_TOOL_NAMES = [
  'generateImage',
  'editImage',
  'blendImages',
  'analyzeImage',
  'chatResponse',
  'generateVideo',
  'generatePaperJS',
] as const;

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function stripTrailingCommas(text: string): string {
  let result = '';
  let inString = false;
  let quoteChar: '"' | "'" = '"';
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      result += char;

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === quoteChar) {
        inString = false;
      }

      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quoteChar = char;
      result += char;
      continue;
    }

    if (char === ',') {
      let lookahead = index + 1;
      while (lookahead < text.length && /\s/.test(text[lookahead])) {
        lookahead += 1;
      }

      if (lookahead < text.length && (text[lookahead] === '}' || text[lookahead] === ']')) {
        continue;
      }
    }

    result += char;
  }

  return result;
}

function repairJsonLikeText(text: string): string {
  let repaired = text;

  if (repaired.charCodeAt(0) === 0xfeff) {
    repaired = repaired.slice(1);
  }

  repaired = repaired.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  repaired = stripTrailingCommas(repaired);
  return repaired;
}

function tryParseJson<T>(text: string): T | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const direct = safeJsonParse<T>(trimmed);
  if (direct !== null) return direct;

  const repaired = repairJsonLikeText(trimmed);
  if (repaired !== trimmed) {
    const repairedParsed = safeJsonParse<T>(repaired);
    if (repairedParsed !== null) return repairedParsed;
  }

  return null;
}

function extractFirstBalancedJsonObject(text: string, startIndex: number): string | null {
  if (startIndex < 0 || startIndex >= text.length || text[startIndex] !== '{') {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function findFirstParseableJsonObject<T>(text: string): T | null {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '{') continue;
    const candidate = extractFirstBalancedJsonObject(text, index);
    if (!candidate) continue;
    const parsed = tryParseJson<T>(candidate);
    if (parsed) return parsed;
  }

  return null;
}

function findFirstParseableJsonFromCodeFence<T>(text: string): T | null {
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(text)) !== null) {
    const content = (match[1] ?? '').trim();
    if (!content) continue;

    const parsed = tryParseJson<T>(content);
    if (parsed) return parsed;

    const extracted = findFirstParseableJsonObject<T>(content);
    if (extracted) return extracted;
  }

  return null;
}

function extractLooseToolSelection(text: string): ToolSelectionJsonPayload | null {
  const normalized = (text ?? '').trim();
  if (!normalized) return null;

  const selectedToolMatch = /["']?selectedTool["']?\s*[:=]\s*["']?([a-zA-Z][a-zA-Z0-9_-]*)["']?/i.exec(normalized);
  let selectedTool = selectedToolMatch?.[1];

  if (!selectedTool) {
    const backtickMatch = new RegExp(
      '`(' + KNOWN_TOOL_NAMES.join('|') + ')`',
      'i'
    ).exec(normalized);
    if (backtickMatch?.[1]) {
      selectedTool = backtickMatch[1];
    }
  }

  if (!selectedTool) {
    const plainMatch = new RegExp(
      `\\b(${KNOWN_TOOL_NAMES.join('|')})\\b`,
      'i'
    ).exec(normalized);
    if (plainMatch?.[1]) {
      selectedTool = plainMatch[1];
    }
  }

  if (!selectedTool || selectedTool === '工具名称') {
    return null;
  }

  const payload: ToolSelectionJsonPayload = { selectedTool };

  const confidenceMatch = /["']?confidence["']?\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/i.exec(normalized);
  if (confidenceMatch?.[1]) {
    const value = Number(confidenceMatch[1]);
    if (!Number.isNaN(value)) {
      payload.confidence = value;
    }
  }

  const reasoningMatch = /["']?reasoning["']?\s*[:=]\s*(["'])([\s\S]*?)\1/i.exec(normalized);
  if (reasoningMatch?.[2]) {
    payload.reasoning = reasoningMatch[2];
  }

  return payload;
}

export function parseToolSelectionJson(text: string): ToolSelectionJsonPayload | null {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;

  const direct = tryParseJson<ToolSelectionJsonPayload>(trimmed);
  if (direct) return direct;

  const fromFence = findFirstParseableJsonFromCodeFence<ToolSelectionJsonPayload>(trimmed);
  if (fromFence) return fromFence;

  const fromObject = findFirstParseableJsonObject<ToolSelectionJsonPayload>(trimmed);
  if (fromObject) return fromObject;

  return extractLooseToolSelection(trimmed);
}
