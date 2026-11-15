import assert from 'node:assert/strict';
import test from 'node:test';
import { isPhoneUserAgent, shouldRedirectToMobile } from './mobileRedirect.ts';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const WECHAT_ANDROID = 'Mozilla/5.0 (Linux; Android 13; V2243A Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0 Mobile Safari/537.36 XWEB/1160065 MicroMessenger/8.0.47';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

test('detects phones only', () => {
  assert.equal(isPhoneUserAgent(IPHONE), true);
  assert.equal(isPhoneUserAgent(ANDROID_PHONE), true);
  assert.equal(isPhoneUserAgent(WECHAT_ANDROID), true);
  assert.equal(isPhoneUserAgent(ANDROID_TABLET), false);
  assert.equal(isPhoneUserAgent(IPAD), false);
  assert.equal(isPhoneUserAgent(DESKTOP), false);
});

test('redirects desktop entry paths on phones', () => {
  for (const path of ['/', '/app', '/app/', '/workspace']) {
    assert.equal(shouldRedirectToMobile(path, IPHONE, false), true, path);
  }
});

test('keeps pages that /m reuses or that must stay reachable', () => {
  for (const path of ['/m', '/m/works', '/my-credits', '/membership', '/auth/login', '/auth/register', '/legal/terms', '/admin', '/apple']) {
    assert.equal(shouldRedirectToMobile(path, IPHONE, false), false, path);
  }
});

test('respects desktop preference and desktop UA', () => {
  assert.equal(shouldRedirectToMobile('/', IPHONE, true), false);
  assert.equal(shouldRedirectToMobile('/', DESKTOP, false), false);
});
