import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 查找错误的 serviceType
  const wrongNode = await prisma.serviceNode.findFirst({
    where: {
      OR: [
        { serviceType: 'minimaxSpeech' },
        { serviceType: 'minimax_speech' },
      ],
    },
  });

  if (wrongNode) {
    console.log('找到错误的节点:', wrongNode.serviceType);

    // 更新为正确的 serviceType
    await prisma.serviceNode.update({
      where: { id: wrongNode.id },
      data: { serviceType: 'minimax-speech' },
    });

    console.log('已修复为: minimax-speech');
  } else {
    console.log('未找到需要修复的节点');
  }

  // 显示当前的 minimax 节点
  const node = await prisma.serviceNode.findUnique({
    where: { serviceType: 'minimax-speech' },
  });

  if (node) {
    console.log('\n当前节点信息:');
    console.log('serviceType:', node.serviceType);
    console.log('serviceName:', node.serviceName);
    console.log('creditsPerCall:', node.creditsPerCall);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
