import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopLoginReturnTo } from './desktopLoginReturnTo.ts';
test('desktop sign-in returns only to the same-origin grant page', () => {
  const target = '/api/auth/desktop/authorize?sessionId=' + 'a'.repeat(43);
  assert.equal(desktopLoginReturnTo(target), target);
  for (const value of ['https://lluban.com/auth', '//lluban.com/auth', '/api/auth/desktop/authorize?sessionId=bad', target + '&redirect=https://lluban.com', target + '#secret', target + '&sessionId=' + 'b'.repeat(43)]) assert.equal(desktopLoginReturnTo(value), null);
});
