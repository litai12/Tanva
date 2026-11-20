/**
 * 本地多租户演示 seed（幂等）。
 * 建两个租户 site-a / site-b + 域名 a.localhost / b.localhost，
 * 各一个可登录用户（故意用同一手机号，演示同凭据不同租户=不同数据）、
 * 差异化积分/项目，以及示例已付订单+消耗记录（喂给「分租户经营统计」面板）。
 *
 * 运行：node backend/scripts/seed-local-tenants.js
 * 清理：node backend/scripts/seed-local-tenants.js --clean
 *
 * 注意：用基础 PrismaClient（非租户作用域），故每条记录都显式写 tenantId。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const DEMO_PHONE = '13900000001';
const DEMO_PASSWORD = 'tanva123';
const USAGE_MARKER = 'seed-demo'; // ApiUsageRecord.serviceName 标记，便于幂等清理

const TENANTS = [
  {
    slug: 'site-a',
    name: '站点A',
    host: 'a.localhost',
    userName: '站点A测试用户',
    balance: 8888,
    projectName: '站点A的项目 · 海报',
    orders: [
      { suffix: '1', amount: '19.90', credits: 1990, method: 'wechat' },
      { suffix: '2', amount: '99.00', credits: 9900, method: 'alipay' },
    ],
    usageCount: 3,
  },
  {
    slug: 'site-b',
    name: '站点B',
    host: 'b.localhost',
    userName: '站点B测试用户',
    balance: 2333,
    projectName: '站点B的项目 · Logo',
    orders: [{ suffix: '1', amount: '50.00', credits: 5000, method: 'alipay' }],
    usageCount: 6,
  },
];

async function upsertTenant(t) {
  const tenant = await prisma.tenant.upsert({
    where: { slug: t.slug },
    update: { name: t.name, status: 'active' },
    create: { slug: t.slug, name: t.name, status: 'active', isPlatform: false },
  });
  await prisma.tenantDomain.upsert({
    where: { host: t.host },
    update: { tenantId: tenant.id, isPrimary: true, verified: true },
    create: { tenantId: tenant.id, host: t.host, isPrimary: true, verified: true },
  });
  return tenant;
}

async function upsertUser(tenant, t) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const existing = await prisma.user.findFirst({
    where: { tenantId: tenant.id, phone: DEMO_PHONE },
  });
  let user;
  if (existing) {
    user = await prisma.user.update({
      where: { id: existing.id },
      data: { name: t.userName, passwordHash, status: 'active' },
    });
  } else {
    user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        phone: DEMO_PHONE,
        passwordHash,
        name: t.userName,
        role: 'user',
        status: 'active',
      },
    });
  }
  // 积分账户（差异化余额）
  await prisma.creditAccount.upsert({
    where: { userId: user.id },
    update: { balance: t.balance, totalEarned: t.balance },
    create: {
      tenantId: tenant.id,
      userId: user.id,
      balance: t.balance,
      totalEarned: t.balance,
      totalSpent: 0,
    },
  });
  // 一个差异化项目（用 name 做幂等判断）
  const proj = await prisma.project.findFirst({
    where: { tenantId: tenant.id, userId: user.id, name: t.projectName },
  });
  if (!proj) {
    await prisma.project.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        name: t.projectName,
        ossPrefix: `seed/${t.slug}/`,
        mainKey: `seed/${t.slug}/main.json`,
      },
    });
  }
  return user;
}

async function seedOrdersAndUsage(tenant, user, t) {
  for (const o of t.orders) {
    const orderNo = `SEED-${t.slug.toUpperCase()}-${o.suffix}`;
    await prisma.paymentOrder.upsert({
      where: { orderNo },
      update: { status: 'paid', amount: o.amount, credits: o.credits, tenantId: tenant.id },
      create: {
        tenantId: tenant.id,
        orderNo,
        userId: user.id,
        orderType: 'recharge',
        amount: o.amount,
        credits: o.credits,
        paymentMethod: o.method,
        status: 'paid',
        tradeNo: `seed-trade-${orderNo}`,
        paidAt: new Date(),
        expiredAt: new Date(Date.now() + 86400000),
      },
    });
  }
  // 消耗记录：先按标记清掉本租户旧 seed，再插新（幂等）
  await prisma.apiUsageRecord.deleteMany({
    where: { tenantId: tenant.id, serviceName: USAGE_MARKER },
  });
  for (let i = 0; i < t.usageCount; i++) {
    await prisma.apiUsageRecord.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        serviceType: 'image',
        serviceName: USAGE_MARKER,
        provider: 'seed',
        creditsUsed: 100 + i * 10,
        responseStatus: 'success',
      },
    });
  }
}

async function clean() {
  for (const t of TENANTS) {
    const tenant = await prisma.tenant.findUnique({ where: { slug: t.slug } });
    if (!tenant) continue;
    await prisma.apiUsageRecord.deleteMany({ where: { tenantId: tenant.id, serviceName: USAGE_MARKER } });
    await prisma.paymentOrder.deleteMany({ where: { tenantId: tenant.id, orderNo: { startsWith: `SEED-${t.slug.toUpperCase()}-` } } });
    const user = await prisma.user.findFirst({ where: { tenantId: tenant.id, phone: DEMO_PHONE } });
    if (user) {
      await prisma.project.deleteMany({ where: { tenantId: tenant.id, userId: user.id, name: t.projectName } });
      await prisma.creditAccount.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    await prisma.tenantDomain.deleteMany({ where: { host: t.host } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
    console.log(`已清理租户 ${t.slug}`);
  }
}

async function main() {
  if (process.argv.includes('--clean')) {
    await clean();
    return;
  }

  console.log('=== 现有租户 ===');
  const all = await prisma.tenant.findMany({ select: { slug: true, name: true, isPlatform: true } });
  all.forEach((t) => console.log(`  ${t.isPlatform ? '[主站]' : '      '} ${t.slug}  ${t.name}`));

  const admins = await prisma.user.findMany({
    where: { tenantId: 'default', role: 'admin' },
    select: { phone: true, name: true },
  });
  console.log('\n=== 主站(default)平台超管（用于查看「分租户统计」面板）===');
  if (admins.length === 0) console.log('  ⚠ 未发现 default 租户下 role=admin 的用户，统计面板需平台超管登录主站后查看');
  else admins.forEach((a) => console.log(`  ${a.phone}  ${a.name || ''}`));

  console.log('\n=== 开始 seed ===');
  for (const t of TENANTS) {
    const tenant = await upsertTenant(t);
    const user = await upsertUser(tenant, t);
    await seedOrdersAndUsage(tenant, user, t);
    console.log(`  ✓ ${t.slug} (${t.host})  用户=${DEMO_PHONE}  余额=${t.balance}  订单=${t.orders.length}  消耗=${t.usageCount}`);
  }

  console.log('\n=== 完成。登录方式（两个端口用同一手机号，数据各自独立）===');
  console.log(`  手机号: ${DEMO_PHONE}   密码: ${DEMO_PASSWORD}`);
  console.log('  端口A → a.localhost → 站点A（余额8888）');
  console.log('  端口B → b.localhost → 站点B（余额2333）');
}

main()
  .catch((e) => {
    console.error('seed 失败:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
