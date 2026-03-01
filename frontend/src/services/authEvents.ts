import { useAuthStore } from "@/stores/authStore";

// 防止 auth-expired 事件重复触发
let lastAuthExpiredTime = 0;
const AUTH_EXPIRED_DEBOUNCE_MS = 3000; // 3秒内不重复触发

export function triggerAuthExpired(reason = "登录已过期，请重新登录") {
  const now = Date.now();
  if (now - lastAuthExpiredTime < AUTH_EXPIRED_DEBOUNCE_MS) {
    return;
  }
  lastAuthExpiredTime = now;

  try {
    window.dispatchEvent(new CustomEvent("auth-expired"));
  } catch {}

  try {
    useAuthStore.getState().forceLogout(reason);
  } catch (error) {
    console.warn("triggerAuthExpired: failed to force logout", error);
  }
}

