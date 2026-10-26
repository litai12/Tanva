import assert from 'node:assert/strict';
import test from 'node:test';
import {
  armAutosaveUserIntent,
  hasAutosaveUserIntent,
  installAutosaveUserIntentListener,
  markAutosaveUserIntent,
} from './autosaveUserIntent.ts';

const target = new EventTarget();
installAutosaveUserIntentListener(target);

// Node 无法构造 isTrusted=true 的事件，用只读属性覆盖模拟浏览器真实输入。
const userEvent = (type: string) => {
  const event = new Event(type);
  Object.defineProperty(event, 'isTrusted', { value: true });
  return event;
};

test('project load alone never enables autosave', () => {
  armAutosaveUserIntent('p1');
  assert.equal(hasAutosaveUserIntent('p1'), false);
  // 系统代码派发的事件（图片加载、重排、协作补丁触发的合成事件）不算用户操作。
  target.dispatchEvent(new Event('pointerdown'));
  target.dispatchEvent(new Event('keydown'));
  assert.equal(hasAutosaveUserIntent('p1'), false);
});

test('a real user input after load enables autosave for that project only', () => {
  armAutosaveUserIntent('p1');
  target.dispatchEvent(userEvent('pointerdown'));
  assert.equal(hasAutosaveUserIntent('p1'), true);
  assert.equal(hasAutosaveUserIntent('p2'), false);
});

test('loading another project resets the intent', () => {
  armAutosaveUserIntent('p1');
  target.dispatchEvent(userEvent('keydown'));
  armAutosaveUserIntent('p2');
  assert.equal(hasAutosaveUserIntent('p2'), false);
  assert.equal(hasAutosaveUserIntent('p1'), false);
});

test('manual save marks intent explicitly, only for the armed project', () => {
  armAutosaveUserIntent('p1');
  markAutosaveUserIntent('p2');
  assert.equal(hasAutosaveUserIntent('p1'), false);
  markAutosaveUserIntent('p1');
  assert.equal(hasAutosaveUserIntent('p1'), true);
});

test('no armed project means nothing to save', () => {
  armAutosaveUserIntent(null);
  target.dispatchEvent(userEvent('pointerdown'));
  assert.equal(hasAutosaveUserIntent(null), false);
});
