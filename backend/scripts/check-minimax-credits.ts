import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const node = await prisma.serviceNode.findUnique({
    where: { serviceType: 'minimax-speech' },
  });

  if (node) {
    console.log('数据库中的配置:');
    console.log('serviceType:', node.serviceType);
    console.log('serviceName:', node.serviceName);
    console.log('creditsPerCall:', node.creditsPerCall);
    console.log('enabled:', node.enabled);
  } else {
    console.log('未找到 minimax-speech 节点');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
