/**
 * 分析用户积分来源的脚本
 * 用于排查用户积分异常问题
 * 
 * 使用方法：
 * npx ts-node scripts/analyze-user-credits.ts <phone_or_email>
 * 
 * 例如：
 * npx ts-node scripts/analyze-user-credits.ts 17192309290
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function analyzeUserCredits(identifier: string) {
  console.log(`\n🔍 正在分析用户: ${identifier}\n`);

  // 查找用户
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { phone: identifier },
        { email: identifier.toLowerCase() },
      ],
    },
    include: {
      creditAccount: true,
    },
  });

  if (!user) {
    console.error(`❌ 未找到用户: ${identifier}`);
    process.exit(1);
  }

  console.log(`✅ 找到用户:`);
  console.log(`   ID: ${user.id}`);
  console.log(`   手机号: ${user.phone}`);
  console.log(`   邮箱: ${user.email || '无'}`);
  console.log(`   注册时间: ${user.createdAt}`);
  console.log(`\n`);

  if (!user.creditAccount) {
    console.log(`⚠️  用户没有积分账户`);
    process.exit(0);
  }

  const account = user.creditAccount;
  console.log(`📊 积分账户信息:`);
  console.log(`   当前余额: ${account.balance}`);
  console.log(`   总获得: ${account.totalEarned}`);
  console.log(`   总消费: ${account.totalSpent}`);
  console.log(`   账户创建时间: ${account.createdAt}`);
  console.log(`\n`);

  // 获取所有交易记录
  const allTransactions = await prisma.creditTransaction.findMany({
    where: {
      accountId: account.id,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  console.log(`📝 所有交易记录 (共 ${allTransactions.length} 条):\n`);
  console.log('='.repeat(100));

  // 按类型分组统计
  const typeStats = new Map<string, { count: number; totalAmount: number }>();
  let totalEarned = 0;
  let totalSpent = 0;

  for (const tx of allTransactions) {
    const type = tx.type;
    const amount = tx.amount;

    if (!typeStats.has(type)) {
      typeStats.set(type, { count: 0, totalAmount: 0 });
    }

    const stats = typeStats.get(type)!;
    stats.count += 1;
    stats.totalAmount += amount;

    if (amount > 0) {
      totalEarned += amount;
    } else {
      totalSpent += Math.abs(amount);
    }

    // 显示交易详情
    const date = tx.createdAt.toLocaleString('zh-CN');
    const sign = amount > 0 ? '+' : '';
    console.log(
      `[${date}] ${tx.type.padEnd(20)} ${sign}${amount.toString().padStart(8)} | ` +
      `余额: ${tx.balanceBefore} → ${tx.balanceAfter} | ${tx.description}`
    );
  }

  console.log('='.repeat(100));
  console.log(`\n📈 按类型统计:\n`);

  for (const [type, stats] of Array.from(typeStats.entries()).sort((a, b) => b[1].totalAmount - a[1].totalAmount)) {
    const sign = stats.totalAmount > 0 ? '+' : '';
    console.log(
      `   ${type.padEnd(20)} 数量: ${stats.count.toString().padStart(4)} | ` +
      `总金额: ${sign}${stats.totalAmount.toString().padStart(8)}`
    );
  }

  console.log(`\n💰 汇总:`);
  console.log(`   总获得积分: +${totalEarned}`);
  console.log(`   总消费积分: -${totalSpent}`);
  console.log(`   理论余额: ${totalEarned - totalSpent}`);
  console.log(`   实际余额: ${account.balance}`);
  console.log(`   差异: ${account.balance - (totalEarned - totalSpent)}`);

  // 检查邀请记录
  console.log(`\n🎁 邀请相关记录:\n`);

  // 检查用户是否被邀请
  if (user.invitedById) {
    const inviter = await prisma.user.findUnique({
      where: { id: user.invitedById },
      select: { phone: true, email: true, name: true },
    });
    console.log(`   被邀请人，邀请者: ${inviter?.name || inviter?.phone || inviter?.email || user.invitedById}`);
  }

  // 检查用户的邀请记录
  const invitationRedemptions = await prisma.invitationRedemption.findMany({
    where: {
      inviterUserId: user.id,
    },
    include: {
      invitee: {
        select: {
          phone: true,
          email: true,
          name: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  if (invitationRedemptions.length > 0) {
    console.log(`   成功邀请 ${invitationRedemptions.length} 人:`);
    for (const redemption of invitationRedemptions) {
      const invitee = redemption.invitee;
      const name = invitee.name || invitee.phone || invitee.email || '未知';
      console.log(
        `      - ${name} | 状态: ${redemption.rewardStatus} | ` +
        `奖励: ${redemption.rewardAmount} | 时间: ${redemption.createdAt.toLocaleString('zh-CN')}`
      );
    }

    const rewardedCount = invitationRedemptions.filter(r => r.rewardStatus === 'rewarded').length;
    const totalReward = rewardedCount * 1000; // REFERRAL_REWARD = 1000
    console.log(`\n   已发放邀请奖励: ${rewardedCount} 次，总计: ${totalReward} 积分`);
  } else {
    console.log(`   未邀请任何人`);
  }

  // 检查是否有 REFERRAL_REWARD 类型的交易记录
  const referralRewards = allTransactions.filter(tx => tx.type === 'REFERRAL_REWARD');
  if (referralRewards.length > 0) {
    console.log(`\n⚠️  发现 ${referralRewards.length} 条邀请奖励交易记录 (类型: REFERRAL_REWARD)`);
    console.log(`   这些记录在后台查询中可能不会显示！`);
    const totalReferralReward = referralRewards.reduce((sum, tx) => sum + tx.amount, 0);
    console.log(`   邀请奖励总额: ${totalReferralReward} 积分`);
  }

  // 检查是否有 CHECK_IN 类型的交易记录
  const checkInRewards = allTransactions.filter(tx => tx.type === 'CHECK_IN');
  if (checkInRewards.length > 0) {
    console.log(`\n⚠️  发现 ${checkInRewards.length} 条签到交易记录 (类型: CHECK_IN)`);
    console.log(`   这些记录在后台查询中可能不会显示！`);
    const totalCheckInReward = checkInRewards.reduce((sum, tx) => sum + tx.amount, 0);
    console.log(`   签到奖励总额: ${totalCheckInReward} 积分`);
  }

  // 检查注册当天的所有交易
  const registrationDate = new Date(user.createdAt);
  registrationDate.setHours(0, 0, 0, 0);
  const nextDay = new Date(registrationDate);
  nextDay.setDate(nextDay.getDate() + 1);

  const firstDayTransactions = allTransactions.filter(
    tx => tx.createdAt >= registrationDate && tx.createdAt < nextDay
  );

  if (firstDayTransactions.length > 0) {
    console.log(`\n📅 注册当天的交易记录 (${registrationDate.toLocaleDateString('zh-CN')}):\n`);
    for (const tx of firstDayTransactions) {
      const time = tx.createdAt.toLocaleTimeString('zh-CN');
      const sign = tx.amount > 0 ? '+' : '';
      console.log(
        `   [${time}] ${tx.type.padEnd(20)} ${sign}${tx.amount.toString().padStart(8)} | ` +
        `${tx.description}`
      );
    }
    const firstDayTotal = firstDayTransactions.reduce((sum, tx) => sum + tx.amount, 0);
    console.log(`\n   注册当天总获得: ${firstDayTotal} 积分`);
  }

  console.log(`\n`);
}

async function main() {
  const identifier = process.argv[2];

  if (!identifier) {
    console.error('❌ 请提供用户手机号或邮箱作为参数');
    console.error('   使用方法: npx ts-node scripts/analyze-user-credits.ts <phone_or_email>');
    process.exit(1);
  }

  try {
    await analyzeUserCredits(identifier);
  } catch (error) {
    console.error('❌ 分析失败:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

