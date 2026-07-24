import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  assessXiaotPromptSafety,
  XIAOT_SAFETY_REFUSAL,
} from '../../agent/xiaot-safety-policy';

// 只检查承载用户创作意图的字段，避免扫描 URL、base64、任务 ID 和技术参数。
const INTENT_FIELDS = new Set([
  'prompt',
  'negativeprompt',
  'text',
  'content',
  'description',
  'script',
  'storyboard',
  'lyrics',
  'title',
  'instruction',
  'instructions',
]);

function collectIntentText(value: unknown, key = '', seen = new Set<object>()): string[] {
  if (typeof value === 'string') {
    return INTENT_FIELDS.has(key.toLowerCase()) ? [value] : [];
  }
  if (!value || typeof value !== 'object' || seen.has(value as object)) return [];
  seen.add(value as object);
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectIntentText(item, key, seen));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([childKey, child]) =>
    collectIntentText(child, childKey, seen),
  );
}

/** 全部 /api/ai 创作入口共用的服务端请求前安全闸门。 */
@Injectable()
export class AiContentSafetyGuard implements CanActivate {
  private readonly logger = new Logger(AiContentSafetyGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const texts = collectIntentText(request?.body);
    for (const text of texts) {
      const category = assessXiaotPromptSafety(text);
      if (!category) continue;
      this.logger.warn(
        `AI creation request blocked by site safety policy: category=${category}`,
      );
      // 400 表示用户可修改创作请求；统一 message 可被现有前端错误处理直接展示。
      throw new BadRequestException(XIAOT_SAFETY_REFUSAL);
    }
    return true;
  }
}

export { collectIntentText };
