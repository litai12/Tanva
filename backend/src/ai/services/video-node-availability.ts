import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';

/** Check the server-owned node status before any credit hold or upstream call. */
export async function assertVideoNodeEnabled(
  prisma: Pick<PrismaService, 'nodeConfig'>,
  nodeKey: string,
): Promise<void> {
  const config = await prisma.nodeConfig.findUnique({
    where: { nodeKey },
    select: { status: true, statusMessage: true, nameZh: true },
  });
  if (config && config.status !== 'normal') {
    throw new BadRequestException(
      config.statusMessage || `${config.nameZh}已停用，请在画布选择可用的视频模型`,
    );
  }
}
