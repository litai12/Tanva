import { BadRequestException } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { PaymentMethod, PaymentStatus, TEAM_SEAT_PLANS } from './dto/payment.dto';

/**
 * H6：通用下单入口 team_seat 越权 / 低价高席位防御。
 * 这里只针对 createOrder 的 team_seat 收口与 processPaymentSuccess 发货前复核做单测，
 * 其它分支（recharge / membership）行为不变，单租户（default）下行为与改动前一致。
 */
describe('PaymentService H6 team_seat 收口', () => {
  function buildService(overrides: {
    membership?: { role: string } | null;
    teamSeatPackageCreate?: jest.Mock;
  } = {}) {
    // 注意用 'in' 区分「显式 null（非团队成员）」与「未提供（默认 owner）」，
    // 否则 `?? {role:'owner'}` 会把 null 也变成 owner，掩盖非成员越权用例。
    const teamMembershipFindUnique = jest
      .fn()
      .mockResolvedValue('membership' in overrides ? overrides.membership : { role: 'owner' });

    const paymentOrderCreate = jest.fn(async (args: any) => ({
      id: 'order_1',
      orderNo: 'PAY_X',
      paymentMethod: args.data.paymentMethod,
      orderType: args.data.orderType,
      businessCode: args.data.businessCode ?? null,
      amount: args.data.amount,
      credits: args.data.credits,
      status: args.data.status,
      qrCodeUrl: args.data.qrCodeUrl ?? null,
      expiredAt: args.data.expiredAt,
      createdAt: new Date(),
      membershipPlanId: args.data.membershipPlanId ?? null,
      metadata: args.data.metadata ?? null,
    }));

    const prisma = {
      paymentOrder: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: paymentOrderCreate,
        findUnique: jest.fn(),
      },
      teamMembership: { findUnique: teamMembershipFindUnique },
    } as unknown as PrismaService;

    const tenantContext = {
      runAsPlatform: jest.fn((fn: () => any) => fn()),
      runAsTenant: jest.fn((_id: string, fn: () => any) => fn()),
      getTenantId: jest.fn(() => 'default'),
      isPlatformMode: jest.fn(() => false),
    } as unknown as TenantContextService;

    // 支付解析器 stub：返回可用的 alipay/wechat SDK，使 createOrder 的二维码生成不报错
    const paymentResolver = {
      resolve: jest.fn(async () => ({
        alipaySdk: { exec: jest.fn(async () => ({ code: '10000', qrCode: 'https://qr.alipay.com/x' })) },
        alipayAppId: 'app',
        wechatPay: { transactions_native: jest.fn(async () => ({ code_url: 'weixin://wxpay/x' })) },
        wechatApiV3Key: null,
        wechatAppId: 'wxapp',
        wechatMchId: 'mch',
        source: { alipay: 'platform', wechat: 'platform' },
      })),
      warmPlatform: jest.fn(() => ({ alipay: true, wechat: true })),
      invalidate: jest.fn(),
    } as any;

    const svc = new PaymentService(
      prisma,
      { get: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      tenantContext,
      paymentResolver,
      undefined,
    );

    return { svc, prisma, teamMembershipFindUnique, paymentOrderCreate };
  }

  describe('createOrder', () => {
    it('owner 通过专用入口的合法 team_seat 单：按服务端套餐价重算金额/积分，存储规范化 metadata', async () => {
      const { svc, paymentOrderCreate } = buildService({ membership: { role: 'owner' } });
      const plan = TEAM_SEAT_PLANS.monthly;

      const res = await svc.createOrder('u_owner', {
        // 客户端故意低价高席位，应被服务端忽略
        amount: 1,
        credits: 999999,
        paymentMethod: PaymentMethod.ALIPAY,
        orderType: 'team_seat',
        metadata: { teamId: 'team_1', seats: 3, cycle: 'monthly' },
      });

      expect(res.amount).toBe(plan.pricePerSeat * 3);
      expect(res.credits).toBe(plan.creditsPerSeat * 3);
      const createdMeta = paymentOrderCreate.mock.calls[0][0].data.metadata;
      expect(createdMeta).toEqual({ teamId: 'team_1', seats: 3, cycle: 'monthly' });
    });

    it('非 owner/admin 下单 team_seat：抛 BadRequestException（越权拦截）', async () => {
      const { svc } = buildService({ membership: { role: 'member' } });
      await expect(
        svc.createOrder('u_member', {
          amount: 300,
          credits: 30000,
          paymentMethod: PaymentMethod.ALIPAY,
          orderType: 'team_seat',
          metadata: { teamId: 'team_1', seats: 3, cycle: 'monthly' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('非团队成员下单 team_seat：抛 BadRequestException', async () => {
      const { svc } = buildService({ membership: null });
      await expect(
        svc.createOrder('u_outsider', {
          amount: 300,
          credits: 30000,
          paymentMethod: PaymentMethod.ALIPAY,
          orderType: 'team_seat',
          metadata: { teamId: 'team_1', seats: 3, cycle: 'monthly' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('席位低于下限 / 无效周期 / 缺 teamId：抛 BadRequestException', async () => {
      const { svc } = buildService({ membership: { role: 'owner' } });
      await expect(
        svc.createOrder('u', {
          amount: 100, credits: 0, paymentMethod: PaymentMethod.ALIPAY,
          orderType: 'team_seat', metadata: { teamId: 'team_1', seats: 1, cycle: 'monthly' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        svc.createOrder('u', {
          amount: 100, credits: 0, paymentMethod: PaymentMethod.ALIPAY,
          orderType: 'team_seat', metadata: { teamId: 'team_1', seats: 3, cycle: 'weekly' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        svc.createOrder('u', {
          amount: 100, credits: 0, paymentMethod: PaymentMethod.ALIPAY,
          orderType: 'team_seat', metadata: { seats: 3, cycle: 'monthly' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('recharge 单不受影响：金额按服务端规则解析，不触碰 team_seat 校验', async () => {
      const { svc, teamMembershipFindUnique } = buildService();
      const res = await svc.createOrder('u', {
        amount: 100,
        credits: 0,
        paymentMethod: PaymentMethod.ALIPAY,
        orderType: 'recharge',
      });
      expect(res.orderType).toBe('recharge');
      expect(res.credits).toBe(10000); // 100 元档位
      expect(teamMembershipFindUnique).not.toHaveBeenCalled();
    });
  });

  describe('processPaymentSuccess team_seat 发货前复核', () => {
    function buildDeliveryService(opts: {
      orderAmount: number;
      orderCredits: number;
      orderMeta: Record<string, unknown> | null;
      buyerRole?: string | null;
      teamExists?: boolean;
    }) {
      const teamSeatPackageCreate = jest.fn().mockResolvedValue({ id: 'pkg_1' });
      const order = {
        id: 'order_1',
        userId: 'u_buyer',
        orderType: 'team_seat',
        status: PaymentStatus.PENDING,
        amount: opts.orderAmount,
        credits: opts.orderCredits,
        paymentMethod: PaymentMethod.ALIPAY,
        metadata: opts.orderMeta,
        orderNo: 'PAY_X',
        tenantId: 'default',
      };

      const tx = {
        paymentOrder: {
          findUnique: jest.fn().mockResolvedValue(order),
          count: jest.fn().mockResolvedValue(0),
          update: jest.fn().mockResolvedValue(order),
        },
        team: {
          findUnique: jest
            .fn()
            .mockResolvedValue(opts.teamExists === false ? null : { id: 'team_1' }),
        },
        teamMembership: {
          findUnique: jest.fn().mockResolvedValue(
            opts.buyerRole === undefined
              ? { role: 'owner' }
              : opts.buyerRole === null
                ? null
                : { role: opts.buyerRole },
          ),
        },
        teamSeatPackage: { create: teamSeatPackageCreate },
        teamCreditAccount: {
          findUnique: jest.fn().mockResolvedValue({ id: 'acc_1' }),
          create: jest.fn(),
          update: jest.fn(),
        },
        teamCreditLot: { create: jest.fn() },
        teamCreditLedger: { create: jest.fn() },
      };

      const prisma = {
        paymentOrder: { findUnique: jest.fn().mockResolvedValue({ tenantId: 'default' }) },
        $transaction: jest.fn(async (fn: any) => fn(tx)),
        businessPolicyService: undefined,
      } as any;

      const tenantContext = {
        runAsPlatform: jest.fn((fn: () => any) => fn()),
        runAsTenant: jest.fn((_id: string, fn: () => any) => fn()),
        getTenantId: jest.fn(() => 'default'),
        isPlatformMode: jest.fn(() => false),
      } as unknown as TenantContextService;

      const businessPolicyService = {
        getMembershipCreditPolicy: jest.fn().mockResolvedValue({ fixedCreditExpireDays: 0 }),
      } as any;

      const paymentResolver = {
        resolve: jest.fn(async () => ({
          alipaySdk: null,
          alipayAppId: null,
          wechatPay: null,
          wechatApiV3Key: null,
          wechatAppId: null,
          wechatMchId: null,
          source: { alipay: 'none', wechat: 'none' },
        })),
        warmPlatform: jest.fn(() => ({ alipay: false, wechat: false })),
        invalidate: jest.fn(),
      } as any;

      const svc = new PaymentService(
        prisma as PrismaService,
        { get: jest.fn() } as any,
        {} as any,
        {} as any,
        businessPolicyService,
        tenantContext,
        paymentResolver,
        undefined,
      );

      return { svc, tx, teamSeatPackageCreate };
    }

    const plan = TEAM_SEAT_PLANS.monthly;

    it('合法订单：发放席位包', async () => {
      const { svc, teamSeatPackageCreate } = buildDeliveryService({
        orderAmount: plan.pricePerSeat * 2,
        orderCredits: plan.creditsPerSeat * 2,
        orderMeta: { teamId: 'team_1', seats: 2, cycle: 'monthly' },
        buyerRole: 'owner',
      });
      await (svc as any).processPaymentSuccess('order_1', 'u_buyer', plan.creditsPerSeat * 2, {
        source: 'test',
      });
      expect(teamSeatPackageCreate).toHaveBeenCalledTimes(1);
    });

    it('下单者非 owner/admin：拒绝发放席位', async () => {
      const { svc, teamSeatPackageCreate } = buildDeliveryService({
        orderAmount: plan.pricePerSeat * 2,
        orderCredits: plan.creditsPerSeat * 2,
        orderMeta: { teamId: 'team_1', seats: 2, cycle: 'monthly' },
        buyerRole: 'member',
      });
      await (svc as any).processPaymentSuccess('order_1', 'u_buyer', plan.creditsPerSeat * 2, {
        source: 'test',
      });
      expect(teamSeatPackageCreate).not.toHaveBeenCalled();
    });

    it('金额与套餐价不符（低价高席位）：拒绝发放席位', async () => {
      const { svc, teamSeatPackageCreate } = buildDeliveryService({
        orderAmount: 1, // 被篡改的低价
        orderCredits: plan.creditsPerSeat * 5,
        orderMeta: { teamId: 'team_1', seats: 5, cycle: 'monthly' },
        buyerRole: 'owner',
      });
      await (svc as any).processPaymentSuccess('order_1', 'u_buyer', plan.creditsPerSeat * 5, {
        source: 'test',
      });
      expect(teamSeatPackageCreate).not.toHaveBeenCalled();
    });

    it('积分与套餐不符：拒绝发放席位', async () => {
      const { svc, teamSeatPackageCreate } = buildDeliveryService({
        orderAmount: plan.pricePerSeat * 2,
        orderCredits: 999999,
        orderMeta: { teamId: 'team_1', seats: 2, cycle: 'monthly' },
        buyerRole: 'owner',
      });
      await (svc as any).processPaymentSuccess('order_1', 'u_buyer', 999999, { source: 'test' });
      expect(teamSeatPackageCreate).not.toHaveBeenCalled();
    });
  });
});
