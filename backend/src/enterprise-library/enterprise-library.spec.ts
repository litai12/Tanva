import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import cookie from '@fastify/cookie';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TeamCoreService } from '../team-core/team-core.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { UsersService } from '../users/users.service';
import { EnterpriseLibraryController } from './enterprise-library.controller';
import { EnterpriseLibraryService } from './enterprise-library.service';
const url = process.env.ENTERPRISE_LIBRARY_TEST_DATABASE_URL;
if (!url || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\/enterprise_library_test(?:\?|$)/.test(url)) throw new Error('Enterprise tests require an isolated local PostgreSQL');
async function run() {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const users = await Promise.all(['owner', 'admin', 'member', 'outsider'].map(name => prisma.user.create({ data: { phone: `enterprise-fixture-${name}`, passwordHash: 'fixture-not-a-login-password', name } })));
  const [owner, admin, member, outsider] = users;
  const team = await prisma.team.create({ data: { name: '装饰团队', ownerId: owner.id, memberships: { create: [{ userId: owner.id, role: 'owner' }, { userId: admin.id, role: 'admin' }, { userId: member.id, role: 'member' }] } } });
  const config = { get: (key: string) => key === 'JWT_ACCESS_SECRET' ? 'enterprise-fixture-secret' : undefined };
  @Module({ imports: [PassportModule.register({ session: false })], controllers: [EnterpriseLibraryController], providers: [
    { provide: PrismaService, useValue: prisma }, TeamCoreService, EnterpriseLibraryService, JwtStrategy,
    { provide: ConfigService, useValue: config }, { provide: UsersService, useValue: { findById: (id: string) => prisma.user.findUnique({ where: { id } }), touchLastLoginAt: async () => {} } },
  ] }) class FixtureModule {}
  const app = await NestFactory.create<NestFastifyApplication>(FixtureModule, new FastifyAdapter(), { logger: false });
  await app.register(cookie as never); app.setGlobalPrefix('api'); await app.init(); await app.getHttpAdapter().getInstance().ready();
  const inject = app.getHttpAdapter().getInstance().inject.bind(app.getHttpAdapter().getInstance());
  const jwt = new JwtService({ secret: 'enterprise-fixture-secret' });
  const request = async (user: typeof owner, method: string, route: string, payload?: unknown) => inject({ method, url: `/api/enterprise-library${route}`, headers: { cookie: `access_token=${jwt.sign({ sub: user.id })}` }, ...(payload ? { payload } : {}) });
  const draft = { title: '庭院工程', content: '防滑砖 12.5 平米，单价 88.00', tags: ['报价'], enterprise: { enterpriseName: '星河装饰', category: 'pricing' }, origin: { source: 'import', fileName: '报价.xlsx' } };
  const teamQuery = `scope=team&teamId=${team.id}`;
  let checks = 0; const equal = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); checks++; };
  try {
    equal((await inject({ method: 'GET', url: '/api/enterprise-library/spaces' })).statusCode, 401);
    const spaces = await request(member, 'GET', '/spaces'); equal(spaces.statusCode, 200); equal(spaces.json().map((space: any) => space.scope), ['cloud-personal', 'team']);
    const personalId = randomUUID(), personalBody = { id: personalId, scope: 'cloud-personal', draft };
    const personal = await request(owner, 'POST', '/documents', personalBody); equal(personal.statusCode, 201); equal(personal.json().version, 1);
    equal((await request(owner, 'POST', '/documents', personalBody)).json().id, personalId);
    equal((await request(owner, 'POST', '/documents', { ...personalBody, draft: { ...draft, enterprise: { enterpriseName: '别家公司', category: 'pricing' } } })).statusCode, 409);
    equal((await request(outsider, 'GET', `/documents/${personalId}?scope=cloud-personal`)).statusCode, 404);
    const teamId = randomUUID(); const created = await request(member, 'POST', '/documents', { id: teamId, scope: 'team', teamId: team.id, draft }); equal(created.statusCode, 201); equal(created.json().canWrite, true);
    equal((await request(outsider, 'GET', `/documents?${teamQuery}`)).statusCode, 403);
    const listed = await request(owner, 'GET', `/documents?${teamQuery}&enterpriseName=${encodeURIComponent('星河装饰')}&category=pricing&query=12.5`); equal(listed.json().items.length, 1); equal('content' in listed.json().items[0], false);
    const edited = await request(admin, 'PATCH', `/documents/${teamId}`, { scope: 'team', teamId: team.id, expectedVersion: 1, draft: { ...draft, content: '最终报价：1320' } }); equal(edited.statusCode, 200); equal(edited.json().version, 2);
    equal((await request(member, 'PATCH', `/documents/${teamId}`, { scope: 'team', teamId: team.id, expectedVersion: 1, draft })).statusCode, 409);
    equal((await request(owner, 'GET', `/documents/${teamId}?${teamQuery}&version=1`)).json().content, draft.content);
    const adminDocId = randomUUID(); await request(admin, 'POST', '/documents', { id: adminDocId, scope: 'team', teamId: team.id, draft });
    equal((await request(member, 'PATCH', `/documents/${adminDocId}`, { scope: 'team', teamId: team.id, expectedVersion: 1, draft })).statusCode, 403);
    const concurrent = await Promise.all([1, 2].map(value => request(member, 'PATCH', `/documents/${teamId}`, { scope: 'team', teamId: team.id, expectedVersion: 2, draft: { ...draft, content: `并发版本${value}` } })));
    equal(concurrent.map(value => value.statusCode).sort(), [200, 409]);
    equal((await request(owner, 'DELETE', `/documents/${teamId}?${teamQuery}&expectedVersion=2`)).statusCode, 409);
    equal((await request(owner, 'DELETE', `/documents/${teamId}?${teamQuery}&expectedVersion=3`)).json().deleted, true);
    equal((await request(member, 'GET', `/documents/${teamId}?${teamQuery}`)).statusCode, 404);
    equal((await request(member, 'GET', `/documents/${teamId}?${teamQuery}&version=1`)).json().content, draft.content);
    await prisma.teamMembership.delete({ where: { teamId_userId: { teamId: team.id, userId: member.id } } });
    equal((await request(member, 'GET', `/documents/${teamId}?${teamQuery}&version=1`)).statusCode, 403);
    const restarted = new PrismaClient({ datasources: { db: { url } } }); try { equal((await restarted.enterpriseKnowledgeRevision.findMany({ where: { documentId: teamId } })).length, 3); } finally { await restarted.$disconnect(); }
    console.log(`PASS: ${checks} real PostgreSQL + Nest/Fastify JWT Cookie enterprise-library checks; no production access.`);
    if (process.env.ENTERPRISE_LIBRARY_HTTP_FIXTURE_PATH) {
      const receipt = process.env.ENTERPRISE_LIBRARY_HTTP_FIXTURE_PATH;
      if (!path.isAbsolute(receipt) || path.basename(receipt) !== 'enterprise-server.json') throw new Error('Invalid fixture receipt path');
      await prisma.teamMembership.create({ data: { teamId: team.id, userId: member.id, role: 'member' } });
      await app.listen(0, '127.0.0.1');
      const address = app.getHttpServer().address();
      await writeFile(receipt, JSON.stringify({ origin: `http://127.0.0.1:${address.port}`, userId: owner.id, teamId: team.id, memberId: member.id, memberCookie: `access_token=${jwt.sign({ sub: member.id })}`, cookie: `access_token=${jwt.sign({ sub: owner.id })}` }), { mode: 0o600 });
      await new Promise<void>(resolve => process.once('SIGTERM', resolve));
    }
  } finally { await app.close(); await prisma.$disconnect(); }
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
