import { ConfigService } from '@nestjs/config';
import { ImageTaskWorkerService } from './image-task-worker.service';
import { ImageTaskService } from './image-task.service';
import { TenantContextService } from '../../tenancy/tenant-context.service';
import { PLATFORM_TENANT_ID } from '../../tenancy/tenant.constants';
import { ImageTaskJobPayload } from './image-task-queue.service';

// 捕获传给 BullMQ Worker 的 job processor 闭包，便于直接驱动测试。
let capturedProcessor: ((job: any) => Promise<void>) | undefined;
jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_queue: string, processor: (job: any) => Promise<void>) => {
    capturedProcessor = processor;
    return {
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    };
  }),
}));

function makeConfig(): ConfigService {
  return { get: jest.fn().mockReturnValue('redis://127.0.0.1:6379') } as unknown as ConfigService;
}

function makeImageTaskService(): ImageTaskService {
  return {
    executeTaskFromJob: jest.fn().mockResolvedValue(undefined),
  } as unknown as ImageTaskService;
}

function makeTenantContext(): TenantContextService {
  return {
    // 透传：同步执行 fn 即可断言被 runAsTenant 包裹
    runAsTenant: jest.fn((_id: string, fn: () => any) => Promise.resolve(fn())),
  } as unknown as TenantContextService;
}

function basePayload(overrides: Partial<ImageTaskJobPayload> = {}): ImageTaskJobPayload {
  return {
    taskId: 'task-1',
    userId: 'user-1',
    type: 'generate',
    prompt: 'hi',
    requestData: {},
    ...overrides,
  };
}

describe('ImageTaskWorkerService', () => {
  beforeEach(() => {
    capturedProcessor = undefined;
    jest.clearAllMocks();
  });

  it('worker 用 payload.tenantId 包裹 runAsTenant 再执行 executeTaskFromJob', async () => {
    const config = makeConfig();
    const imageTaskService = makeImageTaskService();
    const ctx = makeTenantContext();
    const svc = new ImageTaskWorkerService(config, imageTaskService, ctx);

    svc.onModuleInit();
    expect(capturedProcessor).toBeDefined();

    const payload = basePayload({ tenantId: 't_acme' });
    await capturedProcessor!({ data: payload });

    expect(ctx.runAsTenant).toHaveBeenCalledTimes(1);
    expect((ctx.runAsTenant as jest.Mock).mock.calls[0][0]).toBe('t_acme');
    expect(imageTaskService.executeTaskFromJob).toHaveBeenCalledWith(payload);
  });

  it('payload 缺 tenantId 时回退到 PLATFORM_TENANT_ID（回归安全/旧任务）', async () => {
    const config = makeConfig();
    const imageTaskService = makeImageTaskService();
    const ctx = makeTenantContext();
    const svc = new ImageTaskWorkerService(config, imageTaskService, ctx);

    svc.onModuleInit();

    const payload = basePayload();
    await capturedProcessor!({ data: payload });

    expect((ctx.runAsTenant as jest.Mock).mock.calls[0][0]).toBe(PLATFORM_TENANT_ID);
    expect(imageTaskService.executeTaskFromJob).toHaveBeenCalledWith(payload);
  });
});
