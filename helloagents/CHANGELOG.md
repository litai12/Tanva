# Changelog

All notable changes to this knowledge base will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning (knowledge-base versioning).

## [Unreleased]
### Changed
- Flow：Image Split 持久化改为 `inputImageUrl + splitRects`（不再把切片图片/`flow-asset:` 写入 `content.flow`），Image Grid 支持基于 `splitRects` 裁切拼合；Worker 侧计算降低主线程峰值。
- 设计 JSON：`Project.contentJson` / `PublicTemplate.templateData` 强制禁止 `data:`/`blob:`/base64 图片进入 DB/OSS（后端清洗 + 提供批量修复脚本）。
- Flow：图片节点输出统一为远程 URL/OSS key（Camera/Three/ImageGrid/VideoFrameExtract 等不再持久化 base64/缩略图/`flow-asset:`），并在保存前对 `content.flow` 做内联图片校验，避免落库。
- 清空画布：重置 undo/redo 历史并清理剪贴板/图像缓存，避免清空后仍被旧快照引用导致内存不降。

### Fixed
- 项目内容加载：前端对同项目 `GET /api/projects/:id/content` 做并发去重；后端 OSS 未配置/禁用时跳过读写并设置超时，减少重复下载与长时间卡顿。
- Flow：Image Split 分割完成后“生成节点”不再置灰；支持基于 `splitRects` 生成 Image 节点并在 Image 节点运行时裁剪预览（不落库）。

## [0.1.0] - 2026-01-14
### Added
- Initial knowledge base scaffold: `project.md`, `wiki/*`, `history/index.md`, `plan/`.
