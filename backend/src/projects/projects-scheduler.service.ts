import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ProjectsService } from './projects.service';
import { TenantIterationService } from '../tenancy/tenant-iteration.service';

@Injectable()
export class ProjectsSchedulerService {
  private readonly logger = new Logger(ProjectsSchedulerService.name);
  private workflowHistoryCleanupRunning = false;

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly tenantIteration: TenantIterationService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleWorkflowHistoryCleanup() {
    if (this.workflowHistoryCleanupRunning) {
      this.logger.warn('跳过工作流历史清理：上一次任务尚未完成');
      return;
    }

    this.workflowHistoryCleanupRunning = true;
    try {
      // 每个 active 租户在自己的 CLS 内清理；只有 default 时 = 原逻辑跑一次。
      await this.tenantIteration.forEachTenant(() => this.cleanupOneTenant());
    } catch (error) {
      this.logger.error('工作流历史清理失败:', error);
    } finally {
      this.workflowHistoryCleanupRunning = false;
    }
  }

  private async cleanupOneTenant(): Promise<void> {
    const result = await this.projectsService.cleanupExpiredWorkflowHistory();
    this.logger.log(
      `工作流历史清理完成: deleted=${result.deletedCount}, retentionDays=${result.retentionDays}, cutoff=${result.cutoff.toISOString()}`
    );
  }
}
