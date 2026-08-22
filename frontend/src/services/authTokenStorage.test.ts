import assert from 'node:assert/strict';
import test from 'node:test';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

test('desktop auth tokens migrate to encrypted storage and remain synchronous in memory', async () => {
  const storage = new MemoryStorage();
  storage.setItem('access_token', 'legacy-access');
  storage.setItem('refresh_token', 'legacy-refresh');
  const writes: Array<{ accessToken: string; refreshToken: string }> = [];
  let clearCount = 0;

  Object.assign(globalThis, {
    localStorage: storage,
    window: {
      tanvaDesktop: {
        isElectron: true,
        auth: {
          read: async () => ({ available: true, tokens: null }),
          write: async (tokens: { accessToken: string; refreshToken: string }) => {
            writes.push(tokens);
            return true;
          },
          clear: async () => {
            clearCount += 1;
            return true;
          },
        },
      },
    },
  });

  const tokenStorage = await import('./authTokenStorage');
  await tokenStorage.initializeAuthTokenStorage();

  assert.equal(tokenStorage.getAccessToken(), 'legacy-access');
  assert.equal(tokenStorage.getRefreshToken(), 'legacy-refresh');
  assert.deepEqual(writes[0], {
    accessToken: 'legacy-access',
    refreshToken: 'legacy-refresh',
  });
  assert.equal(storage.getItem('access_token'), null);
  assert.equal(storage.getItem('refresh_token'), null);

  tokenStorage.setTokens({
    accessToken: 'rotated-access',
    refreshToken: 'rotated-refresh',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(tokenStorage.getAccessToken(), 'rotated-access');
  assert.equal(tokenStorage.getRefreshToken(), 'rotated-refresh');
  assert.deepEqual(writes.at(-1), {
    accessToken: 'rotated-access',
    refreshToken: 'rotated-refresh',
  });

  tokenStorage.clearTokens();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(tokenStorage.getAccessToken(), null);
  assert.equal(tokenStorage.getRefreshToken(), null);
  assert.equal(clearCount, 1);
});
