import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useAuthStore } from "@/stores/authStore";
import { useProjectStore } from "@/stores/projectStore";
import { Loader2 } from "lucide-react";

export default function LoginPage() {
  const [tab, setTab] = useState<"password" | "sms">("password");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const { login, loginWithSms, error } = useAuthStore();
  const loadProjects = useProjectStore((s) => s.load);

  const _isMock =
    (typeof import.meta !== "undefined" &&
      (import.meta as any).env?.VITE_AUTH_MODE) === "mock";

  const ensureProjectPrepared = async () => {
    await loadProjects();
    const store = useProjectStore.getState();

    if (!store.currentProjectId) {
      if (store.projects.length === 0) {
        try {
          const created = await store.create("未命名");
          store.open(created.id);
        } catch (err) {
          console.error("自动创建项目失败:", err);
        }
      } else {
        const fallback = store.projects[0];
        if (fallback) {
          store.open(fallback.id);
        }
      }
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (tab === "password") {
        await login(phone, password);
      } else {
        await loginWithSms(phone, code || "");
      }
      await ensureProjectPrepared();
      navigate("/app", { replace: true });
    } catch (err) {
      console.error("登录失败:", err);
      setIsSubmitting(false);
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
                    <Link
                      to='#'
                      className='text-white/80 hover:text-white transition-all duration-200'
                    >
                      忘记密码
                    </Link>
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
                        if (!phone) {
                          alert("请输入手机号");
                          return;
                        }
                        try {
                          await fetch("/api/auth/send-sms", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ phone }),
                            credentials: "include",
                          });
                          setCode("336699");
                          alert("未发送验证码（未开放）");
                        } catch (e) {
                          alert("发送失败");
                        }
                      }}
                    >
                      发送
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
    </div>
  );
}
