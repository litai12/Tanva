# 任务清单: 图片上传/生成即时保存与画布渲染修复

目录: `helloagents/plan/202601220842_image_autosave_render/`

---

## 0. 资源代理调整
- [√] 0.1 在 `frontend/src/utils/assetProxy.ts` 与 `frontend/src/utils/imageSource.ts` 禁用 `/api/assets/proxy` 作为默认静态资源路径，改为直连 OSS/CDN（依赖 `VITE_ASSET_PUBLIC_BASE_URL`）

## 1. 自动保存时机
- [-] 1.1 在 `frontend/src/components/canvas/hooks/useQuickImageUpload.ts` 中补充上传成功后的即时保存触发点，确保远程 URL 可用后保存，验证 why.md#需求-上传生成图片即时保存-场景-图片落盘后立即保存
  > 备注: 需求变更为“禁用 /api/assets/proxy 直连 OSS”，本项未执行
- [-] 1.2 在 `frontend/src/components/canvas/hooks/useImageTool.ts` 或 `frontend/src/components/flow/FlowOverlay.tsx` 中补充生成图片成功后的保存触发点，验证 why.md#需求-上传生成图片即时保存-场景-图片落盘后立即保存，依赖任务1.1
  > 备注: 需求变更为“禁用 /api/assets/proxy 直连 OSS”，本项未执行

## 2. 画布渲染一致性
- [-] 2.1 在 `frontend/src/services/paperSaveService.ts` 中强化 Raster 加载后的 view 更新逻辑，避免首次加载空白，验证 why.md#需求-画布图片首次加载即显示-场景-Raster-异步加载完成后自动更新
  > 备注: 需求变更为“禁用 /api/assets/proxy 直连 OSS”，本项未执行
- [-] 2.2 如需补充，在 `frontend/src/components/canvas/hooks/useQuickImageUpload.ts` 中对 source 切换后的 Raster 补充一次 view 更新，验证 why.md#需求-画布图片首次加载即显示-场景-Raster-异步加载完成后自动更新，依赖任务2.1
  > 备注: 需求变更为“禁用 /api/assets/proxy 直连 OSS”，本项未执行

## 3. 安全检查
- [√] 3.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 4. 测试
- [-] 4.1 手工回归上传/生成图片后刷新，验证图片持久化与首次加载可见
  > 备注: 本次仅调整资源代理策略，未执行该回归
