import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ValidationPipe } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { UsersQueryDto } from './dto/admin.dto';

const inviterPhone = '13800000000';
const user = (id: string, invitedByPhone: string | null, overrides: Record<string, unknown> = {}) => ({
  id,
  phone: `1390000000${id}`,
  email: `${id}@example.test`,
  name: `用户${id}`,
  role: 'user',
  status: 'active',
  createdAt: new Date('2026-10-16'),
  invitedBy: invitedByPhone === null ? null : { phone: invitedByPhone },
  creditAccount: null,
  _count: { apiUsageRecords: 0 },
  ...overrides,
});

async function run() {
  const fixtures = [
    user('1', inviterPhone, { name: '目标用户' }),
    user('2', inviterPhone, { email: '目标@example.test' }),
    user('3', inviterPhone),
    user('4', null, { phone: inviterPhone, name: '目标用户' }),
    user('5', `${inviterPhone}1`, { name: '目标用户' }),
    user('6', `1${inviterPhone}`),
    user('7', 'legacy-123'),
  ];
  const listQueries: any[] = [];
  const countQueries: any[] = [];
  const matches = (item: typeof fixtures[number], where: any): boolean => (
    (!where.invitedBy || item.invitedBy?.phone === where.invitedBy.is.phone) &&
    (!where.OR || where.OR.some((condition: any) => Object.entries(condition).every(
      ([key, filter]: [string, any]) => String((item as any)[key] ?? '').includes(filter.contains),
    )))
  );
  const prisma = {
    user: {
      findMany: async (query: any) => {
        listQueries.push(query);
        return fixtures.filter((item) => matches(item, query.where))
          .slice(query.skip, query.skip + query.take);
      },
      count: async (query: any) => {
        countQueries.push(query);
        return fixtures.filter((item) => matches(item, query.where)).length;
      },
    },
  };
  const service = Object.assign(Object.create(AdminService.prototype), { prisma }) as AdminService;
  const controller = Object.assign(Object.create(AdminController.prototype), { adminService: service }) as AdminController;
  const pipe = new ValidationPipe({
    transform: true, whitelist: true, transformOptions: { enableImplicitConversion: true },
  });
  const metadata = { type: 'query' as const, metatype: UsersQueryDto };
  const query = await pipe.transform({ inviterPhone: ` ${inviterPhone} `, page: '2', pageSize: '2' }, metadata);
  assert.equal(query.inviterPhone, ` ${inviterPhone} `, 'whitelist validation must retain the inviter filter');
  for (const role of ['admin', 'normal_admin']) {
    const result = await controller.getAllUsers({ user: { id: 'admin', role } } as any, query);
    assert.deepEqual(result.users.map((item) => item.id), ['3']);
    assert.equal(result.users[0].inviterPhone, inviterPhone);
    assert.deepEqual(result.pagination, { page: 2, pageSize: 2, total: 3, totalPages: 2 });
    assert.deepEqual(listQueries.at(-1).where, { invitedBy: { is: { phone: inviterPhone } } });
    assert.strictEqual(listQueries.at(-1).where, countQueries.at(-1).where,
      'the page query and total count must use the same filter');
  }

  const combined = await service.getAllUsers({ inviterPhone, search: '目标', pageSize: 1 });
  assert.deepEqual(combined.users.map((item) => item.id), ['1']);
  assert.equal(combined.pagination.total, 2, 'search must intersect the inviter filter');
  assert.deepEqual(listQueries.at(-1).where, {
    invitedBy: { is: { phone: inviterPhone } },
    OR: [{ phone: { contains: '目标' } }, { email: { contains: '目标' } }, { name: { contains: '目标' } }],
  });
  assert.strictEqual(listQueries.at(-1).where, countQueries.at(-1).where);
  const beyondLastPage = await service.getAllUsers({ inviterPhone, page: 99 });
  assert.equal(beyondLastPage.pagination.total, 3);
  assert.equal(beyondLastPage.users.length, 0);

  for (const value of [undefined, '', ' \t ']) {
    const result = await service.getAllUsers({ inviterPhone: value });
    assert.equal(result.pagination.total, fixtures.length);
    assert.deepEqual(listQueries.at(-1).where, {});
  }
  const searchOnly = await service.getAllUsers({ inviterPhone: ' ', search: '目标' });
  assert.equal(searchOnly.pagination.total, 4);
  const missing = await service.getAllUsers({ inviterPhone: '19900000000' });
  assert.deepEqual(missing.users, []);
  assert.equal(missing.pagination.total, 0);
  assert.equal(missing.pagination.totalPages, 0);
  const legacyQuery = await pipe.transform({ inviterPhone: 'legacy-123' }, metadata);
  assert.deepEqual((await controller.getAllUsers({ user: { role: 'admin' } } as any, legacyQuery))
    .users.map((item) => item.id), ['7'], 'legacy phone formats must remain filterable');
  for (const value of [[], ['13800000000']]) {
    await assert.rejects(() => pipe.transform({ inviterPhone: value }, metadata),
      (error: any) => error.getStatus() === 400);
  }
  console.log('PASS admin users: validated inviter query forwarding, exact relation match, search intersection, complete pagination totals, blanks, no matches and legacy phone formats.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
