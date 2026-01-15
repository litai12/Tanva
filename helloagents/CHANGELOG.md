# Changelog

All notable changes to this knowledge base will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning (knowledge-base versioning).

## [Unreleased]
### Changed
- Flow：Image Split 持久化改为 `inputImageUrl + splitRects`（不再把切片图片/`flow-asset:` 写入 `content.flow`），Image Grid 支持基于 `splitRects` 裁切拼合；Worker 侧计算降低主线程峰值。
- 设计 JSON：`Project.contentJson` / `PublicTemplate.templateData` 强制禁止 `data:`/`blob:`/base64 图片进入 DB/OSS（后端清洗 + 提供批量修复脚本）。
- 清空画布：重置 undo/redo 历史并清理剪贴板/图像缓存，避免清空后仍被旧快照引用导致内存不降。

### Fixed
- 项目内容加载：前端对同项目 `GET /api/projects/:id/content` 做并发去重；后端 OSS 未配置/禁用时跳过读写并设置超时，减少重复下载与长时间卡顿。

## [0.1.0] - 2026-01-14
### Added
- Initial knowledge base scaffold: `project.md`, `wiki/*`, `history/index.md`, `plan/`.
