import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { AiController } from '../src/ai/ai.controller';

const reqFor = (userId: string) => ({
  user: { sub: userId },
  headers: {},
});

const createController = (tasks: Map<string, any>) => {
  const controller = Object.create(AiController.prototype) as AiController;
  let createCount = 0;
  let executeCount = 0;
  const generationTaskService = {
    findVideoTaskById: async (taskId: string) => tasks.get(taskId) ?? null,
    createVideoTask: async (params: any) => {
      createCount += 1;
      tasks.set(params.taskId, {
        id: params.taskId,
        userId: params.userId,
        taskType: params.taskType,
        status: 'queued',
        result: null,
        error: null,
      });
    },
  };

  Object.assign(controller as any, {
    generationTaskService,
    logger: { log: () => undefined, error: () => undefined, warn: () => undefined },
    executeHunyuan3DTaskAsync: () => {
      executeCount += 1;
    },
  });

  return {
    controller,
    counts: () => ({ createCount, executeCount }),
  };
};

async function verifyDuplicateSubmit(): Promise<void> {
  const tasks = new Map<string, any>();
  const { controller, counts } = createController(tasks);
  const dto = {
    imageUrl: 'https://assets.example.com/source.png',
    projectId: 'project-1',
    nodeId: 'image-1',
    clientRequestId: 'canvas-run-1',
  };

  const first = await controller.convert2Dto3DAsync(dto, reqFor('user-1'));
  const second = await controller.convert2Dto3DAsync(dto, reqFor('user-1'));

  assert.equal(first.success, true);
  assert.equal(first.status, 'pending');
  assert.equal(first.deduplicated, false);
  assert.equal(second.taskId, first.taskId);
  assert.equal(second.deduplicated, true);
  assert.deepEqual(counts(), { createCount: 1, executeCount: 1 });
}

async function verifyPersistedFallback(): Promise<void> {
  const tasks = new Map<string, any>();
  const { controller } = createController(tasks);
  tasks.set('async-hunyuan3d-persisted', {
    id: 'async-hunyuan3d-persisted',
    userId: 'user-1',
    taskType: 'hunyuan3d',
    status: 'succeeded',
    result: {
      modelUrl: 'https://assets.example.com/model.glb',
      promptId: 'upstream-job-1',
      modelKey: 'projects/project-1/models/model.glb',
    },
    error: null,
  });

  const response = await controller.queryConvert2Dto3DAsyncTask(
    'async-hunyuan3d-persisted',
    reqFor('user-1'),
  );
  assert.equal(response.success, true);
  assert.equal(response.status, 'succeeded');
  assert.equal(response.modelUrl, 'https://assets.example.com/model.glb');
}

async function verifyOwnerIsolation(): Promise<void> {
  const tasks = new Map<string, any>();
  const { controller } = createController(tasks);
  tasks.set('async-hunyuan3d-private', {
    id: 'async-hunyuan3d-private',
    userId: 'user-1',
    taskType: 'hunyuan3d',
    status: 'processing',
    result: null,
    error: null,
  });

  await assert.rejects(
    controller.queryConvert2Dto3DAsyncTask(
      'async-hunyuan3d-private',
      reqFor('user-2'),
    ),
    ForbiddenException,
  );
}

async function main(): Promise<void> {
  await verifyDuplicateSubmit();
  await verifyPersistedFallback();
  await verifyOwnerIsolation();
  console.log('Async Hunyuan 3D verification passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
