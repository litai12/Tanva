import { fetchWithAuth } from "./authFetch";

// 后端基础地址（可通过 .env 的 VITE_API_BASE_URL 覆盖）
const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  "http://localhost:4000";

// 拼接基础地址，保证只有一个斜杠
const buildUrl = (path: string) => {
  const base = API_BASE.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return `${base}/${p}`;
};

const JSON_HEADERS = { "Content-Type": "application/json" };
const CREDITS_PER_YUAN = 100;

async function request(path: string, options: RequestInit = {}) {
  const response = await fetchWithAuth(buildUrl(path), options);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "请求失败");
  }
  return response;
}

export interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  dailyActiveUsers: number;
  onlineUsers: number;
  todayRegisteredUsers: number;
  totalCreditsInCirculation: number;
  totalCreditsSpent: number;
  totalApiCalls: number;
  successfulApiCalls: number;
  failedApiCalls: number;
  generatedAt: string;
  userTrend: Array<{
    date: string;
    registeredUsers: number;
    dailyActiveUsers: number;
  }>;
}

export interface UserWithCredits {
  id: string;
  email: string | null;
  phone: string;
  name: string | null;
  role: string;
  status: string;
  wechatBound: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  creditBalance: number;
  totalSpent: number;
  totalEarned: number;
  apiCallCount: number;
}

export interface CreateAdminUserPayload {
  phone: string;
  password: string;
  name: string;
  email?: string;
}

export interface ApiUsageStats {
  serviceType: string;
  serviceName: string;
  provider: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalCreditsUsed: number;
  userCount: number;
  topUsers: Array<{
    userId: string;
    userName: string | null;
    userPhone: string;
    userEmail: string | null;
    callCount: number;
  }>;
}

export interface ApiUsageModelTopUser {
  userId: string;
  userName: string | null;
  userPhone: string;
  userEmail: string | null;
  callCount: number;
  successfulCalls: number;
  failedCalls: number;
  pendingCalls: number;
  totalCreditsUsed: number;
}

export interface ApiUsageModelChannelStats {
  channel: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  pendingCalls: number;
  totalCreditsUsed: number;
  userCount: number;
}

export interface ApiUsageModelStats {
  modelNode: string;
  modelName: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  pendingCalls: number;
  successRate: number;
  totalCreditsUsed: number;
  userCount: number;
  serviceTypes: string[];
  providers: string[];
  models: string[];
  channels: ApiUsageModelChannelStats[];
  topUsers: ApiUsageModelTopUser[];
}

export interface ApiUsageModelStatsResponse {
  items: ApiUsageModelStats[];
  summary: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    pendingCalls: number;
    totalCreditsUsed: number;
    uniqueUsers: number;
  };
  modelNodes: Array<{ key: string; name: string }>;
  channels: string[];
}

export interface ApiUsageRecord {
  id: string;
  userId: string;
  serviceType: string;
  serviceName: string;
  provider: string;
  model: string | null;
  requestParams?: {
    channel?: string | null;
    platformKey?: string | null;
    vendorKey?: string | null;
    providerChannel?: string | null;
    executionChannel?: string | null;
    channelHint?: string | null;
    routedProvider?: string | null;
    taskId?: string | null;
    [key: string]: unknown;
  } | null;
  creditsUsed: number;
  inputTokens: number | null;
  outputTokens: number | null;
  inputImageCount: number | null;
  outputImageCount: number | null;
  responseStatus: string;
  errorMessage: string | null;
  processingTime: number | null;
  createdAt: string;
  user?: {
    id: string;
    phone: string;
    name: string | null;
    email: string | null;
  };
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiUsageRecordsSummary {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  pendingCalls: number;
  totalCreditsUsed: number;
  successfulCredits: number;
  pendingCredits: number;
  refundedCredits: number;
  rawCreditsRecorded: number;
  inputTokens: number;
  outputTokens: number;
  uniqueUsers: number;
  averageProcessingTime: number | null;
}

export interface ApiUsageFilterOption {
  value: string;
  label: string;
  source: "credit-transactions" | "usage";
  count?: number;
}

export interface ApiUsageFilterOptions {
  providers: ApiUsageFilterOption[];
  models: ApiUsageFilterOption[];
  sources: string[];
}

export interface UserCreditsInfo {
  balance: number;
  totalEarned: number;
  totalSpent: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}


// 获取管理后台统计数据
export async function getDashboardStats(): Promise<DashboardStats> {
  const response = await request("/api/admin/dashboard");
  return response.json();
}

// 获取用户列表
export async function getUsers(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}): Promise<{ users: UserWithCredits[]; pagination: Pagination }> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set("page", String(params.page));
  if (params.pageSize) searchParams.set("pageSize", String(params.pageSize));
  if (params.search) searchParams.set("search", params.search);
  if (params.sortBy) searchParams.set("sortBy", params.sortBy);
  if (params.sortOrder) searchParams.set("sortOrder", params.sortOrder);

  const response = await request(`/api/admin/users?${searchParams}`);
  return response.json();
}

// 获取用户详情
export async function createAdminUser(payload: CreateAdminUserPayload): Promise<UserWithCredits> {
  const response = await request("/api/admin/users", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  return response.json();
}

export async function getUserDetail(userId: string) {
  const response = await request(`/api/admin/users/${userId}`);
  return response.json();
}

// 更新用户状态
export async function updateUserStatus(userId: string, status: string) {
  const response = await request(`/api/admin/users/${userId}/status`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ status }),
  });
  return response.json();
}

// 更新用户角色
export async function updateUserRole(userId: string, role: string) {
  const response = await request(`/api/admin/users/${userId}/role`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ role }),
  });
  return response.json();
}

// 删除用户账号
export async function deleteUserAccount(userId: string) {
  const response = await request(`/api/admin/users/${userId}`, {
    method: "DELETE",
  });
  return response.json();
}

export async function unbindUserWechat(userId: string) {
  const response = await request(`/api/admin/users/${userId}/unbind-wechat`, {
    method: "POST",
  });
  return response.json();
}

// 为用户添加积分
export async function addCredits(
  userId: string,
  amount: number,
  description: string
) {
  const response = await request(`/api/admin/users/${userId}/credits/add`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ amount, description }),
  });
  return response.json();
}

// 扣除用户积分
export async function deductCredits(
  userId: string,
  amount: number,
  description: string
) {
  const response = await request(`/api/admin/users/${userId}/credits/deduct`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ amount, description }),
  });
  return response.json();
}

export interface AdminUserCreditTransaction {
  id: string;
  type: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
  businessType?: string | null;
  membershipPlanId?: string | null;
  apiUsageId?: string | null;
  serviceType?: string | null;
  channel?: string | null;
  provider?: string | null;
  model?: string | null;
  outputImageCount?: number | null;
  parallelGroupId?: string | null;
  parallelGroupIndex?: number | null;
  parallelGroupTotal?: number | null;
  billingRemark?: string | null;
  apiResponseStatus?: string | null;
  processingTime?: number | null;
}

export interface UserCreditTransaction extends AdminUserCreditTransaction {}

export async function getAdminUserCreditTransactions(
  userId: string,
  params?: {
    page?: number;
    pageSize?: number;
    type?: string;
  }
): Promise<{ transactions: AdminUserCreditTransaction[]; pagination: Pagination }> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.pageSize) searchParams.set("pageSize", String(params.pageSize));
  if (params?.type) searchParams.set("type", params.type);

  const response = await request(
    `/api/admin/users/${userId}/credits/transactions?${searchParams}`
  );
  return response.json();
}

// 获取 API 使用统计
export async function getApiUsageStats(params?: {
  startDate?: string;
  endDate?: string;
}): Promise<ApiUsageStats[]> {
  const searchParams = new URLSearchParams();
  if (params?.startDate) searchParams.set("startDate", params.startDate);
  if (params?.endDate) searchParams.set("endDate", params.endDate);

  const response = await request(`/api/admin/api-usage/stats?${searchParams}`);
  return response.json();
}

// 获取模型用量监测统计
export async function getApiUsageModelStats(params?: {
  startDate?: string;
  endDate?: string;
  modelNode?: string;
  channel?: string;
}): Promise<ApiUsageModelStatsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.startDate) searchParams.set("startDate", params.startDate);
  if (params?.endDate) searchParams.set("endDate", params.endDate);
  if (params?.modelNode) searchParams.set("modelNode", params.modelNode);
  if (params?.channel) searchParams.set("channel", params.channel);

  const response = await request(`/api/admin/api-usage/model-stats?${searchParams}`);
  return response.json();
}

export async function getApiUsageRecords(params: {
  page?: number;
  pageSize?: number;
  userId?: string;
  userSearch?: string;
  serviceType?: string;
  provider?: string;
  model?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}): Promise<{ records: ApiUsageRecord[]; summary: ApiUsageRecordsSummary; pagination: Pagination }> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set("page", String(params.page));
  if (params.pageSize) searchParams.set("pageSize", String(params.pageSize));
  if (params.userId) searchParams.set("userId", params.userId);
  if (params.userSearch) searchParams.set("userSearch", params.userSearch);
  if (params.serviceType) searchParams.set("serviceType", params.serviceType);
  if (params.provider) searchParams.set("provider", params.provider);
  if (params.model) searchParams.set("model", params.model);
  if (params.status) searchParams.set("status", params.status);
  if (params.startDate) searchParams.set("startDate", params.startDate);
  if (params.endDate) searchParams.set("endDate", params.endDate);

  const response = await request(
    `/api/admin/api-usage/records?${searchParams}`
  );
  return response.json();
}

// 获取服务定价
export async function getApiUsageFilterOptions(): Promise<ApiUsageFilterOptions> {
  const response = await request("/api/admin/api-usage/filter-options");
  return response.json();
}

export async function getPricing() {
  const response = await request("/api/admin/pricing");
  return response.json();
}

export interface ManagedPricingCatalogCondition {
  field: string;
  op: string;
  value?: unknown;
}

export interface ManagedPricingCatalogRule {
  ruleKey?: string;
  label?: string;
  priority?: number;
  evaluatorKey?: string;
  evaluatorType?: string;
  formula?: string;
  conditions: {
    all: ManagedPricingCatalogCondition[];
    any: ManagedPricingCatalogCondition[];
  };
}

export interface ManagedPricingCatalogDimension {
  key: string;
  label?: string;
  type?: string;
  required?: boolean;
  description?: string;
  options?: Array<{
    value: string | number | boolean;
    label?: string;
  }>;
}

export interface ManagedPricingCatalogVendor {
  vendorKey: string;
  label?: string;
  provider?: string;
  platformKey?: string;
  enabled: boolean;
  creditsPerCall?: number;
  priceYuan?: number;
  pricingVersion?: string;
  defaultPrice: {
    credits?: number;
    priceYuan?: number;
    costYuan?: number;
  };
  dimensions: ManagedPricingCatalogDimension[];
  rules: ManagedPricingCatalogRule[];
}

export interface ManagedPricingCatalogItem {
  modelKey: string;
  modelName?: string;
  taskType?: string;
  enabled: boolean;
  defaultVendor?: string;
  vendors: ManagedPricingCatalogVendor[];
}

export async function getManagedPricingCatalog(params?: {
  modelKey?: string;
}): Promise<ManagedPricingCatalogItem[]> {
  const searchParams = new URLSearchParams();
  if (params?.modelKey) searchParams.set("modelKey", params.modelKey);
  const suffix = searchParams.toString() ? `?${searchParams}` : "";
  const response = await request(`/api/credits/pricing/models${suffix}`);
  return response.json();
}

// 获取用户积分信息（用户自己）
export async function getMyCredits(): Promise<UserCreditsInfo> {
  const response = await request("/api/credits/balance");
  return response.json();
}

// 获取用户交易记录（用户自己）
export async function getMyTransactions(params?: {
  page?: number;
  pageSize?: number;
  type?: string;
}): Promise<{ transactions: UserCreditTransaction[]; pagination: Pagination }> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.pageSize) searchParams.set("pageSize", String(params.pageSize));
  if (params?.type) searchParams.set("type", params.type);

  const response = await request(`/api/credits/transactions?${searchParams}`);
  return response.json();
}

// 获取用户 API 使用记录（用户自己）
export async function getMyApiUsage(params?: {
  page?: number;
  pageSize?: number;
  serviceType?: string;
  provider?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}) {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.pageSize) searchParams.set("pageSize", String(params.pageSize));
  if (params?.serviceType) searchParams.set("serviceType", params.serviceType);
  if (params?.provider) searchParams.set("provider", params.provider);
  if (params?.status) searchParams.set("status", params.status);
  if (params?.startDate) searchParams.set("startDate", params.startDate);
  if (params?.endDate) searchParams.set("endDate", params.endDate);

  const response = await request(`/api/credits/usage?${searchParams}`);
  return response.json();
}

export interface ClaimDailyRewardResult {
  success: boolean;
  newBalance: number;
  transactionId: string;
  alreadyClaimed?: boolean;
  expiresAt?: string | null;
  consecutiveDays?: number;
  bonusCredits?: number;
  baseCredits?: number;
  rewardMultiplier?: number;
  tierCode?: string;
}

export interface ExpiringCreditsInfo {
  totalExpiring: number;
  expiringDetails: Array<{ amount: number; expiresAt: string }>;
  isPaidUser: boolean;
}

export interface CheckInCalendar {
  consecutiveDays: number;
  lastCheckInDate: string | null;
  todayCheckedIn: boolean;
  calendarDays: Array<{ day: number; checked: boolean; missed: boolean; isToday: boolean }>;
}

export interface DailyRewardStatus {
  canClaim: boolean;
  lastClaimAt: string | null;
  tierCode?: string;
  todayRewardCredits?: number;
  rewardMultiplier?: number;
}

export async function getDailyRewardStatus(): Promise<DailyRewardStatus> {
  const response = await request("/api/credits/daily-reward/status");
  return response.json();
}

export async function claimDailyReward(): Promise<ClaimDailyRewardResult> {
  const response = await request("/api/credits/daily-reward/claim", {
    method: "POST",
  });
  return response.json();
}

export async function getExpiringCredits(): Promise<ExpiringCreditsInfo> {
  const response = await request("/api/credits/expiring");
  return response.json();
}

export async function getCheckInCalendar(): Promise<CheckInCalendar> {
  const response = await request("/api/credits/check-in/calendar");
  return response.json();
}

// 根据实际产出数量调整积分
export async function adjustCreditsByOutput(
  apiUsageId: string,
  actualOutputCount: number
): Promise<{ success: boolean; adjustedAmount: number; newBalance: number }> {
  const response = await request("/api/credits/adjust-by-output", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ apiUsageId, actualOutputCount }),
  });
  return response.json();
}

// ==================== 系统设置 ====================

export interface SystemSetting {
  id: string;
  key: string;
  value: string;
  description: string | null;
  metadata: Record<string, any> | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedPricingPreviewRequest {
  modelKey: string;
  vendorKey: string;
  context: Record<string, any>;
  pricing?: Record<string, any>;
  metadata?: Record<string, any>;
  creditsPerCall?: number;
  priceYuan?: number;
}

export interface ManagedPricingPreviewResponse {
  modelKey: string;
  vendorKey: string;
  pricingContext: Record<string, any>;
  matchedRuleKey?: string;
  label?: string;
  evaluatorKey?: string;
  evaluatorType?: string;
  pricingVersion?: string;
  price: {
    credits?: number;
    priceYuan?: number;
    costYuan?: number;
  };
  calcTrace?: Record<string, any>;
  source: string;
}

const asObject = (value: unknown): Record<string, any> | null => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  return null;
};

const toFiniteNumber = (value: unknown): number | undefined => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
};

const toCreditsByPriceYuan = (priceYuan: number | undefined): number | undefined => {
  if (!Number.isFinite(Number(priceYuan))) return undefined;
  return Math.ceil(Number(priceYuan) * CREDITS_PER_YUAN);
};

const normalizeComparableValue = (value: unknown): string | number | boolean | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const lowered = trimmed.toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && `${numeric}` === trimmed) return numeric;
    return lowered;
  }
  return null;
};

const matchesPreviewCondition = (
  actualContext: Record<string, any>,
  condition: { field?: string; op?: string; value?: any }
) => {
  const field = String(condition.field || "").trim();
  if (!field) return false;
  const actual = normalizeComparableValue(actualContext[field]);
  const op = String(condition.op || "eq").trim();

  if (op === "exists") {
    return actualContext[field] !== undefined && actualContext[field] !== null && actualContext[field] !== "";
  }
  if (actual === null) return false;

  const normalizedExpectedArray = Array.isArray(condition.value)
    ? condition.value.map((item) => normalizeComparableValue(item)).filter((item) => item !== null)
    : null;
  const normalizedExpected = normalizeComparableValue(condition.value);

  if (op === "in") return (normalizedExpectedArray || []).some((item) => item === actual);
  if (op === "eq") return normalizedExpected === actual;
  if (typeof actual !== "number") return false;

  const numericExpected = toFiniteNumber(condition.value);
  if (numericExpected === undefined) return false;
  if (op === "gt") return actual > numericExpected;
  if (op === "gte") return actual >= numericExpected;
  if (op === "lt") return actual < numericExpected;
  if (op === "lte") return actual <= numericExpected;
  return false;
};

const resolveLookupMatrixPrice = (
  matrix: Record<string, unknown>,
  axes: string[],
  context: Record<string, any>
): number | undefined => {
  let current: unknown = matrix;
  for (const axis of axes) {
    const axisValue = context[axis];
    const key = String(axisValue);
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : undefined;
};

const resolveLocalManagedPricingPreview = (
  data: ManagedPricingPreviewRequest
): ManagedPricingPreviewResponse => {
  const pricing = asObject(data.pricing);
  const matchingRules = Array.isArray(pricing?.matchingRules) ? pricing?.matchingRules : [];
  const evaluators = asObject(pricing?.evaluators) || {};
  const context = data.context || {};

  const activeRules = matchingRules
    .filter((rule) => rule && rule.enabled !== false && rule.ruleKey && rule.evaluatorKey)
    .sort((a, b) => (Number(b?.priority) || 0) - (Number(a?.priority) || 0));

  const matchedRule = activeRules.find((rule) => {
    const all = Array.isArray(rule.conditions?.all) ? rule.conditions.all : [];
    const any = Array.isArray(rule.conditions?.any) ? rule.conditions.any : [];
    const allOk = all.every((condition: { field?: string; op?: string; value?: any }) =>
      matchesPreviewCondition(context, condition)
    );
    const anyOk =
      any.length === 0 ||
      any.some((condition: { field?: string; op?: string; value?: any }) =>
        matchesPreviewCondition(context, condition)
      );
    return allOk && anyOk;
  });

  const resultBase = {
    modelKey: data.modelKey,
    vendorKey: data.vendorKey,
    pricingContext: context,
  };

  if (matchedRule) {
    const evaluatorKey = String(matchedRule.evaluatorKey || "").trim();
    const evaluator = evaluatorKey ? evaluators[evaluatorKey] : undefined;
    const evaluatorType = String(evaluator?.type || "").trim();

    if (evaluatorType === "linear") {
      const unitField = String(evaluator?.unitField || "").trim();
      const unitValue = toFiniteNumber(context[unitField]);
      const unitPriceYuan = toFiniteNumber(evaluator?.unitPriceYuan);
      if (unitField && unitValue !== undefined && unitPriceYuan !== undefined) {
        const priceYuan = Number((unitValue * unitPriceYuan).toFixed(3));
        return {
          ...resultBase,
          matchedRuleKey: matchedRule.ruleKey,
          label: matchedRule.label,
          evaluatorKey,
          evaluatorType,
          pricingVersion: String(pricing?.version || "v2"),
          price: { priceYuan, credits: toCreditsByPriceYuan(priceYuan) },
          calcTrace: { evaluatorType, unitField, unitValue, unitPriceYuan },
          source: "local_vendor_rule",
        };
      }
    }

    if (evaluatorType === "lookup_matrix") {
      const axes = Array.isArray(evaluator?.axes)
        ? evaluator.axes.map((item: unknown) => String(item).trim()).filter(Boolean)
        : [];
      const matrix = asObject(evaluator?.matrix);
      if (matrix && axes.length > 0) {
        const priceYuan = resolveLookupMatrixPrice(matrix, axes, context);
        if (priceYuan !== undefined) {
          return {
            ...resultBase,
            matchedRuleKey: matchedRule.ruleKey,
            label: matchedRule.label,
            evaluatorKey,
            evaluatorType,
            pricingVersion: String(pricing?.version || "v2"),
            price: { priceYuan, credits: toCreditsByPriceYuan(priceYuan) },
            calcTrace: { evaluatorType, axes },
            source: "local_vendor_rule",
          };
        }
      }
    }
  }

  const defaults = asObject(pricing?.defaults);
  const defaultPriceYuan =
    toFiniteNumber(defaults?.priceYuan) ?? toFiniteNumber(data.priceYuan);
  const defaultCredits =
    toFiniteNumber(defaults?.credits) ??
    toFiniteNumber(data.creditsPerCall) ??
    toCreditsByPriceYuan(defaultPriceYuan);

  return {
    ...resultBase,
    pricingVersion: String(pricing?.version || "v2"),
    price: {
      ...(defaultPriceYuan !== undefined ? { priceYuan: defaultPriceYuan } : {}),
      ...(defaultCredits !== undefined ? { credits: defaultCredits } : {}),
    },
    source: defaultPriceYuan !== undefined || defaultCredits !== undefined ? "local_vendor_default" : "none",
  };
};

// 获取所有系统设置
export async function getSettings(): Promise<SystemSetting[]> {
  const response = await request("/api/admin/settings");
  return response.json();
}

// 获取单个系统设置
export async function getSetting(key: string): Promise<SystemSetting> {
  const response = await request(`/api/admin/settings/${key}`);
  return response.json();
}

// 创建或更新系统设置
export async function upsertSetting(data: {
  key: string;
  value: string;
  description?: string;
  metadata?: Record<string, any>;
}): Promise<SystemSetting> {
  const response = await request("/api/admin/settings", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
  return response.json();
}

export async function previewManagedPricing(
  data: ManagedPricingPreviewRequest
): Promise<ManagedPricingPreviewResponse> {
  const response = await fetchWithAuth(buildUrl("/api/admin/pricing/preview"), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
  if (response.ok) {
    return response.json();
  }

  const errorText = await response.text().catch(() => "");
  const shouldFallback =
    response.status === 404 ||
    /Cannot POST/i.test(errorText) ||
    /Not Found/i.test(errorText);

  if (shouldFallback) {
    return resolveLocalManagedPricingPreview(data);
  }

  let errorMessage = "请求失败";
  try {
    const parsed = errorText ? JSON.parse(errorText) : null;
    errorMessage = parsed?.message || errorMessage;
  } catch {
    if (errorText.trim()) errorMessage = errorText.trim();
  }
  throw new Error(errorMessage);
}

export interface MembershipCreditPolicyConfig {
  dailyGiftDecayCredits: number;
  fixedCreditExpireDays: number;
  freeUserMonthlyQuotaCredits: number;
  dailyRewardCredits: number;
  consecutive7DayRewardMultiplier: number;
  membershipRefreshCycleDays: number;
}

export interface MembershipCreditPolicyView {
  settingKey: string;
  defaults: MembershipCreditPolicyConfig;
  effective: MembershipCreditPolicyConfig;
  rawValue: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  description: string;
}

export async function getMembershipCreditPolicy(): Promise<MembershipCreditPolicyView> {
  const response = await request("/api/admin/membership-credit-policy");
  return response.json();
}

export async function updateMembershipCreditPolicy(
  data: Partial<MembershipCreditPolicyConfig>
): Promise<MembershipCreditPolicyView> {
  const response = await request("/api/admin/membership-credit-policy", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
  return response.json();
}

export interface AdminMembershipPlan {
  id: string;
  code: string;
  name: string;
  billingCycle: "monthly" | "yearly";
  price: number | string;
  monthlyQuotaCredits: number;
  signupBonusCredits: number;
  dailyGiftCredits: number;
  isActive: boolean;
  sortOrder: number;
  metadata: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

export async function getAdminMembershipPlans(): Promise<AdminMembershipPlan[]> {
  const response = await request("/api/admin/membership-plans");
  return response.json();
}

export async function createAdminMembershipPlan(
  data: Omit<AdminMembershipPlan, "id" | "createdAt" | "updatedAt" | "price"> & { price: number }
): Promise<AdminMembershipPlan> {
  const response = await request("/api/admin/membership-plans", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
  return response.json();
}

export async function updateAdminMembershipPlan(
  id: string,
  data: Partial<Omit<AdminMembershipPlan, "id" | "createdAt" | "updatedAt" | "price">> & { price?: number }
): Promise<AdminMembershipPlan> {
  const response = await request(`/api/admin/membership-plans/${id}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
  return response.json();
}

// ==================== 支付相关 ====================

export type PaymentMethod = "alipay" | "wechat";
export type PaymentStatus = "pending" | "paid" | "failed" | "expired" | "cancelled";

export interface PaymentOrderResponse {
  orderId: string;
  orderNo: string;
  amount: number;
  credits: number;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  qrCodeUrl: string | null;
  expiredAt: string;
  createdAt: string;
}

export interface PaymentStatusResponse {
  orderNo: string;
  status: PaymentStatus;
  paidAt: string | null;
  credits: number;
  orderType?: "recharge" | "membership";
  membershipPlanId?: string | null;
  subscriptionId?: string | null;
}

// 创建支付订单
export async function createPaymentOrder(data: {
  amount: number;
  credits: number;
  paymentMethod: PaymentMethod;
}): Promise<PaymentOrderResponse> {
  const response = await request("/api/payment/order", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
  return response.json();
}

// 查询订单状态
export async function getPaymentStatus(
  orderNo: string
): Promise<PaymentStatusResponse> {
  const response = await request(`/api/payment/order/${orderNo}/status`);
  return response.json();
}

// 确认支付完成
export async function confirmPayment(
  orderNo: string
): Promise<{ success: boolean; credits: number; newBalance: number }> {
  const response = await request(`/api/payment/order/${orderNo}/confirm`, {
    method: "POST",
  });
  return response.json();
}

// 订单记录
export interface PaymentOrderRecord {
  orderId: string;
  orderNo: string;
  amount: number;
  credits: number;
  paymentMethod: string;
  orderType?: "recharge" | "membership";
  businessCode?: string | null;
  planName?: string | null;
  membershipPlanId?: string | null;
  subscriptionId?: string | null;
  status: PaymentStatus;
  paidAt: string | null;
  createdAt: string;
}

// 获取用户订单列表
export async function getPaymentOrders(params?: {
  page?: number;
  pageSize?: number;
}): Promise<{ orders: PaymentOrderRecord[]; pagination: Pagination }> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.pageSize) searchParams.set("pageSize", String(params.pageSize));

  const response = await request(`/api/payment/orders?${searchParams}`);
  return response.json();
}

// 套餐配置
export interface RechargePackage {
  price: number;
  credits: number;
  bonus: string | null;
  tag: string | null;
  isFirstRecharge: boolean;
}

export interface PackagesResponse {
  packages: RechargePackage[];
  creditsPerYuan: number;
}

// 获取充值套餐
export async function getPaymentPackages(): Promise<PackagesResponse> {
  const response = await request("/api/payment/packages");
  return response.json();
}

export interface PaymentMembershipPlan {
  id: string;
  code: string;
  name: string;
  billingCycle: "monthly" | "yearly";
  price: number;
  monthlyQuotaCredits: number;
  signupBonusCredits: number;
  dailyGiftCredits: number;
  sortOrder: number;
  metadata: Record<string, any> | null;
}

export async function getPaymentMembershipPlans(): Promise<{ plans: PaymentMembershipPlan[] }> {
  const response = await request("/api/payment/membership-plans");
  return response.json();
}

export interface MembershipCurrentResponse {
  subscription: {
    id: string;
    status: string;
    periodType: string;
    currentPeriodStartAt: string;
    currentPeriodEndAt: string;
    activatedAt: string | null;
    renewalCount: number;
    lastOrderId: string | null;
  } | null;
  plan: {
    id: string;
    code: string;
    name: string;
    billingCycle: string;
    price: number;
    monthlyQuotaCredits: number;
    signupBonusCredits: number;
    dailyGiftCredits: number;
    metadata: Record<string, any> | null;
  } | null;
  nextChange: MembershipNextChange | null;
  entitlement: {
    currentPlanCode: string;
    membershipStatus: string;
    currentPeriodStartAt: string | null;
    currentPeriodEndAt: string | null;
    pauseGiftDecay: boolean;
    hasActiveSubscription: boolean;
  };
}

export interface MembershipMeResponse {
  planCode: string;
  membershipStatus: string;
  currentPeriodStartAt: string | null;
  currentPeriodEndAt: string | null;
  benefits: {
    pauseGiftDecay: boolean;
  };
  balances: {
    subscriptionCredits: number;
    giftCredits: number;
    fixedCredits: number;
    totalCredits: number;
  };
  quotas: {
    inviteLimit: number | null;
    imageDailyLimit: number | null;
    videoDailyLimit: number | null;
  };
  nextChange: MembershipNextChange | null;
  current: MembershipCurrentResponse;
}

export interface MembershipNextChange {
  id: string;
  targetPlanId: string;
  targetPlanCode: string;
  targetPlanName: string;
  targetBillingCycle: "monthly" | "yearly";
  changeType: string;
  effectiveMode: string;
  status: string;
  reason: string | null;
  effectiveAt: string;
  currentPeriodEndAt: string | null;
  createdAt: string;
}

export async function getMembershipMe(): Promise<MembershipMeResponse> {
  const response = await request("/api/membership/me");
  return response.json();
}

export async function getMembershipCurrent(): Promise<MembershipCurrentResponse> {
  const response = await request("/api/membership/current");
  return response.json();
}

export interface Seedance2AccessResponse {
  allowed: boolean;
  byVip: boolean;
  byWhitelist: boolean;
  byAdmin: boolean;
}

export async function getSeedance2Access(): Promise<Seedance2AccessResponse> {
  const response = await request("/api/ai/seedance2/access");
  return response.json();
}

export interface MembershipTransitionPreview {
  actionType: "subscribe" | "renew" | "upgrade" | "downgrade";
  effectiveMode: "immediate" | "next_cycle";
  payableAmount: number;
  immediateCreditDelta: number;
  remainingRatio: number;
  targetPlan: {
    id: string;
    code: string;
    name: string;
    billingCycle: "monthly" | "yearly";
    price: number;
  };
  currentPlan: {
    id: string;
    code: string;
    name: string;
    billingCycle: "monthly" | "yearly";
    price: number;
  } | null;
  nextEffectiveAt?: string;
}

export async function getMembershipTransitionPreview(planCode: string): Promise<MembershipTransitionPreview> {
  const searchParams = new URLSearchParams({ planCode });
  const response = await request(`/api/membership/transition-preview?${searchParams}`);
  return response.json();
}

export async function scheduleMembershipPlanChange(planCode: string): Promise<{
  success: boolean;
  nextChangeId: string;
  effectiveAt: string;
}> {
  const response = await request("/api/membership/change-plan", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ planCode }),
  });
  return response.json();
}

export async function createMembershipOrder(data: {
  planCode: string;
  paymentMethod: PaymentMethod;
}): Promise<PaymentOrderResponse> {
  const response = await request("/api/membership/orders", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
  return response.json();
}

export interface MembershipOrderRecord {
  orderId: string;
  orderNo: string;
  planCode: string;
  amount: number;
  credits: number;
  paymentMethod: string;
  orderType: "membership" | "recharge";
  membershipPlanId: string | null;
  subscriptionId: string | null;
  planName?: string | null;
  status: PaymentStatus;
  paidAt: string | null;
  createdAt: string;
}

export async function getMembershipOrders(params?: {
  page?: number;
  pageSize?: number;
  includeRecharge?: boolean;
}): Promise<{ items: MembershipOrderRecord[]; page: number; pageSize: number; total: number }> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.pageSize) searchParams.set("pageSize", String(params.pageSize));
  if (params?.includeRecharge !== undefined) {
    searchParams.set("includeRecharge", params.includeRecharge ? "true" : "false");
  }
  const response = await request(`/api/membership/orders?${searchParams}`);
  return response.json();
}

export interface AdminMembershipStateResponse {
  userId: string;
  current: MembershipCurrentResponse;
  nextChange: MembershipNextChange | null;
  balances: MembershipMeResponse["balances"];
  benefits: MembershipMeResponse["benefits"];
}

export async function getAdminUserMembershipState(userId: string): Promise<AdminMembershipStateResponse> {
  const response = await request(`/api/admin/users/${userId}/membership`);
  return response.json();
}

export async function adminExpireUserMembershipNow(userId: string, reason?: string) {
  const response = await request(`/api/admin/users/${userId}/membership/expire`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ reason }),
  });
  return response.json();
}

export async function adminAdjustUserMembershipPeriod(userId: string, days: number, reason?: string) {
  const response = await request(`/api/admin/users/${userId}/membership/adjust-period`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ days, reason }),
  });
  return response.json();
}

export async function adminChangeUserMembershipPlan(data: {
  userId: string;
  planCode: string;
  effectiveMode: "immediate" | "next_cycle";
  reason?: string;
}) {
  const response = await request(`/api/admin/users/${data.userId}/membership/change-plan`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      planCode: data.planCode,
      effectiveMode: data.effectiveMode,
      reason: data.reason,
    }),
  });
  return response.json();
}

export async function getAdminUserMembershipTransitionPreview(userId: string, planCode: string) {
  const searchParams = new URLSearchParams({ planCode });
  const response = await request(`/api/admin/users/${userId}/membership/transition-preview?${searchParams}`);
  return response.json();
}

export async function adminApplyScheduledMembershipChanges() {
  const response = await request("/api/admin/membership/ops/apply-scheduled-changes", {
    method: "POST",
  });
  return response.json();
}

export async function adminExpireMembershipScan() {
  const response = await request("/api/admin/membership/ops/expire-scan", {
    method: "POST",
  });
  return response.json();
}

export async function adminIssueDailyMembershipGifts() {
  const response = await request("/api/admin/membership/ops/issue-daily-gifts", {
    method: "POST",
  });
  return response.json();
}

export async function adminDecayMembershipGifts() {
  const response = await request("/api/admin/membership/ops/decay-gifts", {
    method: "POST",
  });
  return response.json();
}

export async function adminRefreshYearlyMembershipQuota() {
  const response = await request("/api/admin/membership/ops/refresh-yearly-quota", {
    method: "POST",
  });
  return response.json();
}

// ==================== 水印白名单 ====================

export interface WatermarkWhitelistUser {
  id: string;
  phone: string;
  email: string | null;
  name: string | null;
  noWatermark: boolean;
  createdAt: string;
}

// 获取水印白名单用户列表
export async function getWatermarkWhitelist(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
}): Promise<{ users: WatermarkWhitelistUser[]; pagination: Pagination }> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.pageSize) searchParams.set("pageSize", String(params.pageSize));
  if (params?.search) searchParams.set("search", params.search);

  const response = await request(`/api/admin/watermark-whitelist?${searchParams}`);
  return response.json();
}

// 添加用户到水印白名单
export async function addToWatermarkWhitelist(userId: string) {
  const response = await request(`/api/admin/watermark-whitelist/${userId}`, {
    method: "POST",
  });
  return response.json();
}

// 从水印白名单移除用户
export async function removeFromWatermarkWhitelist(userId: string) {
  const response = await request(`/api/admin/watermark-whitelist/${userId}`, {
    method: "DELETE",
  });
  return response.json();
}

// ==================== 付费用户管理 ====================

export interface PaidUser {
  id: string;
  phone: string;
  email: string | null;
  name: string | null;
  role: string;
  status: string;
  noWatermark: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  creditBalance: number;
  totalSpent: number;
  totalEarned: number;
  totalPaid: number;
  orderCount: number;
  lastPaidAt: string | null;
}

export type PaidUsersSortBy = "amount" | "registeredAt" | "paidAt";

// 获取付费用户列表
export async function getPaidUsers(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: PaidUsersSortBy;
  sortOrder?: "asc" | "desc";
}): Promise<{ users: PaidUser[]; pagination: Pagination }> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.pageSize) searchParams.set("pageSize", String(params.pageSize));
  if (params?.search) searchParams.set("search", params.search);
  if (params?.sortBy) searchParams.set("sortBy", params.sortBy);
  if (params?.sortOrder) searchParams.set("sortOrder", params.sortOrder);

  const response = await request(`/api/admin/paid-users?${searchParams}`);
  return response.json();
}

export type CreditRecordSource = "recharge" | "admin_add" | "admin_deduct";
export type CreditRecordFilterSource =
  | "all"
  | CreditRecordSource
  | "invite_reward"
  | "all_earned";

export interface CreditChangeRecord {
  id: string;
  source: CreditRecordSource;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
  user: {
    id: string;
    phone: string;
    email: string | null;
    name: string | null;
  };
  admin: {
    id: string;
    phone: string;
    email: string | null;
    name: string | null;
  } | null;
  payment: {
    id: string;
    orderNo: string;
    amount: number;
    paymentMethod: string;
    paidAt: string | null;
  } | null;
}

// 获取积分变更记录（充值 + 后台手动调整）
export async function getCreditChangeRecords(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  userId?: string;
  source?: CreditRecordFilterSource;
  startDate?: string;
  endDate?: string;
}): Promise<{ records: CreditChangeRecord[]; pagination: Pagination }> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.pageSize) searchParams.set("pageSize", String(params.pageSize));
  if (params?.search) searchParams.set("search", params.search);
  if (params?.userId) searchParams.set("userId", params.userId);
  if (params?.source) searchParams.set("source", params.source);
  if (params?.startDate) searchParams.set("startDate", params.startDate);
  if (params?.endDate) searchParams.set("endDate", params.endDate);

  const response = await request(`/api/admin/credit-change-records?${searchParams}`);
  return response.json();
}

export type CreditAnomalySeverity = "yellow" | "red" | "purple";

export interface CreditAnomalyRecord {
  id: string;
  accountId: string;
  userId: string;
  dayStart: string;
  dayLabel: string;
  totalAmount: number;
  maxSingleAmount: number;
  transactionCount: number;
  severity: CreditAnomalySeverity;
  sourceBreakdown: Array<{
    sourceKey: string;
    sourceLabel: string;
    amount: number;
    count: number;
  }>;
  firstTransactionAt: string;
  lastTransactionAt: string;
  detectedAt: string;
  updatedAt: string;
  user: {
    id: string;
    phone: string;
    email: string | null;
    name: string | null;
  };
}

export async function getCreditAnomalyRecords(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  userId?: string;
  severity?: CreditAnomalySeverity;
  startDate?: string;
  endDate?: string;
}): Promise<{ records: CreditAnomalyRecord[]; pagination: Pagination }> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.pageSize) searchParams.set("pageSize", String(params.pageSize));
  if (params?.search) searchParams.set("search", params.search);
  if (params?.userId) searchParams.set("userId", params.userId);
  if (params?.severity) searchParams.set("severity", params.severity);
  if (params?.startDate) searchParams.set("startDate", params.startDate);
  if (params?.endDate) searchParams.set("endDate", params.endDate);

  const response = await request(`/api/admin/credit-anomalies?${searchParams}`);
  return response.json();
}

// ==================== 节点配置管理 ====================

export interface NodeConfig {
  id?: string;
  nodeKey: string;
  nameZh: string;
  nameEn: string;
  category: string;
  status: string;
  statusMessage?: string;
  creditsPerCall: number;
  priceYuan?: number;
  serviceType?: string;
  sortOrder: number;
  isVisible: boolean;
  description?: string;
  metadata?: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
}

// 获取所有节点配置（管理员）
export async function getNodeConfigs(): Promise<NodeConfig[]> {
  const response = await request("/api/admin/node-configs");
  return response.json();
}

// 获取单个节点配置
export async function getNodeConfig(nodeKey: string): Promise<NodeConfig> {
  const response = await request(`/api/admin/node-configs/${nodeKey}`);
  return response.json();
}

// 创建节点配置
export async function createNodeConfig(data: Omit<NodeConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<NodeConfig> {
  const response = await request("/api/admin/node-configs", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
  return response.json();
}

// 更新节点配置
export async function updateNodeConfig(nodeKey: string, data: Partial<NodeConfig>): Promise<NodeConfig> {
  const response = await request(`/api/admin/node-configs/${nodeKey}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
  return response.json();
}

// 删除节点配置
export async function deleteNodeConfig(nodeKey: string): Promise<{ success: boolean }> {
  const response = await request(`/api/admin/node-configs/${nodeKey}`, {
    method: "DELETE",
  });
  return response.json();
}

// 强制同步节点配置到后端默认模板（用于模型管理路线切换后刷新节点参数）
export async function syncNodeConfigs(): Promise<{ created: number; updated: number }> {
  const response = await request("/api/admin/node-configs/sync", {
    method: "POST",
  });
  return response.json();
}

export async function listVolcReviewGroups() {
  const response = await request("/api/admin/volc-review/groups");
  return response.json() as Promise<{ id: string; date: string; groupId: string; createdAt: string }[]>;
}

export async function cleanupVolcReviewGroup(date?: string) {
  const response = await request("/api/admin/volc-review/cleanup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date }),
  });
  return response.json() as Promise<{ date: string; deleted: boolean }>;
}

export interface AdminOrder {
  id: string;
  orderNo: string;
  userId: string;
  userPhone: string | null;
  userEmail: string | null;
  userName: string | null;
  orderType: string;
  amount: number;
  credits: number;
  paymentMethod: string;
  status: string;
  tradeNo: string | null;
  paidAt: string | null;
  expiredAt: string | null;
  createdAt: string;
}

export async function syncAdminOrder(orderNo: string): Promise<{ synced: boolean; status: string }> {
  const response = await request(`/api/payment/admin/orders/${orderNo}/sync`, { method: "POST" });
  return response.json();
}

export async function getAdminOrders(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  paymentMethod?: string;
  orderType?: string;
  startDate?: string;
  endDate?: string;
}): Promise<{ orders: AdminOrder[]; pagination: Pagination }> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.pageSize) searchParams.set("pageSize", String(params.pageSize));
  if (params?.search) searchParams.set("search", params.search);
  if (params?.status) searchParams.set("status", params.status);
  if (params?.paymentMethod) searchParams.set("paymentMethod", params.paymentMethod);
  if (params?.orderType) searchParams.set("orderType", params.orderType);
  if (params?.startDate) searchParams.set("startDate", params.startDate);
  if (params?.endDate) searchParams.set("endDate", params.endDate);
  const response = await request(`/api/admin/orders?${searchParams}`);
  return response.json();
}

// ── 团队管理 ──────────────────────────────────────────────────

export interface AdminTeamItem {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  memberCount: number;
  /** 席位容量（唯一口径）：永久席位 + 有效席位包 */
  seatCapacity: number;
  status: string;
  availableCredits: number;
  totalCredits: number;
  createdAt: string;
}

export async function adminGetTeams(params?: {
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ teams: AdminTeamItem[]; pagination: Pagination }> {
  const searchParams = new URLSearchParams();
  if (params?.search) searchParams.set("search", params.search);
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.pageSize) searchParams.set("pageSize", String(params.pageSize));
  const suffix = searchParams.toString() ? `?${searchParams}` : "";
  const response = await request(`/api/admin/teams${suffix}`);
  return response.json();
}

export async function adminAddTeamCredits(
  teamId: string,
  amount: number,
  description: string,
): Promise<{ teamId: string; addedCredits: number }> {
  const response = await request(`/api/admin/teams/${teamId}/credits/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount, description }),
  });
  return response.json();
}

export async function adminDeductTeamCredits(
  teamId: string,
  amount: number,
  description: string,
): Promise<{ teamId: string; deductedCredits: number }> {
  const response = await request(`/api/admin/teams/${teamId}/credits/deduct`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount, description }),
  });
  return response.json();
}

export async function adminUpdateTeamStatus(
  teamId: string,
  status: string,
): Promise<void> {
  await request(`/api/admin/teams/${teamId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export async function adminUpdateTeamSeats(
  teamId: string,
  maxSeats: number,
): Promise<void> {
  await request(`/api/admin/teams/${teamId}/seats`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ maxSeats }),
  });
}

export async function adminDeleteTeam(teamId: string): Promise<void> {
  await request(`/api/admin/teams/${teamId}`, { method: "DELETE" });
}

export async function adminGetTeamCreditHistory(
  teamId: string,
  page = 1,
  pageSize = 30,
): Promise<{ records: any[]; pagination: Pagination }> {
  const response = await request(
    `/api/admin/teams/${teamId}/credits/history?page=${page}&pageSize=${pageSize}`,
  );
  return response.json();
}
