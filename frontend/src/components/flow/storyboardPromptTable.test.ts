import assert from 'node:assert/strict';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import {
  createEmptyStoryboardPromptTable,
  parseStoryboardAnalysis,
  resolveStoryboardPromptTable,
  serializeStoryboardPromptTable,
} from './storyboardPromptTable.ts';
import { DEFAULT_SCRIPT_TO_STORYBOARD_SKILL } from './storyboardScriptSkill.ts';
import {
  buildStoryboardPromptWorkbook,
  parseStoryboardPromptWorkbook,
} from './storyboardPromptExcel.ts';

const SAMPLE = `【镜头总览】
总镜数：1
素材总时长：0.8s

=========单镜头开始=========
镜号：M001
时间区间（镜头完整区间）：0.0s - 0.8s
景别：近景
机位运动：静止机位
构图方式：三分法
画面整体内容：人物站在窗边。
台词文本：无台词
特效元素：尘埃粒子
自定义镜头字段：保留为动态列

---镜头内时序细分（微表情/短时动作拆解）
时间段：0.0s - 0.4s
目标人物：人物A
面部肌肉与表情变化：上眼睑轻抬
肢体动作变化：右肘屈曲
自定义时序字段：动作起点

时间段：0.4s - 0.8s
目标人物：人物A
面部肌肉与表情变化：嘴角向上牵拉
肢体动作变化：右腕旋前
自定义时序字段：动作终点
=========单镜头结束=========

额外输出附加字段（用于影视特效开发）：
画面主色调：冷蓝`;

const MARKDOWN_SCRIPT = `为您整理的完整视频脚本如下，包含画面、口播和字幕：

| 时间 | 镜号 | 画面 | 口播 | 字幕 |
| :--- | :---: | --- | --- | ---: |
| 00:00-00:03 | 1 | 主角走向窗边 | 看向远方 | 新的一天 |
| 00:03-00:06 | 2 | 窗外城市全景 | 出发吧 | 即刻出发 |

以上为完整脚本。`;

test('finds the real Markdown script after introductory prose and ignores separators and footer', () => {
  const table = parseStoryboardAnalysis(MARKDOWN_SCRIPT);
  assert.equal(table.rows.length, 2);
  assert.equal(table.columns.length, 5);
  assert.deepEqual(new Set(table.columns.map((column) => column.label)),
    new Set(['时间', '镜号', '画面', '口播', '字幕']));
  assert.equal(table.rows[0]?.values['时间'], '00:00-00:03');
  assert.equal(table.rows[1]?.values['字幕'], '即刻出发');
  assert.equal(table.overview['总镜数'], '2');
});

test('parses fenced Markdown, optional outer pipes, escaped pipes, and dynamic columns', () => {
  const table = parseStoryboardAnalysis(`脚本如下：
\`\`\`markdown
**镜号** | 时间 | 画面 | 自定义备注
--- | :---: | --- | ---
M001 | 0.0s-1.0s | 门牌 A\\|B<br>镜头推进 | 保留\\|分隔符
M002 | 1.0s-2.0s | 走出门外 |
\`\`\`
补充说明：原视频无字幕。`);
  assert.equal(table.columns.length, 4);
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0]?.values['画面'], '门牌 A|B\n镜头推进');
  assert.equal(table.rows[0]?.values['自定义备注'], '保留|分隔符');
  assert.equal(table.rows[1]?.values['自定义备注'], '');
  assert.equal(table.overview['素材总时长'], '2.0s');
  const reparsed = parseStoryboardAnalysis(serializeStoryboardPromptTable(table));
  assert.equal(reparsed.rows.length, 2);
  assert.equal(reparsed.rows[0]?.values['自定义备注'], '保留|分隔符');
  assert.equal(reparsed.rows[0]?.values['画面'], '门牌 A|B\n镜头推进');
});

test('keeps repeated Markdown header blocks out of data rows and retains unknown columns', () => {
  const table = parseStoryboardAnalysis(`| 镜号 | 画面 | 备注 |
| --- | --- | --- |
| 1 | 进门 | 第一段 |

第二段：
| 镜号 | 画面 | 声音 |
| --- | --- | --- |
| 2 | 坐下 | 椅子摩擦 |`);
  assert.equal(table.rows.length, 2);
  assert.equal(table.columns.length, 4);
  assert.equal(table.rows[0]?.values['备注'], '第一段');
  assert.equal(table.rows[1]?.values['声音'], '椅子摩擦');
});

test('requires a Markdown separator and preserves the structured storyboard parser', () => {
  const prose = parseStoryboardAnalysis('台词：A | B\n画面：人物站定');
  assert.equal(prose.rows.length, 1);
  assert.equal(prose.columns.length, 3);
  assert.ok(prose.columns.some((column) => column.label === '台词'));
  const structured = parseStoryboardAnalysis(`${SAMPLE}\n\n| 镜号 | 画面 |\n| --- | --- |\n| 99 | 示例 |`);
  assert.equal(structured.rows.length, 2);
  assert.equal(structured.rows[0]?.values['镜号'], 'M001');
});

test('repairs old Markdown fallback caches locally while keeping manually edited tables', () => {
  const broken = {
    version: 1 as const,
    overview: {},
    columns: [{ key: '| 00', label: '| 00', scope: 'shot' as const }],
    rows: [{ id: 'analysis-1', shotId: 'shot-1', values: { '| 00': '00-00:03 | 1 | 主角' } }],
  };
  const recovered = resolveStoryboardPromptTable(MARKDOWN_SCRIPT, broken, MARKDOWN_SCRIPT);
  assert.equal(recovered.rows.length, 2);
  assert.equal(recovered.columns.length, 5);
  assert.equal(broken.rows.length, 1);
  const fallback = {
    ...broken,
    columns: [{ key: '分析结果', label: '分析结果', scope: 'timeline' as const }],
    rows: [{ id: 'analysis-1', shotId: 'shot-1', values: { 分析结果: MARKDOWN_SCRIPT } }],
  };
  assert.equal(resolveStoryboardPromptTable(MARKDOWN_SCRIPT, fallback, MARKDOWN_SCRIPT).rows.length, 2);
  assert.equal(resolveStoryboardPromptTable('普通分析文字', fallback, '普通分析文字')
    .columns[0]?.label, '分析结果');

  const edited = parseStoryboardAnalysis(MARKDOWN_SCRIPT);
  edited.rows[0]!.values['画面'] = '手动修改';
  const retained = resolveStoryboardPromptTable(MARKDOWN_SCRIPT, edited, MARKDOWN_SCRIPT);
  assert.equal(retained.rows[0]?.values['画面'], '手动修改');

  const sourceWithPipeHeader = '| 镜号 | A\\|B |\n| --- | --- |\n| 1 | 原始 |';
  const editedWithPipeHeader = parseStoryboardAnalysis(sourceWithPipeHeader);
  editedWithPipeHeader.rows[0]!.values['A|B'] = '手动修改';
  assert.equal(resolveStoryboardPromptTable(sourceWithPipeHeader, editedWithPipeHeader,
    sourceWithPipeHeader).rows[0]?.values['A|B'], '手动修改');
});

test('creates a ready-to-edit empty storyboard table for the text-node palette', () => {
  const table = createEmptyStoryboardPromptTable();
  const scopes = new Map(
    table.columns.map((column) => [column.label, column.scope]),
  );

  assert.equal(table.overview['总镜数'], '1');
  assert.equal(
    table.overview['全程说明'],
    '全程无音乐，只保留音效。不生成字幕。',
  );
  assert.equal(table.rows.length, 1);
  assert.equal(table.rows[0]?.values['镜号'], 'M001');
  assert.equal(scopes.get('画面内容'), 'shot');
  assert.equal(scopes.get('时间段'), 'timeline');
  assert.equal(scopes.get('表情与呼吸'), 'timeline');

  [
    '镜号',
    '时长',
    '景别',
    '运镜',
    '画面内容',
    '台词',
    '音效',
    '备注',
  ].forEach((label) => assert.ok(scopes.has(label), `missing ${label}`));

  const serialized = serializeStoryboardPromptTable(table);
  assert.match(serialized, /镜号：M001/);
  assert.match(serialized, /---镜头内时序细分/);
});

test('ships the naturalistic fast-cut script-to-storyboard contract', () => {
  [
    '拆镜创作模式',
    '锁镜精修模式',
    '90–120 秒',
    '15 秒',
    '0.4–3.0s',
    '超过 8 个汉字',
    '3 个英文单词/秒',
    '@标注',
    'OS 期间角色嘴唇闭合',
    '全程无音乐，只保留音效。不生成字幕。',
    '人物站位（本节拍起始）',
    '字数与语速',
    '镜头描述的最低细节密度',
    '起始几何状态',
    '动作动力链',
    '焦点/景深变化',
    '可见动作持续超过 1.0s 时，至少拆为 3 个',
    '0.0–0.6s（动作前状态）',
    '2.3–3.0s（落点与定格）',
    '始终保持五指',
    '禁止增指、缺指、融指',
  ].forEach((requirement) => {
    assert.ok(
      DEFAULT_SCRIPT_TO_STORYBOARD_SKILL.includes(requirement),
      `missing skill requirement: ${requirement}`,
    );
  });
  assert.ok(DEFAULT_SCRIPT_TO_STORYBOARD_SKILL.length <= 50_000);
});

test('parses shot and timeline fields into dynamic storyboard columns', () => {
  const table = parseStoryboardAnalysis(SAMPLE);

  assert.equal(table.overview['总镜数'], '1');
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0]?.values['时间段'], '0.0s - 0.4s');
  assert.equal(table.rows[1]?.values['镜号'], 'M001');
  assert.equal(table.rows[1]?.values['画面主色调'], '冷蓝');

  const columns = new Map(table.columns.map((column) => [column.label, column.scope]));
  assert.equal(columns.get('时间段'), 'timeline');
  assert.equal(columns.get('自定义镜头字段'), 'shot');
  assert.equal(columns.get('自定义时序字段'), 'timeline');
  assert.equal(columns.get('画面主色调'), 'shot');
});

test('serializes edited table values back to hierarchical prompt text', () => {
  const table = parseStoryboardAnalysis(SAMPLE);
  table.rows[1]!.values['肢体动作变化'] = '左肩外展';

  assert.equal(table.rows[0]?.shotId, table.rows[1]?.shotId);
  const serialized = serializeStoryboardPromptTable(table);
  assert.match(serialized, /镜号：M001/);
  assert.match(serialized, /时间段：0.4s - 0.8s/);
  assert.match(serialized, /肢体动作变化：左肩外展/);
  assert.match(serialized, /自定义镜头字段：保留为动态列/);

  const reparsed = parseStoryboardAnalysis(serialized);
  assert.equal(reparsed.rows.length, 2);
  assert.equal(reparsed.rows[1]?.values['肢体动作变化'], '左肩外展');
});

test('keeps adjacent shot markers as separate table groups', () => {
  const table = parseStoryboardAnalysis(`【镜头总览】
总镜数：2
素材总时长：1.0s
=========单镜头开始=========
镜号：M001
时间区间（镜头完整区间）：0.0s - 0.5s
时间段：0.0s - 0.5s
目标人物：人物A
=========单镜头结束=========
=========单镜头开始=========
镜号：M002
时间区间（镜头完整区间）：0.5s - 1.0s
时间段：0.5s - 1.0s
目标人物：人物B
=========单镜头结束=========`);

  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0]?.values['镜号'], 'M001');
  assert.equal(table.rows[1]?.values['镜号'], 'M002');
});

test('keeps shot grouping after columns are renamed, added, or deleted', () => {
  const table = parseStoryboardAnalysis(SAMPLE);
  const shotNumberColumn = table.columns.find((column) => column.label === '镜号');
  assert.ok(shotNumberColumn);

  shotNumberColumn.label = '镜头编号';
  table.columns.push({
    key: 'director-note',
    label: '导演备注',
    scope: 'timeline',
  });
  table.rows[0]!.values['director-note'] = '保留呼吸停顿';
  table.rows[1]!.values['director-note'] = '动作完成后停住';

  const renamed = serializeStoryboardPromptTable(table);
  assert.equal((renamed.match(/单镜头开始/g) || []).length, 1);
  assert.match(renamed, /镜头编号：M001/);
  assert.match(renamed, /导演备注：动作完成后停住/);

  table.columns = table.columns.filter(
    (column) => column.key !== shotNumberColumn.key,
  );
  table.rows.forEach((row) => {
    delete row.values[shotNumberColumn.key];
  });

  const withoutShotNumber = serializeStoryboardPromptTable(table);
  assert.equal((withoutShotNumber.match(/单镜头开始/g) || []).length, 1);
  assert.doesNotMatch(withoutShotNumber, /镜号：/);

  const reparsed = parseStoryboardAnalysis(withoutShotNumber);
  assert.equal(reparsed.rows.length, 2);
  assert.equal(reparsed.rows[0]?.shotId, reparsed.rows[1]?.shotId);
});

test('rejoins non-adjacent timeline rows by internal shot id', () => {
  const table = parseStoryboardAnalysis(SAMPLE);
  const insertedShot = {
    id: 'manual-shot-2-segment-1',
    shotId: 'manual-shot-2',
    values: {
      ...table.rows[0]!.values,
      镜号: 'M002',
      时间段: '0.8s - 1.2s',
      目标人物: '人物B',
    },
  };
  table.rows.splice(1, 0, insertedShot);

  const serialized = serializeStoryboardPromptTable(table);
  const reparsed = parseStoryboardAnalysis(serialized);

  assert.equal((serialized.match(/单镜头开始/g) || []).length, 2);
  assert.deepEqual(
    reparsed.rows.map((row) => row.values['镜号']),
    ['M001', 'M001', 'M002'],
  );
});

test('round-trips dynamic storyboard rows and column scopes through xlsx', () => {
  const table = parseStoryboardAnalysis(SAMPLE);
  const workbook = buildStoryboardPromptWorkbook(table);

  assert.equal(String.fromCharCode(workbook[0]!, workbook[1]!), 'PK');

  const imported = parseStoryboardPromptWorkbook(workbook);
  const importedColumns = new Map(
    imported.columns.map((column) => [column.label, column]),
  );
  const timelineColumn = importedColumns.get('时间段');
  const customShotColumn = importedColumns.get('自定义镜头字段');

  assert.equal(imported.rows.length, 2);
  assert.equal(imported.overview['总镜数'], '1');
  assert.equal(timelineColumn?.scope, 'timeline');
  assert.equal(customShotColumn?.scope, 'shot');
  assert.equal(
    timelineColumn
      ? imported.rows[1]?.values[timelineColumn.key]
      : undefined,
    '0.4s - 0.8s',
  );
  assert.equal(
    customShotColumn
      ? imported.rows[0]?.values[customShotColumn.key]
      : undefined,
    '保留为动态列',
  );
  assert.equal(
    customShotColumn
      ? imported.rows[1]?.values[customShotColumn.key]
      : undefined,
    '保留为动态列',
  );
  const sheetXml = strFromU8(unzipSync(workbook)['xl/worksheets/sheet1.xml']!);
  const mergeRefs = Array.from(sheetXml.matchAll(/<mergeCell ref="([^"]+)"/g), (match) => match[1]);
  assert.ok(mergeRefs.includes('B2:B3'), mergeRefs.join(','));
  assert.equal((sheetXml.match(/保留为动态列/g) || []).length, 1);
});
