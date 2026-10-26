import assert from 'node:assert/strict';
import { countPaperImages, isPaperImagePlunge, paperBackupKey } from './paper-plunge-guard';

const run = (): void => {
  assert.equal(countPaperImages({ assets: { images: [{}, {}] } }), 2);
  assert.equal(countPaperImages({ assets: {} }), 0);
  assert.equal(countPaperImages(null), 0);

  // 线上实例：v148 → v149 画板被空画板覆盖。
  assert.equal(isPaperImagePlunge(12, 0), true);
  assert.equal(isPaperImagePlunge(1, 0), true, 'clearing the last image is still backed up');
  assert.equal(isPaperImagePlunge(10, 4), true);
  // 正常删除少量图片不触发。
  assert.equal(isPaperImagePlunge(10, 8), false);
  assert.equal(isPaperImagePlunge(4, 2), false);
  assert.equal(isPaperImagePlunge(0, 0), false);
  assert.equal(isPaperImagePlunge(undefined, 0), false);

  assert.equal(paperBackupKey('projects/u/p/', 148, 1), 'projects/u/p/backups/paper-v148-1.json');
  assert.equal(paperBackupKey('projects/u/p', 148, 1), 'projects/u/p/backups/paper-v148-1.json');
};

run();
console.log('paper plunge guard ok');
