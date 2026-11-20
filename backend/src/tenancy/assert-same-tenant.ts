import { ForbiddenException } from '@nestjs/common';

/**
 * 写入涉及跨实体引用时（如 TeamProjectShare(projectId, teamId)、按 metadata.teamId
 * 创建 TeamSeatPackage），用此断言被引用实体与当前租户一致。
 *
 * Prisma 租户扩展只保证「写入行自身的 tenantId」，不校验 connect/外键引用的实体所属租户；
 * 配合本断言堵住跨租户拼接（codex#6）。注意：被引用实体应在「当前租户上下文」内查出，
 * 这样扩展已把它限定在本租户，传入 null/异租户即拒绝。
 */
export function assertSameTenant(
  currentTenantId: string,
  entity: { tenantId: string } | null | undefined,
  label: string,
): void {
  if (!entity || entity.tenantId !== currentTenantId) {
    throw new ForbiddenException(`跨租户引用被拒绝: ${label}`);
  }
}
