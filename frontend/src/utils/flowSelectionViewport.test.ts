import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSelectionSafeArea, fitSelectionInArea } from './flowSelectionViewport.ts';

const area = { x: 80, y: 100, width: 1120, height: 776 };
test('bottom composer moves toolbar above chat, expanded sidebar leaves the left canvas', () => {
  const compact = computeSelectionSafeArea(area, [{ x: 300, y: 720, width: 600, height: 160 }])!;
  assert.equal(compact.y + compact.height, 708);
  const expanded = computeSelectionSafeArea(area, [{ x: 640, y: 16, width: 580, height: 864 }])!;
  assert.equal(expanded.x + expanded.width, 628);
  assert.deepEqual(computeSelectionSafeArea(area, [{ x: 1300, y: 0, width: 600, height: 900 }]), area);
  assert.equal(computeSelectionSafeArea(area, [{ x: 0, y: 0, width: 1280, height: 900 }]), null);
});
test('fit contains a long selection above the toolbar without zooming in', () => {
  const bounds = { x: -400, y: 120, width: 340, height: 3500 };
  const fit = fitSelectionInArea(bounds, area, 0.53);
  assert.ok(fit.zoom <= 0.53);
  assert.ok(bounds.x * fit.zoom + fit.x >= area.x + 24);
  assert.ok((bounds.x + bounds.width) * fit.zoom + fit.x <= area.x + area.width - 24);
  assert.ok(bounds.y * fit.zoom + fit.y >= area.y + 24 - 0.001);
  assert.ok((bounds.y + bounds.height) * fit.zoom + fit.y <= area.y + area.height - 80 + 0.001);
});
