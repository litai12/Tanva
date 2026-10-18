import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveEffectiveMembershipPlan } from '../../membership/vip-entitlement-policy';

const PRIVILEGED_ADMIN_ROLES = new Set(['admin', 'normal_admin']);

/**
 * Single source of truth for the image/video watermark entitlement.
 *
 * Product rule (2026-10-17): an active membership period is itself the
 * no-watermark right. Admin roles and the unified whitelist's "去水印"
 * (User.noWatermark) also skip the watermark. `resolveEffectiveMembershipPlan`
 * only returns a plan for an in-period subscription or the yearly VIP
 * whitelist, so free users remain watermarked.
 *
 * Both the synchronous image endpoints (AiController) and the async image-task
 * worker (ImageTaskService) must use this service; otherwise the same model
 * produces different watermark results depending on the entry point.
 */
@Injectable()
export class WatermarkEntitlementService {
  private readonly logger = new Logger(WatermarkEntitlementService.name);

  constructor(private readonly prisma: PrismaService) {}

  async canSkipWatermarkByUserId(userId?: string | null): Promise<boolean> {
    const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
    if (!normalizedUserId || normalizedUserId === 'anonymous') {
      return false;
    }

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: normalizedUserId },
        select: { role: true, noWatermark: true },
      });
      if (!user) return false;
      if (this.isPrivilegedAdminRole(user.role) || user.noWatermark === true) {
        return true;
      }

      const { plan } = await resolveEffectiveMembershipPlan(this.prisma, normalizedUserId);
      return Boolean(plan);
    } catch (error) {
      this.logger.warn(
        `检查免水印权益失败，按需加水印处理: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  private isPrivilegedAdminRole(role: unknown): boolean {
    const normalized = typeof role === 'string' ? role.trim().toLowerCase() : '';
    return normalized.length > 0 && PRIVILEGED_ADMIN_ROLES.has(normalized);
  }
}
