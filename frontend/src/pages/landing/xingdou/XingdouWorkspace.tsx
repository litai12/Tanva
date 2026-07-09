import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Box,
  Globe2,
  ImageIcon,
  ImagePlus,
  Layers,
  Loader2,
  LogOut,
  MoreHorizontal,
  Plus,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { projectApi, type Project } from "@/services/projectApi";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { TeamSwitcher } from "@/components/team/TeamSwitcher";
import { createEmptyProjectContent, type FlowGraphSnapshot } from "@/types/project";

const activitySlides = [
  { src: "/xingdou/banner-1.png", altZh: "活动案例插画", altEn: "Campaign illustration" },
  { src: "/xingdou/banner-2.png", altZh: "Seedance 2.0 活动", altEn: "Seedance 2.0 campaign" },
  { src: "/xingdou/banner-3.png", altZh: "活动案例海报", altEn: "Campaign poster" },
];

const recentSlotCount = 3;
const workspaceMaxWidth = "1440px";
const heroMaxWidth = "1560px";
const sampleProjectImages = ["/xingdou/banner-3.png", "/xingdou/banner-3.png", null];
const fastImageTemplatePath = "/xingdou/fast-image-template.json";

const isZhLanguage = (language: string | undefined) =>
  String(language || "").toLowerCase().startsWith("zh");

const loadFastImageTemplate = async (): Promise<FlowGraphSnapshot> => {
  const response = await fetch(fastImageTemplatePath, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load template: ${response.status}`);
  }
  const template = await response.json();
  return {
    nodes: Array.isArray(template?.nodes) ? template.nodes : [],
    edges: Array.isArray(template?.edges) ? template.edges : [],
  } as FlowGraphSnapshot;
};

const getDisplayName = (project: Project | null, isZh: boolean) => {
  if (project?.name?.trim()) return project.name.trim();
  return isZh ? "项目名称项目名称项目名称" : "Project name project name";
};

const formatProjectDate = (value: string | undefined, isZh: boolean) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return isZh ? "2026/6/10" : "6/10/2026";
  return new Intl.DateTimeFormat(isZh ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(date);
};

/** 星斗联盟工作台页（/workspace，Tenant.homepage = 'xingdou' 时启用），未登录也可浏览。 */
export default function XingdouWorkspace() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const connection = useAuthStore((state) => state.connection);
  const initAuth = useAuthStore((state) => state.init);
  const authInitializing = useAuthStore((state) => state.initializing);
  const authInitRef = useRef(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeActivityIndex, setActiveActivityIndex] = useState(0);
  const isZh = isZhLanguage(i18n.resolvedLanguage || i18n.language);

  useEffect(() => {
    if (authInitRef.current || user || authInitializing) return;
    authInitRef.current = true;
    initAuth().catch(() => {});
  }, [authInitializing, initAuth, user]);

  const loadProjects = useCallback(async () => {
    if (!user) {
      setProjects([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await projectApi.list();
      setProjects(list);
    } catch (e: unknown) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : isZh
          ? "加载失败"
          : "Failed to load"
      );
    } finally {
      setLoading(false);
    }
  }, [isZh, user]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (activitySlides.length <= 1) return;
    const timer = window.setInterval(() => {
      setActiveActivityIndex((current) => (current + 1) % activitySlides.length);
    }, 3000);
    return () => window.clearInterval(timer);
  }, []);

  const toggleLanguage = useCallback(() => {
    void i18n.changeLanguage(isZh ? "en-US" : "zh-CN");
  }, [i18n, isZh]);

  const handleLogout = useCallback(async () => {
    try {
      setLoggingOut(true);
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }, [logout]);

  const createProject = useCallback(async (options?: { starterFlow?: boolean }) => {
    if (creating) return;
    if (!user) {
      navigate("/auth/login");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const starterFlow = options?.starterFlow ? await loadFastImageTemplate() : null;
      const project = await projectApi.create({
        name: isZh ? "未命名项目" : "Untitled Project",
      });
      if (starterFlow) {
        const content = createEmptyProjectContent();
        content.flow = starterFlow;
        await projectApi.saveContent(project.id, { content });
      }
      navigate(`/app?projectId=${project.id}`);
    } catch (e: unknown) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : isZh
          ? "创建项目失败"
          : "Failed to create project"
      );
    } finally {
      setCreating(false);
    }
  }, [creating, isZh, navigate, user]);

  const recentSlots = useMemo(
    () =>
      Array.from({ length: recentSlotCount }, (_, index) => projects[index] ?? null),
    [projects]
  );

  const quickActions = useMemo(
    () => [
      {
        label: isZh ? "极速生图" : "Fast Generation",
        icon: Zap,
        active: true,
      },
      {
        label: isZh ? "高清放大" : "HD Upscale",
        icon: ImagePlus,
        active: false,
      },
      {
        label: isZh ? "2D转3D" : "2D to 3D",
        icon: Box,
        active: false,
      },
      {
        label: isZh ? "一键分层" : "Layer Split",
        icon: Layers,
        active: false,
      },
    ],
    [isZh]
  );

  const userName =
    user?.name ||
    user?.phone?.slice(-4) ||
    user?.email ||
    user?.id?.slice(-4) ||
    (isZh ? "用户" : "User");

  const status = (() => {
    switch (connection) {
      case "server":
      case "local":
        return { label: isZh ? "在线" : "Online", color: "#16a34a" };
      case "refresh":
        return { label: isZh ? "已刷新" : "Refreshed", color: "#f59e0b" };
      case "mock":
        return { label: isZh ? "模拟" : "Mock", color: "#8b5cf6" };
      default:
        return null;
    }
  })();

  const getActivitySlidePresentation = (index: number) => {
    const count = activitySlides.length;
    const offset = (index - activeActivityIndex + count) % count;

    if (offset === 0) {
      return {
        className:
          "left-[450px] top-0 z-20 h-[300px] w-[660px] border border-white opacity-100 shadow-[0_24px_42px_rgba(0,15,83,0.13)]",
        style: { transform: "translate3d(0,0,0)", transformOrigin: "center center" },
      };
    }

    if (offset === 1) {
      return {
        className:
          "left-[1100px] top-[18px] z-10 h-[264px] w-[470px] opacity-100 shadow-[0_22px_38px_rgba(0,15,83,0.10)]",
        style: {
          transform: "rotateY(-22deg) rotateZ(-1.1deg) skewY(1.8deg) scaleX(0.91)",
          transformOrigin: "left center",
        },
      };
    }

    if (offset === count - 1) {
      return {
        className:
          "left-[20px] top-[18px] z-10 h-[264px] w-[470px] opacity-100 shadow-[0_22px_38px_rgba(0,15,83,0.10)]",
        style: {
          transform: "rotateY(22deg) rotateZ(1.1deg) skewY(-1.8deg) scaleX(0.91)",
          transformOrigin: "right center",
        },
      };
    }

    return {
      className:
        "left-[450px] top-[18px] z-0 h-[264px] w-[470px] opacity-0 shadow-none",
      style: { transform: "scale(0.88)", transformOrigin: "center center" },
    };
  };

  return (
    <main className="relative h-screen overflow-y-auto overflow-x-hidden bg-white text-[#111827]">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[661px]"
        style={{
          backgroundImage: "url('/xingdou/XingdouBg2.png')",
          backgroundPosition: "top center",
          backgroundRepeat: "no-repeat",
          backgroundSize: "1920px 1080px",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-[517px] h-[150px] bg-gradient-to-b from-white/0 via-white/75 to-white"
      />

      <header className="absolute left-0 right-0 top-0 z-30 h-[92px]">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="absolute left-[49px] top-[30.5px] flex h-[46px] w-[290px] items-center justify-center rounded-[12px] border border-white/80 px-0 shadow-[0_12px_12px_rgba(0,15,83,0.12)] backdrop-blur-md max-sm:left-5 max-sm:w-[250px]"
          style={{
            background: "linear-gradient(180deg, #ffffff 0%, #d0d8ff 100%)",
          }}
        >
          <img
            src="/LogoText.svg"
            alt="Tanvas"
            draggable="false"
            className="h-[20px] w-[136px] object-contain"
          />
          <span className="mx-[15px] h-[16.68px] w-px bg-black/45" />
          <span className="whitespace-nowrap text-[17px] font-semibold leading-none text-black">
            {isZh ? "星斗联盟" : "Xingdou"}
          </span>
        </button>

        <div
          className={cn(
            "absolute right-[40px] top-[24px] flex h-[46px] items-center rounded-[12px] border border-white px-4 py-[9px] shadow-[0_12px_12px_rgba(0,15,83,0.12)] backdrop-blur-md max-sm:right-5",
            user ? "w-auto min-w-[470px] gap-5" : "w-[260px] gap-5"
          )}
          style={{
            background: "linear-gradient(180deg, #ffffff 0%, #d0d8ff 100%)",
          }}
        >
          <button
            type="button"
            onClick={toggleLanguage}
            className="inline-flex h-7 shrink-0 items-center gap-[5px] rounded-md text-[16px] font-semibold leading-none text-black transition-colors hover:text-[#143dff]"
            aria-label={isZh ? "切换语言" : "Switch language"}
          >
            <Globe2 className="h-[13.14px] w-[13.14px]" />
            <span>中 / EN</span>
          </button>
          {user ? (
            <>
              <span className="max-w-[120px] truncate text-[15px] font-semibold leading-none text-black/78">
                {isZh ? `你好，${userName}` : `Hi, ${userName}`}
              </span>
              <div className="flex shrink-0 items-center gap-1.5 text-[15px] font-semibold leading-none text-[#143dff]">
                <TeamSwitcher
                  variant="home"
                  className="text-[#143dff] hover:text-[#143dff] [&>span]:text-[#143dff] [&>span:last-of-type]:text-[#143dff]/65 [&_svg]:text-[#143dff]"
                />
              </div>
              {status && (
                <span
                  className="inline-flex h-[27.6px] shrink-0 items-center gap-1.5 rounded-[8px] border border-white/80 bg-white/40 px-3 text-[13px] font-semibold leading-none text-black/72"
                  title={status.label}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: status.color }}
                  />
                  {status.label}
                </span>
              )}
              <button
                type="button"
                onClick={() => void handleLogout()}
                disabled={loggingOut}
                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md text-[15px] font-semibold leading-none text-black/70 transition-colors hover:text-[#143dff] disabled:opacity-50"
              >
                <LogOut className="h-[14px] w-[14px]" />
                {isZh ? "退出登录" : "Log out"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => navigate("/auth/login")}
                className="h-7 rounded-md text-[16px] font-semibold leading-none text-black transition-colors hover:text-[#143dff]"
              >
                {isZh ? "登录" : "Log in"}
              </button>
              <button
                type="button"
                onClick={() => navigate("/auth/register")}
                className="h-[27.6px] w-[72px] rounded-[8px] text-[16px] font-semibold leading-none text-white shadow-[0_8px_18px_rgba(39,71,223,0.24)] transition-opacity hover:opacity-90"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(0,22,126,0.8) 0%, rgba(20,61,255,0.8) 100%)",
                }}
              >
                {isZh ? "注册" : "Sign up"}
              </button>
            </>
          )}
        </div>
      </header>

      <div className="relative z-10 min-h-[1080px]">
        <div
          className="absolute left-1/2 top-8 ml-[-850px] h-[900px] w-[1700px] origin-top"
          style={{
            transform: "scale(0.8)",
            transformOrigin: "top center",
          }}
        >
        <section
          className="absolute left-1/2 top-[108px] h-[292px] -translate-x-1/2 [perspective:1200px]"
          style={{ width: heroMaxWidth }}
        >
          {activitySlides.map((slide, index) => {
            const presentation = getActivitySlidePresentation(index);
            return (
              <img
                key={slide.src}
                src={slide.src}
                alt={isZh ? slide.altZh : slide.altEn}
                draggable="false"
                className={cn(
                  "absolute rounded-[12px] object-cover transition-all duration-700 ease-out",
                  presentation.className
                )}
                style={presentation.style}
              />
            );
          })}
        </section>

        <div
          className="absolute left-1/2 top-[425px] flex h-7 w-[228px] -translate-x-1/2 items-start justify-center gap-2 px-1 pt-3"
          aria-hidden="true"
        >
          {activitySlides.map((slide, index) => (
            <span
              key={slide.src}
              className={cn(
                "h-1 w-[30px] rounded-full",
                index === activeActivityIndex ? "bg-[#2447de]" : "bg-[#cfd3dd]"
              )}
              style={
                index === activeActivityIndex
                  ? {
                      background:
                        "linear-gradient(180deg, rgba(0,22,126,0.8) 0%, rgba(20,61,255,0.8) 100%)",
                    }
                  : { opacity: 0.24, backgroundColor: "#101010" }
              }
            />
          ))}
        </div>

        <div
          className="absolute left-1/2 top-[468px] grid h-[150px] -translate-x-1/2 grid-cols-4 gap-4"
          style={{ width: workspaceMaxWidth }}
        >
          {quickActions.map(({ label, icon: Icon, active }) => (
            <button
              key={label}
              type="button"
              onClick={() => void createProject(active ? { starterFlow: true } : undefined)}
              disabled={creating}
              className={cn(
                "group relative flex h-[92px] w-[348px] items-center justify-between overflow-hidden rounded-[12px] border-2 border-[#b0beff] px-9 text-left text-black transition-all duration-200 hover:border-white hover:text-white hover:shadow-[0_14px_24px_rgba(0,15,83,0.16)]"
              )}
              style={{
                background: "linear-gradient(180deg, #ffffff 0%, #e9edff 100%)",
              }}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(0,22,126,0.8) 0%, rgba(20,61,255,0.8) 100%)",
                }}
              />
              <span className="relative z-10 flex min-w-0 items-center gap-4">
                <Icon
                  className={cn(
                    "shrink-0 text-[#143dff] transition-colors duration-200 group-hover:text-white",
                    active ? "h-[31px] w-[22px]" : "h-[34px] w-[34px]"
                  )}
                  strokeWidth={active ? 2.4 : 2}
                />
                <span className="truncate text-[20px] font-semibold leading-5 tracking-[0]">
                  {label}
                </span>
              </span>
              <ArrowRight
                className={cn(
                  "relative z-10 h-[30px] w-[30px] shrink-0 text-black transition-all duration-200 group-hover:translate-x-1 group-hover:text-white"
                )}
                strokeWidth={1.6}
              />
            </button>
          ))}
        </div>

        <section
          className="absolute left-1/2 top-[616px] -translate-x-1/2"
          style={{ width: workspaceMaxWidth }}
        >
          <div className="flex h-5 items-center justify-between">
            <h1 className="text-[24px] font-semibold leading-5 tracking-[0] text-black">
              {isZh ? "最近项目" : "Recent Projects"}
            </h1>
            <button
              type="button"
              onClick={() => navigate("/app")}
              className="inline-flex h-5 items-center gap-2 text-[16px] font-normal leading-5 text-black/60 transition-colors hover:text-[#2447de]"
            >
              {isZh ? "全部项目" : "All Projects"}
              <ArrowRight className="h-5 w-5" strokeWidth={1.5} />
            </button>
          </div>

        {error && (
          <div className="mt-4 rounded-[8px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="mt-[30px] grid grid-cols-4 gap-4">
          <button
            type="button"
            onClick={() => void createProject()}
            disabled={creating}
            className="group flex h-[232px] w-[348px] flex-col items-center justify-center rounded-[12px] border border-dashed border-[#4460de] text-[#4460de] transition-all hover:bg-[#e9edff]"
            style={{
              background:
                "linear-gradient(180deg, rgba(217,217,217,0.3) 0%, rgba(233,237,255,0.5) 100%)",
            }}
          >
            {creating ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <Plus className="h-6 w-6" strokeWidth={1.7} />
            )}
            <span className="mt-[7px] text-[20px] font-semibold leading-5">
              {isZh ? "开始创作" : "Start Creating"}
            </span>
          </button>

          {recentSlots.map((project, index) => {
            const preview = project?.thumbnailUrl || sampleProjectImages[index];
            const disabled = !project;
            return (
              <article
                key={project?.id ?? `empty-${index}`}
                className={cn("group min-w-0", disabled ? "pointer-events-none" : "")}
              >
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => project && navigate(`/app?projectId=${project.id}`)}
                  className="block h-[232px] w-[348px] overflow-hidden rounded-[12px] border border-[#7e95ff] bg-white text-left transition-all group-hover:shadow-[0_12px_24px_rgba(0,15,83,0.12)]"
                >
                  {preview ? (
                    <img
                      src={preview}
                      alt={getDisplayName(project, isZh)}
                      draggable="false"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <ImageIcon className="h-12 w-12 text-[#b0beff]" strokeWidth={1.9} />
                    </div>
                  )}
                </button>
                <div className="mt-3 flex w-[348px] items-start justify-between gap-3 py-1">
                  <div className="min-w-0">
                    <h2 className="truncate text-[16px] font-semibold leading-5 text-black">
                      {getDisplayName(project, isZh)}
                    </h2>
                    <p className="mt-1 text-[16px] font-normal leading-4 text-black/50">
                      {formatProjectDate(project?.updatedAt || project?.createdAt, isZh)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={disabled}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-black transition-colors hover:bg-black/5 disabled:opacity-100"
                    aria-label={isZh ? "更多项目操作" : "More project actions"}
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    <MoreHorizontal className="h-6 w-6" strokeWidth={3} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        {loading && (
          <div className="mt-5 flex items-center gap-2 text-sm font-medium text-[#71717a]">
            <Loader2 className="h-4 w-4 animate-spin" />
            {isZh ? "加载中..." : "Loading..."}
          </div>
        )}
        </section>
        </div>
      </div>
    </main>
  );
}
