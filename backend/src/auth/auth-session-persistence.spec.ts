import 'reflect-metadata';
import assert from 'node:assert/strict';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

async function run() {
  const presentedToken = 'desktop-refresh-token';
  const newerOtherDeviceToken = 'browser-refresh-token';
  const [presentedHash, newerHash] = await Promise.all([
    bcrypt.hash(presentedToken, 4),
    bcrypt.hash(newerOtherDeviceToken, 4),
  ]);
  const revokedIds: string[] = [];
  const createdTokens: Array<Record<string, unknown>> = [];

  const prisma = {
    user: {
      findUnique: async () => ({
        id: 'user-1',
        email: 'user@example.com',
        role: 'user',
        status: 'active',
      }),
      update: async () => ({ id: 'user-1' }),
    },
    refreshToken: {
      findMany: async () => [
        {
          id: 'browser-session',
          userId: 'user-1',
          tokenHash: newerHash,
          isRevoked: false,
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
        },
        {
          id: 'desktop-session',
          userId: 'user-1',
          tokenHash: presentedHash,
          isRevoked: false,
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(Date.now() - 1_000),
        },
      ],
      updateMany: async ({ where }: { where: { id: string } }) => {
        revokedIds.push(where.id);
        return { count: 1 };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdTokens.push(data);
        return data;
      },
    },
  };

  let signed = 0;
  const jwt = {
    signAsync: async () => (++signed === 1 ? 'rotated-access' : 'rotated-refresh'),
  };
  const config = {
    get: (key: string) => {
      if (key === 'JWT_ACCESS_TTL') return '24h';
      if (key === 'JWT_REFRESH_TTL') return '30d';
      return undefined;
    },
  };
  const service = new AuthService(
    {} as any,
    prisma as any,
    jwt as any,
    config as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  const tokens = await service.refresh(
    { sub: 'user-1' },
    presentedToken,
  );

  assert.deepEqual(tokens, {
    accessToken: 'rotated-access',
    refreshToken: 'rotated-refresh',
  });
  assert.deepEqual(revokedIds, ['desktop-session']);
  assert.equal(createdTokens.length, 1);
  assert.equal(createdTokens[0].userId, 'user-1');
  console.log('auth session persistence verification passed');
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
