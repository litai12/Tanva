import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { BioAuthStatus, BioAuthStatusResponse, StartBioAuthResponse } from './bio-auth.dto';

interface TaskRecord {
  taskId: string;
  imageUrl: string;
  userId: string;
  status: BioAuthStatus;
  errorMessage?: string;
  createdAt: number;
}

// 存根实现：任务创建后 AUTO_APPROVE_MS 毫秒自动切换为 active。
// 待接入火山引擎真实活体检测 API 后替换此逻辑。
const AUTO_APPROVE_MS = 8000;

@Injectable()
export class BioAuthService {
  private readonly logger = new Logger(BioAuthService.name);
  private readonly tasks = new Map<string, TaskRecord>();

  async startTask(userId: string, imageUrl: string): Promise<StartBioAuthResponse> {
    const taskId = randomUUID();
    const record: TaskRecord = {
      taskId,
      imageUrl,
      userId,
      status: 'processing',
      createdAt: Date.now(),
    };
    this.tasks.set(taskId, record);
    this.logger.log(`bio-auth task created: ${taskId} for user ${userId}`);

    // 存根：延迟后自动 approve（真实场景由火山引擎 webhook/轮询驱动）
    setTimeout(() => {
      const t = this.tasks.get(taskId);
      if (t && t.status === 'processing') {
        t.status = 'active';
        this.logger.log(`bio-auth task auto-approved (stub): ${taskId}`);
      }
    }, AUTO_APPROVE_MS);

    return { taskId };
  }

  getStatus(taskId: string): BioAuthStatusResponse {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { status: 'failed', errorMessage: '任务不存在或已过期' };
    }
    return { status: task.status, errorMessage: task.errorMessage };
  }
}
