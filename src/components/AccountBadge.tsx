import { useAuthStore } from '@/stores/authStore';

export default function AccountBadge() {
  const { user, logout, loading } = useAuthStore();
  if (!user) return null;
  
  // 调试信息
  console.log('AccountBadge user:', user);
  console.log('user.name:', user.name);
  console.log('user.phone:', user.phone);
  console.log('user.phone?.slice(-4):', user.phone?.slice(-4));
  console.log('user.email:', user.email);
  
  const displayName = user.name || user.phone?.slice(-4) || user.email || user.id?.slice(-4) || '用户';
  console.log('displayName:', displayName);
  
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-slate-600">你好，{displayName}</span>
      <button
        className="px-2 py-1 rounded border text-slate-600 hover:bg-slate-50"
        onClick={() => logout()}
        disabled={loading}
      >
        {loading ? '处理中…' : '退出登录'}
      </button>
    </div>
  );
}

