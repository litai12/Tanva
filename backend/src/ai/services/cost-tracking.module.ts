import { Module } from '@nestjs/common';
import { CostCalculatorService } from './cost-calculator.service';

/**
 * 成本追踪模块
 * 提供 AI API 调用成本计算和统计功能
 */
@Module({
  providers: [CostCalculatorService],
  exports: [CostCalculatorService],
})
export class CostTrackingModule {}
