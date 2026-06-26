/* eslint-disable no-console */
/**
 * 版本冲突并集合并的可执行校验（后端无 jest，用 ts-node 跑断言）。
 *   运行: npx ts-node scripts/verify-merge-snapshots.ts
 */
import * as assert from 'assert';
import { mergeProjectSnapshots, mergePaperJson } from '../src/projects/merge-project-snapshots';

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    console.error(`  ✗ ${name}\n    ${e?.message || e}`);
    process.exitCode = 1;
  }
}

const ids = (arr: any[]) => arr.map((x) => x.id).sort();

// 1. flow 节点不相交 → 两侧都在
check('flow 节点不相交 → 并集', () => {
  const remote = { flow: { nodes: [{ id: 'a' }], edges: [] } };
  const incoming = { flow: { nodes: [{ id: 'b' }], edges: [] } };
  const m = mergeProjectSnapshots(remote, incoming);
  assert.deepStrictEqual(ids(m.flow.nodes), ['a', 'b']);
});

// 2. 同 id flow 节点 → incoming 胜出
check('同 id flow 节点 → incoming 胜出', () => {
  const remote = { flow: { nodes: [{ id: 'a', v: 'remote' }], edges: [] } };
  const incoming = { flow: { nodes: [{ id: 'a', v: 'local' }], edges: [] } };
  const m = mergeProjectSnapshots(remote, incoming);
  assert.strictEqual(m.flow.nodes.length, 1);
  assert.strictEqual(m.flow.nodes[0].v, 'local');
});

// 3. remote-only 图片 → 保留；4. incoming-only 资产 → 保留
check('assets 并集（remote-only + incoming-only 都在）', () => {
  const remote = { assets: { images: [{ id: 'r1' }], models: [], texts: [], videos: [] } };
  const incoming = { assets: { images: [{ id: 'i1' }], models: [], texts: [], videos: [] } };
  const m = mergeProjectSnapshots(remote, incoming);
  assert.deepStrictEqual(ids(m.assets.images), ['i1', 'r1']);
});

// edges 并集 + 同 id incoming 胜
check('flow edges 并集 + 同 id incoming 胜', () => {
  const remote = { flow: { nodes: [], edges: [{ id: 'e1', v: 'r' }, { id: 'e2' }] } };
  const incoming = { flow: { nodes: [], edges: [{ id: 'e1', v: 'l' }] } };
  const m = mergeProjectSnapshots(remote, incoming);
  assert.deepStrictEqual(ids(m.flow.edges), ['e1', 'e2']);
  assert.strictEqual(m.flow.edges.find((e: any) => e.id === 'e1').v, 'l');
});

// layers 并集保序：incoming 在前，remote-only 追加
check('layers 并集，incoming 顺序在前，remote-only 追加', () => {
  const remote = { layers: [{ id: 'L1' }, { id: 'L3' }] };
  const incoming = { layers: [{ id: 'L2' }, { id: 'L1' }] };
  const m = mergeProjectSnapshots(remote, incoming);
  assert.deepStrictEqual(m.layers.map((l: any) => l.id), ['L2', 'L1', 'L3']);
});

// 标量取 incoming
check('canvas 视口 / activeLayerId 取 incoming', () => {
  const remote = { canvas: { zoom: 9, panX: 9, panY: 9 }, activeLayerId: 'R' };
  const incoming = { canvas: { zoom: 1, panX: 0, panY: 0 }, activeLayerId: 'L' };
  const m = mergeProjectSnapshots(remote, incoming);
  assert.deepStrictEqual(m.canvas, { zoom: 1, panX: 0, panY: 0 });
  assert.strictEqual(m.activeLayerId, 'L');
});

// 5. paperJson 条目级并集：remote 新 data.id 追加，同 id 取 incoming
check('paperJson：remote 新 data.id 条目被追加', () => {
  const incoming = JSON.stringify([
    ['Layer', { children: [['Path', { data: { id: 'p1' } }]] }],
  ]);
  const remote = JSON.stringify([
    ['Layer', { children: [['Path', { data: { id: 'p1' } }], ['Raster', { data: { id: 'r9' } }]] }],
  ]);
  const out = JSON.parse(mergePaperJson(remote, incoming)!);
  const collected = new Set<string>();
  const walk = (n: any) => {
    if (!Array.isArray(n)) return;
    if (typeof n[0] === 'string' && n[1] && typeof n[1] === 'object' && !Array.isArray(n[1])) {
      if (n[1]?.data?.id) collected.add(n[1].data.id);
      (n[1].children || []).forEach(walk);
      return;
    }
    n.forEach(walk);
  };
  walk(out);
  assert.ok(collected.has('p1') && collected.has('r9'), `got ${[...collected]}`);
});

check('paperJson：完全相同 → 原样返回 incoming（无重复追加）', () => {
  const json = JSON.stringify([['Layer', { children: [['Path', { data: { id: 'p1' } }]] }]]);
  assert.strictEqual(mergePaperJson(json, json), json);
});

// 6. 畸形 paperJson → 回退 incoming，不抛错
check('畸形 paperJson → 回退 incoming，不抛错', () => {
  const incoming = '[["Layer",{"children":[]}]]';
  assert.strictEqual(mergePaperJson('{not json', incoming), incoming);
});

check('incoming 无 paperJson → 不抹掉远端绘制', () => {
  const remote = '[["Layer",{"children":[["Path",{"data":{"id":"p1"}}]]}]]';
  assert.strictEqual(mergePaperJson(remote, undefined), remote);
  assert.strictEqual(mergePaperJson(remote, ''), remote);
});

// 7. 空/缺失集合 → 不崩
check('空 / 缺失集合 → 不崩', () => {
  const m = mergeProjectSnapshots({}, { foo: 1 });
  assert.strictEqual(m.foo, 1);
});

// 8. remote 为 null（OSS 读失败）→ 直接返回 incoming
check('remote 为 null → 返回 incoming', () => {
  const incoming = { flow: { nodes: [{ id: 'a' }], edges: [] } };
  assert.strictEqual(mergeProjectSnapshots(null, incoming), incoming);
});

console.log(`\n${passed} checks passed${process.exitCode ? ', WITH FAILURES' : ''}.`);
