import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  getReferralStats,
  getCheckInStatus,
  checkIn,
  type ReferralStats,
  type CheckInStatus,
} from "@/services/referralApi";
import { Calendar, Users, Gift, Copy, Check, Sparkles } from "lucide-react";

export default function ReferralRewards() {
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [checkInStatus, setCheckInStatus] = useState<CheckInStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [statsData, checkInData] = await Promise.all([
        getReferralStats(),
        getCheckInStatus(),
      ]);
      setStats(statsData);
      setCheckInStatus(checkInData);
    } catch (error) {
      console.error("加载数据失败:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCheckIn = async () => {
    if (!checkInStatus?.canCheckIn || checkingIn) return;
    setCheckingIn(true);
    try {
      const result = await checkIn();
      if (result.success) {
        // 重新加载数据
        await loadData();
        // 触发全局积分刷新事件
        window.dispatchEvent(new CustomEvent("refresh-credits"));
        alert(`签到成功！获得 ${result.reward} 积分${result.isWeeklyBonus ? '（含满7天额外奖励）' : ''}`);
      }
    } catch (error: any) {
      alert(error.message || "签到失败");
    } finally {
      setCheckingIn(false);
    }
  };

  const handleCopy = async () => {
    if (!stats) return;
    try {
      await navigator.clipboard.writeText(stats.inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      // 降级方案
      const input = document.createElement("input");
      input.value = stats.inviteLink;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m前`;
    if (diffHours < 24) return `${diffHours}h前`;
    return `${diffDays}d前`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  const consecutiveDays = checkInStatus?.consecutiveDays || 0;
  const dayInWeek = consecutiveDays % 7; // 当前周期内的天数 (0-6)

  return (
    <div className="space-y-6">
      {/* 每日签到区域 */}
      <div className="bg-white rounded-xl border p-6">
        <div className="mb-1">
          <h3 className="text-lg font-semibold text-gray-900">每日签到</h3>
          <p className="text-xs text-gray-400 uppercase tracking-wider">CHECK-IN REWARDS</p>
        </div>

        {/* 连续签到信息 */}
        <div className="flex items-center justify-between mt-4 p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <Calendar className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <div className="font-semibold text-gray-900">
                连续第 {consecutiveDays} 天
              </div>
              <div className="text-sm text-gray-500">
                满7天领 <span className="text-amber-500 font-medium">500</span> 积分
              </div>
            </div>
          </div>
          <Button
            onClick={handleCheckIn}
            disabled={!checkInStatus?.canCheckIn || checkingIn}
            variant={checkInStatus?.canCheckIn ? "default" : "outline"}
            className={checkInStatus?.canCheckIn ? "bg-blue-500 hover:bg-blue-600" : ""}
          >
            {checkingIn ? "签到中..." : checkInStatus?.canCheckIn ? "立即签到" : "今日已签"}
          </Button>
        </div>

        {/* 7天签到格子 */}
        <div className="grid grid-cols-7 gap-2 mt-4">
          {[0, 1, 2, 3, 4, 5, 6].map((dayIndex) => {
            const isCompleted = dayIndex < dayInWeek;
            const isCurrent = dayIndex === dayInWeek;
            const isD7 = dayIndex === 6;
            const reward = checkInStatus?.rewards?.[dayIndex] || 100;

            return (
              <div
                key={dayIndex}
                className={`relative flex flex-col items-center justify-center p-3 rounded-lg border-2 transition-all ${
                  isCurrent
                    ? "border-blue-500 bg-blue-50"
                    : isCompleted
                    ? "border-gray-200 bg-gray-50"
                    : "border-gray-200 bg-white"
                }`}
              >
                {isCompleted ? (
                  <div className="w-6 h-6 rounded-full bg-gray-300 flex items-center justify-center">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                ) : isD7 ? (
                  <Gift className={`w-6 h-6 ${isCurrent ? "text-blue-500" : "text-amber-500"}`} />
                ) : (
                  <span className={`text-lg font-bold ${isCurrent ? "text-blue-600" : "text-gray-400"}`}>
                    {reward}
                  </span>
                )}
                <span className={`text-xs mt-1 ${isCurrent ? "text-blue-600 font-medium" : "text-gray-400"}`}>
                  D{dayIndex + 1}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 邀请统计和邀请码区域 */}
      <div className="grid grid-cols-2 gap-4">
        {/* 左侧：邀请统计 */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Users className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <div className="text-xs text-gray-500">成功邀请</div>
                <div className="text-2xl font-bold text-gray-900">
                  {stats?.successfulInvites || 0}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
                <Gift className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <div className="text-xs text-gray-500">累计收益</div>
                <div className="text-2xl font-bold text-gray-900">
                  {stats?.totalEarnings ? (stats.totalEarnings >= 1000 ? `${(stats.totalEarnings / 1000).toFixed(0)}K` : stats.totalEarnings) : 0}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧：邀请码 */}
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm text-gray-600">邀请码</span>
            <Sparkles className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-xl font-bold text-gray-900 mb-3">
            {stats?.inviteCode || "TANVAS-XXXX"}
          </div>
          <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
            <input
              type="text"
              readOnly
              value={stats?.inviteLink || "tanvas.ai/invite?code=TANVAS-XXXX"}
              className="flex-1 bg-transparent text-sm text-gray-600 outline-none"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleCopy}
              className="shrink-0"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span className="ml-1">{copied ? "已复制" : "复制"}</span>
            </Button>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            好友完成首图生成后，系统将自动核验。多账号刷分行为将被永久封禁。
          </p>
        </div>
      </div>

      {/* 邀请状态列表 */}
      <div className="bg-white rounded-xl border p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900">邀请状态</h3>
          <p className="text-xs text-gray-400 uppercase tracking-wider">REFERRAL STATUS</p>
        </div>

        {/* 奖励规则说明 */}
        <div className="mb-4 p-3 bg-blue-50 rounded-lg text-xs text-blue-600">
          <span className="font-medium">奖励规则：</span>好友注册后完成首次AI生成，系统自动核验并发放 1000 积分奖励
        </div>

        {stats?.inviteRecords && stats.inviteRecords.length > 0 ? (
          <div className="space-y-3">
            {stats.inviteRecords.map((record, index) => (
              <div
                key={record.id}
                className="flex items-center justify-between py-3 border-b last:border-b-0"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-sm text-gray-500">
                    {index + 1}
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">{record.inviteeName}</div>
                    <div className="text-xs text-gray-400">
                      {formatTimeAgo(record.createdAt)} · 邀请
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  {record.rewardStatus === "rewarded" ? (
                    <>
                      <div className="text-green-500 font-medium">+{record.rewardAmount}</div>
                      <div className="text-xs text-gray-400">已发放</div>
                    </>
                  ) : (
                    <>
                      <div className="text-amber-500 font-medium">+{record.rewardAmount}</div>
                      <div className="text-xs text-amber-500">待首次生成</div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-400">
            暂无邀请记录，快去邀请好友吧！
          </div>
        )}
      </div>
    </div>
  );
}
