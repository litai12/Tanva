# 技术设计: 画布与对话框 JSON 复制/导入

## 技术方案
### 核心技术
- React + Zustand（状态读取/合并）
- Paper.js（画布 JSON 追加导入）
- Clipboard API（系统剪贴板）

### 实现要点
- 新增导出/导入服务，封装 JSON 包装结构与校验。
- 导出时使用 `paperSaveService.serializePaperProject` + `sanitizeProjectContentForCloudSave`，保证与后端持久化一致。
- 导入时拆分处理：Paper.js 内容追加、Flow 合并、AI 会话合并，并进行 ID 去重。
- UI 入口：画布右键菜单 + 快捷键；对话框右键菜单 + 快捷键。

## 架构决策 ADR
### ADR-001: 使用“剪贴板 JSON 包装结构”统一导入格式
**上下文:** 需要支持画布与对话内容的复制/导入，并确保不同来源可判别。
**决策:** 统一使用 `{ type, version, payload }` 的 JSON 包装结构。
**理由:** 明确类型与版本，避免误解析，提高后向兼容性。
**替代方案:** 直接输出裸 ProjectContentSnapshot → 拒绝原因: 无法区分类型，兼容性差。
**影响:** 导入逻辑需识别 type/version 并做兼容处理。

## 安全与性能
- **安全:** 严格清理 data/blob/base64，避免写入设计 JSON；导入前 JSON 结构校验。
- **性能:** 大 JSON 导出采用局部序列化（Paper.js 单次 exportJSON），避免重复读取。

## 测试与部署
- **测试:** 手动测试复制/导入流程（画布、Flow、对话）与剪贴板权限回退路径。
- **部署:** 前端发布即可。
