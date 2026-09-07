export type ReportPurpose = 'web' | 'slides';
export type ReportLanguage = '中文' | '中英双语' | '英文';
export type ReportModel = 'xiaot-agent-gpt-5-6-luna' | 'xiaot-agent-gpt-5-6-terra' | 'xiaot-agent-deepseek-v4-flash';
export type ReportAssetType = 'render' | 'photo' | 'video' | 'plan' | 'section' | 'elevation' | 'detail' | 'analysis' | 'concept' | 'data' | 'document' | 'unknown';

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
  /** Content role inferred from the file and later confirmed by XiaoT. */
  assetType?: ReportAssetType;
  assetLabel?: string;
  /** Persist only a remote URL/key. Object URLs are preview-only and never saved. */
  remoteUrl: string;
  chapterId?: string;
  size: number;
  /** Runtime inspection metadata. It is safe to persist because it contains no image bytes. */
  width?: number;
  height?: number;
  durationSeconds?: number;
  orientation?: 'landscape' | 'portrait' | 'square' | 'unknown';
  aspectRatio?: number;
  status: 'uploading' | 'ready' | 'error';
}

export interface ReportBuilderState {
  projectType: '建筑' | '室内' | '景观' | '规划' | '通用';
  purpose: ReportPurpose;
  language: ReportLanguage;
  /** The model used for this report run; kept per conversation. */
  reportModel: ReportModel;
  coverTitle: string;
  chapters: ReportChapter[];
  assets: ReportAsset[];
  stylePreset: string;
  styleMode: 'preset' | 'custom';
  customLayout: string;
  customTextLayout: string;
  customPalette: string;
  animationPreset: string;
  animationMode: 'preset' | 'custom';
  customTransitions: string[];
  customEnters: string[];
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
  { id: 'kineticslice', label: '建筑切片', description: '切片转场和高能章节节奏' },
  { id: 'rationalgrid', label: '信息网格', description: '清晰层级和数据化表达' },
  { id: 'cinematicblack', label: '电影黑', description: '深色背景与重点画面' },
  { id: 'imagegallery', label: '影像画廊', description: '多图横移和连续观展' },
  { id: 'technicalgrid', label: '技术图解', description: '图纸、标注和结构分析' },
  { id: 'editoriallayout', label: '编辑排版', description: '高对比、自由裁切和杂志感' },
  { id: 'naturalwhite', label: '自然留白', description: '明亮、安静、适合设计过程' },
] as const;

export const REPORT_MODEL_OPTIONS = [
  { id: 'xiaot-agent-gpt-5-6-luna', label: '小T-5.6 Luna', description: '推荐：综合规划、结构和视觉表达' },
  { id: 'xiaot-agent-gpt-5-6-terra', label: '小T-5.6 Terra', description: '适合长材料整理与复杂章节' },
  { id: 'xiaot-agent-deepseek-v4-flash', label: '小T-DeepSeek V4 Flash', description: '适合快速生成初稿' },
] as const;

export const REPORT_ANIMATION_PRESETS = [
  { id: 'steady', label: '光感溶解', description: '克制的淡入淡出' },
  { id: 'cinematic', label: '空间穿梭', description: '景深推进和空间转场' },
  { id: 'technical', label: '图纸揭示', description: '沿边界揭示分析线条' },
  { id: 'immersive', label: '轨道环绕', description: '沿空间轨道旋入主画面' },
  { id: 'energy', label: '高能闪切', description: '快速闪切和大标题上滑' },
  { id: 'gallery', label: '画廊环游', description: '连续画框和横向节奏' },
  { id: 'dataflow', label: '数据演进', description: '数据页顺序切换和分级浮现' },
  { id: 'lightstage', label: '光幕发布', description: '光幕扫过，重点结论由暗至明' },
  { id: 'editorial', label: '杂志翻页', description: '标题和长文分段出现' },
  { id: 'diagram', label: '轴线推演', description: '分析图蒙版展开和编号接续' },
] as const;

export const REPORT_LAYOUT_OPTIONS = [
  { id: 'visual', label: '主图 + 左侧栏' },
  { id: 'balanced', label: '左文 + 右图' },
  { id: 'technical', label: '图解 + 标注' },
  { id: 'full', label: '全屏大图 + 标题' },
  { id: 'sequence', label: '多图 + 步骤' },
  { id: 'data', label: '数据 + 图表' },
  { id: 'split', label: '上图 + 下文' },
  { id: 'grid', label: '四图 + 总览' },
  { id: 'detail', label: '主图 + 局部' },
] as const;

export const REPORT_TEXT_LAYOUT_OPTIONS = [
  { id: 'hero-overlay', label: '封面大标题 · 叠图' },
  { id: 'hero-left', label: '封面大标题 · 左侧' },
  { id: 'title-right', label: '标题说明 · 右侧' },
  { id: 'title-top', label: '标题说明 · 上方' },
  { id: 'compact-bottom', label: '小标题图注 · 下方' },
  { id: 'metric-left', label: '数据指标 · 左侧' },
  { id: 'steps-top', label: '步骤标题 · 上方' },
  { id: 'annotation-corner', label: '图解标注 · 贴图' },
  { id: 'editorial-column', label: '长文说明 · 右栏' },
] as const;

export const REPORT_PALETTE_OPTIONS = [
  { id: 'graphite', label: '深海雾蓝' },
  { id: 'dark', label: '玄黑岩灰' },
  { id: 'light', label: '冰蓝石墨' },
  { id: 'editorial', label: '雾紫铁灰' },
  { id: 'immersive', label: '松石深灰' },
  { id: 'contrast', label: '沙岩炭灰' },
  { id: 'space', label: '暗靛银灰' },
  { id: 'blueprint', label: '月白深蓝' },
  { id: 'earth', label: '雨夜橄榄' },
] as const;

export const REPORT_TRANSITION_OPTIONS = [
  { id: 'fade', label: '亮度溶解' },
  { id: 'slide', label: '空间景深推进' },
  { id: 'reveal', label: '蒙版揭示' },
  { id: 'zoom', label: '轨道旋转' },
  { id: 'gallery', label: '画廊横移' },
  { id: 'light', label: '光幕扫入' },
  { id: 'vertical', label: '建筑百叶切片' },
  { id: 'curtain', label: '双幕开启' },
  { id: 'flip', label: '透视翻页' },
] as const;

export const REPORT_ENTER_OPTIONS = [
  { id: 'minimal', label: '线条生长' },
  { id: 'sequence', label: '序列渐现' },
  { id: 'rise', label: '蒙版上滑' },
  { id: 'image', label: '图片缩放揭示' },
  { id: 'depth', label: '景深推进' },
  { id: 'type', label: '标题逐字' },
  { id: 'draw', label: '标注绘制' },
  { id: 'cascade', label: '卡片级联' },
] as const;

const ASSET_TYPE_LABELS: Record<ReportAssetType, string> = {
  render: '效果图', photo: '现场照片', video: '视频', plan: '平面图', section: '剖面图',
  elevation: '立面图', detail: '节点详图', analysis: '分析图', concept: '概念图', data: '数据指标',
  document: '文档', unknown: '待识别',
};

/**
 * Infer a useful content role from a file name while keeping the file itself
 * as the source of truth. The role is a routing hint only; generation must
 * still inspect the actual asset before using it.
 */
export const classifyReportAsset = (name: string, kind: ReportAsset['kind']): { assetType: ReportAssetType; assetLabel: string } => {
  if (kind === 'video') return { assetType: 'video', assetLabel: ASSET_TYPE_LABELS.video };
  const value = name.toLowerCase();
  const matches: Array<[ReportAssetType, RegExp]> = [
    ['render', /效果|渲染|render|鸟瞰|透视|外观|室内效果/],
    ['plan', /总平|平面|plan|floor|layout|户型/],
    ['section', /剖面|section|纵剖|横剖/],
    ['elevation', /立面|elevation|facade/],
    ['detail', /节点|详图|detail|构造|大样/],
    ['analysis', /分析|analysis|日照|交通|视线|区位|流线|指标图/],
    ['concept', /概念|草图|concept|策略|生成|推演/],
    ['data', /数据|指标|表格|统计|data|excel|xlsx|csv/],
    ['photo', /照片|现场|实景|photo|site|航拍/],
  ];
  const match = matches.find(([, pattern]) => pattern.test(value));
  const assetType = match?.[0] || (kind === 'document' ? 'document' : 'unknown');
  return { assetType, assetLabel: ASSET_TYPE_LABELS[assetType] };
};

const defaultChapters = (projectType: ReportBuilderState['projectType']): ReportChapter[] => {
  const chaptersByType: Record<ReportBuilderState['projectType'], Array<[string, string]>> = {
    建筑: [
      ['封面与概览', '项目主效果图、项目名称'], ['项目背景', '区位图、场地照片、任务说明'],
      ['场地分析', '交通、日照、视线或环境分析图'], ['设计概念', '概念草图、体块生成过程'],
      ['平面与功能', '总平面、各层平面、功能分区图'], ['立面与剖面', '主要立面图、剖面图'],
      ['空间效果', '室内外效果图、节点空间、鸟瞰图'], ['技术指标', '指标表、材料与构造节点'],
    ],
    室内: [
      ['封面与定位', '主空间效果图、项目定位'], ['原始空间', '原始平面、现场照片'],
      ['平面与动线', '平面布置图、动线分析图'], ['设计概念', '风格参考、概念草图、色彩板'],
      ['材质与软装', '材料板、家具、软装搭配'], ['灯光设计', '灯光布置、照度或氛围图'],
      ['空间效果', '各区域效果图与局部细节'],
    ],
    景观: [
      ['封面与概览', '主效果图、项目范围'], ['场地现状', '航拍、现场照片、现状问题'],
      ['设计理念', '概念图、策略图、空间结构'], ['总平面与分区', '景观总平面、功能分区'],
      ['流线与竖向', '游线、无障碍、竖向排水'], ['植物与材料', '植物配置、铺装与材料表'],
      ['节点效果', '重要节点效果图与详图'],
    ],
    规划: [
      ['封面与愿景', '整体鸟瞰、项目愿景'], ['现状研判', '区位、现状用地、问题分析'],
      ['定位与目标', '发展定位、目标体系'], ['用地布局', '用地规划、指标分配'],
      ['交通系统', '道路、公交、慢行与停车'], ['空间结构', '轴线、节点、天际线与开放空间'],
      ['实施时序', '分期建设、近期行动'],
    ],
    通用: [
      ['封面', '代表图片、项目名称'], ['项目说明', '项目背景、目标和核心问题'],
      ['现状与分析', '资料、数据、现状问题或用户洞察'], ['核心概念', '概念草图、关键词和设计策略'],
      ['方案推演', '过程、对比、迭代和决策依据'], ['成果展示', '最终成果、效果图或样机'],
      ['总结与下一步', '结论、指标和待补充内容'],
    ],
  };
  const chapters = chaptersByType[projectType];
  return chapters.map(([name, hint], index) => ({
    id: `chapter-${index + 1}`,
    name,
    hint,
    enabled: true,
  }));
};

export const createDefaultReportChapters = (projectType: ReportBuilderState['projectType']): ReportChapter[] => defaultChapters(projectType);

const isLegacyFiveChapterTemplate = (chapters: ReportChapter[]): boolean => {
  // Older builds persisted five generated chapters. Migrate that exact
  // generated id sequence even if a user changed one label or hint; custom
  // chapters created later receive timestamped ids and are preserved.
  return chapters.length === 5 && chapters.every((chapter, index) => chapter.id === `chapter-${index + 1}`);
};

export const createDefaultReportBuilderState = (): ReportBuilderState => ({
  projectType: '建筑',
  purpose: 'web',
  language: '中文',
  reportModel: 'xiaot-agent-gpt-5-6-luna',
  coverTitle: '',
  chapters: defaultChapters('建筑'),
  assets: [],
  stylePreset: 'panorama',
  styleMode: 'preset',
  customLayout: 'balanced',
  customTextLayout: 'title-top',
  customPalette: 'graphite',
  animationPreset: 'steady',
  animationMode: 'preset',
  customTransitions: ['fade', 'reveal'],
  customEnters: ['sequence', 'minimal'],
  presenterMode: true,
  updatedAt: new Date().toISOString(),
});

export const normalizeReportBuilderState = (value: unknown): ReportBuilderState => {
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
          assetType: (typeof asset.assetType === 'string' && Object.prototype.hasOwnProperty.call(ASSET_TYPE_LABELS, asset.assetType) ? asset.assetType : 'unknown') as ReportAssetType,
          assetLabel: typeof asset.assetLabel === 'string' ? asset.assetLabel.slice(0, 30) : ASSET_TYPE_LABELS.unknown,
          remoteUrl: typeof asset.remoteUrl === 'string' && /^(https?:\/\/|\/)/i.test(asset.remoteUrl) ? asset.remoteUrl : '',
          chapterId: typeof asset.chapterId === 'string' ? asset.chapterId : undefined,
          size: Number.isFinite(asset.size) ? Number(asset.size) : 0,
          width: Number.isFinite(asset.width) ? Number(asset.width) : undefined,
          height: Number.isFinite(asset.height) ? Number(asset.height) : undefined,
          durationSeconds: Number.isFinite(asset.durationSeconds) ? Number(asset.durationSeconds) : undefined,
          orientation: (asset.orientation === 'landscape' || asset.orientation === 'portrait' || asset.orientation === 'square' ? asset.orientation : 'unknown') as ReportAsset['orientation'],
          aspectRatio: Number.isFinite(asset.aspectRatio) && Number(asset.aspectRatio) > 0 ? Number(asset.aspectRatio) : undefined,
          status: (asset.status === 'ready' ? 'ready' : asset.status === 'uploading' ? 'uploading' : 'error') as ReportAsset['status'],
        }))
    : [];
  const projectType = ['建筑', '室内', '景观', '规划', '通用'].includes(String(raw.projectType))
    ? raw.projectType as ReportBuilderState['projectType']
    : fallback.projectType;
  const normalizedChapters = chapters.length > 0 && !isLegacyFiveChapterTemplate(chapters) ? chapters : defaultChapters(projectType);
  const validChapterIds = new Set(normalizedChapters.map((chapter) => chapter.id));
  const normalizedAssets = assets.map((asset) => ({
    ...asset,
    chapterId: asset.chapterId && validChapterIds.has(asset.chapterId) ? asset.chapterId : undefined,
  }));
  return {
    ...fallback,
    ...raw,
    projectType,
    purpose: raw.purpose === 'slides' ? 'slides' : 'web',
    language: raw.language === '英文' || raw.language === '中英双语' ? raw.language : '中文',
    reportModel: REPORT_MODEL_OPTIONS.some((option) => option.id === raw.reportModel)
      ? raw.reportModel as ReportModel
      : fallback.reportModel,
    coverTitle: typeof raw.coverTitle === 'string' ? raw.coverTitle.slice(0, 100) : '',
    chapters: normalizedChapters,
    assets: normalizedAssets,
    stylePreset: typeof raw.stylePreset === 'string' ? raw.stylePreset : fallback.stylePreset,
    styleMode: raw.styleMode === 'custom' ? 'custom' : 'preset',
    customLayout: typeof raw.customLayout === 'string' ? raw.customLayout : fallback.customLayout,
    customTextLayout: typeof raw.customTextLayout === 'string' ? raw.customTextLayout : fallback.customTextLayout,
    customPalette: typeof raw.customPalette === 'string' ? raw.customPalette : fallback.customPalette,
    animationPreset: typeof raw.animationPreset === 'string' ? raw.animationPreset : fallback.animationPreset,
    animationMode: raw.animationMode === 'custom' ? 'custom' : 'preset',
    customTransitions: Array.isArray(raw.customTransitions)
      ? raw.customTransitions.filter((value): value is string => typeof value === 'string').slice(0, 6)
      : fallback.customTransitions,
    customEnters: Array.isArray(raw.customEnters)
      ? raw.customEnters.filter((value): value is string => typeof value === 'string').slice(0, 6)
      : fallback.customEnters,
    presenterMode: raw.presenterMode !== false,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : fallback.updatedAt,
  };
};

export const loadReportBuilderState = (sessionId?: string | null): ReportBuilderState => {
  if (typeof window === 'undefined') return createDefaultReportBuilderState();
  try {
    return normalizeReportBuilderState(JSON.parse(window.localStorage.getItem(storageKey(sessionId)) || 'null'));
  } catch {
    return createDefaultReportBuilderState();
  }
};

export const saveReportBuilderState = (state: ReportBuilderState, sessionId?: string | null): ReportBuilderState => {
  const next = normalizeReportBuilderState({ ...state, updatedAt: new Date().toISOString() });
  if (typeof window !== 'undefined') window.localStorage.setItem(storageKey(sessionId), JSON.stringify(next));
  return next;
};

/** Export-safe configuration: only remote asset references leave the app. */
export const buildReportExportConfig = (state: ReportBuilderState) => ({
  projectType: state.projectType,
  purpose: state.purpose,
  language: state.language,
  reportModel: state.reportModel,
  coverTitle: state.coverTitle || `${state.projectType}设计汇报`,
  chapters: state.chapters.map(({ id, name, hint, enabled }) => ({ id, name, hint, enabled })),
  assets: state.assets
    .filter((asset) => asset.status === 'ready' && isPersistableRemoteRef(asset.remoteUrl))
    .map(({ name, kind, assetType, assetLabel, remoteUrl, chapterId, width, height, durationSeconds, orientation, aspectRatio }) => ({ name, kind, assetType, assetLabel, remoteUrl, chapterId, width, height, durationSeconds, orientation, aspectRatio })),
  stylePreset: state.stylePreset,
    animationPreset: state.animationPreset,
    styleMode: state.styleMode,
    customLayout: state.customLayout,
    customTextLayout: state.customTextLayout,
    customPalette: state.customPalette,
    animationMode: state.animationMode,
    customTransitions: state.customTransitions,
    customEnters: state.customEnters,
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
    assets: readyAssets.map(({ name, kind, assetType, assetLabel, remoteUrl, chapterId, width, height, durationSeconds, orientation, aspectRatio }) => ({
      name,
      kind,
      assetType,
      assetLabel,
      remoteUrl,
      chapter: state.chapters.find((chapter) => chapter.id === chapterId)?.name || '未指定章节',
      width,
      height,
      durationSeconds,
      orientation,
      aspectRatio,
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
    '生成前逐项读取素材的可见内容：图片检查像素与主体焦点，PDF/DOCX/PPT 做文字与图表提取，视频至少读取封面帧、时长和可用元数据；文件名只能用于定位，不能作为内容证据。',
    '用户指定的章节归属优先于文件名推断；未指定归属时依据实际可见内容分配，并在章节内记录素材证据。',
    isWeb
      ? '网页交互需支持章节导航、当前页/总页数、播放进度、全屏入口；演示者模式开启时提供备注与计时。动画应服务于内容，不得让标题或关键素材因等待动画而不可见。'
      : 'PPT 每个章节可拆成多页，页面必须有稳定的标题层级和页码；避免把长段落或多张图压缩到一页，演示者模式的备注与计时放入交付说明。',
    '素材只使用给出的远程引用；不要凭空编造面积、日期、客户、地点、奖项或技术指标。缺少素材的章节请明确标注待补充。',
    '',
    '## 作品汇报配置',
    '```json',
    JSON.stringify(config, null, 2),
    '```',
  ].join('\n');
};
