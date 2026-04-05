import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchWithAuth } from "@/services/authFetch";
import {
  getDashboardStats,
  getUsers,
  getApiUsageStats,
  getApiUsageRecords,
  addCredits,
  deductCredits,
  deleteUserAccount,
  updateUserStatus,
  updateUserRole,
  getSettings,
  upsertSetting,
  getWatermarkWhitelist,
  addToWatermarkWhitelist,
  removeFromWatermarkWhitelist,
  getPaidUsers,
  getCreditChangeRecords,
  getAdminUserCreditTransactions,
  getCreditAnomalyRecords,
  getNodeConfigs,
  updateNodeConfig,
  createNodeConfig,
  deleteNodeConfig,
  type DashboardStats,
  type UserWithCredits,
  type ApiUsageStats,
  type ApiUsageRecord,
  type Pagination,
  type SystemSetting,
  type WatermarkWhitelistUser,
  type PaidUser,
  type PaidUsersSortBy,
  type CreditChangeRecord,
  type AdminUserCreditTransaction,
  type CreditAnomalyRecord,
  type NodeConfig,
} from "@/services/adminApi";
import { notifyNodeConfigsUpdated } from "@/services/nodeConfigService";
import {
  fetchTemplates,
  fetchTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  fetchTemplateCategories,
} from "@/services/publicTemplateService";
import type { PublicTemplate } from "@/services/publicTemplateService";

// 统计卡片组件
function StatCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
}) {
  return (
    <div className='bg-white rounded-lg border p-4 shadow-sm'>
      <div className='text-sm text-gray-500'>{title}</div>
      <div className='text-2xl font-bold mt-1'>{value}</div>
      {subtitle && <div className='text-xs text-gray-400 mt-1'>{subtitle}</div>}
    </div>
  );
}

function DashboardTrendChart({
  data,
}: {
  data: DashboardStats["userTrend"];
}) {
  if (!data || data.length === 0) {
    return <div className='text-sm text-gray-400 py-8 text-center'>暂无趋势数据</div>;
  }

  const maxValue = Math.max(
    ...data.map((item) => Math.max(item.registeredUsers, item.dailyActiveUsers)),
    1
  );
  const midValue = Math.max(1, Math.round(maxValue / 2));

  const toPoints = (key: "registeredUsers" | "dailyActiveUsers") =>
    data
      .map((item, index) => {
        const x = (index / Math.max(data.length - 1, 1)) * 100;
        const y = 100 - (item[key] / maxValue) * 100;
        return `${x},${y}`;
      })
      .join(" ");

  const regPoints = toPoints("registeredUsers");
  const dauPoints = toPoints("dailyActiveUsers");

  return (
    <div>
      <div className='flex items-center gap-5 text-xs text-gray-600 mb-3'>
        <div className='flex items-center gap-2'>
          <span className='w-2.5 h-2.5 rounded-full bg-blue-500' />
          <span>注册用户</span>
        </div>
        <div className='flex items-center gap-2'>
          <span className='w-2.5 h-2.5 rounded-full bg-emerald-500' />
          <span>日活用户</span>
        </div>
      </div>
      <div className='grid grid-cols-[38px_1fr] gap-2'>
        <div className='relative h-44 text-[11px] text-gray-400 leading-none select-none'>
          <span className='absolute left-0 top-0'>{maxValue}</span>
          <span className='absolute left-0 top-1/2 -translate-y-1/2'>{midValue}</span>
          <span className='absolute left-0 bottom-0'>0</span>
        </div>
        <div className='relative h-44'>
          <svg width='100%' height='100%' viewBox='0 0 100 100' preserveAspectRatio='none'>
            <line x1='0' y1='100' x2='100' y2='100' stroke='#e5e7eb' strokeWidth='0.6' />
            <line x1='0' y1='66.6' x2='100' y2='66.6' stroke='#f3f4f6' strokeWidth='0.5' />
            <line x1='0' y1='33.3' x2='100' y2='33.3' stroke='#f3f4f6' strokeWidth='0.5' />

            <polyline
              fill='none'
              stroke='#3b82f6'
              strokeWidth='2'
              points={regPoints}
              vectorEffect='non-scaling-stroke'
            />
            <polyline
              fill='none'
              stroke='#10b981'
              strokeWidth='2'
              points={dauPoints}
              vectorEffect='non-scaling-stroke'
            />
          </svg>
          <div className='absolute bottom-0 left-0 right-0 flex justify-between text-[11px] text-gray-400'>
            <span>{data[0]?.date}</span>
            <span>{data[Math.floor(data.length / 2)]?.date}</span>
            <span>{data[data.length - 1]?.date}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const MODEL_PROVIDER_MAPPING_SETTING_KEY = "model_provider_mapping_v2";
type ModelVendorRouteType = "legacy" | "tencent_vod";

interface ManagedVendorPlatformConfig {
  platformKey: string;
  platformName?: string;
  enabled?: boolean;
  route?: ModelVendorRouteType;
  provider?: string;
  description?: string;
  metadata?: Record<string, any>;
}

interface ManagedModelVendorConfig {
  vendorKey: string;
  platformKey?: string;
  label?: string;
  enabled?: boolean;
  route?: ModelVendorRouteType;
  provider?: string;
  modelName?: string;
  modelVersion?: string;
  metadata?: Record<string, any>;
}

interface ManagedModelConfig {
  modelKey: string;
  modelName?: string;
  taskType?: string;
  enabled?: boolean;
  defaultVendor?: string;
  vendors?: ManagedModelVendorConfig[];
  metadata?: Record<string, any>;
}

interface ModelProviderMappingV2 {
  version?: string;
  platforms?: ManagedVendorPlatformConfig[];
  models?: ManagedModelConfig[];
}

const DEFAULT_MODEL_VENDOR_PLATFORMS: ManagedVendorPlatformConfig[] = [
  {
    platformKey: "legacy",
    platformName: "旧链路(Kapon)",
    enabled: true,
    route: "legacy",
    description: "保留当前默认老链路，未切厂商时回退使用",
  },
  {
    platformKey: "tencent_vod",
    platformName: "腾讯 VOD",
    enabled: true,
    route: "tencent_vod",
    description: "腾讯云 VOD AIGC 视频生成",
  },
  {
    platformKey: "vidu_api",
    platformName: "Vidu API",
    enabled: true,
    route: "legacy",
    provider: "vidu",
    description: "Vidu 官方或兼容 API 渠道",
  },
  {
    platformKey: "sora2_api",
    platformName: "Sora 2 API",
    enabled: true,
    route: "legacy",
    provider: "sora2",
    description: "Sora 2 视频生成渠道占位",
  },
  {
    platformKey: "seedance_api",
    platformName: "Seedance API",
    enabled: true,
    route: "legacy",
    provider: "doubao",
    description: "Seedance 视频生成渠道占位",
  },
];

const DEFAULT_MODEL_CATALOG: ManagedModelConfig[] = [
  {
    modelKey: "kling-2.6",
    modelName: "Kling 2.6",
    taskType: "video",
    enabled: true,
    defaultVendor: "legacy",
    vendors: [
      {
        vendorKey: "legacy",
        platformKey: "legacy",
        label: "旧链路(Kapon)",
        enabled: true,
        route: "legacy",
        provider: "kling-2.6",
        modelName: "Kling",
        modelVersion: "2.6",
      },
    ],
  },
  {
    modelKey: "kling-3.0",
    modelName: "Kling 3.0",
    taskType: "video",
    enabled: true,
    defaultVendor: "legacy",
    vendors: [
      {
        vendorKey: "legacy",
        platformKey: "legacy",
        label: "旧链路(Kapon)",
        enabled: true,
        route: "legacy",
        provider: "kling-o3",
        modelName: "Kling",
        modelVersion: "3.0",
      },
      {
        vendorKey: "tencent_vod",
        platformKey: "tencent_vod",
        label: "腾讯 VOD",
        enabled: false,
        route: "tencent_vod",
        provider: "kling-o3",
        modelName: "Kling",
        modelVersion: "3.0",
      },
    ],
  },
  {
    modelKey: "kling-o3",
    modelName: "Kling 3.0-Omni",
    taskType: "video",
    enabled: true,
    defaultVendor: "legacy",
    vendors: [
      {
        vendorKey: "legacy",
        platformKey: "legacy",
        label: "旧链路(Kapon)",
        enabled: true,
        route: "legacy",
        provider: "kling-o3",
        modelName: "Kling",
        modelVersion: "3.0-Omni",
      },
      {
        vendorKey: "tencent_vod",
        platformKey: "tencent_vod",
        label: "腾讯 VOD",
        enabled: false,
        route: "tencent_vod",
        provider: "kling-o3",
        modelName: "Kling",
        modelVersion: "3.0-Omni",
      },
    ],
  },
  {
    modelKey: "vidu-q2",
    modelName: "Vidu Q2",
    taskType: "video",
    enabled: true,
    defaultVendor: "vidu_api",
    vendors: [
      {
        vendorKey: "vidu_api",
        platformKey: "vidu_api",
        label: "Vidu API",
        enabled: true,
        route: "legacy",
        provider: "vidu",
        modelName: "Vidu",
        modelVersion: "Q2",
      },
    ],
  },
  {
    modelKey: "vidu-q3",
    modelName: "Vidu Q3",
    taskType: "video",
    enabled: true,
    defaultVendor: "vidu_api",
    vendors: [
      {
        vendorKey: "vidu_api",
        platformKey: "vidu_api",
        label: "Vidu API",
        enabled: true,
        route: "legacy",
        provider: "viduq3-pro",
        modelName: "Vidu",
        modelVersion: "Q3",
      },
    ],
  },
  {
    modelKey: "sora-2",
    modelName: "Sora 2",
    taskType: "video",
    enabled: true,
    defaultVendor: "sora2_api",
    vendors: [
      {
        vendorKey: "sora2_api",
        platformKey: "sora2_api",
        label: "Sora 2 API",
        enabled: true,
        route: "legacy",
        provider: "sora2",
        modelName: "Sora",
        modelVersion: "2.0",
      },
    ],
  },
  {
    modelKey: "seedance-1.5",
    modelName: "Seedance 1.5",
    taskType: "video",
    enabled: true,
    defaultVendor: "seedance_api",
    vendors: [
      {
        vendorKey: "seedance_api",
        platformKey: "seedance_api",
        label: "Seedance API",
        enabled: true,
        route: "legacy",
        provider: "doubao",
        modelName: "Seedance",
        modelVersion: "1.5",
      },
    ],
  },
  {
    modelKey: "seedance-2.0",
    modelName: "Seedance 2.0",
    taskType: "video",
    enabled: true,
    defaultVendor: "seedance_api",
    vendors: [
      {
        vendorKey: "seedance_api",
        platformKey: "seedance_api",
        label: "Seedance API",
        enabled: true,
        route: "legacy",
        provider: "doubao",
        modelName: "Seedance",
        modelVersion: "2.0",
      },
    ],
  },
];

const DEFAULT_MODEL_PROVIDER_MAPPING_TEMPLATE = JSON.stringify(
  {
    version: "v2",
    platforms: DEFAULT_MODEL_VENDOR_PLATFORMS,
    models: DEFAULT_MODEL_CATALOG,
  },
  null,
  2
);

const createEmptyVendor = (): ManagedModelVendorConfig => ({
  vendorKey: "",
  platformKey: "",
  label: "",
  enabled: true,
  route: "legacy",
  provider: "",
  modelName: "",
  modelVersion: "",
});

const createEmptyModel = (): ManagedModelConfig => ({
  modelKey: "",
  modelName: "",
  taskType: "video",
  enabled: true,
  defaultVendor: "",
  vendors: [createEmptyVendor()],
});

const createEmptyPlatform = (): ManagedVendorPlatformConfig => ({
  platformKey: "",
  platformName: "",
  enabled: true,
  route: "legacy",
  provider: "",
  description: "",
});

const normalizeModelMapping = (input?: Partial<ModelProviderMappingV2>): ModelProviderMappingV2 => {
  const platforms: ManagedVendorPlatformConfig[] = Array.isArray(input?.platforms)
    ? input!.platforms!.filter(Boolean).map((platform) => ({
        platformKey:
          typeof platform?.platformKey === "string" ? platform.platformKey : "",
        platformName:
          typeof platform?.platformName === "string" ? platform.platformName : "",
        enabled: platform?.enabled !== false,
        route:
          platform?.route === "tencent_vod"
            ? ("tencent_vod" as ModelVendorRouteType)
            : ("legacy" as ModelVendorRouteType),
        provider: typeof platform?.provider === "string" ? platform.provider : "",
        description:
          typeof platform?.description === "string" ? platform.description : "",
        metadata:
          platform?.metadata && typeof platform.metadata === "object"
            ? platform.metadata
            : undefined,
      }))
    : [];
  const models: ManagedModelConfig[] = Array.isArray(input?.models)
    ? input!.models!.filter(Boolean).map((model) => ({
        modelKey: typeof model?.modelKey === "string" ? model.modelKey : "",
        modelName: typeof model?.modelName === "string" ? model.modelName : "",
        taskType: typeof model?.taskType === "string" ? model.taskType : "",
        enabled: model?.enabled !== false,
        defaultVendor:
          typeof model?.defaultVendor === "string" ? model.defaultVendor : "",
        vendors: Array.isArray(model?.vendors)
          ? model.vendors.map((vendor) => ({
              vendorKey: typeof vendor?.vendorKey === "string" ? vendor.vendorKey : "",
              platformKey:
                typeof vendor?.platformKey === "string" ? vendor.platformKey : "",
              label: typeof vendor?.label === "string" ? vendor.label : "",
              enabled: vendor?.enabled !== false,
              route:
                vendor?.route === "tencent_vod"
                  ? ("tencent_vod" as ModelVendorRouteType)
                  : ("legacy" as ModelVendorRouteType),
              provider: typeof vendor?.provider === "string" ? vendor.provider : "",
              modelName: typeof vendor?.modelName === "string" ? vendor.modelName : "",
              modelVersion:
                typeof vendor?.modelVersion === "string" ? vendor.modelVersion : "",
              metadata:
                vendor?.metadata && typeof vendor.metadata === "object"
                  ? vendor.metadata
                  : undefined,
            }))
          : [],
        metadata:
          model?.metadata && typeof model.metadata === "object"
            ? model.metadata
            : undefined,
      }))
    : [];

  return {
    version: typeof input?.version === "string" ? input.version : "v2",
    platforms,
    models,
  };
};

const buildPersistedModelMapping = (input: ModelProviderMappingV2): ModelProviderMappingV2 => {
  const normalized = normalizeModelMapping(input);
  const platformMap = new Map(
    (normalized.platforms || []).map((platform) => [platform.platformKey, platform] as const)
  );

  return {
    ...normalized,
    models: (normalized.models || []).map((model) => ({
      ...model,
      vendors: (model.vendors || []).map((vendor) => {
        const platform =
          vendor.platformKey && platformMap.has(vendor.platformKey)
            ? platformMap.get(vendor.platformKey)
            : undefined;

        return {
          ...vendor,
          label: vendor.label || platform?.platformName || vendor.vendorKey,
          route: vendor.route || platform?.route || "legacy",
          provider: vendor.provider || platform?.provider || "",
        };
      }),
    })),
  };
};

// 用户管理 Tab
function UsersTab() {
  const currentUserId = useAuthStore((state) => state.user?.id);
  const [users, setUsers] = useState<UserWithCredits[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  // 积分操作弹窗
  const [creditModal, setCreditModal] = useState<{
    userId: string;
    userName: string;
    type: "add" | "deduct";
  } | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [creditDetailModal, setCreditDetailModal] = useState<{
    userId: string;
    userName: string;
  } | null>(null);
  const [creditDetailLoading, setCreditDetailLoading] = useState(false);
  const [creditDetailRecords, setCreditDetailRecords] = useState<{
    recharge: CreditChangeRecord[];
    manualAdd: CreditChangeRecord[];
    inviteReward: CreditChangeRecord[];
  }>({
    recharge: [],
    manualAdd: [],
    inviteReward: [],
  });
  const [creditDetailTransactions, setCreditDetailTransactions] = useState<
    AdminUserCreditTransaction[]
  >([]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const result = await getUsers({ page, pageSize: 10, search });
      setUsers(result.users);
      setPagination(result.pagination);
    } catch (error) {
      console.error("加载用户失败:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [page, search]);

  const handleCreditOperation = async () => {
    if (!creditModal || !creditAmount || !creditReason) return;

    try {
      if (creditModal.type === "add") {
        await addCredits(
          creditModal.userId,
          parseInt(creditAmount),
          creditReason
        );
      } else {
        await deductCredits(
          creditModal.userId,
          parseInt(creditAmount),
          creditReason
        );
      }
      setCreditModal(null);
      setCreditAmount("");
      setCreditReason("");
      loadUsers();
    } catch (error: any) {
      alert(error.message || "操作失败");
    }
  };

  const handleStatusChange = async (userId: string, status: string) => {
    try {
      await updateUserStatus(userId, status);
      loadUsers();
    } catch (error) {
      console.error("更新状态失败:", error);
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await updateUserRole(userId, role);
      loadUsers();
    } catch (error) {
      console.error("更新角色失败:", error);
    }
  };

  const handleDeleteUser = async (user: UserWithCredits) => {
    if (user.id === currentUserId) {
      alert("不能删除当前登录账号");
      return;
    }

    const displayName = user.name || user.phone;
    const confirmed = window.confirm(
      `确认删除账号「${displayName}」吗？\n手机号：${user.phone}\n此操作不可撤销，并会删除该账号关联数据。`
    );
    if (!confirmed) return;

    setDeletingUserId(user.id);
    try {
      await deleteUserAccount(user.id);
      await loadUsers();
    } catch (error: any) {
      alert(error.message || "删除账号失败");
    } finally {
      setDeletingUserId(null);
    }
  };

  const loadCreditDetails = async (user: UserWithCredits) => {
    setCreditDetailModal({
      userId: user.id,
      userName: user.name || user.phone,
    });
    setCreditDetailLoading(true);
    setCreditDetailTransactions([]);
    try {
      const [rechargeResult, manualAddResult, inviteResult, transactionResult] =
        await Promise.all([
          getCreditChangeRecords({
            userId: user.id,
            source: "recharge",
            page: 1,
            pageSize: 100,
          }),
          getCreditChangeRecords({
            userId: user.id,
            source: "admin_add",
            page: 1,
            pageSize: 100,
          }),
          getCreditChangeRecords({
            userId: user.id,
            source: "invite_reward",
            page: 1,
            pageSize: 100,
          }),
          getAdminUserCreditTransactions(user.id, {
            page: 1,
            pageSize: 100,
          }),
        ]);

      setCreditDetailRecords({
        recharge: rechargeResult.records,
        manualAdd: manualAddResult.records,
        inviteReward: inviteResult.records,
      });
      setCreditDetailTransactions(transactionResult.transactions || []);
    } catch (error) {
      console.error("加载积分详情失败:", error);
      setCreditDetailRecords({
        recharge: [],
        manualAdd: [],
        inviteReward: [],
      });
      setCreditDetailTransactions([]);
    } finally {
      setCreditDetailLoading(false);
    }
  };

  const formatChannelLabel = (channel: string | null | undefined): string => {
    if (!channel) return "-";
    const normalized = channel.trim().toLowerCase();
    if (normalized.includes("apimart")) return "M";
    if (normalized === "legacy" || normalized.includes("147")) return "A";
    return channel;
  };

  return (
    <div>
      <div className='mb-4 flex gap-2'>
        <Input
          placeholder='搜索手机号/邮箱/昵称'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='max-w-xs'
        />
        <Button
          onClick={() => {
            setPage(1);
            loadUsers();
          }}
        >
          搜索
        </Button>
      </div>

      <div className='bg-white rounded-lg border overflow-hidden'>
        <div className='max-h-[1100px] overflow-auto'>
          <table className='w-full text-sm'>
            <thead className='bg-gray-50'>
              <tr>
                <th className='px-4 py-3 text-left'>用户</th>
                <th className='px-4 py-3 text-left'>手机号</th>
                <th className='px-4 py-3 text-left'>积分余额</th>
                <th className='px-4 py-3 text-left'>总消费</th>
                <th className='px-4 py-3 text-left'>API调用</th>
                <th className='px-4 py-3 text-left'>角色</th>
                <th className='px-4 py-3 text-left'>状态</th>
                <th className='px-4 py-3 text-left'>注册时间</th>
                <th className='px-4 py-3 text-left'>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={9}
                    className='px-4 py-8 text-center text-gray-500'
                  >
                    加载中...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className='px-4 py-8 text-center text-gray-500'
                  >
                    暂无数据
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className='border-t hover:bg-gray-50'>
                    <td className='px-4 py-3'>
                      <div>{user.name || "-"}</div>
                      <div className='text-xs text-gray-400'>
                        {user.email || "-"}
                      </div>
                    </td>
                    <td className='px-4 py-3'>{user.phone}</td>
                    <td className='px-4 py-3 font-medium text-blue-600'>
                      {user.creditBalance}
                    </td>
                    <td className='px-4 py-3'>{user.totalSpent}</td>
                    <td className='px-4 py-3'>{user.apiCallCount}</td>
                    <td className='px-4 py-3'>
                      <select
                        value={user.role}
                        onChange={(e) =>
                          handleRoleChange(user.id, e.target.value)
                        }
                        className='text-xs border rounded px-2 py-1'
                      >
                        <option value='user'>用户</option>
                        <option value='admin'>管理员</option>
                      </select>
                    </td>
                    <td className='px-4 py-3'>
                      <select
                        value={user.status}
                        onChange={(e) =>
                          handleStatusChange(user.id, e.target.value)
                        }
                        className='text-xs border rounded px-2 py-1'
                      >
                        <option value='active'>正常</option>
                        <option value='inactive'>禁用</option>
                        <option value='banned'>封禁</option>
                      </select>
                    </td>
                    <td className='px-4 py-3 text-xs text-gray-500'>
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className='px-4 py-3'>
                      <div className='flex flex-wrap gap-1'>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() =>
                            setCreditModal({
                              userId: user.id,
                              userName: user.name || user.phone,
                              type: "add",
                            })
                          }
                        >
                          充值
                        </Button>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() =>
                            setCreditModal({
                              userId: user.id,
                              userName: user.name || user.phone,
                              type: "deduct",
                            })
                          }
                        >
                          扣除
                        </Button>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => loadCreditDetails(user)}
                        >
                          详情
                        </Button>
                        <Button
                          size='sm'
                          variant='outline'
                          className='border-red-300 text-red-600 hover:bg-red-50'
                          disabled={
                            deletingUserId === user.id || user.id === currentUserId
                          }
                          onClick={() => handleDeleteUser(user)}
                        >
                          {deletingUserId === user.id ? "删除中..." : "删除"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pagination && (
        <div className='mt-4 flex items-center justify-center gap-4'>
          <span className='text-sm text-gray-500'>
            共 {pagination.total} 条记录
          </span>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <span className='px-4 py-2 text-sm'>
              {page} / {pagination.totalPages}
            </span>
            <Button
              variant='outline'
              size='sm'
              disabled={page === pagination.totalPages}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}

      {/* 积分操作弹窗 */}
      {creditModal && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50'>
          <div className='bg-white rounded-lg p-6 w-96'>
            <h3 className='text-lg font-semibold mb-4'>
              {creditModal.type === "add" ? "充值积分" : "扣除积分"} -{" "}
              {creditModal.userName}
            </h3>
            <div className='space-y-4'>
              <div>
                <label className='block text-sm text-gray-600 mb-1'>
                  积分数量
                </label>
                <Input
                  type='number'
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                  placeholder='输入积分数量'
                />
              </div>
              <div>
                <label className='block text-sm text-gray-600 mb-1'>
                  操作原因
                </label>
                <Input
                  value={creditReason}
                  onChange={(e) => setCreditReason(e.target.value)}
                  placeholder='输入操作原因'
                />
              </div>
              <div className='flex gap-2 justify-end'>
                <Button variant='outline' onClick={() => setCreditModal(null)}>
                  取消
                </Button>
                <Button onClick={handleCreditOperation}>确认</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 积分来源详情弹窗 */}
      {creditDetailModal && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4'>
          <div className='bg-white rounded-lg p-6 w-full max-w-6xl max-h-[85vh] overflow-auto'>
            <div className='flex items-center justify-between mb-4'>
              <h3 className='text-lg font-semibold'>
                积分详情 - {creditDetailModal.userName}
              </h3>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setCreditDetailModal(null)}
              >
                关闭
              </Button>
            </div>

            {creditDetailLoading ? (
              <div className='py-10 text-center text-gray-500'>加载中...</div>
            ) : (
              <div className='space-y-4'>
                <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
                  <div className='border rounded-lg p-4'>
                    <div className='flex items-center justify-between mb-3'>
                      <h4 className='font-medium text-gray-800'>充值积分</h4>
                      <span className='text-xs text-gray-500'>
                        {creditDetailRecords.recharge.length} 条
                      </span>
                    </div>
                    <div className='space-y-2 max-h-[52vh] overflow-auto pr-1'>
                      {creditDetailRecords.recharge.length === 0 ? (
                        <div className='text-xs text-gray-400 py-6 text-center'>
                          暂无记录
                        </div>
                      ) : (
                        creditDetailRecords.recharge.map((record) => (
                          <div key={record.id} className='border rounded p-2 text-xs'>
                            <div className='text-gray-500'>
                              {new Date(record.createdAt).toLocaleString()}
                            </div>
                            <div className='font-medium text-green-600 mt-1'>
                              +{record.amount} 积分
                            </div>
                            <div className='text-gray-600 mt-1'>{record.description}</div>
                            <div className='text-gray-400 mt-1'>
                              剩余积分: {record.balanceAfter}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className='border rounded-lg p-4'>
                    <div className='flex items-center justify-between mb-3'>
                      <h4 className='font-medium text-gray-800'>手动增加积分</h4>
                      <span className='text-xs text-gray-500'>
                        {creditDetailRecords.manualAdd.length} 条
                      </span>
                    </div>
                    <div className='space-y-2 max-h-[52vh] overflow-auto pr-1'>
                      {creditDetailRecords.manualAdd.length === 0 ? (
                        <div className='text-xs text-gray-400 py-6 text-center'>
                          暂无记录
                        </div>
                      ) : (
                        creditDetailRecords.manualAdd.map((record) => (
                          <div key={record.id} className='border rounded p-2 text-xs'>
                            <div className='text-gray-500'>
                              {new Date(record.createdAt).toLocaleString()}
                            </div>
                            <div className='font-medium text-blue-600 mt-1'>
                              +{record.amount} 积分
                            </div>
                            <div className='text-gray-600 mt-1'>{record.description}</div>
                            <div className='text-gray-400 mt-1'>
                              管理员: {record.admin?.name || record.admin?.phone || "-"}
                            </div>
                            <div className='text-gray-400 mt-1'>
                              剩余积分: {record.balanceAfter}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className='border rounded-lg p-4'>
                    <div className='flex items-center justify-between mb-3'>
                      <h4 className='font-medium text-gray-800'>邀请奖励积分</h4>
                      <span className='text-xs text-gray-500'>
                        {creditDetailRecords.inviteReward.length} 条
                      </span>
                    </div>
                    <div className='space-y-2 max-h-[52vh] overflow-auto pr-1'>
                      {creditDetailRecords.inviteReward.length === 0 ? (
                        <div className='text-xs text-gray-400 py-6 text-center'>
                          暂无记录
                        </div>
                      ) : (
                        creditDetailRecords.inviteReward.map((record) => (
                          <div key={record.id} className='border rounded p-2 text-xs'>
                            <div className='text-gray-500'>
                              {new Date(record.createdAt).toLocaleString()}
                            </div>
                            <div className='font-medium text-emerald-600 mt-1'>
                              +{record.amount} 积分
                            </div>
                            <div className='text-gray-600 mt-1'>{record.description}</div>
                            <div className='text-gray-400 mt-1'>
                              剩余积分: {record.balanceAfter}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className='border rounded-lg overflow-hidden'>
                  <div className='px-4 py-3 bg-gray-50 border-b flex items-center justify-between'>
                    <h4 className='font-medium text-gray-800'>细分积分明细</h4>
                    <span className='text-xs text-gray-500'>
                      {creditDetailTransactions.length} 条
                    </span>
                  </div>

                  {creditDetailTransactions.length === 0 ? (
                    <div className='py-10 text-center text-gray-500 text-sm'>暂无记录</div>
                  ) : (
                    <div className='max-h-[45vh] overflow-auto'>
                      <table className='w-full text-sm'>
                        <thead className='sticky top-0 bg-white z-10'>
                          <tr className='border-b text-gray-500 text-xs bg-gray-50'>
                            <th className='px-4 py-3 text-left'>项目</th>
                            <th className='px-4 py-3 text-right'>积分</th>
                            <th className='px-4 py-3 text-right'>剩余积分</th>
                            <th className='px-4 py-3 text-left'>生成时间</th>
                            <th className='px-4 py-3 text-left'>花费时间</th>
                          </tr>
                        </thead>
                        <tbody>
                          {creditDetailTransactions.map((tx) => {
                            const durationSeconds =
                              typeof tx.processingTime === "number"
                                ? Math.max(0, Math.round(tx.processingTime / 1000))
                                : null;
                            const isPositive = tx.amount > 0;

                            return (
                              <tr key={tx.id} className='border-b hover:bg-gray-50'>
                                <td className='px-4 py-3'>
                                  <div className='font-medium text-gray-800'>
                                    {tx.description}
                                  </div>
                                  {tx.channel && (
                                    <div className='text-xs text-gray-500 mt-0.5'>
                                      渠道: {formatChannelLabel(tx.channel)}
                                    </div>
                                  )}
                                </td>
                                <td
                                  className={`px-4 py-3 text-right font-semibold ${
                                    isPositive ? "text-green-600" : "text-orange-600"
                                  }`}
                                >
                                  {isPositive ? "+" : ""}
                                  {tx.amount}
                                </td>
                                <td className='px-4 py-3 text-right text-blue-600 font-medium'>
                                  {tx.balanceAfter}
                                </td>
                                <td className='px-4 py-3 text-gray-600 whitespace-nowrap'>
                                  {new Date(tx.createdAt).toLocaleString()}
                                </td>
                                <td className='px-4 py-3 text-gray-600 whitespace-nowrap'>
                                  {durationSeconds !== null ? `${durationSeconds}秒` : "-"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// API 使用统计 Tab
function ApiStatsTab() {
  const [stats, setStats] = useState<ApiUsageStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    const loadStats = async () => {
      setLoading(true);
      try {
        const result = await getApiUsageStats();
        setStats(result);
      } catch (error) {
        console.error("加载统计失败:", error);
      } finally {
        setLoading(false);
      }
    };
    loadStats();
  }, []);

  const totalPages = Math.max(1, Math.ceil(stats.length / pageSize));
  const pagedStats = stats.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className='bg-white rounded-lg border overflow-hidden'>
      <div className='max-h-[1200px] overflow-auto'>
        <table className='w-full text-sm'>
          <thead className='bg-gray-50'>
            <tr>
              <th className='px-4 py-3 text-left'>服务名称</th>
              <th className='px-4 py-3 text-left'>服务类型</th>
              <th className='px-4 py-3 text-left'>提供商</th>
              <th className='px-4 py-3 text-left'>用户</th>
              <th className='px-4 py-3 text-right'>总调用</th>
              <th className='px-4 py-3 text-right'>成功</th>
              <th className='px-4 py-3 text-right'>失败</th>
              <th className='px-4 py-3 text-right'>成功率</th>
              <th className='px-4 py-3 text-right'>消耗积分</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className='px-4 py-8 text-center text-gray-500'>
                  加载中...
                </td>
              </tr>
            ) : stats.length === 0 ? (
              <tr>
                <td colSpan={9} className='px-4 py-8 text-center text-gray-500'>
                  暂无数据
                </td>
              </tr>
            ) : (
              pagedStats.map((stat) => (
                <tr
                  key={stat.serviceType}
                  className='border-t hover:bg-gray-50'
                >
                  <td className='px-4 py-3 font-medium'>{stat.serviceName}</td>
                  <td className='px-4 py-3 text-gray-500'>
                    {stat.serviceType}
                  </td>
                  <td className='px-4 py-3'>
                    <span className='px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs'>
                      {stat.provider}
                    </span>
                  </td>
                  <td className='px-4 py-3'>
                    <div className='space-y-1'>
                      <div className='text-xs text-gray-500'>
                        共 {stat.userCount} 个用户
                      </div>
                      {stat.topUsers.length > 0 && (
                        <div className='space-y-0.5'>
                          {stat.topUsers.map((user, idx) => (
                            <div key={user.userId} className='text-xs'>
                              <span className='font-medium'>
                                {user.userName || user.userPhone}
                              </span>
                              <span className='text-gray-400 ml-1'>
                                ({user.callCount}次)
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className='px-4 py-3 text-right'>{stat.totalCalls}</td>
                  <td className='px-4 py-3 text-right text-green-600'>
                    {stat.successfulCalls}
                  </td>
                  <td className='px-4 py-3 text-right text-red-600'>
                    {stat.failedCalls}
                  </td>
                  <td className='px-4 py-3 text-right'>
                    {stat.totalCalls > 0
                      ? (
                          (stat.successfulCalls / stat.totalCalls) *
                          100
                        ).toFixed(1)
                      : 0}
                    %
                  </td>
                  <td className='px-4 py-3 text-right font-medium'>
                    {stat.totalCreditsUsed}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {stats.length > 0 && totalPages > 1 && (
        <div className='mt-4 flex justify-center gap-2 pb-4'>
          <Button
            variant='outline'
            size='sm'
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </Button>
          <span className='px-4 py-2 text-sm'>
            {page} / {totalPages}
          </span>
          <Button
            variant='outline'
            size='sm'
            disabled={page === totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}

// API 调用记录 Tab
function ApiRecordsTab() {
  const [records, setRecords] = useState<ApiUsageRecord[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    serviceType: "",
    provider: "",
    status: "",
  });

  const loadRecords = async () => {
    setLoading(true);
    try {
      const result = await getApiUsageRecords({
        page,
        pageSize: 10,
        ...filters,
      });
      setRecords(result.records);
      setPagination(result.pagination);
    } catch (error) {
      console.error("加载记录失败:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
  }, [page, filters]);

  const statusColors: Record<string, string> = {
    success: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
    pending: "bg-yellow-100 text-yellow-700",
  };

  return (
    <div>
      <div className='mb-4 flex gap-2'>
        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          className='border rounded px-3 py-2 text-sm'
        >
          <option value=''>全部状态</option>
          <option value='success'>成功</option>
          <option value='failed'>失败</option>
          <option value='pending'>处理中</option>
        </select>
        <select
          value={filters.provider}
          onChange={(e) => setFilters({ ...filters, provider: e.target.value })}
          className='border rounded px-3 py-2 text-sm'
        >
          <option value=''>全部提供商</option>
          <option value='gemini'>Gemini</option>
          <option value='sora'>Sora</option>
          <option value='midjourney'>Midjourney</option>
          <option value='imgly'>IMGLY</option>
        </select>
        <Button
          variant='outline'
          onClick={() => {
            setPage(1);
            loadRecords();
          }}
        >
          刷新
        </Button>
      </div>

      <div className='bg-white rounded-lg border overflow-hidden'>
        <div className='max-h-[1100px] overflow-auto'>
          <table className='w-full text-sm'>
            <thead className='bg-gray-50'>
              <tr>
                <th className='px-4 py-3 text-left'>时间</th>
                <th className='px-4 py-3 text-left'>用户</th>
                <th className='px-4 py-3 text-left'>服务</th>
                <th className='px-4 py-3 text-left'>提供商</th>
                <th className='px-4 py-3 text-right'>消耗积分</th>
                <th className='px-4 py-3 text-right'>耗时</th>
                <th className='px-4 py-3 text-left'>状态</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={7}
                    className='px-4 py-8 text-center text-gray-500'
                  >
                    加载中...
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className='px-4 py-8 text-center text-gray-500'
                  >
                    暂无数据
                  </td>
                </tr>
              ) : (
                records.map((record) => (
                  <tr key={record.id} className='border-t hover:bg-gray-50'>
                    <td className='px-4 py-3 text-xs text-gray-500'>
                      {new Date(record.createdAt).toLocaleString()}
                    </td>
                    <td className='px-4 py-3'>
                      <div>{record.user?.name || "-"}</div>
                      <div className='text-xs text-gray-400'>
                        {record.user?.phone}
                      </div>
                    </td>
                    <td className='px-4 py-3'>{record.serviceName}</td>
                    <td className='px-4 py-3'>
                      <span className='px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs'>
                        {record.provider}
                      </span>
                    </td>
                    <td className='px-4 py-3 text-right font-medium'>
                      {record.responseStatus === "failed" ? (
                        <span className='text-green-600'>
                          已退还 {record.creditsUsed}
                        </span>
                      ) : (
                        record.creditsUsed
                      )}
                    </td>
                    <td className='px-4 py-3 text-right text-gray-500'>
                      {record.processingTime
                        ? `${record.processingTime}ms`
                        : "-"}
                    </td>
                    <td className='px-4 py-3'>
                      <span
                        className={`px-2 py-1 rounded text-xs ${
                          statusColors[record.responseStatus] || ""
                        }`}
                      >
                        {record.responseStatus === "success"
                          ? "成功"
                          : record.responseStatus === "failed"
                          ? "失败"
                          : "处理中"}
                      </span>
                      {record.errorMessage && (
                        <div
                          className='text-xs text-red-500 mt-1 max-w-xs truncate'
                          title={record.errorMessage}
                        >
                          {record.errorMessage}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className='mt-4 flex justify-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <span className='px-4 py-2 text-sm'>
            {page} / {pagination.totalPages}
          </span>
          <Button
            variant='outline'
            size='sm'
            disabled={page === pagination.totalPages}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}

// Sora2 供应商选项
const SORA2_PROVIDER_OPTIONS = [
  {
    value: "auto",
    label: "自动切换",
    description: "优先使用 APIMart，失败后自动切换到 Sora2 Pro，再回退到普通Sora2",
  },
  {
    value: "apimart",
    label: "APIMart",
    description: "强制使用 APIMart (api.apimart.ai)，不会切换到 147",
  },
  {
    value: "v2",
    label: "Sora2 Pro",
    description: "强制使用Sora2 Pro (newapi.megabyai.cc)",
  },
  {
    value: "legacy",
    label: "普通Sora2",
    description: "强制使用普通Sora2 (147ai.com)",
  },
];

const BANANA_PROVIDER_OPTIONS = [
  {
    value: "auto",
    label: "自动切换",
    description: "优先使用 Apimart，失败后自动切换到 147",
  },
  {
    value: "tencent_auto",
    label: "自动切换（腾讯优先）",
    description:
      "优先使用腾讯 Nano Banana，失败后自动切换到 Apimart/147",
  },
  {
    value: "tencent",
    label: "腾讯 Nano Banana",
    description: "强制使用腾讯 Nano Banana",
  },
  {
    value: "legacy_auto",
    label: "自动切换（147优先）",
    description: "优先使用 147，失败后自动切换到 Apimart",
  },
  {
    value: "apimart",
    label: "Apimart",
    description: "强制使用 Apimart (api.apimart.ai)",
  },
  {
    value: "legacy",
    label: "147",
    description: "强制使用 147 (api1.147ai.com)",
  },
];

const BANANA_TEXT_PROVIDER_OPTIONS = [
  {
    value: "auto",
    label: "自动切换",
    description: "优先使用 Apimart 语言接口，失败后自动切换到 147",
  },
  {
    value: "legacy_auto",
    label: "自动切换（147优先）",
    description: "优先使用 147 语言接口，失败后自动切换到 Apimart",
  },
  {
    value: "apimart",
    label: "Apimart",
    description: "强制使用 Apimart 语言接口 (api.apimart.ai)",
  },
  {
    value: "legacy",
    label: "147",
    description: "强制使用 147 语言接口 (api1.147ai.com)",
  },
];

// 公共模板管理 Tab
function TemplatesTab() {
  const [templates, setTemplates] = useState<PublicTemplate[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [isActive, setIsActive] = useState<boolean | undefined>(undefined);
  const [categories, setCategories] = useState<string[]>([]);

  // 创建/编辑模态框状态
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PublicTemplate | null>(
    null
  );
  const [formData, setFormData] = useState({
    name: "",
    category: "",
    description: "",
    thumbnail: "",
    thumbnailSmall: "",
    templateData: "",
    templateJsonKey: undefined as string | undefined,
    isActive: true,
  });
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [jsonFileName, setJsonFileName] = useState<string | null>(null);
  const [imageFileName, setImageFileName] = useState<string | null>(null);
  const [smallImageFileName, setSmallImageFileName] = useState<string | null>(
    null
  );

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const result = await fetchTemplates({
        page,
        pageSize: 10,
        category: category || undefined,
        isActive,
        search: search || undefined,
      });
      setTemplates(result.items);
      setPagination(result);
    } catch (error) {
      console.error("加载模板失败:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const result = await fetchTemplateCategories();
      // 将"其他"分类固定在末尾
      if (Array.isArray(result)) {
        const otherCat = result.filter((c) => c === "其他");
        const restCats = result.filter((c) => c !== "其他");
        setCategories([...restCats, ...otherCat]);
      } else {
        setCategories(result);
      }
    } catch (error) {
      console.error("加载分类失败:", error);
    }
  };

  useEffect(() => {
    loadTemplates();
    loadCategories();
  }, [page, category, isActive, search]);

  const handleCreate = () => {
    setEditingTemplate(null);
    setFormData({
      name: "",
      category: "",
      description: "",
      thumbnail: "",
      thumbnailSmall: "",
      templateData: "",
      templateJsonKey: undefined,
      isActive: true,
    });
    setJsonFileName(null);
    setImageFileName(null);
    setModalOpen(true);
  };

  const handleEdit = async (template: PublicTemplate) => {
    const fullTemplate = await fetchTemplate(template.id);
    setEditingTemplate(fullTemplate);
    setFormData({
      name: fullTemplate.name,
      category: fullTemplate.category || "",
      description: fullTemplate.description || "",
      thumbnail: fullTemplate.thumbnail || "",
      thumbnailSmall: fullTemplate.thumbnailSmall || "",
      templateData: JSON.stringify(fullTemplate.templateData, null, 2),
      templateJsonKey: undefined,
      isActive: fullTemplate.isActive ?? true,
    });
    setJsonFileName(null);
    setImageFileName(null);
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      let payload: any = {
        name: formData.name,
        category: formData.category || undefined,
        description: formData.description || undefined,
        thumbnail: formData.thumbnail || undefined,
        thumbnailSmall: formData.thumbnailSmall || undefined,
        isActive: formData.isActive,
      };

      if (formData.templateJsonKey) {
        payload.templateJsonKey = formData.templateJsonKey;
      } else {
        let templateData;
        try {
          templateData = JSON.parse(formData.templateData);
        } catch (e) {
          alert("模板数据必须是有效的JSON格式");
          return;
        }
        payload.templateData = templateData;
      }

      if (editingTemplate) {
        await updateTemplate(editingTemplate.id, payload);
      } else {
        await createTemplate(payload);
      }

      setModalOpen(false);
      loadTemplates();
    } catch (error: any) {
      alert(error.message || "保存失败");
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`确定要删除模板"${name}"吗？此操作无法撤销。`)) return;

    try {
      await deleteTemplate(id);
      loadTemplates();
    } catch (error: any) {
      alert(error.message || "删除失败");
    }
  };

  // 读取 JSON 文件并填充到模板数据
  const handleJsonFileChange = async (file?: File) => {
    if (!file) return;
    setJsonFileName(file.name);
    try {
      // 验证文件大小 (限制为32MB)
      if (file.size > 32 * 1024 * 1024) {
        alert("JSON文件大小不能超过32MB");
        return;
      }

      // 验证文件类型
      if (!file.name.toLowerCase().endsWith(".json")) {
        alert("请选择JSON格式的文件");
        return;
      }

      // 读取并验证JSON格式
      const content = await file.text();
      let parsedJson;
      try {
        parsedJson = JSON.parse(content);
      } catch (parseError) {
        alert("JSON文件格式不正确，请检查文件内容");
        return;
      }

      // 直接将 JSON 内容设置为 templateData，不再依赖 OSS 读取
      setFormData({
        ...formData,
        templateJsonKey: undefined,
        templateData: JSON.stringify(parsedJson, null, 2)
      });
    } catch (err: any) {
      console.error("JSON 读取失败:", err);
      alert(`JSON 读取失败: ${err.message || "未知错误"}`);
    }
  };

  // 上传文件到 OSS（使用 presign）
  const uploadFileToOSS = async (
    file: File,
    dir = "templates/thumbs/",
    maxSize?: number
  ): Promise<string> => {
    const token = localStorage.getItem("authToken");

    // 总是使用 credentials: 'include'，以便浏览器发送 cookie（后端使用 cookie 验证）
    // 同时如果 localStorage 中存在 token，则也带上 Authorization 作为备选认证方式
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const API_BASE =
      import.meta.env.VITE_API_BASE_URL &&
      import.meta.env.VITE_API_BASE_URL.trim().length > 0
        ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
        : "http://localhost:4000";

    const resp = await fetchWithAuth(`${API_BASE}/api/uploads/presign`, {
      method: "POST",
      headers,
      body: JSON.stringify({ dir, maxSize }),
    });

    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({}));
      throw new Error(
        `获取上传凭证失败: ${errorData.message || resp.statusText}`
      );
    }

    const presign = await resp.json();
    if (!presign || !presign.host || !presign.dir) {
      throw new Error("上传凭证格式错误");
    }

    const key = `${presign.dir}${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
    const form = new FormData();
    form.append("key", key);
    form.append("policy", presign.policy);
    form.append("OSSAccessKeyId", presign.accessId);
    form.append("signature", presign.signature);
    form.append("file", file);

    const uploadResp = await fetchWithAuth(presign.host, {
      method: "POST",
      body: form,
      auth: "omit",
      allowRefresh: false,
      credentials: "omit",
    });

    if (!uploadResp.ok) {
      const errorText = await uploadResp.text().catch(() => "");
      throw new Error(
        `上传到OSS失败 (${uploadResp.status}): ${
          errorText || uploadResp.statusText
        }`
      );
    }

    return `${presign.host}/${key}`;
  };

  const handleImageFileChange = async (file?: File) => {
    if (!file) return;
    setIsUploadingImage(true);
    setImageFileName(file.name);
    try {
      const url = await uploadFileToOSS(file, "templates/thumbs/");
      setFormData({ ...formData, thumbnail: url });
    } catch (err: any) {
      console.error("图片上传失败:", err);
      alert("图片上传失败");
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleSmallImageFileChange = async (file?: File) => {
    if (!file) return;
    setIsUploadingImage(true);
    setSmallImageFileName(file.name);
    try {
      const url = await uploadFileToOSS(file, "templates/thumbs_small/");
      setFormData({ ...formData, thumbnailSmall: url });
    } catch (err: any) {
      console.error("小缩略图上传失败:", err);
      alert("小缩略图上传失败");
    } finally {
      setIsUploadingImage(false);
    }
  };

  return (
    <div>
      <div className='mb-4 flex gap-2 flex-wrap'>
        <Input
          placeholder='搜索模板名称/描述'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='max-w-xs'
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className='border rounded px-3 py-2 text-sm'
        >
          <option value=''>全部分类</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
        <select
          value={isActive === undefined ? "" : isActive.toString()}
          onChange={(e) =>
            setIsActive(
              e.target.value === "" ? undefined : e.target.value === "true"
            )
          }
          className='border rounded px-3 py-2 text-sm'
        >
          <option value=''>全部状态</option>
          <option value='true'>启用</option>
          <option value='false'>禁用</option>
        </select>
        <Button onClick={() => setPage(1)}>搜索</Button>
        <Button onClick={handleCreate}>创建模板</Button>
      </div>

      <div className='bg-white rounded-lg border overflow-hidden'>
        <div className='max-h-[800px] overflow-auto'>
          <table className='w-full text-sm'>
            <thead className='bg-gray-50'>
              <tr>
                <th className='px-4 py-3 text-left'>模板</th>
                <th className='px-4 py-3 text-left'>分类</th>
                <th className='px-4 py-3 text-left'>状态</th>
                <th className='px-4 py-3 text-left'>更新时间</th>
                <th className='px-4 py-3 text-left'>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={5}
                    className='px-4 py-8 text-center text-gray-500'
                  >
                    加载中...
                  </td>
                </tr>
              ) : templates.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className='px-4 py-8 text-center text-gray-500'
                  >
                    暂无数据
                  </td>
                </tr>
              ) : (
                templates.map((template) => (
                  <tr key={template.id} className='border-t hover:bg-gray-50'>
                    <td className='px-4 py-3'>
                      <div>
                        <div className='font-medium'>{template.name}</div>
                        {template.description && (
                          <div className='text-xs text-gray-500 mt-1'>
                            {template.description}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className='px-4 py-3'>
                      {template.category && (
                        <span className='px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs'>
                          {template.category}
                        </span>
                      )}
                    </td>

                    <td className='px-4 py-3'>
                      <span
                        className={`px-2 py-1 rounded text-xs ${
                          template.isActive
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {template.isActive ? "启用" : "禁用"}
                      </span>
                    </td>
                    <td className='px-4 py-3 text-xs text-gray-500'>
                      {template.updatedAt
                        ? new Date(template.updatedAt).toLocaleString()
                        : ""}
                    </td>
                    <td className='px-4 py-3'>
                      <div className='flex gap-1'>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => handleEdit(template)}
                        >
                          编辑
                        </Button>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() =>
                            handleDelete(template.id, template.name)
                          }
                        >
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pagination && (
        <div className='mt-4 flex items-center justify-center gap-4'>
          <span className='text-sm text-gray-500'>
            共 {pagination.total} 条记录
          </span>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <span className='px-4 py-2 text-sm'>
              {page} / {pagination.totalPages}
            </span>
            <Button
              variant='outline'
              size='sm'
              disabled={page === pagination.totalPages}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}

      {/* 创建/编辑模态框 */}
      {modalOpen && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50'>
          <div className='bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-auto'>
            <h3 className='text-lg font-semibold mb-4'>
              {editingTemplate ? "编辑模板" : "创建模板"}
            </h3>
            <div className='space-y-4'>
              <div className='grid grid-cols-2 gap-4'>
                <div>
                  <label className='block text-sm text-gray-600 mb-1'>
                    模板名称 *
                  </label>
                  <Input
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder='输入模板名称'
                  />
                </div>
                <div>
                  <label className='block text-sm text-gray-600 mb-1'>
                    分类
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) =>
                      setFormData({ ...formData, category: e.target.value })
                    }
                    className='w-full border rounded px-3 py-2'
                  >
                    <option value=''>请选择分类</option>
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                  <div className='flex gap-2 mt-2'>
                    <input
                      type='text'
                      id='new-category-input'
                      className='flex-1 border rounded px-3 py-2 text-sm'
                      placeholder='输入新分类名称'
                    />
                    <button
                      type='button'
                      className='px-3 py-2 bg-blue-600 text-white rounded text-sm'
                      onClick={async () => {
                        const input = document.getElementById('new-category-input') as HTMLInputElement;
                        const newCat = input?.value?.trim();
                        if (!newCat) {
                          alert('请输入分类名称');
                          return;
                        }
                        if (categories.includes(newCat)) {
                          alert('该分类已存在');
                          return;
                        }
                        try {
                          const res = await fetchWithAuth(
                            "/api/admin/templates/categories",
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ category: newCat }),
                            }
                          );
                          if (!res.ok) throw new Error("添加分类失败");
                          const data = await res.json();
                          if (data?.success) {
                            await loadCategories();
                            input.value = '';
                            setFormData({ ...formData, category: newCat });
                          } else {
                            alert(data?.message || "添加分类失败");
                          }
                        } catch (err) {
                          console.error("添加分类失败", err);
                          alert("添加分类失败");
                        }
                      }}
                    >
                      添加
                    </button>
                    <button
                      type='button'
                      className='px-3 py-2 bg-red-500 text-white rounded text-sm'
                      onClick={async () => {
                        if (!formData.category) {
                          alert('请先选择要删除的分类');
                          return;
                        }
                        if (formData.category === '其他') {
                          alert('"其他"分类不能删除');
                          return;
                        }
                        if (!confirm(`确定要删除分类"${formData.category}"吗？`)) {
                          return;
                        }
                        try {
                          const res = await fetchWithAuth(
                            `/api/admin/templates/categories/${encodeURIComponent(formData.category)}`,
                            { method: "DELETE" }
                          );
                          if (!res.ok) throw new Error("删除分类失败");
                          const data = await res.json();
                          if (data?.success) {
                            await loadCategories();
                            setFormData({ ...formData, category: '' });
                          } else {
                            alert(data?.message || "删除分类失败");
                          }
                        } catch (err) {
                          console.error("删除分类失败", err);
                          alert("删除分类失败");
                        }
                      }}
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className='block text-sm text-gray-600 mb-1'>描述</label>
                <Input
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  placeholder='输入模板描述'
                />
              </div>

              <div>
                <label className='block text-sm text-gray-600 mb-1'>
                  缩略图 (图片上传)
                </label>
                <input
                  type='file'
                  accept='image/*'
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleImageFileChange(f);
                  }}
                />
                {imageFileName && (
                  <div className='text-xs text-gray-500 mt-1'>
                    已选择: {imageFileName}{" "}
                    {isUploadingImage ? "(上传中...)" : ""}
                  </div>
                )}
              </div>

              <div>
                <label className='block text-sm text-gray-600 mb-1'>
                  小缩略图 (40x40)
                </label>
                <input
                  type='file'
                  accept='image/*'
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleSmallImageFileChange(f);
                  }}
                />
                {smallImageFileName && (
                  <div className='text-xs text-gray-500 mt-1'>
                    已选择: {smallImageFileName}{" "}
                    {isUploadingImage ? "(上传中...)" : ""}
                  </div>
                )}
              </div>

              <div className='flex items-center gap-4'>
                <label className='flex items-center gap-2'>
                  <input
                    type='checkbox'
                    checked={formData.isActive}
                    onChange={(e) =>
                      setFormData({ ...formData, isActive: e.target.checked })
                    }
                  />
                  <span className='text-sm text-gray-600'>启用</span>
                </label>
              </div>

              <div>
                <label className='block text-sm text-gray-600 mb-1'>
                  模板数据 (JSON 文件上传) *
                </label>
                <input
                  type='file'
                  accept='application/json'
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleJsonFileChange(f);
                  }}
                />
                {jsonFileName && (
                  <div className='text-xs text-gray-500 mt-1'>
                    已选择: {jsonFileName}
                  </div>
                )}
              </div>

              <div className='flex gap-2 justify-end'>
                <Button variant='outline' onClick={() => setModalOpen(false)}>
                  取消
                </Button>
                <Button onClick={handleSave}>保存</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 水印白名单管理 Tab
function WatermarkWhitelistTab() {
  const [whitelistUsers, setWhitelistUsers] = useState<WatermarkWhitelistUser[]>([]);
  const [allUsers, setAllUsers] = useState<UserWithCredits[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  const loadWhitelist = async () => {
    setLoading(true);
    try {
      const result = await getWatermarkWhitelist({ page, pageSize: 10, search });
      setWhitelistUsers(result.users);
      setPagination(result.pagination);
    } catch (error) {
      console.error("加载白名单失败:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadAllUsers = async () => {
    try {
      const result = await getUsers({ page: 1, pageSize: 50, search: userSearch });
      setAllUsers(result.users);
    } catch (error) {
      console.error("加载用户列表失败:", error);
    }
  };

  useEffect(() => {
    loadWhitelist();
  }, [page, search]);

  useEffect(() => {
    if (showAddModal) {
      loadAllUsers();
    }
  }, [showAddModal, userSearch]);

  const handleAdd = async (userId: string) => {
    try {
      await addToWatermarkWhitelist(userId);
      setShowAddModal(false);
      loadWhitelist();
    } catch (error: any) {
      alert(error.message || "添加失败");
    }
  };

  const handleRemove = async (userId: string) => {
    if (!confirm("确定要从白名单中移除该用户吗？")) return;
    try {
      await removeFromWatermarkWhitelist(userId);
      loadWhitelist();
    } catch (error: any) {
      alert(error.message || "移除失败");
    }
  };

  return (
    <div>
      <div className='mb-4 flex gap-2'>
        <Input
          placeholder='搜索手机号/邮箱/昵称'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='max-w-xs'
        />
        <Button onClick={() => { setPage(1); loadWhitelist(); }}>搜索</Button>
        <Button onClick={() => setShowAddModal(true)}>添加用户</Button>
      </div>

      <div className='bg-white rounded-lg border overflow-hidden'>
        <table className='w-full text-sm'>
          <thead className='bg-gray-50'>
            <tr>
              <th className='px-4 py-3 text-left'>用户</th>
              <th className='px-4 py-3 text-left'>手机号</th>
              <th className='px-4 py-3 text-left'>邮箱</th>
              <th className='px-4 py-3 text-left'>添加时间</th>
              <th className='px-4 py-3 text-left'>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className='px-4 py-8 text-center text-gray-500'>加载中...</td>
              </tr>
            ) : whitelistUsers.length === 0 ? (
              <tr>
                <td colSpan={5} className='px-4 py-8 text-center text-gray-500'>暂无数据</td>
              </tr>
            ) : (
              whitelistUsers.map((user) => (
                <tr key={user.id} className='border-t hover:bg-gray-50'>
                  <td className='px-4 py-3'>{user.name || "-"}</td>
                  <td className='px-4 py-3'>{user.phone}</td>
                  <td className='px-4 py-3'>{user.email || "-"}</td>
                  <td className='px-4 py-3 text-xs text-gray-500'>
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className='px-4 py-3'>
                    <Button size='sm' variant='outline' onClick={() => handleRemove(user.id)}>
                      移除
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className='mt-4 flex items-center justify-center gap-4'>
          <span className='text-sm text-gray-500'>共 {pagination.total} 条记录</span>
          <div className='flex items-center gap-2'>
            <Button variant='outline' size='sm' disabled={page === 1} onClick={() => setPage(page - 1)}>
              上一页
            </Button>
            <span className='px-4 py-2 text-sm'>{page} / {pagination.totalPages}</span>
            <Button variant='outline' size='sm' disabled={page === pagination.totalPages} onClick={() => setPage(page + 1)}>
              下一页
            </Button>
          </div>
        </div>
      )}

      {/* 添加用户弹窗 */}
      {showAddModal && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50'>
          <div className='bg-white rounded-lg p-6 w-[500px] max-h-[80vh] overflow-auto'>
            <h3 className='text-lg font-semibold mb-4'>添加用户到白名单</h3>
            <Input
              placeholder='搜索用户手机号/邮箱/昵称'
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              className='mb-4'
            />
            <div className='max-h-[400px] overflow-auto border rounded'>
              <table className='w-full text-sm'>
                <thead className='bg-gray-50 sticky top-0'>
                  <tr>
                    <th className='px-3 py-2 text-left'>用户</th>
                    <th className='px-3 py-2 text-left'>手机号</th>
                    <th className='px-3 py-2 text-left'>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {allUsers.map((user) => (
                    <tr key={user.id} className='border-t hover:bg-gray-50'>
                      <td className='px-3 py-2'>{user.name || "-"}</td>
                      <td className='px-3 py-2'>{user.phone}</td>
                      <td className='px-3 py-2'>
                        <Button size='sm' onClick={() => handleAdd(user.id)}>添加</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className='mt-4 flex justify-end'>
              <Button variant='outline' onClick={() => setShowAddModal(false)}>关闭</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 付费用户管理 Tab
function PaidUsersTab() {
  const [users, setUsers] = useState<PaidUser[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<PaidUsersSortBy>("amount");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const loadUsers = async () => {
    setLoading(true);
    try {
      const result = await getPaidUsers({ page, pageSize: 10, search, sortBy, sortOrder });
      setUsers(result.users);
      setPagination(result.pagination);
    } catch (error) {
      console.error("加载付费用户失败:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [page, search, sortBy, sortOrder]);

  return (
    <div>
      <div className='mb-4 flex gap-2'>
        <Input
          placeholder='搜索手机号/邮箱/昵称'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='max-w-xs'
        />
        <Button onClick={() => { setPage(1); loadUsers(); }}>搜索</Button>
        <select
          value={sortBy}
          onChange={(e) => {
            setSortBy(e.target.value as PaidUsersSortBy);
            setPage(1);
          }}
          className='h-10 rounded-md border border-input bg-background px-3 py-2 text-sm'
        >
          <option value='amount'>按金额排序</option>
          <option value='registeredAt'>按注册时间排序</option>
          <option value='paidAt'>按支付时间排序</option>
        </select>
        <Button
          variant='outline'
          onClick={() => {
            setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
            setPage(1);
          }}
        >
          {sortOrder === "desc" ? "降序" : "升序"}
        </Button>
      </div>

      <div className='bg-white rounded-lg border overflow-hidden'>
        <div className='max-h-[800px] overflow-auto'>
          <table className='w-full text-sm'>
            <thead className='bg-gray-50'>
              <tr>
                <th className='px-4 py-3 text-left'>用户</th>
                <th className='px-4 py-3 text-left'>手机号</th>
                <th className='px-4 py-3 text-right'>总支付金额</th>
                <th className='px-4 py-3 text-right'>订单数</th>
                <th className='px-4 py-3 text-right'>积分余额</th>
                <th className='px-4 py-3 text-right'>已消费积分</th>
                <th className='px-4 py-3 text-left'>状态</th>
                <th className='px-4 py-3 text-left'>注册时间</th>
                <th className='px-4 py-3 text-left'>支付时间</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className='px-4 py-8 text-center text-gray-500'>加载中...</td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={9} className='px-4 py-8 text-center text-gray-500'>暂无付费用户</td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className='border-t hover:bg-gray-50'>
                    <td className='px-4 py-3'>
                      <div>{user.name || "-"}</div>
                      <div className='text-xs text-gray-400'>{user.email || "-"}</div>
                    </td>
                    <td className='px-4 py-3'>{user.phone}</td>
                    <td className='px-4 py-3 text-right font-medium text-green-600'>
                      ¥{user.totalPaid.toFixed(2)}
                    </td>
                    <td className='px-4 py-3 text-right'>{user.orderCount}</td>
                    <td className='px-4 py-3 text-right text-blue-600'>{user.creditBalance}</td>
                    <td className='px-4 py-3 text-right'>{user.totalSpent}</td>
                    <td className='px-4 py-3'>
                      {user.noWatermark ? (
                        <span className='px-2 py-1 rounded text-xs bg-blue-100 text-blue-700'>
                          VIP
                        </span>
                      ) : (
                        <span className={`px-2 py-1 rounded text-xs ${
                          user.status === 'active' ? 'bg-green-100 text-green-700' :
                          user.status === 'inactive' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {user.status === 'active' ? '正常' : user.status === 'inactive' ? '禁用' : '封禁'}
                        </span>
                      )}
                    </td>
                    <td className='px-4 py-3 text-xs text-gray-500'>
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className='px-4 py-3 text-xs text-gray-500'>
                      {user.lastPaidAt ? new Date(user.lastPaidAt).toLocaleString() : "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className='mt-4 flex items-center justify-center gap-4'>
          <span className='text-sm text-gray-500'>共 {pagination.total} 条记录</span>
          <div className='flex items-center gap-2'>
            <Button variant='outline' size='sm' disabled={page === 1} onClick={() => setPage(page - 1)}>
              上一页
            </Button>
            <span className='px-4 py-2 text-sm'>{page} / {pagination.totalPages}</span>
            <Button variant='outline' size='sm' disabled={page === pagination.totalPages} onClick={() => setPage(page + 1)}>
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// 积分变更记录 Tab
function CreditChangeRecordsTab() {
  const [records, setRecords] = useState<CreditChangeRecord[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<"all" | "recharge" | "admin_add" | "admin_deduct">("all");

  const loadRecords = async () => {
    setLoading(true);
    try {
      const result = await getCreditChangeRecords({
        page,
        pageSize: 20,
        search,
        source,
      });
      setRecords(result.records);
      setPagination(result.pagination);
    } catch (error) {
      console.error("加载积分变更记录失败:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
  }, [page, search, source]);

  const sourceText: Record<string, string> = {
    recharge: "充值到账",
    admin_add: "后台加积分",
    admin_deduct: "后台扣积分",
  };

  const sourceClass: Record<string, string> = {
    recharge: "bg-green-100 text-green-700",
    admin_add: "bg-blue-100 text-blue-700",
    admin_deduct: "bg-red-100 text-red-700",
  };

  return (
    <div>
      <div className='mb-4 flex gap-2 flex-wrap'>
        <Input
          placeholder='搜索手机号/邮箱/昵称'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='max-w-xs'
        />
        <select
          value={source}
          onChange={(e) => {
            setPage(1);
            setSource(e.target.value as "all" | "recharge" | "admin_add" | "admin_deduct");
          }}
          className='border rounded px-3 py-2 text-sm'
        >
          <option value='all'>全部来源</option>
          <option value='recharge'>充值到账</option>
          <option value='admin_add'>后台加积分</option>
          <option value='admin_deduct'>后台扣积分</option>
        </select>
        <Button
          onClick={() => {
            setPage(1);
            loadRecords();
          }}
        >
          搜索
        </Button>
      </div>

      <div className='bg-white rounded-lg border overflow-hidden'>
        <div className='max-h-[900px] overflow-auto'>
          <table className='w-full text-sm'>
            <thead className='bg-gray-50'>
              <tr>
                <th className='px-4 py-3 text-left'>时间</th>
                <th className='px-4 py-3 text-left'>用户</th>
                <th className='px-4 py-3 text-left'>来源</th>
                <th className='px-4 py-3 text-right'>变更积分</th>
                <th className='px-4 py-3 text-right'>变更后余额</th>
                <th className='px-4 py-3 text-left'>管理员</th>
                <th className='px-4 py-3 text-left'>支付信息</th>
                <th className='px-4 py-3 text-left'>备注</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className='px-4 py-8 text-center text-gray-500'>
                    加载中...
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={8} className='px-4 py-8 text-center text-gray-500'>
                    暂无记录
                  </td>
                </tr>
              ) : (
                records.map((record) => (
                  <tr key={record.id} className='border-t hover:bg-gray-50'>
                    <td className='px-4 py-3 text-xs text-gray-500 whitespace-nowrap'>
                      {new Date(record.createdAt).toLocaleString()}
                    </td>
                    <td className='px-4 py-3'>
                      <div>{record.user.name || "-"}</div>
                      <div className='text-xs text-gray-400'>{record.user.phone}</div>
                    </td>
                    <td className='px-4 py-3'>
                      <span className={`px-2 py-1 rounded text-xs ${sourceClass[record.source] || "bg-gray-100 text-gray-700"}`}>
                        {sourceText[record.source] || record.source}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${record.amount >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {record.amount >= 0 ? "+" : ""}
                      {record.amount}
                    </td>
                    <td className='px-4 py-3 text-right text-blue-600 font-medium'>
                      {record.balanceAfter}
                    </td>
                    <td className='px-4 py-3'>
                      {record.admin ? (
                        <div>
                          <div>{record.admin.name || "-"}</div>
                          <div className='text-xs text-gray-400'>{record.admin.phone}</div>
                        </div>
                      ) : (
                        <span className='text-gray-400'>-</span>
                      )}
                    </td>
                    <td className='px-4 py-3'>
                      {record.payment ? (
                        <div className='text-xs'>
                          <div className='font-medium text-gray-700'>¥{record.payment.amount.toFixed(2)}</div>
                          <div className='text-gray-400'>{record.payment.orderNo}</div>
                        </div>
                      ) : (
                        <span className='text-gray-400'>-</span>
                      )}
                    </td>
                    <td className='px-4 py-3 text-xs text-gray-500 max-w-[280px] truncate' title={record.description}>
                      {record.description}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className='mt-4 flex items-center justify-center gap-4'>
          <span className='text-sm text-gray-500'>共 {pagination.total} 条记录</span>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <span className='px-4 py-2 text-sm'>
              {page} / {pagination.totalPages}
            </span>
            <Button
              variant='outline'
              size='sm'
              disabled={page === pagination.totalPages}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CreditAnomaliesTab() {
  const [records, setRecords] = useState<CreditAnomalyRecord[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<"" | "yellow" | "red" | "purple">("");

  const loadRecords = async () => {
    setLoading(true);
    try {
      const result = await getCreditAnomalyRecords({
        page,
        pageSize: 20,
        search: search || undefined,
        severity: severity || undefined,
      });
      setRecords(result.records);
      setPagination(result.pagination);
    } catch (error) {
      console.error("加载积分异常记录失败:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
  }, [page, search, severity]);

  const severityText: Record<string, string> = {
    yellow: "黄色预警",
    red: "红色预警",
    purple: "紫色预警",
  };

  const severityClass: Record<string, string> = {
    yellow: "bg-yellow-100 text-yellow-800",
    red: "bg-red-100 text-red-800",
    purple: "bg-purple-100 text-purple-800",
  };

  const amountClass: Record<string, string> = {
    yellow: "text-yellow-700",
    red: "text-red-700",
    purple: "text-purple-700",
  };

  return (
    <div>
      <div className='mb-4 flex gap-2 flex-wrap'>
        <Input
          placeholder='搜索手机号/邮箱/昵称'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='max-w-xs'
        />
        <select
          value={severity}
          onChange={(e) => {
            setPage(1);
            setSeverity(e.target.value as "" | "yellow" | "red" | "purple");
          }}
          className='border rounded px-3 py-2 text-sm'
        >
          <option value=''>全部等级</option>
          <option value='yellow'>黄色 (&gt;2000)</option>
          <option value='red'>红色 (&gt;5000)</option>
          <option value='purple'>紫色 (&gt;10000)</option>
        </select>
        <Button
          onClick={() => {
            setPage(1);
            loadRecords();
          }}
        >
          搜索
        </Button>
      </div>

      <div className='bg-white rounded-lg border overflow-hidden'>
        <div className='max-h-[900px] overflow-auto'>
          <table className='w-full text-sm'>
            <thead className='bg-gray-50'>
              <tr>
                <th className='px-4 py-3 text-left'>日期</th>
                <th className='px-4 py-3 text-left'>用户</th>
                <th className='px-4 py-3 text-left'>预警等级</th>
                <th className='px-4 py-3 text-right'>当天累计增加</th>
                <th className='px-4 py-3 text-right'>最大单笔</th>
                <th className='px-4 py-3 text-right'>笔数</th>
                <th className='px-4 py-3 text-left'>来源分布</th>
                <th className='px-4 py-3 text-left'>最后变更</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className='px-4 py-8 text-center text-gray-500'>
                    加载中...
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={8} className='px-4 py-8 text-center text-gray-500'>
                    暂无异常记录
                  </td>
                </tr>
              ) : (
                records.map((record) => (
                  <tr key={record.id} className='border-t hover:bg-gray-50'>
                    <td className='px-4 py-3 text-xs text-gray-600 whitespace-nowrap'>
                      {record.dayLabel}
                    </td>
                    <td className='px-4 py-3'>
                      <div>{record.user.name || "-"}</div>
                      <div className='text-xs text-gray-400'>{record.user.phone}</div>
                    </td>
                    <td className='px-4 py-3'>
                      <span className={`px-2 py-1 rounded text-xs ${severityClass[record.severity] || "bg-gray-100 text-gray-700"}`}>
                        {severityText[record.severity] || record.severity}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${amountClass[record.severity] || "text-yellow-700"}`}>
                      +{record.totalAmount}
                    </td>
                    <td className='px-4 py-3 text-right'>{record.maxSingleAmount}</td>
                    <td className='px-4 py-3 text-right'>{record.transactionCount}</td>
                    <td className='px-4 py-3 text-xs text-gray-600'>
                      <div className='space-y-1'>
                        {record.sourceBreakdown.slice(0, 3).map((item) => (
                          <div key={item.sourceKey} className='whitespace-nowrap'>
                            {item.sourceLabel}: +{item.amount} ({item.count}笔)
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className='px-4 py-3 text-xs text-gray-500 whitespace-nowrap'>
                      {new Date(record.lastTransactionAt).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className='mt-4 flex items-center justify-center gap-4'>
          <span className='text-sm text-gray-500'>共 {pagination.total} 条记录</span>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <span className='px-4 py-2 text-sm'>
              {page} / {pagination.totalPages}
            </span>
            <Button
              variant='outline'
              size='sm'
              disabled={page === pagination.totalPages}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ModelManagementTab() {
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "warning";
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mappingDraft, setMappingDraft] = useState<ModelProviderMappingV2>(() =>
    normalizeModelMapping(JSON.parse(DEFAULT_MODEL_PROVIDER_MAPPING_TEMPLATE))
  );
  const [jsonText, setJsonText] = useState(DEFAULT_MODEL_PROVIDER_MAPPING_TEMPLATE);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>("");
  const [showJsonEditor, setShowJsonEditor] = useState(false);
  const [queryModelName, setQueryModelName] = useState("");
  const [queryTaskType, setQueryTaskType] = useState("");
  const [queryStatus, setQueryStatus] = useState<"" | "enabled" | "disabled">("");
  const [queryPlatformName, setQueryPlatformName] = useState("");
  const [editingModelIndex, setEditingModelIndex] = useState<number | null>(null);
  const [editingModelDraft, setEditingModelDraft] = useState<ManagedModelConfig | null>(null);
  const [editingPlatformIndex, setEditingPlatformIndex] = useState<number | null>(null);
  const [editingPlatformDraft, setEditingPlatformDraft] =
    useState<ManagedVendorPlatformConfig | null>(null);

  const syncDraftFromObject = (input: ModelProviderMappingV2) => {
    const normalized = normalizeModelMapping(input);
    setMappingDraft(normalized);
    setJsonText(JSON.stringify(normalized, null, 2));
    return normalized;
  };

  const showToast = (
    message: string,
    type: "success" | "error" | "warning" = "success"
  ) => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast(null);
    }, 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const loadMapping = async () => {
    setLoading(true);
    setStatusText("");
    try {
      const settings = await getSettings();
      const existing = settings.find(
        (item) => item.key === MODEL_PROVIDER_MAPPING_SETTING_KEY
      );
      const nextText =
        existing?.value?.trim() || DEFAULT_MODEL_PROVIDER_MAPPING_TEMPLATE;
      try {
        const parsed = JSON.parse(nextText);
        syncDraftFromObject(parsed);
      } catch {
        setJsonText(nextText);
      }
      setLastUpdatedAt(existing?.updatedAt || null);
    } catch (error) {
      console.error("加载模型管理配置失败:", error);
      setStatusText("加载失败，请稍后重试");
      showToast("加载模型管理配置失败", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMapping();
  }, []);

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(jsonText);
      syncDraftFromObject(parsed);
      setStatusText("JSON 已格式化");
      showToast("JSON 已格式化");
    } catch (error: any) {
      showToast(error.message || "JSON 格式不合法", "error");
    }
  };

  const handleReset = () => {
    syncDraftFromObject(JSON.parse(DEFAULT_MODEL_PROVIDER_MAPPING_TEMPLATE));
    setStatusText("已恢复默认模板，未保存");
    showToast("已恢复默认模板", "warning");
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusText("");
    try {
      const payloadObject = buildPersistedModelMapping(mappingDraft);
      const payload = JSON.stringify(payloadObject, null, 2);
      const saved = await upsertSetting({
        key: MODEL_PROVIDER_MAPPING_SETTING_KEY,
        value: payload,
        description: "模型厂商切换管理(JSON 映射，V2)",
      });
      syncDraftFromObject(payloadObject);
      setLastUpdatedAt(saved.updatedAt);
      setStatusText("保存成功");
      showToast("模型管理配置已保存");
    } catch (error: any) {
      showToast(error.message || "保存失败", "error");
    } finally {
      setSaving(false);
    }
  };

  const updateDraft = (updater: (current: ModelProviderMappingV2) => ModelProviderMappingV2) => {
    setMappingDraft((current) => {
      const next = normalizeModelMapping(updater(current));
      setJsonText(JSON.stringify(next, null, 2));
      return next;
    });
    setStatusText("");
  };

  const updateModelField = (
    modelIndex: number,
    field: keyof ManagedModelConfig,
    value: string | boolean
  ) => {
    updateDraft((current) => {
      const models = [...(current.models || [])];
      models[modelIndex] = {
        ...models[modelIndex],
        [field]: value,
      };
      return { ...current, models };
    });
  };

  const updateVendorField = (
    modelIndex: number,
    vendorIndex: number,
    field: keyof ManagedModelVendorConfig,
    value: string | boolean
  ) => {
    updateDraft((current) => {
      const models = [...(current.models || [])];
      const model = models[modelIndex];
      const vendors = [...(model.vendors || [])];
      vendors[vendorIndex] = {
        ...vendors[vendorIndex],
        [field]: value,
      };

      let defaultVendor = model.defaultVendor || "";
      if (
        field === "vendorKey" &&
        typeof value === "string" &&
        defaultVendor === vendors[vendorIndex].vendorKey
      ) {
        defaultVendor = value;
      }

      models[modelIndex] = {
        ...model,
        defaultVendor,
        vendors,
      };
      return { ...current, models };
    });
  };

  const addModel = () => {
    updateDraft((current) => ({
      ...current,
      models: [...(current.models || []), createEmptyModel()],
    }));
  };

  const removeModel = (modelIndex: number) => {
    updateDraft((current) => ({
      ...current,
      models: (current.models || []).filter((_, index) => index !== modelIndex),
    }));
  };

  const addVendor = (modelIndex: number) => {
    updateDraft((current) => {
      const models = [...(current.models || [])];
      const model = models[modelIndex];
      const vendors = [...(model.vendors || []), createEmptyVendor()];
      models[modelIndex] = {
        ...model,
        vendors,
      };
      return { ...current, models };
    });
  };

  const removeVendor = (modelIndex: number, vendorIndex: number) => {
    updateDraft((current) => {
      const models = [...(current.models || [])];
      const model = models[modelIndex];
      const vendors = (model.vendors || []).filter((_, index) => index !== vendorIndex);
      const nextDefaultVendor =
        vendors.some((item) => item.vendorKey === model.defaultVendor)
          ? model.defaultVendor
          : vendors[0]?.vendorKey || "";
      models[modelIndex] = {
        ...model,
        vendors,
        defaultVendor: nextDefaultVendor,
      };
      return { ...current, models };
    });
  };

  const handleVersionChange = (value: string) => {
    updateDraft((current) => ({ ...current, version: value }));
  };

  const handleApplyJsonToList = () => {
    try {
      const parsed = JSON.parse(jsonText);
      syncDraftFromObject(parsed);
      setStatusText("已从 JSON 同步到列表");
      showToast("已从 JSON 同步到列表");
    } catch (error: any) {
      showToast(error.message || "JSON 格式不合法", "error");
    }
  };

  const openEditModel = (modelIndex?: number) => {
    if (typeof modelIndex === "number") {
      const target = mappingDraft.models?.[modelIndex];
      if (!target) return;
      setEditingModelIndex(modelIndex);
      setEditingModelDraft(
        normalizeModelMapping({ models: [target] }).models?.[0] || createEmptyModel()
      );
      return;
    }

    setEditingModelIndex(null);
    setEditingModelDraft(createEmptyModel());
  };

  const closeEditModel = () => {
    setEditingModelIndex(null);
    setEditingModelDraft(null);
  };

  const saveEditingModel = () => {
    if (!editingModelDraft) return;

    if (!editingModelDraft.modelKey?.trim()) {
      showToast("请填写模型 Key", "warning");
      return;
    }

    const normalizedModel = normalizeModelMapping({
      models: [editingModelDraft],
    }).models?.[0];

    if (!normalizedModel) return;

    updateDraft((current) => {
      const models = [...(current.models || [])];
      if (editingModelIndex === null) {
        models.push(normalizedModel);
      } else {
        models[editingModelIndex] = normalizedModel;
      }
      return { ...current, models };
    });

    closeEditModel();
    showToast(editingModelIndex === null ? "模型已添加到列表" : "模型已更新到列表");
  };

  const updateEditingModelField = (
    field: keyof ManagedModelConfig,
    value: string | boolean
  ) => {
    setEditingModelDraft((current) =>
      current
        ? {
            ...current,
            [field]: value,
          }
        : current
    );
  };

  const updateEditingVendorField = (
    vendorIndex: number,
    field: keyof ManagedModelVendorConfig,
    value: string | boolean
  ) => {
    setEditingModelDraft((current) => {
      if (!current) return current;
      const vendors = [...(current.vendors || [])];
      const previousVendorKey = vendors[vendorIndex]?.vendorKey || "";
      vendors[vendorIndex] = {
        ...vendors[vendorIndex],
        [field]: value,
      };

      return {
        ...current,
        defaultVendor:
          field === "vendorKey" && current.defaultVendor === previousVendorKey
            ? String(value)
            : current.defaultVendor,
        vendors,
      };
    });
  };

  const addEditingVendor = () => {
    setEditingModelDraft((current) =>
      current
        ? {
            ...current,
            vendors: [...(current.vendors || []), createEmptyVendor()],
          }
        : current
    );
  };

  const removeEditingVendor = (vendorIndex: number) => {
    setEditingModelDraft((current) => {
      if (!current) return current;
      const vendors = (current.vendors || []).filter((_, index) => index !== vendorIndex);
      return {
        ...current,
        vendors,
        defaultVendor: vendors.some((item) => item.vendorKey === current.defaultVendor)
          ? current.defaultVendor
          : vendors[0]?.vendorKey || "",
      };
    });
  };

  const copyModel = (modelIndex: number) => {
    const source = mappingDraft.models?.[modelIndex];
    if (!source) return;
    const cloned = JSON.parse(JSON.stringify(source)) as ManagedModelConfig;
    cloned.modelKey = `${source.modelKey || "model"}_copy`;
    cloned.modelName = `${source.modelName || source.modelKey || "模型"} 复制`;
    updateDraft((current) => ({
      ...current,
      models: [...(current.models || []), cloned],
    }));
    setStatusText("模型已复制，记得保存");
    showToast("模型已复制，记得保存");
  };

  const toggleModelStatus = (modelIndex: number, enabled: boolean) => {
    updateModelField(modelIndex, "enabled", enabled);
  };

  const updatePlatformField = (
    platformIndex: number,
    field: keyof ManagedVendorPlatformConfig,
    value: string | boolean
  ) => {
    updateDraft((current) => {
      const platforms = [...(current.platforms || [])];
      platforms[platformIndex] = {
        ...platforms[platformIndex],
        [field]: value,
      };
      return { ...current, platforms };
    });
  };

  const removePlatform = (platformIndex: number) => {
    updateDraft((current) => {
      const target = current.platforms?.[platformIndex];
      const nextPlatforms = (current.platforms || []).filter((_, index) => index !== platformIndex);
      const nextPlatformKey = target?.platformKey || "";
      const nextModels = (current.models || []).map((model) => ({
        ...model,
        vendors: (model.vendors || []).map((vendor) =>
          vendor.platformKey === nextPlatformKey
            ? { ...vendor, platformKey: "" }
            : vendor
        ),
      }));
      return {
        ...current,
        platforms: nextPlatforms,
        models: nextModels,
      };
    });
  };

  const copyPlatform = (platformIndex: number) => {
    const source = mappingDraft.platforms?.[platformIndex];
    if (!source) return;
    const cloned = JSON.parse(JSON.stringify(source)) as ManagedVendorPlatformConfig;
    cloned.platformKey = `${source.platformKey || "platform"}_copy`;
    cloned.platformName = `${source.platformName || source.platformKey || "平台"} 复制`;
    updateDraft((current) => ({
      ...current,
      platforms: [...(current.platforms || []), cloned],
    }));
    setStatusText("平台已复制，记得保存");
    showToast("平台已复制，记得保存");
  };

  const openEditPlatform = (platformIndex?: number) => {
    if (typeof platformIndex === "number") {
      const target = mappingDraft.platforms?.[platformIndex];
      if (!target) return;
      setEditingPlatformIndex(platformIndex);
      setEditingPlatformDraft({ ...target });
      return;
    }
    setEditingPlatformIndex(null);
    setEditingPlatformDraft(createEmptyPlatform());
  };

  const closeEditPlatform = () => {
    setEditingPlatformIndex(null);
    setEditingPlatformDraft(null);
  };

  const updateEditingPlatformField = (
    field: keyof ManagedVendorPlatformConfig,
    value: string | boolean
  ) => {
    setEditingPlatformDraft((current) =>
      current
        ? {
            ...current,
            [field]: value,
          }
        : current
    );
  };

  const saveEditingPlatform = () => {
    if (!editingPlatformDraft) return;
    if (!editingPlatformDraft.platformKey?.trim()) {
      showToast("请填写平台 Key", "warning");
      return;
    }

    const normalizedPlatform = normalizeModelMapping({
      platforms: [editingPlatformDraft],
    }).platforms?.[0];
    if (!normalizedPlatform) return;

    updateDraft((current) => {
      const platforms = [...(current.platforms || [])];
      if (editingPlatformIndex === null) {
        platforms.push(normalizedPlatform);
      } else {
        platforms[editingPlatformIndex] = normalizedPlatform;
      }
      return { ...current, platforms };
    });

    closeEditPlatform();
    showToast(editingPlatformIndex === null ? "平台已添加到列表" : "平台已更新到列表");
  };

  const filteredModels = (mappingDraft.models || []).filter((model) => {
    const matchedName = !queryModelName
      ? true
      : `${model.modelKey} ${model.modelName}`.toLowerCase().includes(queryModelName.toLowerCase());
    const matchedTaskType = !queryTaskType
      ? true
      : (model.taskType || "").toLowerCase().includes(queryTaskType.toLowerCase());
    const matchedStatus =
      !queryStatus
        ? true
        : queryStatus === "enabled"
        ? model.enabled !== false
        : model.enabled === false;
    return matchedName && matchedTaskType && matchedStatus;
  });

  const filteredPlatforms = (mappingDraft.platforms || []).filter((platform) => {
    const matchedName = !queryPlatformName
      ? true
      : `${platform.platformKey} ${platform.platformName} ${platform.provider}`
          .toLowerCase()
          .includes(queryPlatformName.toLowerCase());
    return matchedName;
  });

  return (
    <div className='space-y-6'>
      {toast && (
        <div className='fixed right-6 top-6 z-[70]'>
          <div
            className={`min-w-[240px] rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur ${
              toast.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : toast.type === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}
      <div className='bg-white rounded-lg border p-6 shadow-sm'>
        <div className='flex items-start justify-between gap-4'>
          <div>
            <h3 className='text-lg font-semibold'>模型管理</h3>
            <p className='text-sm text-gray-500 mt-1'>
              通过 JSON 管理同一个模型对应的多个厂商路由。默认目录已预置
              Kling、Vidu、Sora 2、Seedance 等首批模型；当前运行时优先对
              `kling-o3` 启用厂商切换，未切换时继续走旧链路。
            </p>
          </div>
          <div className='text-right text-xs text-gray-400'>
            <div>Setting Key</div>
            <div className='font-mono text-[11px]'>
              {MODEL_PROVIDER_MAPPING_SETTING_KEY}
            </div>
            {lastUpdatedAt && (
              <div className='mt-2'>
                更新于 {new Date(lastUpdatedAt).toLocaleString()}
              </div>
            )}
          </div>
        </div>

        <div className='mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]'>
          <div className='space-y-3'>
            <div className='rounded-lg border border-gray-200 bg-gray-50 p-4'>
              <div className='flex flex-wrap items-end gap-4'>
                <div className='min-w-[220px] flex-1'>
                  <label className='mb-1 block text-sm text-gray-600'>模型名称 / Key</label>
                  <Input
                    value={queryModelName}
                    onChange={(e) => setQueryModelName(e.target.value)}
                    placeholder='搜索模型名称或模型 Key'
                    className='bg-white'
                  />
                </div>
                <div className='min-w-[180px]'>
                  <label className='mb-1 block text-sm text-gray-600'>任务类型</label>
                  <Input
                    value={queryTaskType}
                    onChange={(e) => setQueryTaskType(e.target.value)}
                    placeholder='如：video'
                    className='bg-white'
                  />
                </div>
                <div className='min-w-[160px]'>
                  <label className='mb-1 block text-sm text-gray-600'>状态</label>
                  <select
                    value={queryStatus}
                    onChange={(e) =>
                      setQueryStatus(e.target.value as "" | "enabled" | "disabled")
                    }
                    className='w-full rounded border px-3 py-2 bg-white'
                  >
                    <option value=''>全部状态</option>
                    <option value='enabled'>启用</option>
                    <option value='disabled'>禁用</option>
                  </select>
                </div>
                <div className='min-w-[140px]'>
                  <label className='mb-1 block text-sm text-gray-600'>Version</label>
                  <Input
                    value={mappingDraft.version || "v2"}
                    onChange={(e) => handleVersionChange(e.target.value)}
                    className='bg-white'
                  />
                </div>
              </div>
            </div>

            <div className='rounded-lg border bg-white shadow-sm'>
              <div className='flex items-center justify-between gap-4 border-b px-4 py-3'>
                <div>
                  <div className='text-sm font-medium text-gray-900'>模型列表</div>
                  <div className='text-sm text-gray-500 mt-1'>
                    参考 xiangyu-admin 的管理模式，列表负责筛选、状态切换和复制，详细配置放到弹层里。
                  </div>
                </div>
                <Button variant='outline' onClick={() => openEditModel()}>
                  新增模型
                </Button>
              </div>

              <div className='overflow-x-auto'>
                <table className='w-full text-sm'>
                  <thead className='bg-gray-50 text-gray-600'>
                    <tr>
                      <th className='px-4 py-3 text-left'>模型</th>
                      <th className='px-4 py-3 text-left'>任务类型</th>
                      <th className='px-4 py-3 text-left'>默认厂商</th>
                      <th className='px-4 py-3 text-left'>厂商数</th>
                      <th className='px-4 py-3 text-left'>状态</th>
                      <th className='px-4 py-3 text-left'>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredModels.length === 0 ? (
                      <tr>
                        <td colSpan={6} className='px-4 py-10 text-center text-gray-500'>
                          暂无匹配模型
                        </td>
                      </tr>
                    ) : (
                      filteredModels.map((model) => {
                        const modelIndex = (mappingDraft.models || []).findIndex(
                          (item) =>
                            item.modelKey === model.modelKey &&
                            item.modelName === model.modelName
                        );
                        return (
                          <tr key={`${model.modelKey}-${modelIndex}`} className='border-t'>
                            <td className='px-4 py-3'>
                              <div className='font-medium text-gray-900'>
                                {model.modelName || model.modelKey}
                              </div>
                              <div className='mt-1 font-mono text-xs text-gray-400'>
                                {model.modelKey || "-"}
                              </div>
                            </td>
                            <td className='px-4 py-3 text-gray-600'>
                              {model.taskType || "-"}
                            </td>
                            <td className='px-4 py-3 text-gray-600'>
                              {model.defaultVendor || "-"}
                            </td>
                            <td className='px-4 py-3 text-gray-600'>
                              {(model.vendors || []).length}
                            </td>
                            <td className='px-4 py-3'>
                              <label className='inline-flex items-center gap-2 text-sm text-gray-700'>
                                <input
                                  type='checkbox'
                                  checked={model.enabled !== false}
                                  onChange={(e) =>
                                    toggleModelStatus(modelIndex, e.target.checked)
                                  }
                                />
                                {model.enabled !== false ? "启用" : "禁用"}
                              </label>
                            </td>
                            <td className='px-4 py-3'>
                              <div className='flex flex-wrap gap-3'>
                                <button
                                  onClick={() => openEditModel(modelIndex)}
                                  className='text-blue-600 hover:text-blue-700'
                                >
                                  编辑
                                </button>
                                <button
                                  onClick={() => copyModel(modelIndex)}
                                  className='text-blue-600 hover:text-blue-700'
                                >
                                  复制
                                </button>
                                <button
                                  onClick={() => removeModel(modelIndex)}
                                  className='text-red-600 hover:text-red-700'
                                >
                                  删除
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className='rounded-lg border bg-white shadow-sm'>
              <div className='flex items-center justify-between gap-4 border-b px-4 py-3'>
                <div>
                  <div className='text-sm font-medium text-gray-900'>厂商平台</div>
                  <div className='text-sm text-gray-500 mt-1'>
                    参考 xiangyu-admin 的平台管理，把通用厂商信息抽出来复用。
                  </div>
                </div>
                <Button variant='outline' onClick={() => openEditPlatform()}>
                  新增平台
                </Button>
              </div>

              <div className='border-b bg-gray-50 px-4 py-3'>
                <div className='max-w-sm'>
                  <label className='mb-1 block text-sm text-gray-600'>平台名称 / Key / Provider</label>
                  <Input
                    value={queryPlatformName}
                    onChange={(e) => setQueryPlatformName(e.target.value)}
                    placeholder='搜索平台名称、Key 或 Provider'
                    className='bg-white'
                  />
                </div>
              </div>

              <div className='overflow-x-auto'>
                <table className='w-full text-sm'>
                  <thead className='bg-gray-50 text-gray-600'>
                    <tr>
                      <th className='px-4 py-3 text-left'>平台</th>
                      <th className='px-4 py-3 text-left'>路由类型</th>
                      <th className='px-4 py-3 text-left'>Provider</th>
                      <th className='px-4 py-3 text-left'>状态</th>
                      <th className='px-4 py-3 text-left'>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPlatforms.length === 0 ? (
                      <tr>
                        <td colSpan={5} className='px-4 py-10 text-center text-gray-500'>
                          暂无匹配平台
                        </td>
                      </tr>
                    ) : (
                      filteredPlatforms.map((platform) => {
                        const platformIndex = (mappingDraft.platforms || []).findIndex(
                          (item) => item.platformKey === platform.platformKey
                        );
                        return (
                          <tr key={`${platform.platformKey}-${platformIndex}`} className='border-t'>
                            <td className='px-4 py-3'>
                              <div className='font-medium text-gray-900'>
                                {platform.platformName || platform.platformKey}
                              </div>
                              <div className='mt-1 font-mono text-xs text-gray-400'>
                                {platform.platformKey || "-"}
                              </div>
                            </td>
                            <td className='px-4 py-3 text-gray-600'>
                              {platform.route || "-"}
                            </td>
                            <td className='px-4 py-3 text-gray-600'>
                              {platform.provider || "-"}
                            </td>
                            <td className='px-4 py-3'>
                              <label className='inline-flex items-center gap-2 text-sm text-gray-700'>
                                <input
                                  type='checkbox'
                                  checked={platform.enabled !== false}
                                  onChange={(e) =>
                                    updatePlatformField(platformIndex, "enabled", e.target.checked)
                                  }
                                />
                                {platform.enabled !== false ? "启用" : "禁用"}
                              </label>
                            </td>
                            <td className='px-4 py-3'>
                              <div className='flex flex-wrap gap-3'>
                                <button
                                  onClick={() => openEditPlatform(platformIndex)}
                                  className='text-blue-600 hover:text-blue-700'
                                >
                                  编辑
                                </button>
                                <button
                                  onClick={() => copyPlatform(platformIndex)}
                                  className='text-blue-600 hover:text-blue-700'
                                >
                                  复制
                                </button>
                                <button
                                  onClick={() => removePlatform(platformIndex)}
                                  className='text-red-600 hover:text-red-700'
                                >
                                  删除
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className='flex flex-wrap gap-3'>
              <Button onClick={handleSave} disabled={saving || loading}>
                {saving ? "保存中..." : "保存配置"}
              </Button>
              <Button
                variant='outline'
                onClick={handleFormat}
                disabled={saving || loading}
              >
                格式化 JSON
              </Button>
              <Button
                variant='outline'
                onClick={loadMapping}
                disabled={saving || loading}
              >
                重新加载
              </Button>
              <Button
                variant='outline'
                onClick={handleReset}
                disabled={saving || loading}
              >
                恢复默认模板
              </Button>
              <Button
                variant='outline'
                onClick={() => setShowJsonEditor((value) => !value)}
                disabled={saving || loading}
              >
                {showJsonEditor ? "收起 JSON" : "展开 JSON"}
              </Button>
            </div>
            {statusText && <div className='text-sm text-gray-500'>{statusText}</div>}

            {showJsonEditor && (
              <div className='rounded-lg border bg-white p-4 shadow-sm'>
                <div className='mb-3 flex items-center justify-between gap-4'>
                  <div>
                    <div className='text-sm font-medium text-gray-900'>高级模式 JSON</div>
                    <div className='text-sm text-gray-500 mt-1'>
                      批量调整时可直接改 JSON，改完点“同步到列表”。
                    </div>
                  </div>
                  <Button
                    variant='outline'
                    onClick={handleApplyJsonToList}
                    disabled={saving || loading}
                  >
                    同步到列表
                  </Button>
                </div>
                <textarea
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  spellCheck={false}
                  className='min-h-[320px] w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 font-mono text-xs leading-6 text-gray-800 outline-none focus:border-blue-400 focus:bg-white'
                  placeholder='请输入模型管理 JSON'
                />
              </div>
            )}
          </div>

          <div className='space-y-4'>
            <div className='rounded-lg border border-blue-100 bg-blue-50 p-4'>
              <div className='text-sm font-medium text-blue-900'>规则说明</div>
              <div className='mt-2 space-y-2 text-sm text-blue-900/80'>
                <p>先在“厂商平台”里维护通用平台模板，再在模型里绑定 vendor。</p>
                <p>同一 `modelKey` 可以配置多个 `vendors`。</p>
                <p>`defaultVendor` 指向默认厂商，运行时会选中该项。</p>
                <p>`enabled: false` 的模型或厂商不会被选中。</p>
                <p>`route: "legacy"` 保持旧链路，`route: "tencent_vod"` 走腾讯 VOD。</p>
              </div>
            </div>

            <div className='rounded-lg border p-4'>
              <div className='text-sm font-medium text-gray-900'>当前建议</div>
              <div className='mt-2 space-y-2 text-sm text-gray-600'>
                <p>默认目录先把首批模型占位录齐，便于后续逐个打通。</p>
                <p>通用厂商信息尽量写到“厂商平台”，模型里只保留模型版本等差异项。</p>
                <p>`kling-o3` 默认保持 `legacy`，验证稳定后再切 `defaultVendor`。</p>
                <p>后续新增模型时沿用相同结构，避免再改接口分发代码。</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {editingModelDraft && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8'>
          <div className='max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-xl bg-white shadow-2xl'>
            <div className='flex items-center justify-between border-b px-6 py-4'>
              <div>
                <div className='text-lg font-semibold text-gray-900'>
                  {editingModelIndex === null ? "新增模型" : "编辑模型"}
                </div>
                <div className='mt-1 text-sm text-gray-500'>
                  参考 xiangyu-admin 的编辑方式，把模型基础信息和厂商路由收在一个弹层里。
                </div>
              </div>
              <Button variant='outline' onClick={closeEditModel}>
                关闭
              </Button>
            </div>

            <div className='space-y-6 px-6 py-5'>
              <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
                <div>
                  <label className='mb-1 block text-sm text-gray-600'>模型 Key</label>
                  <Input
                    value={editingModelDraft.modelKey || ""}
                    onChange={(e) => updateEditingModelField("modelKey", e.target.value)}
                    placeholder='如：kling-o3'
                  />
                </div>
                <div>
                  <label className='mb-1 block text-sm text-gray-600'>模型名称</label>
                  <Input
                    value={editingModelDraft.modelName || ""}
                    onChange={(e) => updateEditingModelField("modelName", e.target.value)}
                    placeholder='如：Kling 3.0-Omni'
                  />
                </div>
                <div>
                  <label className='mb-1 block text-sm text-gray-600'>任务类型</label>
                  <Input
                    value={editingModelDraft.taskType || ""}
                    onChange={(e) => updateEditingModelField("taskType", e.target.value)}
                    placeholder='如：video'
                  />
                </div>
                <div className='flex items-end'>
                  <label className='flex items-center gap-2 text-sm text-gray-700'>
                    <input
                      type='checkbox'
                      checked={editingModelDraft.enabled !== false}
                      onChange={(e) => updateEditingModelField("enabled", e.target.checked)}
                    />
                    启用该模型
                  </label>
                </div>
              </div>

              <div className='rounded-lg border bg-gray-50 p-4'>
                <div className='flex items-center justify-between gap-4'>
                  <div>
                    <div className='text-sm font-medium text-gray-900'>厂商路由</div>
                    <div className='mt-1 text-sm text-gray-500'>
                      一个模型可以对应多个厂商，默认厂商决定当前生效链路。
                    </div>
                  </div>
                  <Button variant='outline' onClick={addEditingVendor}>
                    新增厂商
                  </Button>
                </div>

                <div className='mt-4 space-y-4'>
                  {(editingModelDraft.vendors || []).map((vendor, vendorIndex) => (
                    <div key={`${vendor.vendorKey || "vendor"}-${vendorIndex}`} className='rounded-lg border bg-white p-4'>
                      <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
                        <div>
                          <label className='mb-1 block text-sm text-gray-600'>平台模板</label>
                          <select
                            value={vendor.platformKey || ""}
                            onChange={(e) => {
                              const nextPlatformKey = e.target.value;
                              const targetPlatform = (mappingDraft.platforms || []).find(
                                (item) => item.platformKey === nextPlatformKey
                              );
                              updateEditingVendorField(vendorIndex, "platformKey", nextPlatformKey);
                              if (targetPlatform) {
                                updateEditingVendorField(
                                  vendorIndex,
                                  "label",
                                  vendor.label || targetPlatform.platformName || ""
                                );
                                updateEditingVendorField(
                                  vendorIndex,
                                  "route",
                                  targetPlatform.route || "legacy"
                                );
                                updateEditingVendorField(
                                  vendorIndex,
                                  "provider",
                                  targetPlatform.provider || ""
                                );
                              }
                            }}
                            className='w-full rounded border px-3 py-2 bg-white'
                          >
                            <option value=''>不绑定模板</option>
                            {(mappingDraft.platforms || []).map((platform) => (
                              <option key={platform.platformKey} value={platform.platformKey}>
                                {platform.platformName || platform.platformKey}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className='mb-1 block text-sm text-gray-600'>厂商 Key</label>
                          <Input
                            value={vendor.vendorKey || ""}
                            onChange={(e) =>
                              updateEditingVendorField(vendorIndex, "vendorKey", e.target.value)
                            }
                            placeholder='如：tencent_vod'
                          />
                        </div>
                        <div>
                          <label className='mb-1 block text-sm text-gray-600'>展示名称</label>
                          <Input
                            value={vendor.label || ""}
                            onChange={(e) =>
                              updateEditingVendorField(vendorIndex, "label", e.target.value)
                            }
                            placeholder='如：腾讯 VOD'
                          />
                        </div>
                        <div>
                          <label className='mb-1 block text-sm text-gray-600'>路由类型</label>
                          <select
                            value={vendor.route || "legacy"}
                            onChange={(e) =>
                              updateEditingVendorField(
                                vendorIndex,
                                "route",
                                e.target.value as ModelVendorRouteType
                              )
                            }
                            className='w-full rounded border px-3 py-2 bg-white'
                          >
                            <option value='legacy'>legacy</option>
                            <option value='tencent_vod'>tencent_vod</option>
                          </select>
                        </div>
                        <div className='flex items-end justify-between gap-3'>
                          <label className='flex items-center gap-2 text-sm text-gray-700'>
                            <input
                              type='checkbox'
                              checked={vendor.enabled !== false}
                              onChange={(e) =>
                                updateEditingVendorField(vendorIndex, "enabled", e.target.checked)
                              }
                            />
                            启用
                          </label>
                          <Button
                            variant='outline'
                            onClick={() => removeEditingVendor(vendorIndex)}
                            className='text-red-600 hover:text-red-700'
                          >
                            删除
                          </Button>
                        </div>
                      </div>

                      <div className='mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
                        <div>
                          <label className='mb-1 block text-sm text-gray-600'>Provider</label>
                          <Input
                            value={vendor.provider || ""}
                            onChange={(e) =>
                              updateEditingVendorField(vendorIndex, "provider", e.target.value)
                            }
                            placeholder='如：kling-o3'
                          />
                        </div>
                        <div>
                          <label className='mb-1 block text-sm text-gray-600'>ModelName</label>
                          <Input
                            value={vendor.modelName || ""}
                            onChange={(e) =>
                              updateEditingVendorField(vendorIndex, "modelName", e.target.value)
                            }
                            placeholder='如：Kling'
                          />
                        </div>
                        <div>
                          <label className='mb-1 block text-sm text-gray-600'>ModelVersion</label>
                          <Input
                            value={vendor.modelVersion || ""}
                            onChange={(e) =>
                              updateEditingVendorField(
                                vendorIndex,
                                "modelVersion",
                                e.target.value
                              )
                            }
                            placeholder='如：3.0-Omni'
                          />
                        </div>
                        <div>
                          <label className='mb-1 block text-sm text-gray-600'>默认厂商</label>
                          <label className='flex h-10 items-center gap-2 rounded border bg-white px-3 text-sm text-gray-700'>
                            <input
                              type='radio'
                              name='editing-default-vendor'
                              checked={
                                (editingModelDraft.defaultVendor || "") === (vendor.vendorKey || "")
                              }
                              onChange={() =>
                                updateEditingModelField("defaultVendor", vendor.vendorKey || "")
                              }
                            />
                            设为默认
                          </label>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className='flex justify-end gap-3 border-t px-6 py-4'>
              <Button variant='outline' onClick={closeEditModel}>
                取消
              </Button>
              <Button onClick={saveEditingModel}>保存到列表</Button>
            </div>
          </div>
        </div>
      )}

      {editingPlatformDraft && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8'>
          <div className='w-full max-w-2xl rounded-xl bg-white shadow-2xl'>
            <div className='flex items-center justify-between border-b px-6 py-4'>
              <div>
                <div className='text-lg font-semibold text-gray-900'>
                  {editingPlatformIndex === null ? "新增平台" : "编辑平台"}
                </div>
                <div className='mt-1 text-sm text-gray-500'>
                  平台保存通用路由能力，模型里再绑定和补充模型版本参数。
                </div>
              </div>
              <Button variant='outline' onClick={closeEditPlatform}>
                关闭
              </Button>
            </div>

            <div className='space-y-4 px-6 py-5'>
              <div className='grid gap-4 md:grid-cols-2'>
                <div>
                  <label className='mb-1 block text-sm text-gray-600'>平台 Key</label>
                  <Input
                    value={editingPlatformDraft.platformKey || ""}
                    onChange={(e) =>
                      updateEditingPlatformField("platformKey", e.target.value)
                    }
                    placeholder='如：tencent_vod'
                  />
                </div>
                <div>
                  <label className='mb-1 block text-sm text-gray-600'>平台名称</label>
                  <Input
                    value={editingPlatformDraft.platformName || ""}
                    onChange={(e) =>
                      updateEditingPlatformField("platformName", e.target.value)
                    }
                    placeholder='如：腾讯 VOD'
                  />
                </div>
              </div>

              <div className='grid gap-4 md:grid-cols-2'>
                <div>
                  <label className='mb-1 block text-sm text-gray-600'>路由类型</label>
                  <select
                    value={editingPlatformDraft.route || "legacy"}
                    onChange={(e) =>
                      updateEditingPlatformField(
                        "route",
                        e.target.value as ModelVendorRouteType
                      )
                    }
                    className='w-full rounded border px-3 py-2 bg-white'
                  >
                    <option value='legacy'>legacy</option>
                    <option value='tencent_vod'>tencent_vod</option>
                  </select>
                </div>
                <div>
                  <label className='mb-1 block text-sm text-gray-600'>Provider</label>
                  <Input
                    value={editingPlatformDraft.provider || ""}
                    onChange={(e) =>
                      updateEditingPlatformField("provider", e.target.value)
                    }
                    placeholder='如：kling-o3'
                  />
                </div>
              </div>

              <div>
                <label className='mb-1 block text-sm text-gray-600'>说明</label>
                <textarea
                  value={editingPlatformDraft.description || ""}
                  onChange={(e) =>
                    updateEditingPlatformField("description", e.target.value)
                  }
                  className='min-h-[100px] w-full rounded border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400'
                  placeholder='如：腾讯云 VOD AIGC 视频生成'
                />
              </div>

              <label className='flex items-center gap-2 text-sm text-gray-700'>
                <input
                  type='checkbox'
                  checked={editingPlatformDraft.enabled !== false}
                  onChange={(e) =>
                    updateEditingPlatformField("enabled", e.target.checked)
                  }
                />
                启用该平台
              </label>
            </div>

            <div className='flex justify-end gap-3 border-t px-6 py-4'>
              <Button variant='outline' onClick={closeEditPlatform}>
                取消
              </Button>
              <Button onClick={saveEditingPlatform}>保存到列表</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 系统设置 Tab
function SettingsTab() {
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sora2Provider, setSora2Provider] = useState("auto");
  const [bananaProvider, setBananaProvider] = useState("auto");
  const [bananaTextProvider, setBananaTextProvider] = useState("auto");

  // 微信二维码状态
  const [officialQrCode, setOfficialQrCode] = useState<string>("");
  const [groupQrCode, setGroupQrCode] = useState<string>("");
  const [uploadingOfficial, setUploadingOfficial] = useState(false);
  const [uploadingGroup, setUploadingGroup] = useState(false);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const result = await getSettings();
      setSettings(result);
      // 找到 sora2_provider 设置
      const sora2Setting = result.find((s) => s.key === "sora2_provider");
      if (sora2Setting) {
        setSora2Provider(sora2Setting.value);
      }
      const bananaSetting = result.find((s) => s.key === "banana_provider");
      if (bananaSetting) {
        setBananaProvider(bananaSetting.value);
      }
      const bananaTextSetting = result.find(
        (s) => s.key === "banana_text_provider"
      );
      if (bananaTextSetting) {
        setBananaTextProvider(bananaTextSetting.value);
      }
      // 加载微信二维码设置
      const officialSetting = result.find((s) => s.key === "wechat_official_account_qrcode");
      if (officialSetting) {
        setOfficialQrCode(officialSetting.value);
      }
      const groupSetting = result.find((s) => s.key === "wechat_group_qrcode");
      if (groupSetting) {
        setGroupQrCode(groupSetting.value);
      }
    } catch (error) {
      console.error("加载设置失败:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  // 上传二维码图片
  const handleQrCodeUpload = async (
    file: File,
    type: 'official' | 'group'
  ) => {
    const setUploading = type === 'official' ? setUploadingOfficial : setUploadingGroup;
    const settingKey = type === 'official' ? 'wechat_official_account_qrcode' : 'wechat_group_qrcode';
    const description = type === 'official' ? '微信公众号二维码' : '微信交流群二维码';

    setUploading(true);
    try {
      // 使用 OSS 上传
      const { uploadToOSS } = await import('@/services/ossUploadService');
      const result = await uploadToOSS(file, {
        dir: 'settings/qrcodes/',
        fileName: file.name,
      });

      if (!result.success || !result.url) {
        throw new Error(result.error || '上传失败');
      }

      // 保存到系统设置
      await upsertSetting({
        key: settingKey,
        value: result.url,
        description,
      });

      // 更新本地状态
      if (type === 'official') {
        setOfficialQrCode(result.url);
      } else {
        setGroupQrCode(result.url);
      }

      alert('上传成功');
      loadSettings();
    } catch (error: any) {
      alert(error.message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleSaveSora2Provider = async () => {
    setSaving(true);
    try {
      await upsertSetting({
        key: "sora2_provider",
        value: sora2Provider,
        description: "Sora2 视频生成 API 供应商选择",
      });
      alert("保存成功");
      loadSettings();
    } catch (error: any) {
      alert(error.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBananaProvider = async () => {
    setSaving(true);
    try {
      await upsertSetting({
        key: "banana_provider",
        value: bananaProvider,
        description: "Banana 图像底层 API 供应商选择",
      });
      alert("保存成功");
      loadSettings();
    } catch (error: any) {
      alert(error.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBananaTextProvider = async () => {
    setSaving(true);
    try {
      await upsertSetting({
        key: "banana_text_provider",
        value: bananaTextProvider,
        description: "Banana 语言底层 API 供应商选择",
      });
      alert("保存成功");
      loadSettings();
    } catch (error: any) {
      alert(error.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className='text-center py-8 text-gray-500'>加载中...</div>;
  }

  return (
    <div className='space-y-6'>
      {/* Sora2 供应商设置 */}
      <div className='bg-white rounded-lg border p-6 shadow-sm'>
        <h3 className='text-lg font-semibold mb-4'>Sora2 视频生成设置</h3>
        <p className='text-sm text-gray-500 mb-4'>
          选择视频生成时使用的 API
          供应商。若要确保不走 147，请选择 APIMart 渠道。
        </p>
        <div className='space-y-3'>
          {SORA2_PROVIDER_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition ${
                sora2Provider === option.value
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <input
                type='radio'
                name='sora2Provider'
                value={option.value}
                checked={sora2Provider === option.value}
                onChange={(e) => setSora2Provider(e.target.value)}
                className='mt-1'
              />
              <div>
                <div className='font-medium'>{option.label}</div>
                <div className='text-sm text-gray-500'>
                  {option.description}
                </div>
              </div>
            </label>
          ))}
        </div>
        <div className='mt-4'>
          <Button onClick={handleSaveSora2Provider} disabled={saving}>
            {saving ? "保存中..." : "保存设置"}
          </Button>
        </div>
      </div>

      <div className='bg-white rounded-lg border p-6 shadow-sm'>
        <h3 className='text-lg font-semibold mb-4'>Banana 图像生成设置</h3>
        <p className='text-sm text-gray-500 mb-4'>
          选择 Banana 图像能力底层使用的 API 供应商。支持两种自动模式：
          Apimart 优先或 147 优先。
        </p>
        <div className='space-y-3'>
          {BANANA_PROVIDER_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition ${
                bananaProvider === option.value
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <input
                type='radio'
                name='bananaProvider'
                value={option.value}
                checked={bananaProvider === option.value}
                onChange={(e) => setBananaProvider(e.target.value)}
                className='mt-1'
              />
              <div>
                <div className='font-medium'>{option.label}</div>
                <div className='text-sm text-gray-500'>
                  {option.description}
                </div>
              </div>
            </label>
          ))}
        </div>
        <div className='mt-4'>
          <Button onClick={handleSaveBananaProvider} disabled={saving}>
            {saving ? "保存中..." : "保存设置"}
          </Button>
        </div>
      </div>

      <div className='bg-white rounded-lg border p-6 shadow-sm'>
        <h3 className='text-lg font-semibold mb-4'>Banana 语言生成设置</h3>
        <p className='text-sm text-gray-500 mb-4'>
          选择 Banana 语言类能力（文本对话、工具选择、提示词优化）底层使用的 API
          供应商。支持两种自动模式：Apimart 优先或 147 优先。
        </p>
        <div className='space-y-3'>
          {BANANA_TEXT_PROVIDER_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition ${
                bananaTextProvider === option.value
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <input
                type='radio'
                name='bananaTextProvider'
                value={option.value}
                checked={bananaTextProvider === option.value}
                onChange={(e) => setBananaTextProvider(e.target.value)}
                className='mt-1'
              />
              <div>
                <div className='font-medium'>{option.label}</div>
                <div className='text-sm text-gray-500'>
                  {option.description}
                </div>
              </div>
            </label>
          ))}
        </div>
        <div className='mt-4'>
          <Button onClick={handleSaveBananaTextProvider} disabled={saving}>
            {saving ? "保存中..." : "保存设置"}
          </Button>
        </div>
      </div>

      {/* 微信二维码设置 */}
      <div className='bg-white rounded-lg border p-6 shadow-sm'>
        <h3 className='text-lg font-semibold mb-4'>微信咨询二维码</h3>
        <p className='text-sm text-gray-500 mb-4'>
          设置欢迎页面右下角悬浮按钮显示的微信二维码，用于用户咨询和加入交流群。
        </p>
        <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
          {/* 公众号二维码 */}
          <div className='border rounded-lg p-4'>
            <div className='text-sm font-medium mb-3'>公众号二维码</div>
            <div className='flex flex-col items-center'>
              <div className='w-32 h-32 bg-gray-100 rounded-lg mb-3 flex items-center justify-center overflow-hidden'>
                {officialQrCode ? (
                  <img src={officialQrCode} alt='公众号二维码' className='w-full h-full object-contain' />
                ) : (
                  <span className='text-gray-400 text-xs'>暂无图片</span>
                )}
              </div>
              <label className='cursor-pointer'>
                <input
                  type='file'
                  accept='image/*'
                  className='hidden'
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleQrCodeUpload(file, 'official');
                    e.target.value = '';
                  }}
                  disabled={uploadingOfficial}
                />
                <span className={`px-4 py-2 text-sm rounded-lg border transition ${
                  uploadingOfficial
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-white hover:bg-gray-50 text-gray-700 cursor-pointer'
                }`}>
                  {uploadingOfficial ? '上传中...' : officialQrCode ? '更换图片' : '上传图片'}
                </span>
              </label>
            </div>
          </div>

          {/* 交流群二维码 */}
          <div className='border rounded-lg p-4'>
            <div className='text-sm font-medium mb-3'>微信交流群二维码</div>
            <div className='flex flex-col items-center'>
              <div className='w-32 h-32 bg-gray-100 rounded-lg mb-3 flex items-center justify-center overflow-hidden'>
                {groupQrCode ? (
                  <img src={groupQrCode} alt='交流群二维码' className='w-full h-full object-contain' />
                ) : (
                  <span className='text-gray-400 text-xs'>暂无图片</span>
                )}
              </div>
              <label className='cursor-pointer'>
                <input
                  type='file'
                  accept='image/*'
                  className='hidden'
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleQrCodeUpload(file, 'group');
                    e.target.value = '';
                  }}
                  disabled={uploadingGroup}
                />
                <span className={`px-4 py-2 text-sm rounded-lg border transition ${
                  uploadingGroup
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-white hover:bg-gray-50 text-gray-700 cursor-pointer'
                }`}>
                  {uploadingGroup ? '上传中...' : groupQrCode ? '更换图片' : '上传图片'}
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* 当前设置列表 */}
      <div className='bg-white rounded-lg border p-6 shadow-sm'>
        <h3 className='text-lg font-semibold mb-4'>所有系统设置</h3>
        {settings.length === 0 ? (
          <p className='text-gray-500'>暂无设置</p>
        ) : (
          <table className='w-full text-sm'>
            <thead className='bg-gray-50'>
              <tr>
                <th className='px-4 py-2 text-left'>键名</th>
                <th className='px-4 py-2 text-left'>值</th>
                <th className='px-4 py-2 text-left'>描述</th>
                <th className='px-4 py-2 text-left'>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {settings.map((setting) => (
                <tr key={setting.id} className='border-t'>
                  <td className='px-4 py-2 font-mono text-xs'>{setting.key}</td>
                  <td className='px-4 py-2'>
                    <span className='px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs'>
                      {setting.value}
                    </span>
                  </td>
                  <td className='px-4 py-2 text-gray-500'>
                    {setting.description || "-"}
                  </td>
                  <td className='px-4 py-2 text-xs text-gray-400'>
                    {new Date(setting.updatedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// 节点配置管理 Tab
function NodeConfigsTab() {
  const [configs, setConfigs] = useState<NodeConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingConfig, setEditingConfig] = useState<NodeConfig | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const loadConfigs = async () => {
    setLoading(true);
    try {
      const result = await getNodeConfigs();
      setConfigs(result);
    } catch (error) {
      console.error("加载节点配置失败:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfigs();
  }, []);

  const handleEdit = (config: NodeConfig) => {
    setEditingConfig({ ...config });
    setIsCreating(false);
    setModalOpen(true);
  };

  const handleCreate = () => {
    setEditingConfig({
      nodeKey: "",
      nameZh: "",
      nameEn: "",
      category: "other",
      status: "normal",
      creditsPerCall: 0,
      sortOrder: 0,
      isVisible: true,
    });
    setIsCreating(true);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!editingConfig) return;

    if (isCreating) {
      if (!editingConfig.nodeKey || !editingConfig.nameZh || !editingConfig.nameEn) {
        alert("请填写节点标识、中文名称和英文名称");
        return;
      }
      try {
        await createNodeConfig({
          nodeKey: editingConfig.nodeKey,
          nameZh: editingConfig.nameZh,
          nameEn: editingConfig.nameEn,
          category: editingConfig.category,
          status: editingConfig.status,
          statusMessage: editingConfig.statusMessage,
          creditsPerCall: editingConfig.creditsPerCall,
          priceYuan: editingConfig.priceYuan,
          serviceType: editingConfig.serviceType,
          sortOrder: editingConfig.sortOrder,
          isVisible: editingConfig.isVisible,
          description: editingConfig.description,
        });
        notifyNodeConfigsUpdated();
        setModalOpen(false);
        setEditingConfig(null);
        loadConfigs();
      } catch (error: any) {
        alert(error.message || "创建失败");
      }
    } else {
      try {
        await updateNodeConfig(editingConfig.nodeKey, {
          nameZh: editingConfig.nameZh,
          nameEn: editingConfig.nameEn,
          category: editingConfig.category,
          status: editingConfig.status,
          statusMessage: editingConfig.statusMessage,
          creditsPerCall: editingConfig.creditsPerCall,
          priceYuan: editingConfig.priceYuan,
          serviceType: editingConfig.serviceType,
          sortOrder: editingConfig.sortOrder,
          isVisible: editingConfig.isVisible,
          description: editingConfig.description,
        });
        notifyNodeConfigsUpdated();
        setModalOpen(false);
        setEditingConfig(null);
        loadConfigs();
      } catch (error: any) {
        alert(error.message || "保存失败");
      }
    }
  };

  const handleDelete = async (nodeKey: string, nameZh: string) => {
    if (!confirm(`确定要删除节点"${nameZh}"吗？此操作不可恢复。`)) {
      return;
    }
    try {
      await deleteNodeConfig(nodeKey);
      notifyNodeConfigsUpdated();
      loadConfigs();
    } catch (error: any) {
      alert(error.message || "删除失败");
    }
  };

  const statusOptions = [
    { value: "normal", label: "正常" },
    { value: "maintenance", label: "维护中" },
    { value: "coming_soon", label: "即将开放" },
    { value: "disabled", label: "已禁用" },
  ];

  const categoryOptions = [
    { value: "input", label: "输入节点" },
    { value: "image", label: "图像生成" },
    { value: "video", label: "视频生成" },
    { value: "other", label: "其他" },
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "normal":
        return <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">正常</span>;
      case "maintenance":
        return <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs">维护中</span>;
      case "coming_soon":
        return <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs">即将开放</span>;
      case "disabled":
        return <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs">已禁用</span>;
      default:
        return <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">{status}</span>;
    }
  };

  const getCategoryBadge = (category: string) => {
    switch (category) {
      case "input":
        return <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">输入</span>;
      case "image":
        return <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs">图像</span>;
      case "video":
        return <span className="px-2 py-1 bg-pink-100 text-pink-700 rounded text-xs">视频</span>;
      default:
        return <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">其他</span>;
    }
  };

  return (
    <div>
      <div className="mb-4">
        <Button onClick={handleCreate}>添加节点</Button>
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="max-h-[800px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left">节点</th>
                <th className="px-4 py-3 text-left">分类</th>
                <th className="px-4 py-3 text-left">状态</th>
                <th className="px-4 py-3 text-right">积分/次</th>
                <th className="px-4 py-3 text-right">原价(元)</th>
                <th className="px-4 py-3 text-left">服务类型</th>
                <th className="px-4 py-3 text-center">显示</th>
                <th className="px-4 py-3 text-left">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">加载中...</td>
                </tr>
              ) : configs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    暂无数据，请点击"初始化默认配置"
                  </td>
                </tr>
              ) : (
                configs.map((config) => (
                  <tr key={config.nodeKey} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium">{config.nameZh}</div>
                      <div className="text-xs text-gray-400">{config.nodeKey}</div>
                    </td>
                    <td className="px-4 py-3">{getCategoryBadge(config.category)}</td>
                    <td className="px-4 py-3">
                      {getStatusBadge(config.status)}
                      {config.statusMessage && (
                        <div className="text-xs text-gray-400 mt-1">{config.statusMessage}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {config.creditsPerCall > 0 ? config.creditsPerCall : <span className="text-green-600">免费</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {config.priceYuan ? `¥${config.priceYuan}` : "-"}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {config.serviceType || "-"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {config.isVisible ? (
                        <span className="text-green-600">✓</span>
                      ) : (
                        <span className="text-red-600">✗</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => handleEdit(config)}>
                          编辑
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDelete(config.nodeKey, config.nameZh)}
                          className="text-red-600 hover:text-red-700 hover:border-red-300"
                        >
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 编辑弹窗 */}
      {modalOpen && editingConfig && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-auto">
            <h3 className="text-lg font-semibold mb-4">
              {isCreating ? "添加节点" : `编辑节点 - ${editingConfig.nameZh}`}
            </h3>
            <div className="space-y-4">
              {isCreating && (
                <div>
                  <label className="block text-sm text-gray-600 mb-1">节点标识 *</label>
                  <Input
                    value={editingConfig.nodeKey}
                    onChange={(e) => setEditingConfig({ ...editingConfig, nodeKey: e.target.value })}
                    placeholder="如：myNewNode（唯一标识，创建后不可修改）"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">中文名称 *</label>
                  <Input
                    value={editingConfig.nameZh}
                    onChange={(e) => setEditingConfig({ ...editingConfig, nameZh: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">英文名称 *</label>
                  <Input
                    value={editingConfig.nameEn}
                    onChange={(e) => setEditingConfig({ ...editingConfig, nameEn: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">分类</label>
                  <select
                    value={editingConfig.category}
                    onChange={(e) => setEditingConfig({ ...editingConfig, category: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  >
                    {categoryOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">状态</label>
                  <select
                    value={editingConfig.status}
                    onChange={(e) => setEditingConfig({ ...editingConfig, status: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  >
                    {statusOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">状态说明（可选）</label>
                <Input
                  value={editingConfig.statusMessage || ""}
                  onChange={(e) => setEditingConfig({ ...editingConfig, statusMessage: e.target.value })}
                  placeholder="如：接口维护中，预计明天恢复"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">积分消耗/次</label>
                  <Input
                    type="number"
                    value={editingConfig.creditsPerCall}
                    onChange={(e) => setEditingConfig({ ...editingConfig, creditsPerCall: parseInt(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">原价(元)</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editingConfig.priceYuan || ""}
                    onChange={(e) => setEditingConfig({ ...editingConfig, priceYuan: parseFloat(e.target.value) || undefined })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">服务类型</label>
                  <Input
                    value={editingConfig.serviceType || ""}
                    onChange={(e) => setEditingConfig({ ...editingConfig, serviceType: e.target.value })}
                    placeholder="如：kling-o1-video"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">排序</label>
                  <Input
                    type="number"
                    value={editingConfig.sortOrder}
                    onChange={(e) => setEditingConfig({ ...editingConfig, sortOrder: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">描述</label>
                <Input
                  value={editingConfig.description || ""}
                  onChange={(e) => setEditingConfig({ ...editingConfig, description: e.target.value })}
                  placeholder="节点功能描述"
                />
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editingConfig.isVisible}
                    onChange={(e) => setEditingConfig({ ...editingConfig, isVisible: e.target.checked })}
                  />
                  <span className="text-sm text-gray-600">在节点面板中显示</span>
                </label>
              </div>

              <div className="flex gap-2 justify-end pt-4">
                <Button variant="outline" onClick={() => { setModalOpen(false); setEditingConfig(null); }}>
                  取消
                </Button>
                <Button onClick={handleSave}>保存</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 主页面
export default function Admin() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<
    | "dashboard"
    | "users"
    | "paid-users"
    | "credit-records"
    | "credit-anomalies"
    | "api-stats"
    | "api-records"
    | "watermark"
    | "node-configs"
    | "settings"
    | "templates"
  >("dashboard");
  const [settingsSubTab, setSettingsSubTab] = useState<"system" | "model-management">(
    "system"
  );
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    // 检查是否为管理员
    if (user && user.role !== "admin") {
      navigate("/");
      return;
    }
  }, [user, navigate]);

  useEffect(() => {
    if (!user || user.role !== "admin") return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const loadDashboard = async (showLoading = false) => {
      if (showLoading) setLoading(true);
      try {
        const data = await getDashboardStats();
        if (cancelled) return;
        setStats(data);
        setDashboardError(null);
        setLastUpdatedAt(data.generatedAt);
      } catch (error) {
        if (cancelled) return;
        console.error("加载统计失败:", error);
        setDashboardError("统计刷新失败，请稍后重试");
      } finally {
        if (!cancelled && showLoading) setLoading(false);
      }
    };

    if (activeTab === "dashboard") {
      void loadDashboard(true);
      timer = setInterval(() => {
        void loadDashboard(false);
      }, 10 * 60 * 1000);
    }

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [user, activeTab]);

  if (!user || user.role !== "admin") {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <div className='text-center'>
          <h1 className='text-2xl font-bold mb-2'>无权访问</h1>
          <p className='text-gray-500 mb-4'>您没有管理员权限</p>
          <Button onClick={() => navigate("/")}>返回首页</Button>
        </div>
      </div>
    );
  }

  const tabs = [
    { key: "dashboard", label: "概览" },
    { key: "users", label: "用户管理" },
    { key: "paid-users", label: "付费用户" },
    { key: "credit-records", label: "积分记录" },
    { key: "credit-anomalies", label: "异常积分" },
    { key: "api-stats", label: "API统计" },
    { key: "api-records", label: "API记录" },
    { key: "watermark", label: "水印白名单" },
    { key: "node-configs", label: "节点管理" },
    { key: "templates", label: "公共模板" },
    { key: "settings", label: "系统设置" },
  ] as const;

  return (
    <div className='h-screen overflow-y-auto bg-gray-100'>
      {/* 顶部导航 */}
      <header className='bg-white border-b'>
        <div className='max-w-7xl mx-auto px-4 py-4 flex items-center justify-between'>
          <div className='flex items-center gap-4'>
            <h1 className='text-xl font-bold'>管理后台</h1>
            <nav className='flex gap-1 ml-8'>
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition ${
                    activeTab === tab.key
                      ? "bg-blue-100 text-blue-700"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
          <Button variant='ghost' onClick={() => navigate(-1)}>
            返回
          </Button>
        </div>
      </header>

      {/* 主内容区 */}
      <main className='max-w-7xl mx-auto px-4 py-6'>
        {activeTab === "dashboard" && (
          <div>
            <h2 className='text-lg font-semibold mb-4'>系统概览</h2>
            {loading && !stats ? (
              <div className='text-center py-8 text-gray-500'>加载中...</div>
            ) : stats ? (
              <div className='space-y-4'>
                <div className='text-xs text-gray-500'>
                  自动刷新：每 10 分钟
                  {lastUpdatedAt
                    ? ` · 最后更新 ${new Date(lastUpdatedAt).toLocaleTimeString("zh-CN", {
                        hour12: false,
                      })}`
                    : ""}
                </div>
                <div className='grid grid-cols-2 md:grid-cols-4 gap-4'>
                  <StatCard title='总用户数' value={stats.totalUsers} />
                  <StatCard title='日活用户' value={stats.dailyActiveUsers} subtitle='当天累计去重' />
                  <StatCard title='在线用户' value={stats.onlineUsers} subtitle='最近 15 分钟内有登录态请求' />
                  <StatCard title='当日注册用户' value={stats.todayRegisteredUsers} subtitle='当天新增' />
                  <StatCard
                    title='流通积分'
                    value={stats.totalCreditsInCirculation}
                  />
                  <StatCard title='已消费积分' value={stats.totalCreditsSpent} />
                  <StatCard
                    title='API调用总数'
                    value={stats.totalApiCalls}
                    subtitle={`成功: ${stats.successfulApiCalls} / 失败: ${stats.failedApiCalls}`}
                  />
                  <StatCard
                    title='API成功率'
                    value={
                      stats.totalApiCalls > 0
                        ? `${(
                            (stats.successfulApiCalls / stats.totalApiCalls) *
                            100
                          ).toFixed(1)}%`
                        : "-"
                    }
                  />
                </div>
                <div className='bg-white rounded-lg border p-4 shadow-sm'>
                  <div className='text-sm font-medium text-gray-700 mb-3'>注册用户 vs 日活用户（近 14 天）</div>
                  <DashboardTrendChart data={stats.userTrend} />
                </div>
                {dashboardError && <div className='text-sm text-red-500'>{dashboardError}</div>}
              </div>
            ) : (
              <div className='text-center py-8 text-gray-500'>加载失败</div>
            )}
          </div>
        )}

        {activeTab === "users" && <UsersTab />}
        {activeTab === "paid-users" && <PaidUsersTab />}
        {activeTab === "credit-records" && <CreditChangeRecordsTab />}
        {activeTab === "credit-anomalies" && <CreditAnomaliesTab />}
        {activeTab === "api-stats" && <ApiStatsTab />}
        {activeTab === "api-records" && <ApiRecordsTab />}
        {activeTab === "watermark" && <WatermarkWhitelistTab />}
        {activeTab === "node-configs" && <NodeConfigsTab />}
        {activeTab === "templates" && <TemplatesTab />}
        {activeTab === "settings" && (
          <div className='space-y-4'>
            <div className='rounded-lg border bg-white p-2 shadow-sm'>
              <div className='flex flex-wrap gap-2'>
                {[
                  { key: "system", label: "当前系统设置" },
                  { key: "model-management", label: "模型管理" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() =>
                      setSettingsSubTab(
                        tab.key as "system" | "model-management"
                      )
                    }
                    className={`rounded-md px-4 py-2 text-sm font-medium transition ${
                      settingsSubTab === tab.key
                        ? "bg-blue-100 text-blue-700"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {settingsSubTab === "system" && <SettingsTab />}
            {settingsSubTab === "model-management" && <ModelManagementTab />}
          </div>
        )}
      </main>
    </div>
  );
}
