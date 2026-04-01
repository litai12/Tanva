import { useAuthStore } from '@/stores/authStore';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function AccountBadge() {
  const { user, logout, loading, connection } = useAuthStore();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const lt = (zhText: string, enText: string) => (isZh ? zhText : enText);

  if (!user) return null;

  // 调试信息
  console.log('AccountBadge user:', user);
  console.log('user.name:', user.name);
  console.log('user.phone:', user.phone);
  console.log('user.phone?.slice(-4):', user.phone?.slice(-4));
  console.log('user.email:', user.email);

  const displayName = user.name || user.phone?.slice(-4) || user.email || user.id?.slice(-4) || lt('用户', 'User');
  console.log('displayName:', displayName);

  const status = (() => {
    switch (connection) {
      case 'server': return { label: lt('在线', 'Online'), color: '#16a34a' };
      case 'refresh': return { label: lt('已续期', 'Refreshed'), color: '#f59e0b' };
      case 'local': return { label: lt('在线', 'Online'), color: '#16a34a' };
      case 'mock': return { label: 'Mock', color: '#8b5cf6' };
      default: return { label: lt('未知', 'Unknown'), color: '#9ca3af' };
    }
  })();

  const handleLogout = async () => {
    try {
      await logout();
      // 退出后重定向到登录页
      navigate('/auth/login', { replace: true });
    } catch (error) {
      console.error('退出登录失败:', error);
    }
  };

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-slate-600">{lt('你好，', 'Hi, ')}{displayName}</span>
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border" style={{ borderColor: status.color, color: status.color }} title={lt(`认证来源：${status.label}`, `Auth source: ${status.label}`)}>
        <span style={{ width: 6, height: 6, borderRadius: 9999, background: status.color, display: 'inline-block' }} />
        {status.label}
      </span>
      <button
        className="px-2 py-1 rounded border text-slate-600 hover:bg-slate-50"
        onClick={handleLogout}
        disabled={loading}
      >
        {loading ? lt('处理中…', 'Processing...') : lt('退出登录', 'Log out')}
      </button>
    </div>
  );
}
