# Changelog

All notable changes to this knowledge base will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning (knowledge-base versioning).

## [Unreleased]
### Changed
- Flow：降低 base64 图片导致的内存峰值（Image Split 迁移到 Worker 并使用 `flow-asset:` 引用；Image Grid 输出改为 Blob；Flow 持久化对比避免大字符串 JSON 序列化）。
- 设计 JSON：`Project.contentJson` / `PublicTemplate.templateData` 强制禁止 `data:`/`blob:`/base64 图片进入 DB/OSS（后端清洗 + 提供批量修复脚本）。
- 清空画布：重置 undo/redo 历史并清理剪贴板/图像缓存，避免清空后仍被旧快照引用导致内存不降。

## [0.1.0] - 2026-01-14
### Added
- Initial knowledge base scaffold: `project.md`, `wiki/*`, `history/index.md`, `plan/`.
