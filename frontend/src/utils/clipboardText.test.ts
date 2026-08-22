import assert from 'node:assert/strict';
import test from 'node:test';
import { writeClipboardText } from './clipboardText';

const withWindow = async (
  value: unknown,
  run: () => Promise<void>
): Promise<void> => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value,
  });
  try {
    await run();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }
};

test('uses the Electron clipboard bridge for packaged file renderers', async () => {
  const written: string[] = [];
  await withWindow(
    {
      tanvaDesktop: {
        clipboard: {
          writeText: async (text: string) => {
            written.push(text);
            return true;
          },
        },
      },
    },
    async () => writeClipboardText('桌面复制验证')
  );
  assert.deepEqual(written, ['桌面复制验证']);
});

test('surfaces a desktop clipboard write failure', async () => {
  await withWindow(
    {
      tanvaDesktop: {
        clipboard: { writeText: async () => false },
      },
    },
    async () => {
      await assert.rejects(
        () => writeClipboardText('复制失败验证'),
        /系统剪贴板写入失败/
      );
    }
  );
});
