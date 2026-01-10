const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createAdminUser() {
  try {
    // 检查是否已有管理员用户
    const existingAdmin = await prisma.user.findFirst({
      where: { role: 'admin' }
    });

    if (existingAdmin) {
      console.log('管理员用户已存在:', existingAdmin);
      return;
    }

    // 创建管理员用户
    const hashedPassword = await bcrypt.hash('admin123456', 10);

    const adminUser = await prisma.user.create({
      data: {
        phone: '13800000000',
        email: 'admin@tnavas.ai',
        passwordHash: hashedPassword,
        name: 'Administrator',
        role: 'admin',
        status: 'active'
      }
    });

    console.log('管理员用户创建成功:');
    console.log('手机号: 13800000000');
    console.log('密码: admin123456');
    console.log('用户ID:', adminUser.id);

  } catch (error) {
    console.error('创建管理员用户失败:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createAdminUser();
