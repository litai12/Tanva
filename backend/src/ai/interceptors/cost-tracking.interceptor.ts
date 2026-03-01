import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { CostCalculatorService } from '../services/cost-calculator.service';

/**
 * 成本追踪拦截器
 * 自动记录每次 API 调用的成本
 */
@Injectable()
export class CostTrackingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CostTrackingInterceptor.name);

  constructor(private readonly costCalculator: CostCalculatorService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const startTime = Date.now();

    // 从请求路径提取操作类型
    const path = request.path;
    const operation = this.extractOperation(path);

    // 从请求体提取 model 参数
    const model = request.body?.model || 'gemini';

    return next.handle().pipe(
      tap((response) => {
        const duration = Date.now() - startTime;
        const cost = this.costCalculator.calculateCost(model, operation);

        // 记录成本信息
        this.logger.log({
          timestamp: new Date().toISOString(),
          operation,
          provider: model,
          duration: `${duration}ms`,
          cost: `$${cost.toFixed(4)}`,
          endpoint: path,
        });

        // 将成本信息添加到响应中
        if (response && typeof response === 'object') {
          response._costInfo = {
            operation,
            provider: model,
            cost,
            duration,
          };
        }
      })
    );
  }

  /**
   * 从请求路径提取操作类型
   */
  private extractOperation(path: string): string {
    if (path.includes('generate')) return 'imageGeneration';
    if (path.includes('edit')) return 'imageEditing';
    if (path.includes('blend')) return 'imageBlending';
    if (path.includes('analyze')) return 'imageAnalysis';
    if (path.includes('chat') || path.includes('text')) return 'textChat';
    return 'unknown';
  }
}
