import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getDashboardStats,
  getUsers,
  getApiUsageStats,
  getApiUsageRecords,
  addCredits,
  deductCredits,
  updateUserStatus,
  updateUserRole,
  listInvites,
  generateInvites,
  disableInvite,
  type DashboardStats,
  type UserWithCredits,
  type ApiUsageStats,
  type ApiUsageRecord,
  type Pagination,
  type InvitationCode,
} from "@/services/adminApi";

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
      const result = await getUsers({ page, pageSize: 20, search });
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
                <td colSpan={9} className='px-4 py-8 text-center text-gray-500'>
                  加载中...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={9} className='px-4 py-8 text-center text-gray-500'>
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

  return (
    <div className='bg-white rounded-lg border overflow-hidden'>
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
            stats.map((stat) => (
              <tr key={stat.serviceType} className='border-t hover:bg-gray-50'>
                <td className='px-4 py-3 font-medium'>{stat.serviceName}</td>
                <td className='px-4 py-3 text-gray-500'>{stat.serviceType}</td>
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
                    ? ((stat.successfulCalls / stat.totalCalls) * 100).toFixed(
                        1
                      )
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
        pageSize: 50,
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
                <td colSpan={7} className='px-4 py-8 text-center text-gray-500'>
                  加载中...
                </td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td colSpan={7} className='px-4 py-8 text-center text-gray-500'>
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
                    {record.creditsUsed}
                  </td>
                  <td className='px-4 py-3 text-right text-gray-500'>
                    {record.processingTime ? `${record.processingTime}ms` : "-"}
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

// 邀请码管理 Tab
function InvitesTab() {
  const [items, setItems] = useState<InvitationCode[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("");
  const [codeSearch, setCodeSearch] = useState("");

  const [genCount, setGenCount] = useState("10");
  const [genMaxUses, setGenMaxUses] = useState("1");
  const [genPrefix, setGenPrefix] = useState("");
  const [genInviter, setGenInviter] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await listInvites({
        page,
        pageSize: 20,
        status: status || undefined,
        code: codeSearch || undefined,
      });
      setItems(res.items);
      setPagination(res.pagination);
    } catch (e: any) {
      alert(e?.message || "加载邀请码失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [page, status]);

  const onGenerate = async () => {
    try {
      const count = Number(genCount) || 1;
      const maxUses = Number(genMaxUses) || 1;
      await generateInvites({
        count,
        maxUses,
        prefix: genPrefix || undefined,
        inviterUserId: genInviter || undefined,
      });
      load();
      alert("生成成功");
    } catch (e: any) {
      alert(e?.message || "生成失败");
    }
  };

  const onDisable = async (id: string) => {
    if (!confirm("确认禁用该邀请码？")) return;
    try {
      await disableInvite(id);
      load();
    } catch (e: any) {
      alert(e?.message || "禁用失败");
    }
  };

  return (
    <div className='space-y-4'>
      <div className='grid md:grid-cols-2 gap-4'>
        <div className='bg-white border rounded-lg p-4 shadow-sm space-y-3'>
          <h3 className='font-semibold'>生成邀请码</h3>
          <div className='grid grid-cols-2 gap-2'>
            <Input
              placeholder='数量'
              value={genCount}
              onChange={(e) => setGenCount(e.target.value)}
            />
            <Input
              placeholder='每码可用次数'
              value={genMaxUses}
              onChange={(e) => setGenMaxUses(e.target.value)}
            />
            <Input
              placeholder='前缀（可选）'
              value={genPrefix}
              onChange={(e) => setGenPrefix(e.target.value)}
            />
            <Input
              placeholder='邀请人用户ID（可选）'
              value={genInviter}
              onChange={(e) => setGenInviter(e.target.value)}
            />
          </div>
          <Button onClick={onGenerate}>生成</Button>
        </div>

        <div className='bg-white border rounded-lg p-4 shadow-sm space-y-3'>
          <h3 className='font-semibold'>筛选</h3>
          <div className='grid grid-cols-3 gap-2'>
            <Input
              placeholder='按code搜索'
              value={codeSearch}
              onChange={(e) => setCodeSearch(e.target.value)}
            />
            <select
              className='border rounded px-2 py-2'
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value=''>全部状态</option>
              <option value='active'>可用</option>
              <option value='used'>已用完</option>
              <option value='disabled'>已禁用</option>
            </select>
            <Button
              variant='outline'
              onClick={() => {
                setCodeSearch("");
                setStatus("");
                setPage(1);
                load();
              }}
            >
              重置
            </Button>
            <Button
              variant='outline'
              onClick={() => {
                setPage(1);
                load();
              }}
            >
              查找
            </Button>
          </div>
        </div>
      </div>

      <div className='bg-white border rounded-lg p-4 shadow-sm overflow-auto'>
        <table className='w-full text-sm'>
          <thead>
            <tr className='text-left border-b'>
              <th className='py-2 pr-2'>Code</th>
              <th className='py-2 pr-2'>状态</th>
              <th className='py-2 pr-2'>用量</th>
              <th className='py-2 pr-2'>邀请人</th>
              <th className='py-2 pr-2'>使用用户</th>
              <th className='py-2 pr-2'>创建时间</th>
              <th className='py-2 pr-2'>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className='border-b last:border-none'>
                <td className='py-2 pr-2 font-mono'>{item.code}</td>
                <td className='py-2 pr-2'>{item.status}</td>
                <td className='py-2 pr-2'>
                  {item.usedCount}/{item.maxUses}
                </td>
                <td className='py-2 pr-2 text-xs'>
                  {item.inviterUserId || "-"}
                </td>
                <td className='py-2 pr-2 text-xs'>
                  {item.redemptions && item.redemptions.length > 0
                    ? item.redemptions
                        .map(
                          (r) =>
                            r.invitee?.name ||
                            r.invitee?.phone ||
                            r.inviteeUserId
                        )
                        .filter(Boolean)
                        .slice(0, 3)
                        .join("，")
                    : "—"}
                </td>
                <td className='py-2 pr-2 text-xs'>
                  {new Date(item.createdAt).toLocaleString()}
                </td>
                <td className='py-2 pr-2'>
                  {item.status === "active" ? (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => onDisable(item.id)}
                    >
                      禁用
                    </Button>
                  ) : (
                    <span className='text-gray-400'>-</span>
                  )}
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={6} className='py-4 text-center text-gray-500'>
                  {loading ? "加载中..." : "暂无数据"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {pagination && (
          <div className='flex items-center justify-end gap-2 mt-3 text-sm'>
            <span>
              第 {pagination.page}/{pagination.totalPages} 页
            </span>
            <Button
              size='sm'
              variant='outline'
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </Button>
            <Button
              size='sm'
              variant='outline'
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// 主页面
export default function Admin() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<
    "dashboard" | "users" | "api-stats" | "api-records" | "invites"
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
    { key: "api-stats", label: "API统计" },
    { key: "api-records", label: "API记录" },
    { key: "invites", label: "邀请码" },
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
          <Button variant='ghost' onClick={() => navigate("/")}>
            返回首页
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
        {activeTab === "api-stats" && <ApiStatsTab />}
        {activeTab === "api-records" && <ApiRecordsTab />}
        {activeTab === "invites" && <InvitesTab />}
      </main>
    </div>
  );
}
