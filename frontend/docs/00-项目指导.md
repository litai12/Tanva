# CLAUDE.md

本文件为Claude Code (claude.ai/code) 在此代码库中工作时提供指导。

## 项目概述

Artboard是一个基于Paper.js的专业React + TypeScript绘图应用程序。专注于清洁架构和生产就绪的实现。

## 架构指南

### 状态管理 - Zustand
```typescript
// 在 src/stores/ 目录中使用 Zustand stores
- canvasStore.ts - 画布状态（缩放、平移、网格设置）
- appStore.ts - 应用程序状态
- uiStore.ts - UI面板可见性和设置
```

### 画布系统（关键监控）

**Canvas.tsx行数监控**：
- ⚠️ **保持在200行以下** - 接近此限制时拆分为组件
- 将复杂逻辑提取到自定义hooks中
- 将Paper.js特定代码移至专门的服务/工具中
- 为不同功能创建专用画布组件

### UI框架
- **shadcn/ui**：用于一致、可访问的UI组件
- **Tailwind CSS**：工具优先的样式方法

## 路径别名
- `@/*` 映射到 `./src/*` - 用于所有内部导入

## 文件组织原则

### 组件文件
- 每个文件一个组件
- 在同一文件中共同定位相关类型
- 使用描述性、具体的文件名

### 存储文件
- 每个存储单一职责
- 清晰的关注点分离
- 所有状态的适当TypeScript类型定义

## 新增功能：背景移除（抠图）

### 功能概述
集成了AI驱动的背景移除功能，支持透明PNG输出和Paper.js无缝集成。

### 核心文件
```
后端:
server/src/ai/
├── services/background-removal.service.ts   # 核心抠图服务
├── dto/background-removal.dto.ts            # DTO定义
└── ai.controller.ts                         # API: POST /api/ai/remove-background

前端:
src/services/
├── backgroundRemovalService.ts              # 前后端协调和智能路由
└── paperBackgroundRemovalService.ts         # Paper.js集成（Raster转换、导出）

UI组件:
src/components/canvas/
├── BackgroundRemovalTool.tsx                # 抠图工具主界面
└── BackgroundRemovedImageExport.tsx         # 导出和管理面板

集成:
src/components/toolbar/ToolBar.tsx          # 工具栏中的魔棒按钮集成
```

### 技术栈
- **后端**: `@imgly/background-removal-node` (ONNX模型)
- **前端**: `@imgly/background-removal` (可选，用于小图快速处理)
- **输出**: 真正的透明PNG（RGBA格式，不是白色背景）

### 处理策略
- **小图(<2MB)**: 优先前端WASM处理（毫秒级）
- **大图(>2MB)**: 自动转发到后端API（秒级）
- **无WebGPU**: 自动降级到后端处理

### 导出功能
- PNG下载（保留透明度）
- 复制到剪贴板
- 继续在Paper.js中编辑

### 详细文档
参考 `BACKGROUND_REMOVAL_GUIDE.md` 获取完整的使用指南、API文档和故障排除



