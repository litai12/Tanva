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


