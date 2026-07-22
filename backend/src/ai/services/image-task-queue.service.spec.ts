import { ConfigService } from '@nestjs/config';
import { ImageTaskQueueService, ImageTaskJobPayload } from './image-task-queue.service';
import { TenantContextService } from '../../tenancy/tenant-context.service';

// 捕获 BullMQ Queue 实例，断言入队 payload。
const queueAdd = jest.fn().mockResolvedValue(undefined);
const queueGetJobCounts = jest.fn().mockResolvedValue({ waiting: 0, active: 0 });
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: queueAdd,
    getJobCounts: queueGetJobCounts,
    getJob: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

function makeConfig(): ConfigService {
  return { get: jest.fn().mockReturnValue('redis://127.0.0.1:6379') } as unknown as ConfigService;
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

describe('ImageTaskQueueService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('addJob 用请求期 CLS 的 tenantId 写入 payload（调用方无需改签名）', async () => {
    const ctx = { getTenantId: jest.fn().mockReturnValue('t_acme') } as unknown as TenantContextService;
    const svc = new ImageTaskQueueService(makeConfig(), ctx);
    svc.onModuleInit();

    await svc.addJob(basePayload());

    expect(ctx.getTenantId).toHaveBeenCalledTimes(1);
    const enqueued = queueAdd.mock.calls[0][1] as ImageTaskJobPayload;
    expect(enqueued.tenantId).toBe('t_acme');
    expect(queueAdd.mock.calls[0][2]).toEqual({ jobId: 'task-1' });
  });

  it('payload 已显式带 tenantId 时优先保留', async () => {
    const ctx = { getTenantId: jest.fn().mockReturnValue('t_ignored') } as unknown as TenantContextService;
    const svc = new ImageTaskQueueService(makeConfig(), ctx);
    svc.onModuleInit();

    await svc.addJob(basePayload({ tenantId: 't_explicit' }));

    const enqueued = queueAdd.mock.calls[0][1] as ImageTaskJobPayload;
    expect(enqueued.tenantId).toBe('t_explicit');
  });
});
