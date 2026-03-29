/**
 * Midjourney V7 / Niji 7（悠船）对整段「说明 + Markdown」敏感，容易失败；
 * 纯文本交互节点常输出带标题、引用、加粗的排版，需压缩为可生图的主提示词。
 */
const MAX_MJ_V7_PROMPT_CHARS = 6000;

export function sanitizeFlowTextForMidjourneyV7(raw: string): string {
  let s = (raw || '').trim();
  if (!s) return s;

  // 1) 常见 LLM 结构：> **Prompt:** 或 **Prompt:** 后的正文
  const blockAfterPromptLabel = extractAfterPromptLabel(s);
  if (blockAfterPromptLabel.length >= 16) {
    s = blockAfterPromptLabel;
  }

  // 2) 去掉 Markdown 标题行、列表装饰（保留正文）
  s = s
    .replace(/^#{1,6}\s+[^\r\n]*/gm, ' ')
    .replace(/^\s*[-*+]\s+/gm, ' ')
    .replace(/^>\s?/gm, '');

  // 3) 粗体 / 斜体 / 反引号
  s = s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1');

  // 4) 空白归一
  s = s.replace(/\s+/g, ' ').trim();

  if (s.length > MAX_MJ_V7_PROMPT_CHARS) {
    s = s.slice(0, MAX_MJ_V7_PROMPT_CHARS).trim();
  }

  return s;
}

function extractAfterPromptLabel(s: string): string {
  // 常见排版：> **Prompt:** 英文提示词（整段加粗标签为 **Prompt:**）
  const patterns: RegExp[] = [
    />\s*\*\*Prompt:\*\*\s*([\s\S]+?)(?=\n\s*\n\s*(?:#{1,3}\s|###\s|\*\*[A-Za-z\u4e00-\u9fff])|$)/i,
    /\*\*Prompt:\*\*\s*([\s\S]+?)(?=\n\s*\n\s*(?:#{1,3}\s|###\s|\*\*)|$)/i,
    /(?:^|\n)\s*Prompt\s*:\s*([^\n]+(?:\n(?!\n)[^\n]+)*)/i,
  ];

  for (const re of patterns) {
    const m = s.match(re);
    if (m?.[1]) {
      const inner = m[1].trim();
      if (inner.length >= 8) return inner;
    }
  }

  return '';
}
