/**
 * Token 主动刷新管理器
 *
 * 功能：
 * 1. 在 access token 过期前主动刷新（提前 1 小时）
 * 2. 提供 token 有效性检查
 * 3. 触发登录弹窗事件
 */

// Token 配置（与后端 JWT_ACCESS_TTL=24h 对应）
const ACCESS_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时
const REFRESH_BEFORE_EXPIRE_MS = 60 * 60 * 1000; // 提前 1 小时刷新
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 每 30 分钟检查一次

// 后端基础地址
const viteEnv =
  typeof import.meta !== "undefined" && (import.meta as any).env
    ? (import.meta as any).env
    : undefined;

const base =
  viteEnv?.VITE_API_BASE_URL && viteEnv.VITE_API_BASE_URL.trim().length > 0
    ? viteEnv.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000";

// 事件类型
export type TokenEvent =
  | "token-refreshed"
  | "token-refresh-failed"
  | "login-required";

type TokenEventCallback = (event: TokenEvent, data?: any) => void;

class TokenRefreshManager {
  private lastRefreshTime: number = 0;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private isRefreshing: boolean = false;
  private listeners: Set<TokenEventCallback> = new Set();
  private initialized: boolean = false;

  /**
   * 初始化管理器，开始定时检查
   */
  init() {
    if (this.initialized) return;
    this.initialized = true;

    // 记录初始时间（假设刚登录或刚刷新页面时 token 是有效的）
    this.lastRefreshTime = Date.now();

    // 启动定时检查
    this.startPeriodicCheck();

    // 监听页面可见性变化，页面重新可见时检查 token
    if (typeof document !== "undefined") {
      document.addEventListener(
        "visibilitychange",
        this.handleVisibilityChange
      );
    }

    // 监听 auth-expired 事件（来自 authFetch）
    if (typeof window !== "undefined") {
      window.addEventListener("auth-expired", this.handleAuthExpired);
    }

    console.log("[TokenRefreshManager] 初始化完成");
  }

  /**
   * 销毁管理器
   */
  destroy() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    if (typeof document !== "undefined") {
      document.removeEventListener(
        "visibilitychange",
        this.handleVisibilityChange
      );
    }

    if (typeof window !== "undefined") {
      window.removeEventListener("auth-expired", this.handleAuthExpired);
    }

    this.initialized = false;
    this.listeners.clear();
    console.log("[TokenRefreshManager] 已销毁");
  }

  /**
   * 订阅事件
   */
  subscribe(callback: TokenEventCallback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * 触发事件
   */
  private emit(event: TokenEvent, data?: any) {
    this.listeners.forEach((cb) => {
      try {
        cb(event, data);
      } catch (e) {
        console.error("[TokenRefreshManager] 事件回调错误:", e);
      }
    });
  }

  /**
   * 页面可见性变化处理
   */
  private handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      // 页面重新可见，检查是否需要刷新
      this.checkAndRefresh();
    }
  };

  /**
   * 处理 auth-expired 事件
   */
  private handleAuthExpired = () => {
    console.log("[TokenRefreshManager] 收到 auth-expired 事件");
    this.emit("login-required", { reason: "token-expired" });
  };

  /**
   * 启动定时检查
   */
  private startPeriodicCheck() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }

    this.refreshTimer = setInterval(() => {
      this.checkAndRefresh();
    }, CHECK_INTERVAL_MS);
  }

  /**
   * 检查并在需要时刷新 token
   */
  async checkAndRefresh(): Promise<boolean> {
    const timeSinceLastRefresh = Date.now() - this.lastRefreshTime;
    const timeUntilExpire = ACCESS_TOKEN_TTL_MS - timeSinceLastRefresh;

    // 如果距离过期还有超过 1 小时，不需要刷新
    if (timeUntilExpire > REFRESH_BEFORE_EXPIRE_MS) {
      return true;
    }

    console.log(
      `[TokenRefreshManager] Token 即将过期（剩余 ${Math.round(
        timeUntilExpire / 60000
      )} 分钟），开始刷新`
    );
    return this.refresh();
  }

  /**
   * 执行 token 刷新
   */
  async refresh(): Promise<boolean> {
    if (this.isRefreshing) {
      console.log("[TokenRefreshManager] 刷新正在进行中，跳过");
      return false;
    }

    this.isRefreshing = true;

    try {
      const res = await fetch(`${base}/api/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });

      if (res.ok) {
        this.lastRefreshTime = Date.now();
        console.log("[TokenRefreshManager] Token 刷新成功");
        this.emit("token-refreshed");
        return true;
      } else {
        console.warn("[TokenRefreshManager] Token 刷新失败:", res.status);
        this.emit("token-refresh-failed", { status: res.status });

        // 如果是 401，说明 refresh token 也过期了
        if (res.status === 401) {
          this.emit("login-required", { reason: "refresh-token-expired" });
        }
        return false;
      }
    } catch (e) {
      console.error("[TokenRefreshManager] Token 刷新网络错误:", e);
      this.emit("token-refresh-failed", { error: e });
      return false;
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * 登录成功后调用，重置刷新时间
   */
  onLoginSuccess() {
    this.lastRefreshTime = Date.now();
    console.log("[TokenRefreshManager] 登录成功，重置刷新时间");
  }

  /**
   * 登出时调用
   */
  onLogout() {
    this.lastRefreshTime = 0;
  }

  /**
   * 确保 token 有效（用于关键操作前调用）
   * 如果 token 即将过期，会先刷新
   */
  async ensureValidToken(): Promise<boolean> {
    const timeSinceLastRefresh = Date.now() - this.lastRefreshTime;
    const timeUntilExpire = ACCESS_TOKEN_TTL_MS - timeSinceLastRefresh;

    // 如果已经过期或即将过期（5分钟内），先刷新
    if (timeUntilExpire < 5 * 60 * 1000) {
      return this.refresh();
    }

    return true;
  }

  /**
   * 获取 token 剩余有效时间（毫秒）
   */
  getTimeUntilExpire(): number {
    const timeSinceLastRefresh = Date.now() - this.lastRefreshTime;
    return Math.max(0, ACCESS_TOKEN_TTL_MS - timeSinceLastRefresh);
  }
}

// 单例导出
export const tokenRefreshManager = new TokenRefreshManager();
