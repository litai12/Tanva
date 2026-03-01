# 任务清单: 画布图片预览项目内列表

目录: `helloagents/plan/202601211840_canvas_project_image_list/`

---

## 1. 后端接口支持项目过滤
- [√] 1.1 在 `backend/src/global-image-history/dto/global-image-history.dto.ts` 增加 `sourceProjectId` 查询字段，验证 why.md#需求-画布双击图片时的项目内预览列表-场景-右侧缩略图只展示当前项目图片
- [√] 1.2 在 `backend/src/global-image-history/global-image-history.service.ts` 追加 sourceProjectId 过滤条件，验证 why.md#需求-画布双击图片时的项目内预览列表-场景-右侧缩略图只展示当前项目图片，依赖任务1.1

## 2. 前端 API 与预览懒加载
- [√] 2.1 在 `frontend/src/services/globalImageHistoryApi.ts` 支持 sourceProjectId 查询参数，验证 why.md#需求-画布双击图片时的项目内预览列表-场景-右侧缩略图只展示当前项目图片
- [√] 2.2 在 `frontend/src/components/ui/ImagePreviewModal.tsx` 增加滚动触底触发 onLoadMore 的能力，验证 why.md#需求-画布双击图片时的项目内预览列表-场景-右侧缩略图只展示当前项目图片
- [√] 2.3 在 `frontend/src/components/canvas/ImageContainer.tsx` 使用项目级分页状态加载预览列表，验证 why.md#需求-画布双击图片时的项目内预览列表-场景-右侧缩略图只展示当前项目图片，依赖任务2.1、2.2

## 3. 安全检查
- [√] 3.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 4. 测试
- [-] 4.1 手动验证双击画布图片后的项目内列表与滚动懒加载表现
> 备注: 未在本地运行交互验证。
