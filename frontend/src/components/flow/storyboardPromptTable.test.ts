import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseStoryboardAnalysis,
  serializeStoryboardPromptTable,
} from './storyboardPromptTable.ts';

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
