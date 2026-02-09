import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useAuthStore } from "@/stores/authStore";
import { Eye, EyeOff } from "lucide-react";

export default function RegisterPage() {
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const navigate = useNavigate();
  const { register, loading, error } = useAuthStore();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      alert("两次输入的密码不一致");
      return;
    }
    await register(
      phone,
      password,
      name || undefined,
      email || undefined
    );
    // 注册成功后跳转到登录
    navigate("/auth/login");
  };

  return (
    <div className='min-h-screen flex items-center justify-center relative overflow-hidden'>
      {/* 视频背景 */}
      <video
        autoPlay
        loop
        muted
        playsInline
        className='absolute inset-0 w-full h-full object-cover z-[1]'
      >
        <source src='/OpenVideo.mp4' type='video/mp4' />
        您的浏览器不支持视频播放。
      </video>

      {/* 黑色透明蒙版 */}
      <div className='absolute inset-0 bg-black/50 z-[2]'></div>

      <Card className='w-full max-w-xl p-8 relative z-10 backdrop-blur-md bg-white/10 border border-white/20 shadow-2xl'>
        <div className='flex items-center justify-center mb-8'>
          {/* <img src='/LogoText.svg' className='h-8 w-auto brightness-0 invert drop-shadow-lg mr-3' /> */}
                  <div className='text-2xl font-semibold text-white drop-shadow-md'>注册账号</div>
        </div>

        <form onSubmit={onSubmit} className='space-y-6'>
          <Input
            placeholder='请输入手机号（必填）'
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12'
          />
          <Input
            placeholder='邮箱（选填）'
            type='email'
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12'
          />
          <Input
            placeholder='昵称（选填）'
            value={name}
            onChange={(e) => setName(e.target.value)}
            className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12'
          />
          <div className='relative'>
            <Input
              placeholder='设置密码（至少10位，含大小写与数字）'
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12 pr-10'
            />
            <button
              type='button'
              onClick={() => setShowPassword(!showPassword)}
              className='absolute right-3 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors'
            >
              {showPassword ? <Eye className='h-5 w-5' /> : <EyeOff className='h-5 w-5' />}
            </button>
          </div>
          <div className='relative'>
            <Input
              placeholder='确认密码'
              type={showConfirm ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12 pr-10'
            />
            <button
              type='button'
              onClick={() => setShowConfirm(!showConfirm)}
              className='absolute right-3 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors'
            >
              {showConfirm ? <Eye className='h-5 w-5' /> : <EyeOff className='h-5 w-5' />}
            </button>
          </div>
          {error && <div className='text-red-400 text-sm drop-shadow-md'>{error}</div>}
          <Button
            type='submit'
            className='w-full bg-white/20 hover:bg-white/30 text-white border border-white/30 rounded-xl h-12 font-medium backdrop-blur-sm transition-all duration-200 disabled:opacity-70 hover:shadow-lg'
            disabled={loading}
          >
            {loading ? "提交中..." : "注册"}
          </Button>
          <div className='text-center text-sm'>
            <span className='text-white/80 drop-shadow-md'>已有账号？</span>
            <Link to='/auth/login' className='text-white hover:text-white/90 transition-all duration-200 font-medium ml-1'>
              去登录
            </Link>
          </div>
        </form>
      </Card>

      {/* 协议链接 */}
      <div className='absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex gap-4 text-xs text-white/60'>
        <Link to='/legal/terms' className='hover:text-white transition-colors'>
          用户服务与AI使用协议
        </Link>
        <span>|</span>
        <Link to='/legal/privacy' className='hover:text-white transition-colors'>
          隐私政策
        </Link>
        <span>|</span>
        <Link to='/legal/community' className='hover:text-white transition-colors'>
          社区自律公约
        </Link>
      </div>
    </div>
  );
}
