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
  totalCreditsInCirculation: number;
  totalCreditsSpent: number;
  totalApiCalls: number;
  successfulApiCalls: number;
  failedApiCalls: number;
}

export interface UserWithCredits {
  id: string;
  email: string | null;
  phone: string;
  name: string | null;
  role: string;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  creditBalance: number;
  totalSpent: number;
  totalEarned: number;
  apiCallCount: number;
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

export interface ApiUsageRecord {
  id: string;
  userId: string;
  serviceType: string;
  serviceName: string;
  provider: string;
  model: string | null;
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

// 获取 API 使用记录
export async function getApiUsageRecords(params: {
  page?: number;
  pageSize?: number;
  userId?: string;
  serviceType?: string;
  provider?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}): Promise<{ records: ApiUsageRecord[]; pagination: Pagination }> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set("page", String(params.page));
  if (params.pageSize) searchParams.set("pageSize", String(params.pageSize));
  if (params.userId) searchParams.set("userId", params.userId);
  if (params.serviceType) searchParams.set("serviceType", params.serviceType);
  if (params.provider) searchParams.set("provider", params.provider);
  if (params.status) searchParams.set("status", params.status);
  if (params.startDate) searchParams.set("startDate", params.startDate);
  if (params.endDate) searchParams.set("endDate", params.endDate);

  const response = await request(
    `/api/admin/api-usage/records?${searchParams}`
  );
  return response.json();
}

// 获取服务定价
export async function getPricing() {
  const response = await request("/api/admin/pricing");
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
}) {
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

export interface DailyRewardStatus {
  canClaim: boolean;
  lastClaimAt: string | null;
}

export interface ClaimDailyRewardResult {
  success: boolean;
  newBalance: number;
  transactionId: string;
  alreadyClaimed?: boolean;
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

// ==================== 支付相关 ====================

export type PaymentMethod = "alipay" | "wechat";
export type PaymentStatus = "pending" | "paid" | "failed" | "expired";

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

// 获取充值套餐（根据首充状态返回不同配置）
export async function getPaymentPackages(): Promise<PackagesResponse> {
  const response = await request("/api/payment/packages");
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
