import type {
  StoryboardPromptColumn,
  StoryboardPromptRow,
  StoryboardPromptTableData,
} from './types.ts';

export const DEFAULT_VIDEO_STORYBOARD_PROMPT = `你作为影视视频智能解析引擎，对输入影视视频素材执行全域画面分析，严格按照下方固定输出模板生成结构化结果。
分析维度包含：镜头切割识别、分镜信息提取、时序动作拆解、面部肌肉/微表情捕捉、构图与运镜分析，所有时间轴精确到小数点后1位（格式示例：0.0s-0.3s）。

硬性执行规则：
1. 自动依据画面剪辑切换点，完成镜头分割，每个独立镜头分配唯一【镜号】；
2. 区分景别：远景/大全景/全景/中全景/中景/中近景/近景/特写/大特写；
3. 机位运动类型：固定镜头、推、拉、摇、移、跟、环绕、升降、晃动、组合运动，无运动标注【静止机位】；
4. 画面内容客观描述：人物、道具、场景、光影色调、特效元素、构图方式（中心构图/对称/三分法/框架构图等）；
5. 台词：原声台词，无台词填写【无台词】；
6. 时序微动作&表情分段：单镜头内部继续拆分短时片段（建议0.2~0.5s区间），精细描述；
7. 表情分析禁止笼统词汇，必须落地到脸部肌肉变化：眉肌、眼轮匝肌、颧肌、口轮匝肌、下颌、嘴角、眼睑状态；肢体动作描述骨骼、关节运动；
8. 输出严格使用固定表格结构文本，不要markdown表格，使用层级文本，方便程序解析JSON；
9. 若画面存在多人物，分开描述每个人物动作、面部状态；
10. 画面出现特效、CG、光影变化，单独标注特效信息，适配影视特效制作需求。

====固定输出格式模板====
【镜头总览】
总镜数：
素材总时长：

=========单镜头开始=========
镜号：M001
时间区间（镜头完整区间）：xx.x s - xx.x s
景别：
机位运动：
构图方式：
画面整体内容：
台词文本：
特效元素：

---镜头内时序细分（微表情/短时动作拆解）
时间段：0.0s - 0.3s
目标人物：
面部肌肉与表情变化：
肢体动作变化：

时间段：0.3s - 0.6s
目标人物：
面部肌肉与表情变化：
肢体动作变化：

时间段：0.6s - 0.9s
目标人物：
面部肌肉与表情变化：
肢体动作变化：
=========单镜头结束=========

依次循环所有镜头，直至视频素材结束。

额外输出附加字段（用于影视特效开发）：
画面主色调、光影类型（硬光/软光）、画面IRE亮度参考、画面虚实（焦点位置）`;

const OVERVIEW_LABEL_ORDER = [
  '集数/标题',
  '总镜数',
  '素材总时长',
  '节拍数',
  '全程说明',
];

const SHOT_LABEL_ORDER = [
  '镜号',
  '时间区间（镜头完整区间）',
  '时长',
  '节拍单元',
  '剧本特征',
  '场景与光影',
  '人物站位（本节拍起始）',
  '景别',
  '运镜',
  '构图',
  '画面内容',
  '台词',
  '音效',
  '备注',
  '字数与语速',
  // Legacy video-analysis labels remain recognized for existing tables.
  '机位运动',
  '构图方式',
  '画面整体内容',
  '台词文本',
  '特效元素',
  '画面主色调',
  '光影类型（硬光/软光）',
  '画面IRE亮度参考',
  '画面虚实（焦点位置）',
];

const TIMELINE_LABEL_ORDER = [
  '时间段',
  '目标人物',
  '表情与呼吸',
  '细微肢体与应激动作',
  // Legacy video-analysis labels remain recognized for existing tables.
  '面部肌肉与表情变化',
  '肢体动作变化',
];

const SHOT_LABELS = new Set(SHOT_LABEL_ORDER);
const TIMELINE_LABELS = new Set(TIMELINE_LABEL_ORDER);
const SECTION_LABELS = new Set([
  '额外输出附加字段（用于影视特效开发）',
]);
const CANONICAL_COLUMN_ORDER = [
  '时间段',
  '镜号',
  '时间区间（镜头完整区间）',
  ...SHOT_LABEL_ORDER.filter((label) => (
    label !== '镜号' && label !== '时间区间（镜头完整区间）'
  )),
  ...TIMELINE_LABEL_ORDER.filter((label) => label !== '时间段'),
];

const DEFAULT_SCRIPT_STORYBOARD_COLUMNS: Array<{
  label: string;
  scope: StoryboardPromptColumn['scope'];
}> = [
  { label: '时间段', scope: 'timeline' },
  { label: '镜号', scope: 'shot' },
  { label: '时间区间（镜头完整区间）', scope: 'shot' },
  { label: '时长', scope: 'shot' },
  { label: '节拍单元', scope: 'shot' },
  { label: '剧本特征', scope: 'shot' },
  { label: '场景与光影', scope: 'shot' },
  { label: '人物站位（本节拍起始）', scope: 'shot' },
  { label: '景别', scope: 'shot' },
  { label: '运镜', scope: 'shot' },
  { label: '构图', scope: 'shot' },
  { label: '画面内容', scope: 'shot' },
  { label: '台词', scope: 'shot' },
  { label: '音效', scope: 'shot' },
  { label: '备注', scope: 'shot' },
  { label: '字数与语速', scope: 'shot' },
  { label: '目标人物', scope: 'timeline' },
  { label: '表情与呼吸', scope: 'timeline' },
  { label: '细微肢体与应激动作', scope: 'timeline' },
];

export const createEmptyStoryboardPromptTable = (): StoryboardPromptTableData => {
  const columns = DEFAULT_SCRIPT_STORYBOARD_COLUMNS.map(({ label, scope }) => ({
    key: label,
    label,
    scope,
  }));
  const values = Object.fromEntries(
    columns.map((column) => [column.key, column.label === '镜号' ? 'M001' : '']),
  );
  return {
    version: 1,
    overview: {
      '集数/标题': '',
      总镜数: '1',
      素材总时长: '',
      节拍数: '',
      全程说明: '全程无音乐，只保留音效。不生成字幕。',
    },
    columns,
    rows: [{
      id: 'shot-1-segment-1',
      shotId: 'shot-1',
      values,
    }],
  };
};

type ParsedFields = {
  values: Record<string, string>;
  order: string[];
};

const cleanOutputText = (rawText: string): string =>
  String(rawText || '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*```(?:text|plaintext|json)?\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/i, '')
    .trim();

const normalizeLabel = (rawLabel: string): string =>
  rawLabel
    .replace(/^\s*[-*]\s*/, '')
    .replace(/\*\*/g, '')
    .trim();

const appendFieldValue = (
  values: Record<string, string>,
  order: string[],
  label: string,
  rawValue: string,
): void => {
  const normalizedLabel = normalizeLabel(label);
  if (!normalizedLabel || SECTION_LABELS.has(normalizedLabel)) return;
  const value = rawValue.trim();
  if (!(normalizedLabel in values)) {
    order.push(normalizedLabel);
    values[normalizedLabel] = value;
    return;
  }
  if (!value) return;
  if (!values[normalizedLabel]) {
    values[normalizedLabel] = value;
    return;
  }
  if (values[normalizedLabel].split('\n').includes(value)) return;
  values[normalizedLabel] = `${values[normalizedLabel]}\n${value}`;
};

const parseLabeledLines = (rawText: string): ParsedFields => {
  const values: Record<string, string> = {};
  const order: string[] = [];
  let activeLabel: string | null = null;

  for (const rawLine of rawText.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      activeLabel = null;
      continue;
    }
    if (
      /^={3,}/.test(line) ||
      /^---/.test(line) ||
      /^【.+】$/.test(line)
    ) {
      activeLabel = null;
      continue;
    }
    const match = /^([^：:\n]{1,100})[：:]\s*(.*)$/.exec(line);
    if (match) {
      const label = normalizeLabel(match[1]);
      appendFieldValue(values, order, label, match[2]);
      activeLabel = label;
      continue;
    }
    if (activeLabel && values[activeLabel]) {
      values[activeLabel] = `${values[activeLabel]}\n${line}`;
    }
  }

  return { values, order };
};

const splitShotBlocks = (text: string): string[] => {
  const markerPattern =
    /={3,}\s*单镜头开始\s*={3,}([\s\S]*?)(?=={3,}\s*单镜头开始\s*={3,}|$)/gi;
  const markedBlocks = Array.from(text.matchAll(markerPattern))
    .map((match) => (
      match[1]
        ?.replace(/={3,}\s*单镜头结束\s*={3,}/gi, '')
        .trim() || ''
    ))
    .filter(Boolean);
  if (markedBlocks.length > 0) return markedBlocks;

  const shotStarts = Array.from(text.matchAll(/^镜号[：:]/gm));
  if (shotStarts.length === 0) return [];
  return shotStarts.map((match, index) => {
    const start = match.index || 0;
    const end = shotStarts[index + 1]?.index ?? text.length;
    return text.slice(start, end).trim();
  });
};

const addColumn = (
  columnsByLabel: Map<string, StoryboardPromptColumn>,
  label: string,
  scope: StoryboardPromptColumn['scope'],
): void => {
  if (!label || columnsByLabel.has(label)) return;
  columnsByLabel.set(label, { key: label, label, scope });
};

const parseTimelineSection = (
  rawText: string,
  shotFields: ParsedFields,
): { rows: ParsedFields[]; discoveredShotLabels: string[] } => {
  const rows: ParsedFields[] = [];
  const discoveredShotLabels: string[] = [];
  let current: ParsedFields | null = null;
  let activeTarget: { fields: ParsedFields; label: string } | null = null;

  const pushCurrent = () => {
    if (current && Object.keys(current.values).length > 0) rows.push(current);
    current = null;
    activeTarget = null;
  };

  for (const rawLine of rawText.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      activeTarget = null;
      continue;
    }
    if (/^={3,}/.test(line) || /^---/.test(line)) {
      activeTarget = null;
      continue;
    }
    const match = /^([^：:\n]{1,100})[：:]\s*(.*)$/.exec(line);
    if (!match) {
      if (activeTarget && activeTarget.fields.values[activeTarget.label]) {
        activeTarget.fields.values[activeTarget.label] =
          `${activeTarget.fields.values[activeTarget.label]}\n${line}`;
      }
      continue;
    }

    const label = normalizeLabel(match[1]);
    const value = match[2];
    if (label === '时间段') {
      pushCurrent();
      current = { values: {}, order: [] };
      appendFieldValue(current.values, current.order, label, value);
      activeTarget = { fields: current, label };
      continue;
    }

    const belongsToShot =
      SHOT_LABELS.has(label) ||
      (!current && !TIMELINE_LABELS.has(label));
    if (belongsToShot) {
      appendFieldValue(shotFields.values, shotFields.order, label, value);
      if (!discoveredShotLabels.includes(label)) discoveredShotLabels.push(label);
      activeTarget = { fields: shotFields, label };
      continue;
    }

    if (!current) current = { values: {}, order: [] };
    appendFieldValue(current.values, current.order, label, value);
    activeTarget = { fields: current, label };
  }
  pushCurrent();
  return { rows, discoveredShotLabels };
};

const sortColumns = (
  columns: StoryboardPromptColumn[],
): StoryboardPromptColumn[] => {
  const canonicalIndex = new Map(
    CANONICAL_COLUMN_ORDER.map((label, index) => [label, index]),
  );
  return columns
    .map((column, index) => ({ column, index }))
    .sort((left, right) => {
      const leftOrder = canonicalIndex.get(left.column.label);
      const rightOrder = canonicalIndex.get(right.column.label);
      if (leftOrder !== undefined || rightOrder !== undefined) {
        return (leftOrder ?? Number.MAX_SAFE_INTEGER) -
          (rightOrder ?? Number.MAX_SAFE_INTEGER);
      }
      if (left.column.scope !== right.column.scope) {
        return left.column.scope === 'shot' ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map(({ column }) => column);
};

export const parseStoryboardAnalysis = (
  rawText: string,
): StoryboardPromptTableData => {
  const text = cleanOutputText(rawText);
  const overview: Record<string, string> = {
    总镜数: '',
    素材总时长: '',
  };
  const columnsByLabel = new Map<string, StoryboardPromptColumn>();
  const rows: StoryboardPromptRow[] = [];

  const overviewMarker = text.indexOf('【镜头总览】');
  if (overviewMarker >= 0) {
    const overviewStart = overviewMarker + '【镜头总览】'.length;
    const firstShotStart = text.search(/={3,}\s*单镜头开始|^镜号[：:]/m);
    const overviewEnd = firstShotStart >= overviewStart ? firstShotStart : text.length;
    const parsedOverview = parseLabeledLines(text.slice(overviewStart, overviewEnd));
    parsedOverview.order.forEach((label) => {
      overview[label] = parsedOverview.values[label];
    });
  }

  const shotBlocks = splitShotBlocks(text);
  shotBlocks.forEach((block, shotIndex) => {
    const explicitTimelineMarker = block.search(/---\s*镜头内时序细分[^\n]*/i);
    const timelineMarker = explicitTimelineMarker >= 0
      ? explicitTimelineMarker
      : block.search(/^时间段[：:]/m);
    const shotText = timelineMarker >= 0 ? block.slice(0, timelineMarker) : block;
    const timelineText = timelineMarker >= 0
      ? (
          explicitTimelineMarker >= 0
            ? block.slice(timelineMarker).replace(/^---[^\n]*\n?/, '')
            : block.slice(timelineMarker)
        )
      : '';
    const shotFields = parseLabeledLines(shotText);
    const parsedTimeline = parseTimelineSection(timelineText, shotFields);

    shotFields.order.forEach((label) => addColumn(columnsByLabel, label, 'shot'));
    parsedTimeline.discoveredShotLabels.forEach((label) => (
      addColumn(columnsByLabel, label, 'shot')
    ));

    const timelineRows = parsedTimeline.rows.length > 0
      ? parsedTimeline.rows
      : [{ values: {}, order: [] }];
    timelineRows.forEach((timelineFields, timelineIndex) => {
      timelineFields.order.forEach((label) => (
        addColumn(columnsByLabel, label, 'timeline')
      ));
      const values = {
        ...shotFields.values,
        ...timelineFields.values,
      };
      if (!values['时间段'] && values['时间区间（镜头完整区间）']) {
        values['时间段'] = values['时间区间（镜头完整区间）'];
        addColumn(columnsByLabel, '时间段', 'timeline');
      }
      rows.push({
        id: `shot-${shotIndex + 1}-segment-${timelineIndex + 1}`,
        shotId: `shot-${shotIndex + 1}`,
        values,
      });
    });
  });

  if (rows.length === 0 && text) {
    const genericFields = { values: {}, order: [] } as ParsedFields;
    const genericTimeline = parseTimelineSection(text, genericFields);
    genericFields.order.forEach((label) => addColumn(columnsByLabel, label, 'shot'));
    genericTimeline.rows.forEach((timelineFields, index) => {
      timelineFields.order.forEach((label) => (
        addColumn(columnsByLabel, label, 'timeline')
      ));
      rows.push({
        id: `segment-${index + 1}`,
        shotId: 'shot-1',
        values: { ...genericFields.values, ...timelineFields.values },
      });
    });
  }

  if (rows.length === 0) {
    addColumn(columnsByLabel, '分析结果', 'timeline');
    rows.push({
      id: 'analysis-1',
      shotId: 'shot-1',
      values: { 分析结果: text },
    });
  }

  if (!overview['总镜数'] && shotBlocks.length > 0) {
    overview['总镜数'] = String(shotBlocks.length);
  }
  if (!overview['素材总时长']) {
    const seconds = rows.flatMap((row) => {
      const timeline = [
        row.values['时间区间（镜头完整区间）'],
        row.values['时间段'],
      ].filter(Boolean).join(' ');
      return Array.from(timeline.matchAll(/(\d+(?:\.\d+)?)\s*s/gi))
        .map((match) => Number(match[1]))
        .filter(Number.isFinite);
    });
    if (seconds.length > 0) {
      overview['素材总时长'] = `${Math.max(...seconds).toFixed(1)}s`;
    }
  }

  return {
    version: 1,
    overview,
    columns: sortColumns(Array.from(columnsByLabel.values())),
    rows,
  };
};

export const normalizeStoryboardPromptTable = (
  value: unknown,
): StoryboardPromptTableData | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<StoryboardPromptTableData>;
  if (!Array.isArray(candidate.columns) || !Array.isArray(candidate.rows)) return null;

  const columns = candidate.columns
    .map((column): StoryboardPromptColumn | null => {
      if (!column || typeof column !== 'object') return null;
      const key = typeof column.key === 'string' ? column.key.trim() : '';
      const label = typeof column.label === 'string' ? column.label.trim() : key;
      if (!key || !label) return null;
      return {
        key,
        label,
        scope: column.scope === 'shot' ? 'shot' : 'timeline',
      };
    })
    .filter((column): column is StoryboardPromptColumn => Boolean(column));
  if (columns.length === 0) return null;

  const overview: Record<string, string> = {};
  if (candidate.overview && typeof candidate.overview === 'object') {
    Object.entries(candidate.overview).forEach(([key, raw]) => {
      overview[key] = typeof raw === 'string' ? raw : String(raw ?? '');
    });
  }

  const rows = candidate.rows
    .map((row, index): StoryboardPromptRow | null => {
      if (!row || typeof row !== 'object' || !row.values || typeof row.values !== 'object') {
        return null;
      }
      const values: Record<string, string> = {};
      columns.forEach((column) => {
        const raw = row.values[column.key];
        values[column.key] = typeof raw === 'string' ? raw : String(raw ?? '');
      });
      const rowId =
        typeof row.id === 'string' && row.id.trim()
          ? row.id
          : `row-${index + 1}`;
      const shotNumberColumn =
        columns.find((column) => column.label === '镜号') ||
        columns.find((column) => column.key === '镜号');
      const shotNumber = shotNumberColumn
        ? String(values[shotNumberColumn.key] || '').trim()
        : '';
      const parsedShotId = /^(shot-\d+)-segment-\d+$/i.exec(rowId)?.[1];
      const persistedShotId =
        typeof row.shotId === 'string' ? row.shotId.trim() : '';
      return {
        id: rowId,
        shotId:
          persistedShotId ||
          parsedShotId ||
          (shotNumber ? `shot-number:${shotNumber}` : `shot-row:${index + 1}`),
        values,
      };
    })
    .filter((row): row is StoryboardPromptRow => Boolean(row));

  return {
    version: 1,
    overview,
    columns: sortColumns(columns),
    rows,
  };
};

const orderedOverviewEntries = (
  overview: Record<string, string>,
): Array<[string, string]> => {
  const seen = new Set<string>();
  const entries: Array<[string, string]> = [];
  OVERVIEW_LABEL_ORDER.forEach((label) => {
    if (!(label in overview)) return;
    seen.add(label);
    entries.push([label, overview[label]]);
  });
  Object.entries(overview).forEach(([label, value]) => {
    if (!seen.has(label)) entries.push([label, value]);
  });
  return entries;
};

export const serializeStoryboardPromptTable = (
  rawTable: StoryboardPromptTableData,
): string => {
  const table = normalizeStoryboardPromptTable(rawTable);
  if (!table) return '';

  const lines = ['【镜头总览】'];
  const overviewEntries = orderedOverviewEntries(table.overview);
  if (overviewEntries.length > 0) {
    overviewEntries.forEach(([label, value]) => lines.push(`${label}：${value}`));
  } else {
    lines.push('总镜数：', '素材总时长：');
  }

  const shotColumns = table.columns.filter((column) => column.scope === 'shot');
  const timelineColumns = table.columns.filter((column) => column.scope === 'timeline');
  const groups: Array<{ key: string; rows: StoryboardPromptRow[] }> = [];
  const groupsByKey = new Map<string, { key: string; rows: StoryboardPromptRow[] }>();
  table.rows.forEach((row, index) => {
    const key = row.shotId || `__row_${index}`;
    const existing = groupsByKey.get(key);
    if (existing) {
      existing.rows.push(row);
      return;
    }
    const group = { key, rows: [row] };
    groupsByKey.set(key, group);
    groups.push(group);
  });

  groups.forEach((group) => {
    lines.push('', '=========单镜头开始=========');
    shotColumns.forEach((column) => {
      const value = group.rows
        .map((row) => row.values[column.key])
        .find((candidate) => String(candidate || '').trim()) || '';
      lines.push(`${column.label}：${value}`);
    });

    if (timelineColumns.length > 0) {
      lines.push('', '---镜头内时序细分（微表情/短时动作拆解）');
      group.rows.forEach((row, rowIndex) => {
        if (rowIndex > 0) lines.push('');
        timelineColumns.forEach((column) => {
          lines.push(`${column.label}：${row.values[column.key] || ''}`);
        });
      });
    }
    lines.push('=========单镜头结束=========');
  });

  return lines.join('\n').trim();
};
