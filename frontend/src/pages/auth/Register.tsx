import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useAuthStore } from "@/stores/authStore";
import { Eye, EyeOff, Check, X } from "lucide-react";
import { validateInviteCode } from "@/services/referralApi";
import { authApi } from "@/services/authApi";

export default function RegisterPage() {
  const [searchParams] = useSearchParams();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeCountdown, setCodeCountdown] = useState(0);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteCodeValid, setInviteCodeValid] = useState<boolean | null>(null);
  const [inviterName, setInviterName] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false); // 默认不勾选，必须手动同意
  const navigate = useNavigate();
  const { register, login, loading, error } = useAuthStore();

  // 发送验证码
  const handleSendCode = async () => {
    if (!phone.trim() || !/^1[3-9]\d{9}$/.test(phone)) {
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: "请输入有效的手机号", type: "error" },
        })
      );
      return;
    }
    try {
      await authApi.sendSms({ phone });
      // 开始倒计时
      setCodeCountdown(60);
      const timer = setInterval(() => {
        setCodeCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err: any) {
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: err?.message || "发送失败", type: "error" },
        })
      );
    }
  };

  // 从URL参数中获取邀请码
  useEffect(() => {
    const code = searchParams.get("code");
    if (code) {
      setInviteCode(code);
      // 自动验证邀请码
      validateInviteCode(code).then((result) => {
        setInviteCodeValid(result.valid);
        if (result.valid && result.inviterName) {
          setInviterName(result.inviterName);
        }
      });
    }
  }, [searchParams]);

  // 验证邀请码
  const handleInviteCodeBlur = async () => {
    if (!inviteCode.trim()) {
      setInviteCodeValid(null);
      setInviterName(null);
      return;
    }
    const result = await validateInviteCode(inviteCode.trim());
    setInviteCodeValid(result.valid);
    if (result.valid && result.inviterName) {
      setInviterName(result.inviterName);
    } else {
      setInviterName(null);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreeTerms) {
      alert("请先同意用户协议和隐私政策");
      return;
    }
    if (password !== confirm) {
      alert("两次输入的密码不一致");
      return;
    }
    // 如果填写了邀请码，必须验证有效性
    if (inviteCode.trim()) {
      if (inviteCodeValid === null) {
        // 还没验证过，先验证
        const result = await validateInviteCode(inviteCode.trim());
        setInviteCodeValid(result.valid);
        if (!result.valid) {
          alert("邀请码无效，请检查后重试");
          return;
        }
      } else if (inviteCodeValid === false) {
        alert("邀请码无效，请检查后重试");
        return;
      }
    }
    try {
      await register(
        phone,
        password,
        code,
        name || undefined,
        email || undefined,
        inviteCode.trim() || undefined
      );
      // 注册成功后自动登录
      await login(phone, password);
      navigate("/");
    } catch (err) {
      // 错误已在 store 中处理
    }
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
          <div className='flex gap-2'>
            <Input
              placeholder='请输入验证码'
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              maxLength={6}
              className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12 flex-1'
            />
            <Button
              type='button'
              onClick={handleSendCode}
              disabled={codeCountdown > 0 || !phone.trim()}
              className='bg-white/20 border border-white/30 text-white hover:bg-white/30 rounded-xl h-12 px-4 whitespace-nowrap disabled:opacity-50'
            >
              {codeCountdown > 0 ? `${codeCountdown}s` : '获取验证码'}
            </Button>
          </div>
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
          <div className='relative'>
            <Input
              placeholder='邀请码（选填）'
              value={inviteCode}
              onChange={(e) => {
                setInviteCode(e.target.value);
                setInviteCodeValid(null);
              }}
              onBlur={handleInviteCodeBlur}
              className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12 pr-10'
            />
            {inviteCodeValid !== null && (
              <div className='absolute right-3 top-1/2 -translate-y-1/2'>
                {inviteCodeValid ? (
                  <Check className='h-5 w-5 text-green-400' />
                ) : (
                  <X className='h-5 w-5 text-red-400' />
                )}
              </div>
              
            )}
            {inviteCodeValid && inviterName && (
              <div className='text-xs text-green-400 mt-1 ml-1'>
                来自 {inviterName} 的邀请
              </div>
            )}
          </div>
          {error && <div className='text-red-400 text-sm drop-shadow-md'>{error}</div>}

          {/* 协议勾选 */}
          <div className='flex items-center justify-center gap-2'>
            <button
              type='button'
              onClick={() => setAgreeTerms(!agreeTerms)}
              className={`w-3 h-3 rounded-full border-2 flex items-center justify-center transition-all ${
                agreeTerms
                  ? 'bg-white border-white'
                  : 'bg-transparent border-white/50'
              }`}
            >
              {agreeTerms && <Check className='w-3 h-3 text-black' />}
            </button>
            <label
              onClick={() => setAgreeTerms(!agreeTerms)}
              className='text-xs text-white/70 cursor-pointer'
            >
              我已阅读并同意
              <Link to='/legal/terms' className='text-white hover:underline mx-1' target='_blank' onClick={(e) => e.stopPropagation()}>用户协议</Link>
              、
              <Link to='/legal/privacy' className='text-white hover:underline mx-1' target='_blank' onClick={(e) => e.stopPropagation()}>隐私政策</Link>
              和
              <Link to='/legal/community' className='text-white hover:underline mx-1' target='_blank' onClick={(e) => e.stopPropagation()}>社区自律公约</Link>
            </label>
          </div>

          <Button
            type='submit'
            className='w-full bg-white/20 hover:bg-white/30 text-white border border-white/30 rounded-xl h-12 font-medium backdrop-blur-sm transition-all duration-200 disabled:opacity-70 hover:shadow-lg'
            disabled={loading || !agreeTerms}
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
    </div>
  );
}
