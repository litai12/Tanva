import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Prisma, type PaymentOrder } from '@prisma/client';
import { ValidationPipe } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { UserPaidOrdersQueryDto } from './dto/admin.dto';

const userId = 'user-a';
const timestamp = new Date('2026-10-14T10:00:00Z');
const order = (id: string, overrides: Partial<PaymentOrder> = {}): PaymentOrder => ({
  id,
  orderNo: `order-${id}`,
  userId,
  orderType: 'recharge',
  businessCode: null,
  amount: new Prisma.Decimal('10.10'),
  credits: 101,
  paymentMethod: 'alipay',
  status: 'paid',
  qrCodeUrl: null,
  tradeNo: `trade-${id}`,
  paidAt: timestamp,
  expiredAt: timestamp,
  membershipPlanId: null,
  subscriptionId: null,
  teamId: null,
  planSnapshot: null,
  metadata: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  ...overrides,
});

async function run() {
  const fixtures = [
    ...Array.from({ length: 125 }, (_, index) => order(`alipay-${String(index).padStart(3, '0')}`)),
    order('wechat', { paymentMethod: 'wechat', amount: new Prisma.Decimal(13), credits: 200 }),
    order('member-actual', {
      orderType: 'membership', membershipPlanId: 'plan', credits: 0,
      metadata: { immediateCreditDelta: 7 },
      planSnapshot: { monthlyQuotaCredits: 1000, signupBonusCredits: 100 },
    }),
    order('member-snapshot', {
      orderType: 'membership', membershipPlanId: 'deleted-plan', credits: 0,
      planSnapshot: { name: '历史套餐', billingCycle: 'yearly', monthlyQuotaCredits: 100, signupBonusCredits: 20 },
    }),
    order('member-plan', { orderType: 'membership', membershipPlanId: 'plan', credits: 0 }),
    order('member-legacy', { orderType: 'membership', credits: 40 }),
    order('team-order', { orderType: 'team_seats', paymentMethod: 'other-channel' }),
    order('pending', { status: 'pending', amount: new Prisma.Decimal(99999) }),
    order('failed', { status: 'failed', amount: new Prisma.Decimal(99999) }),
    order('expired', { status: 'expired', amount: new Prisma.Decimal(99999) }),
    order('other-user', { userId: 'user-b', amount: new Prisma.Decimal(99999) }),
    order('old-order', { paidAt: new Date('2020-01-01'), createdAt: new Date('2030-01-01') }),
  ];
  const plans = [{ id: 'plan', name: '套餐', monthlyQuotaCredits: 200, signupBonusCredits: 25, billingCycle: 'monthly' }];
  const matches = (item: PaymentOrder, where: any): boolean => (
    (!where.userId || item.userId === where.userId) &&
    (!where.status || item.status === where.status) &&
    (!where.orderType || item.orderType === where.orderType) &&
    (!where.paymentMethod || (typeof where.paymentMethod === 'string'
      ? item.paymentMethod === where.paymentMethod : where.paymentMethod.in.includes(item.paymentMethod))) &&
    (!where.OR || where.OR.some((condition: any) => matches(item, condition)))
  );
  const user = { id: userId, phone: '13800000000', email: null, name: '测试用户', creditAccount: null, apiUsageRecords: [] };
  const queries: any[] = [];
  const prisma = {
    user: {
      findUnique: async ({ where }: any) => ['user-a', 'empty-user'].includes(where.id) ? { ...user, id: where.id } : null,
      findMany: async ({ where }: any) => {
        // 用户订单接口只能通过主键关联，不能经手机号/姓名模糊查找其他用户。
        assert.ok(where.id?.in);
        return where.id.in.includes(userId) ? [user] : [];
      },
    },
    membershipPlan: {
      findMany: async ({ where }: any) => plans.filter((plan) => where.id.in.includes(plan.id)),
    },
    paymentOrder: {
      count: async ({ where }: any) => fixtures.filter((item) => matches(item, where)).length,
      aggregate: async ({ where }: any) => ({
        _sum: { amount: fixtures.filter((item) => matches(item, where)).reduce(
          (sum, item) => sum.add(item.amount), new Prisma.Decimal(0),
        ) },
      }),
      findMany: async (query: any) => {
        queries.push(query);
        const clauses = Array.isArray(query.orderBy) ? query.orderBy : [query.orderBy];
        const sorted = fixtures.filter((item) => matches(item, query.where)).sort((a, b) => {
          for (const clause of clauses) {
            const [key, direction] = Object.entries(clause)[0];
            const left = (a as any)[key];
            const right = (b as any)[key];
            if (left < right) return direction === 'desc' ? 1 : -1;
            if (left > right) return direction === 'desc' ? -1 : 1;
          }
          return 0;
        });
        return sorted.slice(query.skip ?? 0, query.take === undefined ? undefined : (query.skip ?? 0) + query.take);
      },
    },
  };
  const service = Object.assign(Object.create(AdminService.prototype), { prisma }) as AdminService;
  const detail = await service.getUserDetail(userId);
  assert.ok(detail);
  assert.equal(detail.rechargeOrders.alipayRecharge.count, 126);
  assert.equal(detail.rechargeOrders.alipayRecharge.totalCredits, 126 * 101);
  assert.ok(Math.abs(detail.rechargeOrders.alipayRecharge.totalAmount - 126 * 10.1) < 0.000001);
  assert.equal(detail.rechargeOrders.wechatRecharge.count, 1);
  assert.equal(detail.rechargeOrders.wechatRecharge.totalCredits, 200);
  assert.equal(detail.rechargeOrders.membership.count, 4);
  assert.equal(detail.rechargeOrders.membership.totalCredits, 7 + 120 + 225 + 40);
  assert.equal(detail.rechargeOrders.recentOrders.length, 20);
  assert.ok(detail.rechargeOrders.recentOrders.some((item) => item.paymentMethod === 'alipay'));

  const first = await service.getUserPaidOrders(userId);
  const second = await service.getUserPaidOrders(userId, 2);
  const expected = fixtures.filter((item) => item.userId === userId && item.status === 'paid');
  assert.equal(first.pagination.total, expected.length);
  assert.deepEqual(second.pagination, { page: 2, pageSize: 20, total: expected.length, totalPages: 7 });
  assert.equal(first.orders.length, 20);
  assert.equal(second.orders.length, 20);
  assert.equal(new Set([...first.orders, ...second.orders].map((item) => item.id)).size, 40);
  assert.equal(first.orders[0].id, 'wechat');
  assert.equal(second.orders[0].id, 'alipay-110');
  assert.ok(first.orders.some((item) => item.orderType === 'team_seats' && item.paymentMethod === 'other-channel'));
  assert.equal(first.orders.find((item) => item.id === 'member-snapshot')?.planName, '历史套餐');
  assert.equal(first.orders.find((item) => item.id === 'member-snapshot')?.billingCycle, 'yearly');
  const expectedAmount = expected.reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0)).toNumber();
  assert.equal(first.totalAmount, expectedAmount);
  assert.equal(second.totalAmount, expectedAmount);
  assert.ok([...first.orders, ...second.orders].every((item) => item.userId === userId && item.status === 'paid'));
  const final = await service.getUserPaidOrders(userId, 7);
  assert.equal(final.orders.at(-1)?.id, 'old-order');
  assert.equal((await service.getUserPaidOrders(userId, 99)).orders.length, 0);
  const empty = await service.getUserPaidOrders('empty-user');
  assert.deepEqual(empty, { orders: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 }, totalAmount: 0 });
  await assert.rejects(() => service.getUserPaidOrders('missing-user'), (error: any) => error.getStatus() === 404);
  assert.ok(queries.filter((query) => query.skip !== undefined).every((query) =>
    query.take === 20 && query.where.userId && query.where.status === 'paid'));
  await service.getOrders();
  assert.deepEqual(queries.at(-1).orderBy, { createdAt: 'desc' });

  const controller = Object.assign(Object.create(AdminController.prototype), { adminService: service }) as AdminController;
  for (const role of ['admin', 'normal_admin']) {
    const response = await controller.getUserPaidOrders({ user: { id: 'admin', role } } as any, userId, { page: 2 });
    assert.equal(response.pagination.page, 2);
  }
  await assert.rejects(
    () => controller.getUserPaidOrders({ user: { role: 'user' } } as any, userId, {}),
    (error: any) => error.getStatus() === 403,
  );
  const pipe = new ValidationPipe({ transform: true, whitelist: true, transformOptions: { enableImplicitConversion: true } });
  const metadata = { type: 'query' as const, metatype: UserPaidOrdersQueryDto };
  assert.equal((await pipe.transform({}, metadata)).page, 1);
  assert.equal((await pipe.transform({ page: '2', pageSize: '100' }, metadata)).page, 2);
  for (const page of ['0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992']) {
    await assert.rejects(() => pipe.transform({ page }, metadata), (error: any) => error.getStatus() === 400);
  }
  console.log('PASS admin paid orders: complete recharge summaries, membership credits, exact-user paid-only pagination, totals, RBAC, query validation, read-only operations.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
