import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useAuthStore } from "@/stores/authStore";
import { Eye, EyeOff, Check, X } from "lucide-react";
import { validateInviteCode } from "@/services/referralApi";
import { authApi } from "@/services/authApi";
import { useTranslation } from "react-i18next";

export default function RegisterPage() {
  const { t } = useTranslation();
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
          detail: { message: t("auth.register.phoneInvalid"), type: "error" },
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
          detail: { message: err?.message || t("auth.register.sendFailed"), type: "error" },
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
    const trimmedName = name.trim();
    if (!trimmedName) {
      alert(t("auth.register.usernameRequired"));
      return;
    }
    if (!agreeTerms) {
      alert(t("auth.agreements.mustAgree"));
      return;
    }
    if (password !== confirm) {
      alert(t("auth.register.passwordMismatch"));
      return;
    }
    // 如果填写了邀请码，必须验证有效性
    if (inviteCode.trim()) {
      if (inviteCodeValid === null) {
        // 还没验证过，先验证
        const result = await validateInviteCode(inviteCode.trim());
        setInviteCodeValid(result.valid);
        if (!result.valid) {
          alert(t("auth.register.invalidInvite"));
          return;
        }
      } else if (inviteCodeValid === false) {
        alert(t("auth.register.invalidInvite"));
        return;
      }
    }
    try {
      await register(
        phone,
        password,
        code || "336699", // 暂时使用默认验证码，因为验证码输入框已隐藏
        trimmedName,
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
        {t("auth.videoUnsupported")}
      </video>

      {/* 黑色透明蒙版 */}
      <div className='absolute inset-0 bg-black/50 z-[2]'></div>

      <Card className='w-full max-w-xl p-8 relative z-10 backdrop-blur-md bg-white/10 border border-white/20 shadow-2xl'>
        <div className='flex items-center justify-center mb-8'>
          {/* <img src='/LogoText.svg' className='h-8 w-auto brightness-0 invert drop-shadow-lg mr-3' /> */}
          <div className='text-2xl font-semibold text-white drop-shadow-md'>
            {t("auth.register.title")}
          </div>
        </div>

        <form onSubmit={onSubmit} className='space-y-6'>
          <Input
            placeholder={t("auth.register.phonePlaceholder")}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12'
          />
          {/* 验证码输入框 - 暂时隐藏 */}
          {/* <div className='flex gap-2'>
            <Input
              placeholder={t("auth.login.codePlaceholder")}
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
              {codeCountdown > 0
                ? t("auth.login.resendCode", { seconds: codeCountdown })
                : t("auth.login.sendCode")}
            </Button>
          </div> */}
          <Input
            placeholder={t("auth.register.emailPlaceholder")}
            type='email'
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12'
          />
          <Input
            placeholder={t("auth.register.namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12'
          />
          <div className='relative'>
            <Input
              placeholder={t("auth.register.passwordPlaceholder")}
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
              placeholder={t("auth.register.confirmPlaceholder")}
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
              placeholder={t("auth.register.invitePlaceholder")}
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
                {t("auth.register.inviteFrom", { name: inviterName })}
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
              {t("auth.agreements.prefix")}
              {" "}
              <Link to='/legal/terms' className='text-white hover:underline mx-1' target='_blank' onClick={(e) => e.stopPropagation()}>{t("auth.agreements.terms")}</Link>
              {t("auth.agreements.comma")}
              <Link to='/legal/privacy' className='text-white hover:underline mx-1' target='_blank' onClick={(e) => e.stopPropagation()}>{t("auth.agreements.privacy")}</Link>
              {" "}
              {t("auth.agreements.and")}
              {" "}
              <Link to='/legal/community' className='text-white hover:underline mx-1' target='_blank' onClick={(e) => e.stopPropagation()}>{t("auth.agreements.community")}</Link>
            </label>
          </div>

          <Button
            type='submit'
            className='w-full bg-white/20 hover:bg-white/30 text-white border border-white/30 rounded-xl h-12 font-medium backdrop-blur-sm transition-all duration-200 disabled:opacity-70 hover:shadow-lg'
            disabled={loading || !agreeTerms}
          >
            {loading ? t("auth.register.submitting") : t("auth.register.submit")}
          </Button>
          <div className='text-center text-sm'>
            <span className='text-white/80 drop-shadow-md'>{t("auth.register.hasAccount")}</span>
            <Link to='/auth/login' className='text-white hover:text-white/90 transition-all duration-200 font-medium ml-1'>
              {t("auth.register.goLogin")}
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
