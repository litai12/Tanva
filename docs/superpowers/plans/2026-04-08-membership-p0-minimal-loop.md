# Membership P0 Minimal Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend-only P0 membership minimal loop on top of the existing `CreditLot` ledger: membership plan config, subscription activation, membership payment order typing, and payment-success grant of `membership_bound` lots.

**Architecture:** Keep `CreditLot` as the only credit truth source for deduction. Add a small `membership` domain that owns plan lookup, subscription activation, entitlement snapshot updates, and membership grant transactions. Extend `payment` to branch by `orderType`, but keep recharge behavior unchanged.

**Tech Stack:** NestJS, Prisma, PostgreSQL, TypeScript, existing script-style verification in `backend/scripts/`

---

### Task 1: Prisma Membership Schema

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/202604080002_add_membership_p0_minimal_loop/migration.sql`
- Test: `backend/scripts/test-membership-p0-types.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');

assert.match(schema, /model MembershipPlan \{/);
assert.match(schema, /model UserMembershipSubscription \{/);
assert.match(schema, /model MembershipEntitlementSnapshot \{/);
assert.match(schema, /orderType\s+String\s+@default\("recharge"\)/);
assert.match(schema, /membershipPlanId\s+String\?/);
assert.match(schema, /subscriptionId\s+String\?/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm_config_cache=$PWD/.npm-cache npx --yes tsx backend/scripts/test-membership-p0-types.ts`
Expected: FAIL because membership models and payment-order fields are missing.

- [ ] **Step 3: Write minimal implementation**

Add Prisma models and fields:

```prisma
model MembershipPlan {
  id                  String   @id @default(uuid())
  code                String   @unique
  name                String
  billingCycle        String
  price               Decimal  @db.Decimal(10, 2)
  monthlyQuotaCredits Int      @default(0)
  signupBonusCredits  Int      @default(0)
  dailyGiftCredits    Int      @default(0)
  isActive            Boolean  @default(true)
  sortOrder           Int      @default(0)
  metadata            Json?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}
```

```prisma
model UserMembershipSubscription {
  id                   String   @id @default(uuid())
  userId               String
  membershipPlanId     String
  status               String   @default("active")
  periodType           String
  currentPeriodStartAt DateTime
  currentPeriodEndAt   DateTime
  activatedAt          DateTime?
  expiredAt            DateTime?
  cancelledAt          DateTime?
  renewalCount         Int      @default(0)
  lastOrderId          String?
  snapshot             Json?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
}
```

```prisma
model MembershipEntitlementSnapshot {
  userId               String   @id
  currentPlanCode      String   @default("free")
  membershipStatus     String   @default("inactive")
  currentPeriodStartAt DateTime?
  currentPeriodEndAt   DateTime?
  pauseGiftDecay       Boolean  @default(false)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
}
```

```prisma
model PaymentOrder {
  orderType        String   @default("recharge")
  businessCode     String?
  membershipPlanId String?
  subscriptionId   String?
  planSnapshot     Json?
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm_config_cache=$PWD/.npm-cache npx --yes tsx backend/scripts/test-membership-p0-types.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/202604080002_add_membership_p0_minimal_loop/migration.sql backend/scripts/test-membership-p0-types.ts
git commit -m "feat: add membership p0 schema"
```

### Task 2: Membership Activation Service

**Files:**
- Create: `backend/src/membership/membership.types.ts`
- Create: `backend/src/membership/membership.service.ts`
- Create: `backend/src/membership/membership.module.ts`
- Test: `backend/scripts/test-membership-p0-activation.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { strict as assert } from 'node:assert';
import { MembershipService } from '../src/membership/membership.service';

assert.equal(typeof MembershipService.prototype.activatePaidMembershipOrder, 'function');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm_config_cache=$PWD/.npm-cache npx --yes tsx backend/scripts/test-membership-p0-activation.ts`
Expected: FAIL because membership service does not exist.

- [ ] **Step 3: Write minimal implementation**

Expose:

```ts
async activatePaidMembershipOrder(params: {
  tx: Prisma.TransactionClient;
  userId: string;
  orderId: string;
  paidAt: Date;
}): Promise<{ subscriptionId: string; grantedCredits: number }>
```

Responsibilities:
- load paid order + plan snapshot
- create or extend active subscription
- create `membership_bound` lot
- update `CreditAccount.balance`
- write membership grant `CreditTransaction`
- upsert `MembershipEntitlementSnapshot`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm_config_cache=$PWD/.npm-cache npx --yes tsx backend/scripts/test-membership-p0-activation.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/membership/membership.types.ts backend/src/membership/membership.service.ts backend/src/membership/membership.module.ts backend/scripts/test-membership-p0-activation.ts
git commit -m "feat: add membership activation service"
```

### Task 3: Payment Order Typing And Branching

**Files:**
- Modify: `backend/src/payment/dto/payment.dto.ts`
- Modify: `backend/src/payment/payment.service.ts`
- Modify: `backend/src/payment/payment.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/scripts/test-payment-membership-branch.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const dto = readFileSync(new URL('../src/payment/dto/payment.dto.ts', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/payment/payment.service.ts', import.meta.url), 'utf8');

assert.match(dto, /type PaymentOrderType = 'recharge' \| 'membership'/);
assert.match(service, /currentOrder\.orderType === 'membership'/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm_config_cache=$PWD/.npm-cache npx --yes tsx backend/scripts/test-payment-membership-branch.ts`
Expected: FAIL because membership order type is missing.

- [ ] **Step 3: Write minimal implementation**

Add DTO support:

```ts
export type PaymentOrderType = 'recharge' | 'membership';
```

Branch in payment success:

```ts
if (currentOrder.orderType === 'membership') {
  const activation = await this.membershipService.activatePaidMembershipOrder(...);
  await tx.paymentOrder.update({ where: { id: orderId }, data: { subscriptionId: activation.subscriptionId } });
  return;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm_config_cache=$PWD/.npm-cache npx --yes tsx backend/scripts/test-payment-membership-branch.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/payment/dto/payment.dto.ts backend/src/payment/payment.service.ts backend/src/payment/payment.module.ts backend/src/app.module.ts backend/scripts/test-payment-membership-branch.ts
git commit -m "feat: branch payment success for membership orders"
```

### Task 4: Membership Plan Query And Order Creation

**Files:**
- Modify: `backend/src/payment/payment.controller.ts`
- Modify: `backend/src/payment/payment.service.ts`
- Test: `backend/scripts/test-payment-membership-create-order.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const controller = readFileSync(new URL('../src/payment/payment.controller.ts', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/payment/payment.service.ts', import.meta.url), 'utf8');

assert.match(controller, /@Get\\('membership-plans'\\)/);
assert.match(service, /membershipPlanId/);
assert.match(service, /orderType: dto\\.orderType \\?\\? 'recharge'/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm_config_cache=$PWD/.npm-cache npx --yes tsx backend/scripts/test-payment-membership-create-order.ts`
Expected: FAIL because membership plan endpoint and membership order creation do not exist.

- [ ] **Step 3: Write minimal implementation**

Add:
- `GET /payment/membership-plans`
- `CreateOrderDto.orderType?`
- `CreateOrderDto.membershipPlanId?`
- membership order validation:
  - plan must exist and be active
  - amount must match plan price
  - credits must equal `0`
  - persist `planSnapshot`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm_config_cache=$PWD/.npm-cache npx --yes tsx backend/scripts/test-payment-membership-create-order.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/payment/payment.controller.ts backend/src/payment/payment.service.ts backend/scripts/test-payment-membership-create-order.ts
git commit -m "feat: add membership plan query and order creation"
```

### Task 5: Verification And Knowledge Base Sync

**Files:**
- Modify: `helloagents/wiki/modules/backend-credits.md`
- Modify: `helloagents/CHANGELOG.md`

- [ ] **Step 1: Run focused verification**

Run:

```bash
npm_config_cache=$PWD/.npm-cache npx --yes tsx backend/scripts/test-membership-p0-types.ts
npm_config_cache=$PWD/.npm-cache npx --yes tsx backend/scripts/test-membership-p0-activation.ts
npm_config_cache=$PWD/.npm-cache npx --yes tsx backend/scripts/test-payment-membership-branch.ts
npm_config_cache=$PWD/.npm-cache npx --yes tsx backend/scripts/test-payment-membership-create-order.ts
cd backend && npm run build
```

Expected: all PASS and `tsc -p tsconfig.build.json` succeeds.

- [ ] **Step 2: Sync docs**

Document:
- membership P0 now exists
- `membership_bound` grant path is connected for paid membership orders
- frontend membership page and scheduler are still not implemented

- [ ] **Step 3: Commit**

```bash
git add helloagents/wiki/modules/backend-credits.md helloagents/CHANGELOG.md
git commit -m "docs: sync membership p0 backend status"
```
