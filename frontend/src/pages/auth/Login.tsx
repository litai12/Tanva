import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useAuthStore } from "@/stores/authStore";
import { Loader2 } from "lucide-react";
import { authApi } from "@/services/authApi";
import ForgotPasswordModal from "@/components/auth/ForgotPasswordModal";

export default function LoginPage() {
  const [tab, setTab] = useState<"password" | "sms">("password");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState(false);
  const navigate = useNavigate();
  const { login, loginWithSms, error, user } = useAuthStore();

  useEffect(() => {
    if (user) {
      navigate("/app", { replace: true });
    }
  }, [user, navigate]);

  const _isMock =
    (typeof import.meta !== "undefined" &&
      (import.meta as any).env?.VITE_AUTH_MODE) === "mock";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (tab === "password") {
        await login(phone, password);
      } else {
        await loginWithSms(phone, code || "");
      }
      // 登录成功后，useEffect 会处理跳转到 /app
    } catch (err) {
      console.error("登录失败:", err);
      setIsSubmitting(false);
    }
  };

  // 发送验证码的冷却（秒）
  const [sendCooldown, setSendCooldown] = useState(0);
  useEffect(() => {
    if (sendCooldown <= 0) return;
    const t = setInterval(
      () => setSendCooldown((s) => Math.max(0, s - 1)),
      1000
    );
    return () => clearInterval(t);
  }, [sendCooldown]);

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

      <Card className='w-full max-w-2xl p-8 relative z-10 backdrop-blur-md bg-white/10 border border-white/20 shadow-2xl'>
        <div className='flex items-center justify-center mb-10'>
          <img
            src='/LogoText.svg'
            className='h-8 w-auto brightness-0 invert drop-shadow-lg'
          />
        </div>
        <div className='flex gap-8'>
          <div className='flex-1'>
            <div className='flex gap-6 mb-8 text-sm items-center justify-center'>
              <button
                className={
                  tab === "password"
                    ? "text-white font-semibold drop-shadow-md transition-all duration-200"
                    : "text-white/70 hover:text-white transition-all duration-200"
                }
                onClick={() => setTab("password")}
              >
                密码登录
              </button>
              <button
                className={
                  tab === "sms"
                    ? "text-white font-semibold drop-shadow-md transition-all duration-200"
                    : "text-white/70 hover:text-white transition-all duration-200"
                }
                onClick={() => setTab("sms")}
              >
                验证码登录
              </button>
            </div>
            {/* 固定高度容器，避免切换时跳跃 */}
            <div className='relative min-h-[260px] transition-[min-height] px-36'>
              {tab === "password" ? (
                <form onSubmit={onSubmit} className='space-y-6'>
                  <Input
                    placeholder='请输入手机号'
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12'
                  />
                  <Input
                    placeholder='请输入密码'
                    type='password'
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12'
                  />
                  {error && (
                    <div className='text-red-400 text-sm drop-shadow-md'>
                      {error}
                    </div>
                  )}
                  <Button
                    type='submit'
                    className='w-full bg-white/20 hover:bg-white/30 text-white border border-white/30 rounded-xl h-12 font-medium backdrop-blur-sm transition-all duration-200 disabled:opacity-70 hover:shadow-lg'
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        登录中...
                      </>
                    ) : (
                      "登录"
                    )}
                  </Button>
                  <div className='flex justify-between text-sm'>
                    <button
                      onClick={() => setIsForgotPasswordOpen(true)}
                      className='text-white/80 hover:text-white transition-all duration-200'
                    >
                      忘记密码
                    </button>
                    <Link
                      to='/auth/register'
                      className='text-white/80 hover:text-white transition-all duration-200'
                    >
                      立即注册
                    </Link>
                  </div>
                </form>
              ) : (
                <form onSubmit={onSubmit} className='space-y-6'>
                  <Input
                    placeholder='请输入手机号'
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12'
                  />
                  <div className='flex gap-3'>
                    <Input
                      placeholder='请输入验证码'
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12 flex-1'
                    />
                    <Button
                      type='button'
                      variant='outline'
                      className='whitespace-nowrap flex-shrink-0 min-w-[80px] rounded-xl bg-white/20 hover:bg-white/30 text-white border-white/30 backdrop-blur-sm transition-all duration-200 h-12'
                      onClick={async () => {
                        if (sendCooldown > 0) return;
                        if (!phone) {
                          window.dispatchEvent(
                            new CustomEvent("toast", {
                              detail: {
                                message: "请输入手机号",
                                type: "error",
                              },
                            })
                          );
                          return;
                        }
                        if (!/^1[3-9]\d{9}$/.test(phone)) {
                          window.dispatchEvent(
                            new CustomEvent("toast", {
                              detail: {
                                message: "手机号格式不正确",
                                type: "error",
                              },
                            })
                          );
                          return;
                        }
                        try {
                          const res = await authApi.sendSms({ phone });
                          // 如果后端返回调试码（开发模式），自动填充到输入框以便测试
                          // 不自动填充验证码；始终提示用户手动输入短信收到的验证码
                          window.dispatchEvent(
                            new CustomEvent("toast", {
                              detail: {
                                message:
                                  "验证码已发送，请注意查收短信并手动输入",
                                type: "success",
                              },
                            })
                          );
                          // 启动 60s 冷却
                          setSendCooldown(60);
                        } catch (err: any) {
                          window.dispatchEvent(
                            new CustomEvent("toast", {
                              detail: {
                                message: err?.message || "发送失败",
                                type: "error",
                              },
                            })
                          );
                        }
                      }}
                      disabled={sendCooldown > 0}
                    >
                      {sendCooldown > 0 ? `重新发送(${sendCooldown}s)` : "发送"}
                    </Button>
                  </div>
                  {error && (
                    <div className='text-red-400 text-sm drop-shadow-md'>
                      {error}
                    </div>
                  )}
                  <Button
                    type='submit'
                    className='w-full bg-white/20 hover:bg-white/30 text-white border border-white/30 rounded-xl h-12 font-medium backdrop-blur-sm transition-all duration-200 disabled:opacity-70 hover:shadow-lg'
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        登录中...
                      </>
                    ) : (
                      "登录"
                    )}
                  </Button>
                </form>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* 忘记密码模态框 */}
      <ForgotPasswordModal
        isOpen={isForgotPasswordOpen}
        onClose={() => setIsForgotPasswordOpen(false)}
        onSuccess={() => {
          // 密码重置成功后可以自动切换到密码登录标签页
          setTab("password");
        }}
      />
    </div>
  );
}
