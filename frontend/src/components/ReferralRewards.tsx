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
    if (!stats?.inviteCode) return;
    try {
      await navigator.clipboard.writeText(stats.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      // 降级方案
      const input = document.createElement("input");
      input.value = stats.inviteCode;
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

  return (
    <div className="space-y-6">
      {/* 每日签到区域 */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-500" />
            <h3 className="font-medium">每日签到</h3>
          </div>
          <span className="text-sm text-gray-500">
            已连续签到 {consecutiveDays} 天
          </span>
        </div>

        {/* 7天签到格子 */}
        <div className="grid grid-cols-7 gap-2 mb-4">
          {[1, 2, 3, 4, 5, 6, 7].map((day) => {
            const checked = day <= (consecutiveDays % 7 || (consecutiveDays > 0 && consecutiveDays % 7 === 0 ? 7 : 0));
            const isToday = !checkInStatus?.canCheckIn ? false : day === (consecutiveDays % 7) + 1;

            return (
              <div
                key={day}
                className={`flex flex-col items-center justify-center p-2 rounded-lg ${
                  checked
                    ? "bg-blue-500 text-white"
                    : isToday
                    ? "bg-blue-100 border-2 border-blue-500 border-dashed"
                    : "bg-gray-100"
                }`}
              >
                <span className="text-xs font-medium">D{day}</span>
                {checked && <Check className="w-4 h-4 mt-1" />}
              </div>
            );
          })}
        </div>

        {/* 签到按钮 */}
        <Button
          className="w-full"
          disabled={!checkInStatus?.canCheckIn || checkingIn}
          onClick={handleCheckIn}
        >
          {checkingIn
            ? "签到中..."
            : checkInStatus?.canCheckIn
            ? "立即签到 (+100积分)"
            : "今日已签到"}
        </Button>

        <p className="text-xs text-gray-400 mt-2 text-center">
          连续签到7天可额外获得500积分奖励
        </p>
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
          <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
            <span className="flex-1 text-xl font-bold text-gray-900">
              {stats?.inviteCode || "TANVAS-XXXX"}
            </span>
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
