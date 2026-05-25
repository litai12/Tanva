# Team Seat Package 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 开发团队自助充值功能——团队 owner/admin 可购买月卡/年卡席位套餐，一次性支付后立即发放积分至团队账户，席位套餐独立计时、FIFO 到期，永久席位固定2个不受影响。

**Architecture:** 在 PaymentService 现有订单流程上新增 `team_seat` 订单类型；新建 `TeamSeatPackage` 表追踪每笔席位包（含席位数、周期、到期时间）；支付成功回调中直接用 prisma transaction 完成积分发放和席位包记录，避免模块循环依赖。前端重写 `TeamManagementModal` 的套餐 Tab，FloatingHeader 在团队模式下将"积分充值"入口重定向至该 Modal。

**Tech Stack:** NestJS + Prisma (PostgreSQL), React + TypeScript, Alipay/WeChat Pay（复用现有 SDK）

---

## 文件清单

**Backend — 新建**
- `backend/src/team-credits/team-seat-package.service.ts` — 席位套餐业务逻辑（校验权限、创建订单、查询套餐列表）

**Backend — 修改**
- `backend/prisma/schema.prisma` — 新增 `TeamSeatPackage` model；`PaymentOrder` 加 `teamId` 字段；`Team` 加反向关系
- `backend/src/payment/dto/payment.dto.ts` — `PaymentOrderType` 加 `'team_seat'`；新增 `TEAM_SEAT_PLANS`、`TEAM_SEAT_MIN_SEATS`、`TEAM_PERMANENT_SEATS` 常量
- `backend/src/payment/payment.service.ts` — `processPaymentSuccess` 新增 `team_seat` 分支（内联 prisma transaction）
- `backend/src/team-credits/team-credits.controller.ts` — 新增 `POST seat-packages/orders`、`GET seat-packages` 端点
- `backend/src/team-credits/team-credits.module.ts` — 注册 `TeamSeatPackageService`，import `PaymentModule`

**Frontend — 修改**
- `frontend/src/services/teamCreditsApi.ts` — 新增 `teamSeatPackageApi`
- `frontend/src/components/team/TeamManagementModal.tsx` — 加 `initialTab` prop，重写 `SubscriptionTab`
- `frontend/src/components/layout/FloatingHeader.tsx` — 团队模式下充值入口重定向至 `TeamManagementModal`

---

## Task 1: Prisma Schema — TeamSeatPackage + PaymentOrder.teamId

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: 修改 schema.prisma**

在 `PaymentOrder` model 中（`subscriptionId String?` 行之后）添加一行：
```prisma
  teamId        String?
```

在 `Team` model 的 relations 块（`creditAccount TeamCreditAccount?` 行之后）添加：
```prisma
  seatPackages  TeamSeatPackage[]
```

在文件末尾（`TeamCreditLedger` model 之后）添加新 model：
```prisma
model TeamSeatPackage {
  id             String   @id @default(uuid())
  teamId         String
  paymentOrderId String?  @unique
  seats          Int
  cycle          String
  credits        Int
  status         String   @default("active")
  purchasedAt    DateTime @default(now())
  expiresAt      DateTime
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  team           Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)

  @@index([teamId, status, expiresAt])
}
```

- [ ] **Step 2: 生成并运行迁移**

```bash
cd backend
npx prisma migrate dev --name add_team_seat_package
```

期望输出：`Your database is now in sync with your schema.`

- [ ] **Step 3: 验证 Prisma Client 生成成功**

```bash
npx prisma generate
```

期望输出：`Generated Prisma Client`

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat: add TeamSeatPackage model and teamId to PaymentOrder"
```

---

## Task 2: Payment DTO — 新增 team_seat 类型和套餐常量

**Files:**
- Modify: `backend/src/payment/dto/payment.dto.ts`

- [ ] **Step 1: 修改 PaymentOrderType**

找到第 16 行：
```typescript
export type PaymentOrderType = 'recharge' | 'membership';
```
替换为：
```typescript
export type PaymentOrderType = 'recharge' | 'membership' | 'team_seat';
```

- [ ] **Step 2: 在 CREDITS_PER_YUAN 常量之后追加团队席位常量**

在文件末尾（`CREDITS_PER_YUAN` 行之后）添加：
```typescript
export const TEAM_SEAT_PLANS = {
  monthly: { pricePerSeat: 100, creditsPerSeat: 1000, durationDays: 30, label: '月卡' },
  annual:  { pricePerSeat: 1200, creditsPerSeat: 12000, durationDays: 365, label: '年卡' },
} as const;

export type TeamSeatCycle = keyof typeof TEAM_SEAT_PLANS;
export const TEAM_SEAT_MIN_SEATS = 2;
export const TEAM_PERMANENT_SEATS = 2;
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/payment/dto/payment.dto.ts
git commit -m "feat: add team_seat order type and seat plan constants"
```

---

## Task 3: PaymentService — processPaymentSuccess 新增 team_seat 分支

**Files:**
- Modify: `backend/src/payment/payment.service.ts`

- [ ] **Step 1: 在 processPaymentSuccess 的 membership 分支之后添加 team_seat 分支**

找到（约第 766 行）：
```typescript
      if (currentOrder.orderType === 'membership') {
        const activation = await this.membershipService.activatePaidMembershipOrder({
          tx,
          userId,
          orderId,
          paidAt: options?.paidAt ?? new Date(),
        });
        await tx.paymentOrder.update({
          where: { id: orderId },
          data: {
            subscriptionId: activation.subscriptionId,
          },
        });
        return;
      }
```

在该 `if` 块结束（`return;` 之后的 `}`）后，立即插入：
```typescript
      if (currentOrder.orderType === 'team_seat') {
        const meta = currentOrder.metadata as Record<string, unknown> | null;
        const teamId = typeof meta?.teamId === 'string' ? meta.teamId : null;
        if (!teamId) return;
        const seats = Number(meta?.seats) || 0;
        const cycle = typeof meta?.cycle === 'string' ? meta.cycle : 'monthly';
        const durationDays = cycle === 'annual' ? 365 : 30;
        const paidAt = options?.paidAt ?? new Date();
        const expiresAt = new Date(paidAt.getTime() + durationDays * 86_400_000);

        await tx.teamSeatPackage.create({
          data: {
            teamId,
            paymentOrderId: orderId,
            seats,
            cycle,
            credits,
            status: 'active',
            purchasedAt: paidAt,
            expiresAt,
          },
        });

        let acc = await tx.teamCreditAccount.findUnique({ where: { teamId } });
        if (!acc) {
          acc = await tx.teamCreditAccount.create({
            data: { teamId, balance: 0, frozenBalance: 0, totalEarned: 0 },
          });
        }
        await tx.teamCreditLot.create({
          data: {
            teamCreditAccId: acc.id,
            amount: credits,
            remaining: credits,
            expiresAt: null,
            source: 'topup',
            sourceRefId: orderId,
          },
        });
        await tx.teamCreditAccount.update({
          where: { id: acc.id },
          data: { balance: { increment: credits }, totalEarned: { increment: credits } },
        });
        await tx.teamCreditLedger.create({
          data: {
            teamAccId: acc.id,
            entryType: 'topup',
            amount: credits,
            taskId: `topup_${orderId}`,
            note: `购买${cycle === 'annual' ? '年卡' : '月卡'}席位套餐 x${seats}，发放 ${credits} 积分`,
          },
        });
        return;
      }
```

- [ ] **Step 2: 确认 TS 编译无报错**

```bash
cd backend
npx tsc --noEmit
```

期望输出：无错误（或仅有与此改动无关的已存在警告）

- [ ] **Step 3: Commit**

```bash
git add backend/src/payment/payment.service.ts
git commit -m "feat: handle team_seat order in processPaymentSuccess"
```

---

## Task 4: TeamSeatPackageService — 新建文件

**Files:**
- Create: `backend/src/team-credits/team-seat-package.service.ts`

- [ ] **Step 1: 创建文件**

```typescript
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TeamCoreService } from '../team-core/team-core.service';
import { PaymentService } from '../payment/payment.service';
import {
  TEAM_SEAT_PLANS,
  TEAM_SEAT_MIN_SEATS,
  TEAM_PERMANENT_SEATS,
  TeamSeatCycle,
} from '../payment/dto/payment.dto';

@Injectable()
export class TeamSeatPackageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly teamCore: TeamCoreService,
    private readonly paymentService: PaymentService,
  ) {}

  async createOrder(
    teamId: string,
    requestingUserId: string,
    dto: { seats: number; cycle: TeamSeatCycle; paymentMethod: 'alipay' | 'wechat' },
  ) {
    await this.teamCore.assertRole(teamId, requestingUserId, ['owner', 'admin']);
    if (!Number.isInteger(dto.seats) || dto.seats < TEAM_SEAT_MIN_SEATS) {
      throw new BadRequestException(`最少购买 ${TEAM_SEAT_MIN_SEATS} 席位`);
    }
    if (!TEAM_SEAT_PLANS[dto.cycle]) {
      throw new BadRequestException('无效的套餐周期');
    }
    const plan = TEAM_SEAT_PLANS[dto.cycle];
    const amount = plan.pricePerSeat * dto.seats;
    const credits = plan.creditsPerSeat * dto.seats;

    return this.paymentService.createOrder(requestingUserId, {
      amount,
      credits,
      paymentMethod: dto.paymentMethod as any,
      orderType: 'team_seat',
      metadata: { teamId, seats: dto.seats, cycle: dto.cycle },
    });
  }

  async listPackages(teamId: string, requestingUserId: string) {
    await this.teamCore.assertMember(teamId, requestingUserId);

    // 惰性过期：查询时顺手标记已到期的包
    await this.prisma.teamSeatPackage.updateMany({
      where: { teamId, status: 'active', expiresAt: { lt: new Date() } },
      data: { status: 'expired' },
    });

    const activePackages = await this.prisma.teamSeatPackage.findMany({
      where: { teamId, status: 'active' },
      orderBy: { expiresAt: 'asc' },
    });

    const purchasedSeats = activePackages.reduce((sum, p) => sum + p.seats, 0);

    return {
      permanentSeats: TEAM_PERMANENT_SEATS,
      totalSeats: TEAM_PERMANENT_SEATS + purchasedSeats,
      activePackages,
    };
  }
}
```

- [ ] **Step 2: 确认 TS 编译无报错**

```bash
cd backend
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/team-credits/team-seat-package.service.ts
git commit -m "feat: add TeamSeatPackageService"
```

---

## Task 5: TeamCreditsController + Module — 注册新端点

**Files:**
- Modify: `backend/src/team-credits/team-credits.controller.ts`
- Modify: `backend/src/team-credits/team-credits.module.ts`

- [ ] **Step 1: 更新 controller**

将 `team-credits.controller.ts` 替换为：
```typescript
import { Controller, Get, Param, Query, Req, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiCookieAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { TeamCreditsService } from './team-credits.service';
import { TeamSeatPackageService } from './team-seat-package.service';
import { TeamSeatCycle } from '../payment/dto/payment.dto';

@ApiTags('team-credits')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard)
@Controller('teams/:teamId')
export class TeamCreditsController {
  constructor(
    private readonly svc: TeamCreditsService,
    private readonly seatPackageSvc: TeamSeatPackageService,
  ) {}

  @Get('credits')
  getAccount(@Req() req: any, @Param('teamId') teamId: string) {
    return this.svc.getAccount(teamId, req.user.sub);
  }

  @Get('credits/ledger')
  getLedger(
    @Req() req: any,
    @Param('teamId') teamId: string,
    @Query('take') take = '50',
    @Query('skip') skip = '0',
  ) {
    return this.svc.getLedger(teamId, req.user.sub, +take, +skip);
  }

  @Get('credits/members')
  getMemberUsages(@Req() req: any, @Param('teamId') teamId: string) {
    return this.svc.getMemberUsages(teamId, req.user.sub);
  }

  @Post('seat-packages/orders')
  createSeatOrder(
    @Req() req: any,
    @Param('teamId') teamId: string,
    @Body() body: { seats: number; cycle: TeamSeatCycle; paymentMethod: 'alipay' | 'wechat' },
  ) {
    return this.seatPackageSvc.createOrder(teamId, req.user.sub, body);
  }

  @Get('seat-packages')
  listSeatPackages(@Req() req: any, @Param('teamId') teamId: string) {
    return this.seatPackageSvc.listPackages(teamId, req.user.sub);
  }
}
```

- [ ] **Step 2: 更新 module**

将 `team-credits.module.ts` 替换为：
```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TeamCoreModule } from '../team-core/team-core.module';
import { PaymentModule } from '../payment/payment.module';
import { TeamCreditsController } from './team-credits.controller';
import { TeamCreditsService } from './team-credits.service';
import { TeamCreditLedgerService } from './team-credit-ledger.service';
import { TeamSeatPackageService } from './team-seat-package.service';

@Module({
  imports: [PrismaModule, TeamCoreModule, PaymentModule],
  controllers: [TeamCreditsController],
  providers: [TeamCreditsService, TeamCreditLedgerService, TeamSeatPackageService],
  exports: [TeamCreditsService, TeamCreditLedgerService],
})
export class TeamCreditsModule {}
```

- [ ] **Step 3: 确认 TS 编译无报错**

```bash
cd backend
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/team-credits/team-credits.controller.ts backend/src/team-credits/team-credits.module.ts
git commit -m "feat: add seat-packages endpoints to TeamCreditsController"
```

---

## Task 6: Frontend API — teamSeatPackageApi

**Files:**
- Modify: `frontend/src/services/teamCreditsApi.ts`

- [ ] **Step 1: 在文件末尾追加 teamSeatPackageApi**

在 `teamSubscriptionApi` 对象之后添加：
```typescript
export const teamSeatPackageApi = {
  createOrder: (
    teamId: string,
    body: { seats: number; cycle: 'monthly' | 'annual'; paymentMethod: string },
  ) =>
    fetchWithAuth(`${base}/api/teams/${teamId}/seat-packages/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<any>(r)),

  listPackages: (teamId: string) =>
    fetchWithAuth(`${base}/api/teams/${teamId}/seat-packages`).then((r) => json<any>(r)),
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/services/teamCreditsApi.ts
git commit -m "feat: add teamSeatPackageApi"
```

---

## Task 7: TeamManagementModal — initialTab prop + 重写 SubscriptionTab

**Files:**
- Modify: `frontend/src/components/team/TeamManagementModal.tsx`

- [ ] **Step 1: 给 Props 加 initialTab**

找到：
```typescript
interface Props {
  teamId: string;
  onClose: () => void;
}
```
替换为：
```typescript
interface Props {
  teamId: string;
  onClose: () => void;
  initialTab?: 'members' | 'subscription';
}
```

- [ ] **Step 2: 在 TeamManagementModal 函数中用 initialTab**

找到：
```typescript
  const [tab, setTab] = useState<Tab>('members');
```
替换为：
```typescript
  const [tab, setTab] = useState<Tab>(initialTab ?? 'members');
```

同时在函数签名中解构 `initialTab`：
```typescript
export function TeamManagementModal({ teamId, onClose, initialTab }: Props) {
```

- [ ] **Step 3: 在文件顶部补充导入**

在现有 import 块中添加（`teamSubscriptionApi` 已经引入，补充 `teamSeatPackageApi` 和 `getPaymentStatus`）：
```typescript
import { teamSeatPackageApi } from '../../services/teamCreditsApi';
import { getPaymentStatus } from '../../services/adminApi';
```

- [ ] **Step 4: 完全替换 SubscriptionTab 函数**

删除从 `function SubscriptionTab` 开始到该函数结尾的全部代码（约 509~747 行），替换为以下完整实现：

```typescript
function SubscriptionTab({ teamId, myRole }: { teamId: string; myRole?: string }) {
  const canManage = myRole === 'owner' || myRole === 'admin';

  // 套餐数据
  const [summary, setSummary] = useState<{
    permanentSeats: number;
    totalSeats: number;
    activePackages: Array<{
      id: string;
      seats: number;
      cycle: string;
      credits: number;
      expiresAt: string;
      purchasedAt: string;
    }>;
  } | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  // 购买表单
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [seats, setSeats] = useState(2);
  const [paymentMethod, setPaymentMethod] = useState<'alipay' | 'wechat'>('alipay');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // 支付二维码
  const [qrOrder, setQrOrder] = useState<{
    orderNo: string;
    qrCodeUrl: string;
    amount: number;
    credits: number;
  } | null>(null);
  const [paySuccess, setPaySuccess] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const PLANS = {
    monthly: { pricePerSeat: 100, creditsPerSeat: 1000, label: '月卡', days: 30 },
    annual:  { pricePerSeat: 1200, creditsPerSeat: 12000, label: '年卡', days: 365 },
  } as const;

  const plan = PLANS[cycle];
  const totalAmount = plan.pricePerSeat * seats;
  const totalCredits = plan.creditsPerSeat * seats;

  const loadSummary = async () => {
    setSummaryLoading(true);
    try {
      const data = await teamSeatPackageApi.listPackages(teamId);
      setSummary(data);
    } catch {
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [teamId]);

  const startPolling = (orderNo: string, credits: number) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const status = await getPaymentStatus(orderNo);
        if (status.status === 'paid') {
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
          setPaySuccess(true);
          setQrOrder(null);
          loadSummary();
          window.dispatchEvent(new CustomEvent('refresh-credits'));
        }
      } catch {}
    }, 3000);
  };

  const handleBuy = async () => {
    if (!canManage || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const order = await teamSeatPackageApi.createOrder(teamId, {
        seats,
        cycle,
        paymentMethod,
      });
      setQrOrder({
        orderNo: order.orderNo,
        qrCodeUrl: order.qrCodeUrl,
        amount: order.amount,
        credits: order.credits,
      });
      startPolling(order.orderNo, order.credits);
    } catch (e: any) {
      setError(e?.message || '创建订单失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseQr = () => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    setQrOrder(null);
  };

  if (summaryLoading) {
    return <div className="px-6 py-10 text-center text-sm text-slate-400">加载中…</div>;
  }

  return (
    <div className="px-6 py-4 space-y-5">
      {/* 成功提示 */}
      {paySuccess && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 flex items-center justify-between">
          <span>购买成功！积分已发放至团队账户。</span>
          <button onClick={() => setPaySuccess(false)} className="text-emerald-400 hover:text-emerald-600 ml-3">✕</button>
        </div>
      )}

      {/* 席位概览 */}
      {summary && (
        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">席位概览</p>
          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-2xl font-bold text-slate-800">{summary.totalSeats}</span>
              <span className="text-slate-400 ml-1">总席位</span>
            </div>
            <div className="text-slate-400">
              {summary.permanentSeats} 永久 + {summary.totalSeats - summary.permanentSeats} 套餐
            </div>
          </div>
        </div>
      )}

      {/* 活跃套餐列表 */}
      {summary && summary.activePackages.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">已购套餐</p>
          <div className="space-y-2">
            {summary.activePackages.map((pkg) => (
              <div key={pkg.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium text-slate-700">{pkg.seats} 席位</span>
                  <span className="ml-2 text-xs text-slate-400">{pkg.cycle === 'annual' ? '年卡' : '月卡'}</span>
                </div>
                <div className="text-xs text-slate-400">
                  到期 {new Date(pkg.expiresAt).toLocaleDateString('zh-CN')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 购买新套餐 */}
      {canManage && (
        <div>
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">购买席位套餐</p>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
            {/* 周期选择 */}
            <div className="flex rounded-xl overflow-hidden border border-slate-200">
              {(['monthly', 'annual'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCycle(c)}
                  className={cn(
                    'flex-1 py-2 text-sm font-medium transition-colors',
                    cycle === c ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50',
                  )}
                >
                  {PLANS[c].label}
                  <span className="ml-1 text-xs opacity-70">¥{PLANS[c].pricePerSeat}/席位</span>
                </button>
              ))}
            </div>

            {/* 席位数量 */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">席位数量（最少 2）</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSeats((s) => Math.max(2, s - 1))}
                  className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  −
                </button>
                <span className="w-8 text-center text-sm font-semibold text-slate-800">{seats}</span>
                <button
                  onClick={() => setSeats((s) => Math.min(100, s + 1))}
                  className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  +
                </button>
              </div>
            </div>

            {/* 积分预览 */}
            <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>赠送积分</span>
                <span className="font-semibold text-blue-700">+{totalCredits.toLocaleString()} 积分</span>
              </div>
              <div className="flex justify-between text-slate-400 text-xs mt-1">
                <span>{plan.creditsPerSeat.toLocaleString()} 积分/席位 × {seats} 席位</span>
                <span>有效期 {plan.days} 天</span>
              </div>
            </div>

            {/* 支付方式 */}
            <div className="flex gap-2">
              {(['alipay', 'wechat'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={cn(
                    'flex-1 py-2 rounded-xl text-sm border transition-colors',
                    paymentMethod === m
                      ? 'border-slate-800 bg-slate-800 text-white'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300',
                  )}
                >
                  {m === 'alipay' ? '支付宝' : '微信支付'}
                </button>
              ))}
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            {/* 购买按钮 */}
            <button
              onClick={handleBuy}
              disabled={submitting}
              className="w-full py-3 rounded-xl bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              {submitting ? '创建订单…' : `立即购买 ¥${totalAmount.toLocaleString()}`}
            </button>
          </div>
        </div>
      )}

      {!canManage && (
        <p className="text-xs text-slate-400 text-center pb-2">只有团队所有者或管理员可以购买套餐</p>
      )}

      {/* 支付二维码弹窗 */}
      {qrOrder && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={handleCloseQr}>
          <div className="bg-white rounded-3xl shadow-2xl p-6 w-80 text-center space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">扫码完成支付</h3>
              <button onClick={handleCloseQr} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="text-2xl font-bold text-slate-800">¥{qrOrder.amount.toLocaleString()}</div>
            <div className="text-xs text-slate-400">支付后将发放 {qrOrder.credits.toLocaleString()} 积分</div>
            {qrOrder.qrCodeUrl ? (
              <img src={qrOrder.qrCodeUrl} alt="支付二维码" className="w-48 h-48 mx-auto rounded-xl" />
            ) : (
              <div className="w-48 h-48 mx-auto rounded-xl bg-slate-100 flex items-center justify-center text-xs text-slate-400">
                二维码加载中…
              </div>
            )}
            <p className="text-xs text-slate-400">请使用{paymentMethod === 'alipay' ? '支付宝' : '微信'}扫码</p>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: 补充 useRef import**

确认文件顶部 React import 包含 `useRef`：
```typescript
import React, { useEffect, useState, useRef } from 'react';
```

- [ ] **Step 6: 确认 TS 编译无报错**

```bash
cd frontend
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/team/TeamManagementModal.tsx
git commit -m "feat: rewrite SubscriptionTab with seat package purchase UI"
```

---

## Task 8: FloatingHeader — 团队模式下充值重定向

**Files:**
- Modify: `frontend/src/components/layout/FloatingHeader.tsx`

- [ ] **Step 1: 在 `teamManagementId` state 声明（约 382 行）之后新增 initialTab state**

```typescript
  const [teamModalInitialTab, setTeamModalInitialTab] = useState<'members' | 'subscription'>('members');
```

- [ ] **Step 2: 修改 openMembershipHub**

找到（约第 949 行）：
```typescript
  /** 画板顶栏积分入口：打开 VIP / 积分弹窗 */
  const openMembershipHub = useCallback(() => {
    setIsMembershipOpen(true);
  }, []);
```

替换为：
```typescript
  /** 画板顶栏积分入口：个人模式打开会员弹窗，团队模式打开团队套餐 */
  const openMembershipHub = useCallback(() => {
    if (activeTeamForCredits && !activeTeamForCredits.isPersonal) {
      setTeamModalInitialTab('subscription');
      setTeamManagementId(activeTeamForCredits.id);
      return;
    }
    setIsMembershipOpen(true);
  }, [activeTeamForCredits]);
```

- [ ] **Step 3: 给 TeamManagementModal 传递 initialTab，并在关闭时重置**

找到（约第 2907 行）：
```typescript
          <TeamManagementModal
            teamId={teamManagementId}
            onClose={() => setTeamManagementId(null)}
          />
```

替换为：
```typescript
          <TeamManagementModal
            teamId={teamManagementId}
            onClose={() => { setTeamManagementId(null); setTeamModalInitialTab('members'); }}
            initialTab={teamModalInitialTab}
          />
```

- [ ] **Step 4: 确认 TS 编译无报错**

```bash
cd frontend
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/layout/FloatingHeader.tsx
git commit -m "feat: redirect credit recharge to team seat modal in team mode"
```

---

## Task 9: 端对端验证

- [ ] **Step 1: 启动后端**

```bash
cd backend && npm run start:dev
```

期望：NestJS 启动成功，无报错

- [ ] **Step 2: 启动前端**

```bash
cd frontend && npm run dev
```

- [ ] **Step 3: 验证个人模式充值不受影响**

1. 切换至个人工作空间
2. 点击顶栏积分数字
3. 确认打开的是原有会员/充值面板（MembershipPanel），不是团队套餐

- [ ] **Step 4: 验证团队模式充值入口**

1. 切换至团队工作空间
2. 点击顶栏积分数字
3. 确认打开的是 TeamManagementModal 且默认在"套餐" Tab

- [ ] **Step 5: 验证套餐购买 UI**

1. 在套餐 Tab 中切换月卡/年卡，确认价格和积分预览实时更新
2. 调整席位数，最少为 2
3. 点击"立即购买"，确认弹出二维码对话框
4. 观察后端日志确认 `POST /api/teams/:teamId/seat-packages/orders` 返回 200

- [ ] **Step 6: 验证 GET seat-packages 接口**

```bash
curl -H "Cookie: access_token=<your_token>" \
  http://localhost:4000/api/teams/<teamId>/seat-packages
```

期望返回：`{ permanentSeats: 2, totalSeats: 2, activePackages: [] }`

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: team seat package self-service purchase complete"
```
