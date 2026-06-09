/** 主站（默认租户）固定 id */
export const PLATFORM_TENANT_ID = 'default';
/** CLS 中存当前租户 id 的 key */
export const CLS_TENANT_KEY = 'tenantId';
/** CLS 中标记「平台态/逃生舱」的 key —— 为 true 时 Prisma 扩展不注入 tenantId */
export const CLS_PLATFORM_MODE_KEY = 'platformMode';
/**
 * 全局白名单 model（Prisma model 名）。这些表不做租户注入。
 */
export const TENANT_GLOBAL_MODELS: ReadonlySet<string> = new Set([
  'Tenant', 'TenantDomain', 'SystemSetting', 'NodeConfig', 'PublicTemplate',
  'CreditPricing', 'CreditPackage', 'MembershipPlan', 'CreditConsumePolicy', 'postgres_log',
]);
