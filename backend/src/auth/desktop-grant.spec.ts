import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { DesktopGrantService } from './desktop-grant.service';

async function run() {
  const fixtureConfig = (values: Record<string, string>) => ({ get: (key: string) => values[key] }) as unknown as ConfigService;
  const service = new DesktopGrantService(fixtureConfig({ NODE_ENV: 'test', REDIS_URL: '' }));
  const verifier = randomBytes(48).toString('base64url');
  const input = { state: randomBytes(32).toString('base64url'), challenge: createHash('sha256').update(verifier).digest('base64url'), challengeMethod: 'S256', callbackUrl: 'tanva://auth/callback' };
  const grant = await service.create(input);
  assert.deepEqual(await service.exchange(grant.id, input.state, verifier), { status: 'pending' });
  await assert.rejects(service.exchange(grant.id, 'wrong', verifier));
  await assert.rejects(service.exchange(grant.id, input.state, randomBytes(48).toString('base64url')));
  await assert.rejects(service.approve(grant.id, 'forged-csrf', 'account-a', 'approve'));
  assert.equal((await service.read(grant.id))?.status, 'pending');
  const approved = await service.approve(grant.id, grant.csrf, 'account-a', 'approve');
  assert.equal(approved.callbackUrl, `tanva://auth/callback?state=${input.state}`);
  assert(!approved.callbackUrl.includes(verifier));
  const concurrent = await Promise.allSettled([service.exchange(grant.id, input.state, verifier), service.exchange(grant.id, input.state, verifier)]);
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter(result => result.status === 'rejected').length, 1);
  assert.deepEqual(concurrent.find(result => result.status === 'fulfilled')?.status === 'fulfilled' ? (concurrent.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<unknown>).value : null, { status: 'authorized', userId: 'account-a' });
  await assert.rejects(service.exchange(grant.id, input.state, verifier));
  const denied = await service.create(input); await service.approve(denied.id, denied.csrf, 'account-a', 'deny');
  assert.deepEqual(await service.exchange(denied.id, input.state, verifier), { status: 'denied' });
  await assert.rejects(service.create({ ...input, callbackUrl: 'luban://auth/callback' }));
  const production = new DesktopGrantService(fixtureConfig({ NODE_ENV: 'production', REDIS_URL: '' }));
  await assert.rejects(production.create(input), /REDIS_URL/);
  console.log('desktop grant PKCE, CSRF, atomic single consumption, denial, enterprise isolation and production store checks passed');
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
