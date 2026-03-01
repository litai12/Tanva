// 加载环境变量
require('dotenv').config({ path: ['.env', '../.env'] });

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

/**
 * 将指定账号设置为管理员权限
 * 使用方法：
 *   node set-admin.js --phone 13800000000
 *   node set-admin.js --email user@example.com
 *   node set-admin.js --id user-uuid-here
 */
async function setAdmin() {
  try {
    // 解析命令行参数
    const args = process.argv.slice(2);
    let identifier = null;
    let identifierType = null;

    // 解析参数
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--phone' && args[i + 1]) {
        identifier = args[i + 1];
        identifierType = 'phone';
        break;
      } else if (args[i] === '--email' && args[i + 1]) {
        identifier = args[i + 1];
        identifierType = 'email';
        break;
      } else if (args[i] === '--id' && args[i + 1]) {
        identifier = args[i + 1];
        identifierType = 'id';
        break;
      }
    }

    if (!identifier || !identifierType) {
      console.error("❌ 错误: 请提供用户标识");
      console.log("\n使用方法:");
      console.log("  node set-admin.js --phone 13800000000");
      console.log("  node set-admin.js --email user@example.com");
      console.log("  node set-admin.js --id user-uuid-here");
      process.exit(1);
    }

    // 查找用户
    let user = null;
    if (identifierType === 'phone') {
      user = await prisma.user.findUnique({
        where: { phone: identifier },
      });
    } else if (identifierType === 'email') {
      user = await prisma.user.findUnique({
        where: { email: identifier },
      });
    } else if (identifierType === 'id') {
      user = await prisma.user.findUnique({
        where: { id: identifier },
      });
    }

    if (!user) {
      console.error(`❌ 错误: 未找到用户 (${identifierType}: ${identifier})`);
      process.exit(1);
    }

    // 检查是否已经是管理员
    if (user.role === 'admin') {
      console.log(`ℹ️  用户已经是管理员权限`);
      console.log(`   用户ID: ${user.id}`);
      console.log(`   手机号: ${user.phone}`);
      console.log(`   邮箱: ${user.email || '未设置'}`);
      console.log(`   角色: ${user.role}`);
      return;
    }

    // 更新用户角色为 admin
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { role: 'admin' },
    });

    console.log("✅ 成功将用户设置为管理员权限");
    console.log(`   用户ID: ${updatedUser.id}`);
    console.log(`   手机号: ${updatedUser.phone}`);
    console.log(`   邮箱: ${updatedUser.email || '未设置'}`);
    console.log(`   姓名: ${updatedUser.name || '未设置'}`);
    console.log(`   角色: ${updatedUser.role} (已更新)`);
    console.log(`   状态: ${updatedUser.status}`);
  } catch (error) {
    console.error("❌ 操作失败:", error.message);
    if (error.code === 'P2002') {
      console.error("   数据库唯一约束冲突");
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

setAdmin();

