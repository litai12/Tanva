import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useAuthStore } from '@/stores/authStore';

export default function RegisterPage() {
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const navigate = useNavigate();
  const { register, loading, error } = useAuthStore();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      alert('两次输入的密码不一致');
      return;
    }
    await register(phone, password, name || undefined, email || undefined);
    // 注册成功后跳转到登录
    navigate('/auth/login');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-white to-sky-50">
      <Card className="w-full max-w-xl p-8">
        <div className="flex items-center justify-center mb-6">
          <img src="/Logo.svg" className="h-10 mr-2" />
          <div className="text-2xl font-semibold">创建账户</div>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <Input placeholder="请输入手机号（必填）" value={phone} onChange={e=>setPhone(e.target.value)} required />
          <Input placeholder="邮箱（选填）" type="email" value={email} onChange={e=>setEmail(e.target.value)} />
          <Input placeholder="昵称（选填）" value={name} onChange={e=>setName(e.target.value)} />
          <Input placeholder="设置密码（至少10位，含大小写与数字）" type="password" value={password} onChange={e=>setPassword(e.target.value)} required />
          <Input placeholder="确认密码" type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} required />
          {error && <div className="text-red-500 text-sm">{error}</div>}
          <Button type="submit" className="w-full" disabled={loading}>{loading? '提交中...' : '注册'}</Button>
          <div className="text-center text-sm text-slate-500">已有账号？<Link to="/auth/login" className="text-sky-600">去登录</Link></div>
        </form>
      </Card>
    </div>
  );
}
