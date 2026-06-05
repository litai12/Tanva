/**
 * Seedance 2.0 限时免费活动前端开关。
 *
 * 构建时通过环境变量 VITE_SEEDANCE20_FREE=1/true/on/yes 开启：
 * - 视频节点积分预览对 seedance-2.0 / seedance-2.0-fast 显示 0；
 * - 登录弹窗、活动横幅文案切换为「限时免费」。
 *
 * 需与后端运行时开关 SEEDANCE20_FREE 同步开关，二者各自管自己的展示/计费，
 * 实际扣费以后端为准（后端 0 积分即免费）。
 */
export const isSeedance20FreeEnabled = (): boolean => {
  const raw = String(import.meta.env.VITE_SEEDANCE20_FREE ?? "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
};
