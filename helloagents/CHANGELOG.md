# Changelog

All notable changes to this knowledge base will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning (knowledge-base versioning).

## [Unreleased]
### Changed
- Flow：降低 base64 图片导致的内存峰值（Image Split 避免重复写入/深比较；Flow 持久化对比避免大字符串 JSON 序列化）。

## [0.1.0] - 2026-01-14
### Added
- Initial knowledge base scaffold: `project.md`, `wiki/*`, `history/index.md`, `plan/`.
