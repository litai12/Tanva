import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canvasGridInk, hexLuminance, hexToHsv, hsvToHex, normalizeHexColor, sanitizeBackgroundPreferences } from './canvasBackground.ts';

test('HEX editing accepts short and full HEX, rejecting CSS/injected/alpha values', () => {
  assert.equal(normalizeHexColor(' #AbC '), '#aabbcc');
  assert.equal(normalizeHexColor('FF0011'), '#ff0011');
  for (const invalid of ['red', '#1234', '#12345678', '#xyz', '#12', 'url(test)', '']) {
    assert.equal(normalizeHexColor(invalid), null);
  }
});

test('persisted preferences sanitize each theme independently', () => {
  assert.deepEqual(sanitizeBackgroundPreferences({ light: '#ABC', dark: '#17181C' }), { light: '#aabbcc', dark: '#17181c' });
  assert.deepEqual(sanitizeBackgroundPreferences({ light: 'url(test)', dark: '#000' }), { light: null, dark: '#000000' });
  assert.deepEqual(sanitizeBackgroundPreferences(null), { light: null, dark: null });
});

test('grid ink responds to actual background brightness across UI themes', () => {
  assert.equal(hexLuminance('#ffffff'), 1);
  assert.equal(hexLuminance('#000000'), 0);
  assert.equal(canvasGridInk('#e3eaf2'), '#000000');
  assert.equal(canvasGridInk('#151c26'), '#ffffff');
  assert.equal(canvasGridInk('#ff0000'), '#ffffff');
});

test('spectrum colors round trip and clamp drag boundaries', () => {
  for (const color of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#d3c3c3', '#14201a', '#abcdef']) {
    assert.equal(hsvToHex(hexToHsv(color)), color);
  }
  assert.equal(hsvToHex({ h: 360, s: 2, v: 2 }), '#ff0000');
  assert.equal(hsvToHex({ h: 20, s: 1, v: -1 }), '#000000');
});
