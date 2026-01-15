# Changelog

All notable changes to this knowledge base will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning (knowledge-base versioning).

## [Unreleased]
### Changed
- Flow：Image Split 分割运行时使用 `canvas/flow-asset`（Split 时不再强制上传 OSS）；保存前通过 `frontend/src/services/flowSaveService.ts` 自动补传并将 `inputImageUrl` 替换为远程 URL/OSS key，持久化仍为 `inputImageUrl + splitRects`；Worker 侧计算降低主线程峰值。
- 设计 JSON：`Project.contentJson` / `PublicTemplate.templateData` 强制禁止 `data:`/`blob:`/base64 图片进入 DB/OSS（后端清洗 + 提供批量修复脚本）。
- Flow：图片节点输出以远程 URL/OSS key 为主（Camera/Three/ImageGrid/VideoFrameExtract 等不再持久化 base64/缩略图/`flow-asset:`）；运行时允许临时引用，但保存前会对 `content.flow` 做内联图片校验/补传替换，避免落库。
- Canvas：统一图片引用适配（remote URL / `/api/assets/proxy` / OSS key / 相对路径），并将 `<img>`/Paper.js Raster 的展示源统一收口到 `frontend/src/utils/imageSource.ts`（`toRenderableImageSrc`、`isPersistableImageRef`、`normalizePersistableImageRef`、`resolveImageToBlob/DataUrl`）。
- 清空画布：重置 undo/redo 历史并清理剪贴板/图像缓存，避免清空后仍被旧快照引用导致内存不降。
- 后端：开发环境可通过 `CORS_DEV_ALLOW_ALL` 放开跨域并忽略 `CORS_ORIGIN`。

### Fixed
- 项目内容加载：前端对同项目 `GET /api/projects/:id/content` 做并发去重；后端 OSS 未配置/禁用时跳过读写并设置超时，减少重复下载与长时间卡顿。
- Flow：Image Split 分割完成后“生成节点”不再置灰；支持基于 `splitRects` 生成 Image 节点并在 Image 节点运行时裁剪预览（不落库）。
- Canvas：修复将 OSS key/proxy/path 误判为 base64/待上传导致图片置灰的问题（含快速上传、导入重建实例、视频缩略图与下载链路）。
- Flow：禁用节点拖拽时的自动平移（`autoPanOnNodeDrag`），并在 `dragStop` 强制回同步视口，避免快速拖动节点时视口漂移导致其他节点整体偏移。
- Flow：三维节点（`ThreeNode`）上传模型后自动居中相机，并将模型 URL 持久化为远程引用，避免切换/resize 后模型丢失。
- Flow：三维节点（`ThreeNode`）在节点 resize 时 canvas 保持铺满（以容器尺寸同步 renderer，避免 `setSize` 改写 canvas 样式尺寸导致留白）。

## [0.1.0] - 2026-01-14
### Added
- Initial knowledge base scaffold: `project.md`, `wiki/*`, `history/index.md`, `plan/`.
