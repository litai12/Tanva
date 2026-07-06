/**
 * 一次性回填：把「旧轨」的 team.maxSeats 容量迁移到「单轨」的席位包模型。
 *
 * 背景：席位容量已统一为 单一真相 = TEAM_PERMANENT_SEATS(2) + Σ 有效席位包.seats
 * （见 TeamCoreService.getSeatCapacity）。历史上若有团队是通过旧的后台
 * adminUpdateTeamSeats 直接写 team.maxSeats 提过容量、却没有对应的席位包，
 * 切换到单轨后这些团队的容量会回落到 2。本脚本为这些团队补一条
 * cycle='admin' 的永久席位包，保证迁移后无人掉容量。
 *
 * 幂等：admin 包本身会计入「已计算容量」，重复运行不会重复叠加。
 * 个人团队跳过。
 *
 * 使用：
 *   npx ts-node scripts/backfill-team-seat-capacity.ts          # 演练（dry-run，只打印）
 *   npx ts-node scripts/backfill-team-seat-capacity.ts --apply  # 实际写入
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEAM_PERMANENT_SEATS = 2;
const FAR_FUTURE = new Date('2999-12-31T00:00:00.000Z');

async function main() {
  const apply = process.argv.includes('--apply');
  const now = new Date();
  console.log(`\n席位容量回填 ${apply ? '【实际写入】' : '【演练 dry-run】'}\n`);

  const teams = await prisma.team.findMany({
    where: { isPersonal: false },
    select: { id: true, name: true, maxSeats: true },
  });

  let touched = 0;
  for (const team of teams) {
    const agg = await prisma.teamSeatPackage.aggregate({
      where: { teamId: team.id, status: 'active', expiresAt: { gt: now } },
      _sum: { seats: true },
    });
    const computedCapacity = TEAM_PERMANENT_SEATS + (agg._sum.seats ?? 0);
    const legacyCapacity = team.maxSeats ?? 0;

    // 旧 maxSeats 比当前单轨容量更高 → 需要补 admin 包把差额迁移过来
    if (legacyCapacity <= computedCapacity) continue;

    const adminSeats = legacyCapacity - computedCapacity;
    touched++;
    console.log(
      `团队 ${team.name} (${team.id}): 旧 maxSeats=${legacyCapacity}, 当前单轨容量=${computedCapacity} → 补 admin 包 +${adminSeats} 席`,
    );

    if (!apply) continue;

    const existing = await prisma.teamSeatPackage.findFirst({
      where: { teamId: team.id, cycle: 'admin' },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      await prisma.teamSeatPackage.update({
        where: { id: existing.id },
        data: { seats: existing.seats + adminSeats, status: 'active', expiresAt: FAR_FUTURE },
      });
    } else {
      await prisma.teamSeatPackage.create({
        data: {
          teamId: team.id,
          seats: adminSeats,
          cycle: 'admin',
          credits: 0,
          status: 'active',
          purchasedAt: now,
          expiresAt: FAR_FUTURE,
        },
      });
    }
  }

  console.log(
    `\n完成。共 ${teams.length} 个团队，${touched} 个需要回填${apply ? '（已写入）' : '（演练，未写入；加 --apply 执行）'}。\n`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
