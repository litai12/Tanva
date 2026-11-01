import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopLoginReturnTo } from './desktopLoginReturnTo.ts';
test('desktop sign-in returns only to the same-origin grant page', () => {
  const target = '/api/auth/desktop/authorize?sessionId=' + 'a'.repeat(43);
  assert.equal(desktopLoginReturnTo(target), target);
  for (const value of ['https://lluban.com/auth', '//lluban.com/auth', '/api/auth/desktop/authorize?sessionId=bad', target + '&redirect=https://lluban.com', target + '#secret', target + '&sessionId=' + 'b'.repeat(43)]) assert.equal(desktopLoginReturnTo(value), null);
});
test('MCP OAuth sign-in returns only to the same-origin consent page', () => {
  const target = '/api/oauth/consent?requestId=' + 'a'.repeat(43);
  assert.equal(desktopLoginReturnTo(target), target);
  for (const value of ['/api/oauth/consent?requestId=bad', '/api/oauth/consent?sessionId=' + 'a'.repeat(43), '/api/auth/desktop/authorize?requestId=' + 'a'.repeat(43), target + '&redirect_uri=https://lluban.com', target + '#x', '/api/oauth/authorize?requestId=' + 'a'.repeat(43), '//tanvas.cn/api/oauth/consent?requestId=' + 'a'.repeat(43)]) assert.equal(desktopLoginReturnTo(value), null);
});
