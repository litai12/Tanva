import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Globe2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { TeamSwitcher } from "@/components/team/TeamSwitcher";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

const isZhLanguage = (language: string | undefined) =>
  String(language || "").toLowerCase().startsWith("zh");

/** 星斗传媒官网着陆页（Tenant.homepage = 'xingdou'），CTA 进入 /workspace 工作台。 */
export default function XingdouLanding() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const connection = useAuthStore((s) => s.connection);
  const initAuth = useAuthStore((s) => s.init);
  const authInitializing = useAuthStore((s) => s.initializing);
  const authInitRef = useRef(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const isZh = isZhLanguage(i18n.resolvedLanguage || i18n.language);

  useEffect(() => {
    if (authInitRef.current || user || authInitializing) return;
    authInitRef.current = true;
    initAuth().catch(() => {});
  }, [user, authInitializing, initAuth]);

  const toggleLanguage = () => {
    void i18n.changeLanguage(isZh ? "en-US" : "zh-CN");
  };

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      await logout();
      navigate("/auth/login", { replace: true });
    } catch (error) {
      console.error("Logout failed", error);
    } finally {
      setLoggingOut(false);
    }
  };

  const status = (() => {
    switch (connection) {
      case "server":
      case "local":
        return { label: t("common.status.online"), color: "#16a34a" };
      case "refresh":
        return { label: t("common.status.refreshed"), color: "#f59e0b" };
      case "mock":
        return { label: t("common.status.mock"), color: "#8b5cf6" };
      default:
        return null;
    }
  })();

  const userName =
    user?.name ||
    user?.phone?.slice(-4) ||
    user?.email ||
    user?.id?.slice(-4) ||
    t("common.user");

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black text-white">
      <img
        src="https://tanvas-ai.tos-cn-guangzhou.volces.com/static/landing/xingdou/XingdouBg.png"
        alt=""
        aria-hidden="true"
        draggable="false"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_56%_22%,rgba(255,255,255,0.13),transparent_30%),linear-gradient(90deg,rgba(0,0,0,0.31)_0%,rgba(0,0,0,0.06)_45%,rgba(0,0,0,0.06)_100%)]" />

      <header className="absolute left-0 right-0 top-0 z-20 px-[3vw] pt-[5.7vh] sm:pt-[5.6vh]">
        <div className="flex items-start justify-between gap-6">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex h-[52px] min-w-[280px] items-center justify-center rounded-full border border-white/20 bg-black/20 px-[34px] text-[22px] leading-none tracking-[0] text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-md transition-colors hover:bg-black/25 max-sm:h-[38px] max-sm:min-w-0 max-sm:px-6 max-sm:text-[15px]"
          >
            从化AIGC孵化基地
          </button>

          <div className="flex h-[52px] items-center gap-[34px] rounded-full border border-white/10 bg-black/40 px-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_12px_42px_rgba(0,0,0,0.25)] backdrop-blur-md max-md:gap-3 max-md:px-3">
            <button
              type="button"
              onClick={toggleLanguage}
              className="inline-flex h-[40px] items-center gap-[10px] rounded-full px-1 text-[14px] font-medium text-white/93 transition-colors hover:text-white"
              aria-label={t("common.language", { defaultValue: "Language" })}
            >
              <Globe2 className="h-[17px] w-[17px] text-[#b9b2ff]" />
              <span>中 / EN</span>
            </button>

            {user ? (
              <div className="flex items-center gap-3 text-sm text-white max-lg:hidden">
                <span className="max-w-[160px] truncate">
                  {t("home.header.greeting", { name: userName })}
                </span>
                <TeamSwitcher variant="home" />
                {status && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/22 bg-white/9 px-2.5 py-1 text-xs text-white"
                    title={status.label}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: status.color }}
                    />
                    {status.label}
                  </span>
                )}
                <Button
                  variant="ghost"
                  className="h-9 rounded-full px-3 text-[13px] font-medium text-white hover:bg-white/10 hover:text-white"
                  onClick={handleLogout}
                  disabled={loggingOut}
                >
                  {t("home.header.actions.logout")}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-[30px] max-md:gap-2">
                <Button
                  variant="ghost"
                  className="h-[40px] rounded-full bg-transparent px-0 text-[14px] font-medium text-white hover:bg-transparent hover:text-white max-sm:px-2"
                  onClick={() => navigate("/auth/login")}
                >
                  {t("home.header.actions.login")}
                </Button>
                <Button
                  variant="ghost"
                  className="h-[35px] rounded-full border border-white/35 bg-white/24 px-[15px] text-[14px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] hover:bg-white/30 hover:text-white max-sm:px-2"
                  onClick={() => navigate("/auth/register")}
                >
                  {t("home.header.actions.register")}
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {user && (
        <div className="absolute right-[3vw] top-[132px] z-20 hidden items-center gap-3 rounded-full border border-white/10 bg-[#151b2f]/62 px-4 py-2 text-sm text-white/90 backdrop-blur-md max-lg:flex max-sm:top-[112px] max-sm:max-w-[calc(100vw-2rem)]">
          <span className="truncate">
            {t("home.header.greeting", { name: userName })}
          </span>
          <Button
            variant="ghost"
            className="h-8 rounded-full px-3 text-xs text-white hover:bg-white/10 hover:text-white"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {t("home.header.actions.logout")}
          </Button>
        </div>
      )}

      <section className="relative z-10 flex h-full items-center">
        <div className="ml-[9.45vw] mt-[2.4vh] flex max-w-[920px] flex-col items-start max-md:ml-8 max-md:mr-8 max-sm:ml-6 max-sm:mt-10">
          <div className="flex items-center gap-[32px] max-md:flex-wrap max-md:gap-5">
            <h1 className="whitespace-nowrap bg-[linear-gradient(180deg,#ffffff_0%,#f7f4ff_58%,#d9ccff_100%)] bg-clip-text text-[64px] leading-none tracking-[0] text-transparent drop-shadow-[0_4px_18px_rgba(255,255,255,0.15)] max-lg:text-[54px] max-md:text-[42px] max-sm:text-[36px]">
              星斗传媒
            </h1>
            <div className="h-[58px] w-px bg-white/24 max-md:h-11" />
            <img
              src="https://tanvas-ai.tos-cn-guangzhou.volces.com/static/landing/xingdou/XingdouLogo.png"
              alt="Tanvas"
              draggable="false"
              className={cn(
                "h-[86px] w-auto drop-shadow-[0_0_22px_rgba(255,255,255,0.22)] max-lg:h-[72px] max-md:h-[56px] max-sm:h-[45px]"
              )}
            />
          </div>

          <p className="mt-[38px] text-[29px] font-medium leading-none tracking-[0.025em] text-white/91 drop-shadow-[0_2px_10px_rgba(0,0,0,0.42)] max-md:mt-7 max-md:text-[23px] max-sm:text-[19px]">
            打破常规，看见创意的无垠边界
          </p>

          <Button
            className="mt-[54px] h-[58px] min-w-[226px] rounded-full border border-white/87 bg-black/14 px-12 text-[20px] font-semibold text-white shadow-[0_10px_30px_rgba(0,0,0,0.18)] backdrop-blur-[2px] hover:bg-white/12 max-md:mt-9 max-md:h-12 max-md:min-w-[178px] max-md:text-[16px]"
            onClick={() => navigate("/workspace")}
          >
            {t("home.hero.startNow")}
          </Button>
        </div>
      </section>

      <a
        href="https://beian.miit.gov.cn/"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-[19px] left-[47px] z-20 text-[10px] leading-none text-white/55 transition-colors hover:text-white/80 max-sm:left-5"
      >
        {t("home.icp")}
      </a>
    </main>
  );
}
