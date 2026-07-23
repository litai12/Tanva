import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { VideoProviderService } from '../src/ai/services/video-provider.service';
import { VolcAssetService } from '../src/volc-asset/volc-asset.service';
import { isMissingVolcAssetError } from '../src/volc-asset/volc-asset-lifecycle.util';

type TaskGroupRow = {
  groupId: string;
  taskId?: string;
  status: string;
  expiresAt: Date;
  deletedAt?: Date | null;
  lastError?: string | null;
};

function createPrismaStub() {
  const rows = new Map<string, TaskGroupRow>();
  const delegate = {
    create: async ({ data }: any) => {
      rows.set(data.groupId, { ...data, deletedAt: null });
      return rows.get(data.groupId);
    },
    update: async ({ where, data }: any) => {
      const row = rows.get(where.groupId);
      if (!row) throw new Error('row not found');
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      const row = rows.get(where.groupId);
      if (!row || (where.deletedAt === null && row.deletedAt)) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
    findFirst: async ({ where }: any) =>
      [...rows.values()].find(
        (row) =>
          row.taskId === where.taskId &&
          !row.deletedAt &&
          row.status !== 'deleted',
      ) || null,
    findMany: async ({ where }: any) =>
      [...rows.values()].filter(
        (row) =>
          !row.deletedAt &&
          row.status !== 'deleted' &&
          row.expiresAt.getTime() <= new Date(where.expiresAt.lte).getTime(),
      ),
  };
  return {
    rows,
    prisma: { volcTaskAssetGroup: delegate } as unknown as PrismaService,
  };
}

async function verifyServiceLifecycle(): Promise<void> {
  const { rows, prisma } = createPrismaStub();
  const config = {
    get: (key: string) =>
      ({
        VOLC_ARK_ACCESS_KEY: 'test-ak',
        VOLC_ARK_SECRET_KEY: 'test-sk',
        VOLC_TASK_ASSET_GROUP_TTL_HOURS: '24',
      } as Record<string, string>)[key],
  } as ConfigService;
  const service = new VolcAssetService(config, prisma);
  service.onModuleInit();

  let assetSequence = 0;
  const deletedGroups: string[] = [];
  (service as any).createAssetGroup = async () => 'group-run-1';
  (service as any).createAsset = async () => `asset-new-${++assetSequence}`;
  (service as any).pollAssetActive = async () => undefined;
  (service as any).deleteAssetGroup = async (groupId: string) => {
    deletedGroups.push(groupId);
  };

  const prepared = await service.createTaskAssetGroup([
    'https://cdn.test/current-crop-1.png',
    'https://cdn.test/current-crop-2.png',
  ]);
  assert.equal(prepared.groupId, 'group-run-1');
  assert.deepEqual(
    prepared.references.map((item) => item.volcAssetId),
    ['asset-new-1', 'asset-new-2'],
  );

  await service.bindTaskAssetGroup(prepared.groupId, 'newapi:task-1');
  assert.equal(rows.get(prepared.groupId)?.taskId, 'newapi:task-1');
  assert.equal(rows.get(prepared.groupId)?.status, 'running');

  assert.equal(await service.cleanupTaskAssetGroup('newapi:task-1', 'succeeded'), true);
  assert.deepEqual(deletedGroups, ['group-run-1']);
  assert.equal(rows.get(prepared.groupId)?.status, 'deleted');
  assert.ok(rows.get(prepared.groupId)?.deletedAt instanceof Date);
  assert.equal(await service.cleanupTaskAssetGroup('newapi:task-1', 'succeeded'), false);

  rows.set('group-expired', {
    groupId: 'group-expired',
    status: 'running',
    expiresAt: new Date(Date.now() - 1000),
    deletedAt: null,
  });
  assert.deepEqual(await service.cleanupExpiredTaskAssetGroups(), { deleted: 1, failed: 0 });
  assert.ok(deletedGroups.includes('group-expired'));
}

async function verifyVideoProviderLifecycle(): Promise<void> {
  const createdGroups: string[] = [];
  const deletedGroups: string[] = [];
  const bound: Array<[string, string]> = [];
  const cleanedTasks: Array<[string, string]> = [];
  let groupSequence = 0;
  const assetService = {
    createTaskAssetGroup: async (urls: string[]) => {
      const sequence = ++groupSequence;
      const groupId = `group-${sequence}`;
      createdGroups.push(groupId);
      return {
        groupId,
        references: urls.map((url, index) => ({
          url,
          volcAssetId: `asset-fresh-${sequence}-${index}`,
          volcAssetStatus: 'active' as const,
        })),
      };
    },
    bindTaskAssetGroup: async (groupId: string, taskId: string) => {
      bound.push([groupId, taskId]);
    },
    cleanupTaskAssetGroupById: async (groupId: string) => {
      deletedGroups.push(groupId);
      return true;
    },
    cleanupTaskAssetGroup: async (taskId: string, status: string) => {
      cleanedTasks.push([taskId, status]);
      return true;
    },
  } as unknown as VolcAssetService;

  const provider = new VideoProviderService(
    {} as any,
    {} as any,
    {} as any,
    assetService,
  );
  const bioReference = {
    url: 'https://cdn.test/authorized-person.png',
    volcAssetId: 'asset-bio-authorized',
    volcAssetStatus: 'active' as const,
    volcAssetKind: 'bio-auth' as const,
  };
  assert.deepEqual(
    (provider as any).withoutVolcAssetHints({ referenceImages: [bioReference] }).referenceImages,
    [bioReference],
  );
  const submittedRefs: any[][] = [];
  let attempts = 0;
  (provider as any).generateVideoAttempt = async (options: any) => {
    submittedRefs.push(options.referenceImages);
    attempts += 1;
    if (attempts === 1) {
      throw new Error(
        'The parameter content[1].image_url.url is not valid: The specified asset asset-old-1 is not found.',
      );
    }
    return { taskId: 'newapi:task-retried', status: 'queued' };
  };

  const result = await provider.generateVideo({
    provider: 'doubao',
    seedanceModel: 'seedance-2.0',
    referenceImages: [
      {
        url: 'https://cdn.test/current-render.png',
        volcAssetId: 'asset-deleted-from-old-project',
        volcAssetStatus: 'active',
      },
    ],
  });
  assert.equal(result.taskId, 'newapi:task-retried');
  assert.deepEqual(createdGroups, ['group-1', 'group-2']);
  assert.deepEqual(deletedGroups, ['group-1']);
  assert.equal(submittedRefs[0][0].volcAssetId, 'asset-fresh-1-0');
  assert.equal(submittedRefs[1][0].volcAssetId, 'asset-fresh-2-0');
  assert.ok(!JSON.stringify(submittedRefs).includes('asset-deleted-from-old-project'));
  assert.deepEqual(bound, [['group-2', 'newapi:task-retried']]);

  (provider as any).queryTaskAttempt = async () => ({ status: 'succeeded', videoUrl: 'https://cdn.test/out.mp4' });
  await provider.queryTask('doubao', 'newapi:task-retried');
  assert.deepEqual(cleanedTasks, [['newapi:task-retried', 'succeeded']]);
}

async function main(): Promise<void> {
  assert.equal(
    isMissingVolcAssetError({
      error: {
        code: 'InvalidParameter',
        message: 'The specified asset asset-20260720230219-x5xq5 is not found.',
        param: 'content[1].image_url.url',
      },
    }),
    true,
  );
  assert.equal(isMissingVolcAssetError(new Error('source image URL returned 404')), false);
  await verifyServiceLifecycle();
  await verifyVideoProviderLifecycle();
  console.log('Volc task asset lifecycle verification passed.');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
