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
  updateUserStatus,
  updateUserRole,
  getSettings,
  upsertSetting,
  getWatermarkWhitelist,
  addToWatermarkWhitelist,
  removeFromWatermarkWhitelist,
  getPaidUsers,
  getNodeConfigs,
  updateNodeConfig,
  createNodeConfig,
  type DashboardStats,
  type UserWithCredits,
  type ApiUsageStats,
  type ApiUsageRecord,
  type Pagination,
  type SystemSetting,
  type WatermarkWhitelistUser,
  type PaidUser,
  type NodeConfig,
} from "@/services/adminApi";
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

// 用户管理 Tab
function UsersTab() {
  const [users, setUsers] = useState<UserWithCredits[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  // 积分操作弹窗
  const [creditModal, setCreditModal] = useState<{
    userId: string;
    userName: string;
    type: "add" | "deduct";
  } | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");

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
                      <div className='flex gap-1'>
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
    description: "优先使用Sora2 Pro，失败后自动切换到普通Sora2",
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

  const loadUsers = async () => {
    setLoading(true);
    try {
      const result = await getPaidUsers({ page, pageSize: 10, search });
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
  }, [page, search]);

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
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className='px-4 py-8 text-center text-gray-500'>加载中...</td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={8} className='px-4 py-8 text-center text-gray-500'>暂无付费用户</td>
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
                      <span className={`px-2 py-1 rounded text-xs ${
                        user.status === 'active' ? 'bg-green-100 text-green-700' :
                        user.status === 'inactive' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {user.status === 'active' ? '正常' : user.status === 'inactive' ? '禁用' : '封禁'}
                      </span>
                    </td>
                    <td className='px-4 py-3 text-xs text-gray-500'>
                      {new Date(user.createdAt).toLocaleDateString()}
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

// 系统设置 Tab
function SettingsTab() {
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sora2Provider, setSora2Provider] = useState("auto");

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
    } catch (error) {
      console.error("加载设置失败:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

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
          供应商。自动模式会优先使用Sora2 Pro，失败后自动切换到普通Sora2。
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
        setModalOpen(false);
        setEditingConfig(null);
        loadConfigs();
      } catch (error: any) {
        alert(error.message || "保存失败");
      }
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
                      <Button size="sm" variant="outline" onClick={() => handleEdit(config)}>
                        编辑
                      </Button>
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
    | "api-stats"
    | "api-records"
    | "watermark"
    | "node-configs"
    | "settings"
    | "templates"
  >("dashboard");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 检查是否为管理员
    if (user && user.role !== "admin") {
      navigate("/");
      return;
    }

    const loadDashboard = async () => {
      try {
        const data = await getDashboardStats();
        setStats(data);
      } catch (error) {
        console.error("加载统计失败:", error);
      } finally {
        setLoading(false);
      }
    };

    loadDashboard();
  }, [user, navigate]);

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
    { key: "api-stats", label: "API统计" },
    { key: "api-records", label: "API记录" },
    { key: "watermark", label: "水印白名单" },
    { key: "node-configs", label: "节点管理" },
    { key: "templates", label: "公共模板" },
    { key: "settings", label: "系统设置" },
  ] as const;

  return (
    <div className='min-h-screen bg-gray-100'>
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
            {loading ? (
              <div className='text-center py-8 text-gray-500'>加载中...</div>
            ) : stats ? (
              <div className='grid grid-cols-2 md:grid-cols-4 gap-4'>
                <StatCard title='总用户数' value={stats.totalUsers} />
                <StatCard title='活跃用户' value={stats.activeUsers} />
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
            ) : (
              <div className='text-center py-8 text-gray-500'>加载失败</div>
            )}
          </div>
        )}

        {activeTab === "users" && <UsersTab />}
        {activeTab === "paid-users" && <PaidUsersTab />}
        {activeTab === "api-stats" && <ApiStatsTab />}
        {activeTab === "api-records" && <ApiRecordsTab />}
        {activeTab === "watermark" && <WatermarkWhitelistTab />}
        {activeTab === "node-configs" && <NodeConfigsTab />}
        {activeTab === "templates" && <TemplatesTab />}
        {activeTab === "settings" && <SettingsTab />}
      </main>
    </div>
  );
}
