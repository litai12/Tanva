import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { AiController } from '../ai.controller';
import { assertVideoNodeEnabled } from './video-node-availability';

async function run() {
  for (const status of ['disabled', 'maintenance', 'coming_soon', 'normal']) {
    let reads = 0;
    const prisma = {
      nodeConfig: {
        findUnique: async (args: { where: { nodeKey: string } }) => {
          reads++;
          assert.equal(args.where.nodeKey, 'doubaoVideo');
          return { status, nameZh: 'Seedance 1.5 Pro', statusMessage: null };
        },
      },
    } as unknown as Pick<PrismaService, 'nodeConfig'>;
    if (status === 'normal') await assertVideoNodeEnabled(prisma, 'doubaoVideo');
    else await assert.rejects(assertVideoNodeEnabled(prisma, 'doubaoVideo'), BadRequestException);
    assert.equal(reads, 1, 'read current admin config on every request');
  }
  let charged = 0;
  let submitted = 0;
  const ai = Object.assign(Object.create(AiController.prototype), {
    prisma: { nodeConfig: { findUnique: async () => ({ status: 'disabled', nameZh: 'Seedance 1.5 Pro' }) } },
    creditCharge: { begin: async () => { charged++; } },
    videoProviderService: { generateVideo: async () => { submitted++; } },
  }) as AiController;
  // Both a stale chat request and an API-key request stop before billing/submission.
  for (const req of [{ user: { id: 'user-1' } }, {}]) {
    await assert.rejects(ai.generateVideoProvider({
      provider: 'doubao', seedanceModel: 'seedance-1.5-pro', prompt: 'test',
    }, req), BadRequestException);
  }
  assert.equal(charged, 0);
  assert.equal(submitted, 0);
  console.log('video node availability and pre-billing controller rejection: PASS');
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
