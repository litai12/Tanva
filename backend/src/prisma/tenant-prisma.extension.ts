import { Prisma } from '@prisma/client';
import { TENANT_GLOBAL_MODELS } from '../tenancy/tenant.constants';

export interface TenantCtx {
  tenantId: string;
  isPlatform: boolean;
}

/** 这些操作按 where 过滤当前租户 */
const WHERE_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

/**
 * 纯函数：根据 model / operation / ctx 决定如何注入 tenantId。
 * 抽出来便于单测，不依赖 Prisma client / CLS。
 */
export function buildTenantArgs(
  model: string,
  operation: string,
  args: any,
  ctx: TenantCtx,
): any {
  const next = { ...(args ?? {}) };
  if (ctx.isPlatform) return next; // 逃生舱：平台态不注入
  if (TENANT_GLOBAL_MODELS.has(model)) return next; // 白名单：不注入

  const t = ctx.tenantId;
  if (operation === 'create') {
    next.data = { ...(next.data ?? {}), tenantId: t };
  } else if (operation === 'createMany') {
    const data = next.data;
    next.data = Array.isArray(data)
      ? data.map((d: any) => ({ ...d, tenantId: t }))
      : { ...(data ?? {}), tenantId: t };
  } else if (operation === 'upsert') {
    next.where = { ...(next.where ?? {}), tenantId: t };
    next.create = { ...(next.create ?? {}), tenantId: t };
    next.update = { ...(next.update ?? {}), tenantId: t };
  } else if (WHERE_OPS.has(operation)) {
    next.where = { ...(next.where ?? {}), tenantId: t };
  }
  return next;
}

/**
 * 构造 Prisma client 扩展。getCtx 在每次查询时从 CLS 读当前租户上下文。
 */
export function createTenantExtension(getCtx: () => TenantCtx) {
  return Prisma.defineExtension({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const ctx = getCtx();
          return query(buildTenantArgs(model as string, operation, args, ctx));
        },
      },
    },
  });
}
