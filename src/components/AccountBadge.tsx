import { useAuthStore } from '@/stores/authStore';

export default function AccountBadge() {
  const { user, logout, loading, connection } = useAuthStore();
  if (!user) return null;
  
  // 调试信息
  console.log('AccountBadge user:', user);
  console.log('user.name:', user.name);
  console.log('user.phone:', user.phone);
  console.log('user.phone?.slice(-4):', user.phone?.slice(-4));
  console.log('user.email:', user.email);
  
  const displayName = user.name || user.phone?.slice(-4) || user.email || user.id?.slice(-4) || '用户';
  console.log('displayName:', displayName);
  
  const status = (() => {
    switch (connection) {
      case 'server': return { label: '在线', color: '#16a34a' };
      case 'refresh': return { label: '已续期', color: '#f59e0b' };
      case 'local': return { label: '本地会话', color: '#6b7280' };
      case 'mock': return { label: 'Mock', color: '#8b5cf6' };
      default: return { label: '未知', color: '#9ca3af' };
    }
  })();

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-slate-600">你好，{displayName}</span>
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border" style={{ borderColor: status.color, color: status.color }} title={`认证来源：${status.label}`}>
        <span style={{ width: 6, height: 6, borderRadius: 9999, background: status.color, display: 'inline-block' }} />
        {status.label}
      </span>
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
