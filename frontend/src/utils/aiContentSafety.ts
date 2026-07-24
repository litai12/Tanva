export const AI_CONTENT_SAFETY_REFUSAL =
  "这属于敏感或不符合本站创作主题的话题，我不便回答。\n\n如果您有创作、设计、故事构思或画布相关的需求，我很乐意为您提供帮助！";

const POLITICAL_NAMES_AND_ALIASES =
  /(?:习近平|习[近进晋]平|宽衣帝|毛泽东|邓小平|江泽民|胡锦涛|李克强|李强|周恩来|刘少奇|朱德|彭德怀|温家宝|朱镕基)/iu;

const BLOCKED_INPUT = new RegExp(
  [
    POLITICAL_NAMES_AND_ALIASES.source,
    "中国(?:现任|近现代)?(?:政治人物|领导人)",
    "(?:国家主席|总书记|政治局常委|国务院总理)(?:是谁|简介|评价|黑料|绰号|内幕)?",
    "战争|军事冲突|战场屠杀|恐怖袭击|恐怖主义|极端主义|炸弹袭击|生化武器|核武器攻击",
    "血腥|肢解|斩首|开膛|虐杀|虐待致死|尸块|器官外露|残忍杀害|凶杀过程",
    "自杀方法|如何自杀|怎么自杀|自残方法|如何自残|怎么自残",
  ].join("|"),
  "iu"
);

function normalizeSafetyText(value: string): string {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\s·•_—-]+/gu, "");
}

export function shouldBlockAIRequest(value: string): boolean {
  return BLOCKED_INPUT.test(normalizeSafetyText(value));
}

export function sanitizeAITextOutput(value: string): string {
  return POLITICAL_NAMES_AND_ALIASES.test(normalizeSafetyText(value))
    ? AI_CONTENT_SAFETY_REFUSAL
    : value;
}
