/**
 * 一次性回填：把历史 ApiUsageRecord 明细按天聚合进 ApiUsageDailyStat（rollup）。
 *
 * 背景：admin API 统计已改为「历史读 rollup + 昨今读明细实时」。上线后历史天
 * 还没有 rollup 行，需要本脚本把「最早一条记录」到「昨天」之间的每一个本地
 * 自然日补齐。今天不滚（由读取侧实时覆盖），昨天会在每日 00:15 的定时任务里
 * 再次滚动，重复运行 rollupDay 幂等（先删该天再插）。
 *
 * 复用 ApiUsageRollupService.rollupDay，保证与运行时 SQL 完全一致、不漂移。
 *
 * 使用：
 *   npx ts-node scripts/backfill-api-usage-daily-stat.ts          # 演练（只打印范围）
 *   npx ts-node scripts/backfill-api-usage-daily-stat.ts --apply  # 实际回填
 */

import { PrismaClient } from '@prisma/client';
import { ApiUsageRollupService } from '../src/admin/services/api-usage-rollup.service';

const prisma = new PrismaClient();

function localDayStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayStr(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(`\nAPI 用量日滚动回填 ${apply ? '【实际回填】' : '【演练 dry-run】'}\n`);

  const earliest = await prisma.apiUsageRecord.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  if (!earliest) {
    console.log('没有任何 ApiUsageRecord，无需回填。\n');
    return;
  }

  const from = localDayStart(earliest.createdAt);
  // 回填到「昨天」为止；今天由读取侧实时覆盖
  const today = localDayStart(new Date());
  const to = new Date(today);
  to.setDate(to.getDate() - 1);

  if (to.getTime() < from.getTime()) {
    console.log('最早记录就在今天，没有历史天需要回填。\n');
    return;
  }

  const totalDays = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  console.log(`回填区间: ${dayStr(from)} ~ ${dayStr(to)}（共 ${totalDays} 天，今天不滚）`);

  if (!apply) {
    console.log('\n演练结束，未写入。加 --apply 实际回填。\n');
    return;
  }

  const service = new ApiUsageRollupService(prisma as any);
  const { days, rows } = await service.backfillRange(from, to);
  console.log(`\n完成。滚动 ${days} 天，写入 ${rows} 条聚合行。\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
