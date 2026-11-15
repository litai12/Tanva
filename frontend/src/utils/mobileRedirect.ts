// 手机访问桌面端入口时重定向到同域 /m。/m 与桌面端同源同一个 SPA，
// 登录态（authStore / token 存储 / cookie）天然共享，无需额外同步。

const PREFER_DESKTOP_KEY = 'tanva:prefer-desktop';

// 只重定向桌面端画布/首页入口；/my-credits、/membership 等被 /m 复用的页面、
// 登录注册、法律条款、调试页都不跳转。
const DESKTOP_ENTRY_PATH = /^\/(?:app|workspace)?\/?$/;

// 仅手机：平板（iPad / Android 平板）仍可使用画布，不强制跳转。
const PHONE_UA = /iPhone|iPod|Android.+Mobile|Windows Phone|HarmonyOS.+Mobile|Mobile.+Firefox|BlackBerry|Opera Mini|IEMobile/i;

export function isPhoneUserAgent(ua: string): boolean {
  return PHONE_UA.test(ua);
}

export function shouldRedirectToMobile(pathname: string, ua: string, preferDesktop: boolean): boolean {
  return !preferDesktop && DESKTOP_ENTRY_PATH.test(pathname) && isPhoneUserAgent(ua);
}

/** 读取 `?desktop=1|0` 覆盖并持久化，返回当前是否偏好桌面版。 */
export function readPreferDesktop(search: string): boolean {
  try {
    const flag = new URLSearchParams(search).get('desktop');
    if (flag === '1') window.localStorage.setItem(PREFER_DESKTOP_KEY, '1');
    else if (flag === '0') window.localStorage.removeItem(PREFER_DESKTOP_KEY);
    return window.localStorage.getItem(PREFER_DESKTOP_KEY) === '1';
  } catch {
    return false;
  }
}
