export type ReportPurpose = 'web' | 'slides';
export type ReportLanguage = '中文' | '中英双语' | '英文';

export interface ReportChapter {
  id: string;
  name: string;
  hint: string;
  enabled: boolean;
}

export interface ReportAsset {
  id: string;
  name: string;
  kind: 'image' | 'document' | 'video' | 'other';
  /** Persist only a remote URL/key. Object URLs are preview-only and never saved. */
  remoteUrl: string;
  chapterId?: string;
  size: number;
  status: 'uploading' | 'ready' | 'error';
}

export interface ReportBuilderState {
  projectType: '建筑' | '室内' | '景观' | '规划' | '通用';
  purpose: ReportPurpose;
  language: ReportLanguage;
  coverTitle: string;
  chapters: ReportChapter[];
  assets: ReportAsset[];
  stylePreset: string;
  animationPreset: string;
  presenterMode: boolean;
  updatedAt: string;
}

const STORAGE_KEY = 'tanva:desktop-report-builder:v1';
const storageKey = (sessionId?: string | null) => sessionId ? `${STORAGE_KEY}:${sessionId}` : STORAGE_KEY;
const isPersistableRemoteRef = (value: unknown): value is string =>
  typeof value === 'string' && /^(https?:\/\/|\/)/i.test(value) && !/^\/\/|^data:|^blob:|^flow-asset:/i.test(value);

export const REPORT_STYLE_PRESETS = [
  { id: 'panorama', label: '全景沉浸', description: '大图、空间感和连续叙事' },
  { id: 'monochrome', label: '黑白理性', description: '克制对比，适合方案汇报' },
  { id: 'rationalgrid', label: '信息网格', description: '清晰层级和数据化表达' },
  { id: 'cinematicblack', label: '电影黑', description: '深色背景与重点画面' },
  { id: 'editoriallayout', label: '编辑排版', description: '高对比、自由裁切和杂志感' },
  { id: 'naturalwhite', label: '自然留白', description: '明亮、安静、适合设计过程' },
] as const;

export const REPORT_ANIMATION_PRESETS = [
  { id: 'steady', label: '光感溶解', description: '克制的淡入淡出' },
  { id: 'cinematic', label: '空间穿梭', description: '景深推进和空间转场' },
  { id: 'technical', label: '图纸揭示', description: '沿边界揭示分析线条' },
  { id: 'gallery', label: '画廊环游', description: '连续画框和横向节奏' },
  { id: 'editorial', label: '杂志翻页', description: '标题和长文分段出现' },
] as const;

const defaultChapters = (projectType: ReportBuilderState['projectType']): ReportChapter[] => {
  const namesByType: Record<ReportBuilderState['projectType'], string[]> = {
    建筑: ['项目概览', '场地与问题', '设计概念', '方案推演', '成果展示'],
    室内: ['项目概览', '设计概念', '平面布局', '材料与细节', '效果展示'],
    景观: ['项目概览', '场地生态', '景观策略', '植物与动线', '成果展示'],
    规划: ['项目背景', '场地分析', '规划策略', '空间结构', '实施路径'],
    通用: ['项目概览', '问题与机会', '核心概念', '方案推演', '成果展示'],
  };
  const names = namesByType[projectType];
  return names.map((name, index) => ({
    id: `chapter-${index + 1}`,
    name,
    hint: '',
    enabled: true,
  }));
};

export const createDefaultReportBuilderState = (): ReportBuilderState => ({
  projectType: '建筑',
  purpose: 'web',
  language: '中文',
  coverTitle: '',
  chapters: defaultChapters('建筑'),
  assets: [],
  stylePreset: 'panorama',
  animationPreset: 'steady',
  presenterMode: true,
  updatedAt: new Date().toISOString(),
});

const normalize = (value: unknown): ReportBuilderState => {
  const fallback = createDefaultReportBuilderState();
  if (!value || typeof value !== 'object') return fallback;
  const raw = value as Partial<ReportBuilderState>;
  const chapters = Array.isArray(raw.chapters)
    ? raw.chapters
        .filter((chapter): chapter is ReportChapter => Boolean(chapter && typeof chapter === 'object'))
        .map((chapter, index) => ({
          id: typeof chapter.id === 'string' ? chapter.id : `chapter-${index + 1}`,
          name: typeof chapter.name === 'string' ? chapter.name.slice(0, 60) : `章节 ${index + 1}`,
          hint: typeof chapter.hint === 'string' ? chapter.hint.slice(0, 120) : '',
          enabled: chapter.enabled !== false,
        }))
    : fallback.chapters;
  const assets = Array.isArray(raw.assets)
    ? raw.assets
        .filter((asset): asset is ReportAsset => Boolean(asset && typeof asset === 'object'))
        .map((asset) => ({
          id: typeof asset.id === 'string' ? asset.id : crypto.randomUUID(),
          name: typeof asset.name === 'string' ? asset.name.slice(0, 160) : '素材',
          kind: (asset.kind === 'image' || asset.kind === 'document' || asset.kind === 'video' ? asset.kind : 'other') as ReportAsset['kind'],
          remoteUrl: typeof asset.remoteUrl === 'string' && /^(https?:\/\/|\/)/i.test(asset.remoteUrl) ? asset.remoteUrl : '',
          chapterId: typeof asset.chapterId === 'string' ? asset.chapterId : undefined,
          size: Number.isFinite(asset.size) ? Number(asset.size) : 0,
          status: (asset.status === 'ready' ? 'ready' : asset.status === 'uploading' ? 'uploading' : 'error') as ReportAsset['status'],
        }))
    : [];
  const projectType = ['建筑', '室内', '景观', '规划', '通用'].includes(String(raw.projectType))
    ? raw.projectType as ReportBuilderState['projectType']
    : fallback.projectType;
  return {
    ...fallback,
    ...raw,
    projectType,
    purpose: raw.purpose === 'slides' ? 'slides' : 'web',
    language: raw.language === '英文' || raw.language === '中英双语' ? raw.language : '中文',
    coverTitle: typeof raw.coverTitle === 'string' ? raw.coverTitle.slice(0, 100) : '',
    chapters: chapters.length > 0 ? chapters : defaultChapters(projectType),
    assets,
    stylePreset: typeof raw.stylePreset === 'string' ? raw.stylePreset : fallback.stylePreset,
    animationPreset: typeof raw.animationPreset === 'string' ? raw.animationPreset : fallback.animationPreset,
    presenterMode: raw.presenterMode !== false,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : fallback.updatedAt,
  };
};

export const loadReportBuilderState = (sessionId?: string | null): ReportBuilderState => {
  if (typeof window === 'undefined') return createDefaultReportBuilderState();
  try {
    return normalize(JSON.parse(window.localStorage.getItem(storageKey(sessionId)) || 'null'));
  } catch {
    return createDefaultReportBuilderState();
  }
};

export const saveReportBuilderState = (state: ReportBuilderState, sessionId?: string | null): ReportBuilderState => {
  const next = normalize({ ...state, updatedAt: new Date().toISOString() });
  if (typeof window !== 'undefined') window.localStorage.setItem(storageKey(sessionId), JSON.stringify(next));
  return next;
};

/** Export-safe configuration: only remote asset references leave the app. */
export const buildReportExportConfig = (state: ReportBuilderState) => ({
  projectType: state.projectType,
  purpose: state.purpose,
  language: state.language,
  coverTitle: state.coverTitle || `${state.projectType}设计汇报`,
  chapters: state.chapters.map(({ id, name, hint, enabled }) => ({ id, name, hint, enabled })),
  assets: state.assets
    .filter((asset) => asset.status === 'ready' && isPersistableRemoteRef(asset.remoteUrl))
    .map(({ name, kind, remoteUrl, chapterId }) => ({ name, kind, remoteUrl, chapterId })),
  stylePreset: state.stylePreset,
  animationPreset: state.animationPreset,
  presenterMode: state.presenterMode,
});

export const buildReportOutlineMarkdown = (state: ReportBuilderState): string => {
  const config = buildReportExportConfig(state);
  const lines = [
    `# ${config.coverTitle}`,
    '',
    `- 项目类型：${config.projectType}`,
    `- 展示形式：${config.purpose === 'web' ? '网页交互形式' : 'PPT 交互形式'}`,
    `- 页面语言：${config.language}`,
    `- 页面样式：${config.stylePreset}`,
    `- 播放效果：${config.animationPreset}`,
    `- 演示者模式：${config.presenterMode ? '开启' : '关闭'}`,
    '',
    '## 章节',
  ];
  config.chapters.forEach((chapter, index) => {
    lines.push(`${index + 1}. ${chapter.enabled ? '' : '[停用] '}${chapter.name}${chapter.hint ? `：${chapter.hint}` : ''}`);
  });
  lines.push('', '## 已上传素材');
  if (config.assets.length === 0) lines.push('暂无已上传的远程素材。');
  config.assets.forEach((asset) => lines.push(`- ${asset.name} (${asset.kind})${asset.chapterId ? ` · 章节 ${asset.chapterId}` : ''}\n  ${asset.remoteUrl}`));
  return lines.join('\n');
};

export const buildReportGenerationPrompt = (state: ReportBuilderState): string => {
  const readyAssets = state.assets.filter((asset) => asset.status === 'ready' && isPersistableRemoteRef(asset.remoteUrl));
  const config = {
    ...buildReportExportConfig(state),
    purpose: state.purpose === 'web' ? '网页交互形式' : 'PPT 交互形式',
    chapters: state.chapters.filter((chapter) => chapter.enabled),
    assets: readyAssets.map(({ name, kind, remoteUrl, chapterId }) => ({
      name,
      kind,
      remoteUrl,
      chapter: state.chapters.find((chapter) => chapter.id === chapterId)?.name || '未指定章节',
    })),
  };
  const isWeb = state.purpose === 'web';
  return [
    isWeb
      ? '请加载并使用“design-presentation-web（网页汇报）”技能，生成一份建筑作品网页汇报。'
      : '请加载并使用“pptx-generator”技能，生成一份真实、可编辑、可下载的 PPTX 建筑作品汇报。',
    isWeb
      ? '严格按照下面的完整配置执行，创建可编辑的 HTML 汇报产物，并在生成后打开文件工作台预览。'
      : '严格按照下面的完整配置执行，生成并校验真实 .pptx 文件，完成后必须用 present_file 交付并打开文件工作台。',
    isWeb
      ? '网页必须包含章节导航、素材画廊、章节内页、样式和播放效果；不要只返回 Markdown 或文字说明。'
      : 'PPT 必须按章节生成页面、使用给出的远程素材并保持原生可编辑；不要返回固定三页 HTML、Markdown 或模拟文件。',
    '素材只使用给出的远程引用；不要凭空编造面积、日期、客户、地点、奖项或技术指标。缺少素材的章节请明确标注待补充。',
    '',
    '## 作品汇报配置',
    '```json',
    JSON.stringify(config, null, 2),
    '```',
  ].join('\n');
};
