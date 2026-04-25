# 真人素材生物认证 — ImageNode 增强设计

**日期：** 2026-04-25  
**范围：** 在现有 `ImageNode` 上追加独立的生物认证（活体检测）流程，用于授权图片用于 AI 内容生成  
**参考文档：** https://www.volcengine.com/docs/82379/2333589  

---

## 1. 背景与目标

现有 `ImageNode` 已有一套 volcAsset 素材审核流程（上传 → processing → active，3天有效期）。  
新增「生物认证」模块，使用火山引擎活体检测 API，让用户以本人身份授权将图片用于 AI 生成。

两套流程**完全独立、互不影响**，下游节点根据自身需求决定使用哪一种授权方式。

---

## 2. 数据模型

在 `ImageNode` 的 `data` 对象上新增以下字段：

```ts
bioAuthId?: string       // 火山引擎活体检测任务 ID
bioAuthStatus?: 'processing' | 'active' | 'failed'
bioAuthDate?: string     // 认证通过时间（ISO 字符串），用于计算过期
bioAuthError?: string    // 失败原因文案
```

有效期常量：`BIO_AUTH_VALID_DAYS = 30`

---

## 3. 状态机

| 内部状态 | 显示文案 | Badge 颜色 |
|---|---|---|
| 无字段（初始） | 未认证 | 灰色 |
| `processing` | 认证中… | 蓝色旋转 |
| `active` + bioAuthDate 在 30 天内 | ✓ 已认证（N 天后过期） | 绿色 |
| `active` + bioAuthDate 超过 30 天 | 已过期，点击重新认证 | 橙色 |
| `failed` | 认证失败，点击重试 | 红色 |

过期判断逻辑（同 volcAsset 审核模式）：

```ts
const BIO_AUTH_VALID_DAYS = 30;
const isExpired = bioAuthStatus === 'active' &&
  bioAuthDate &&
  Date.now() > new Date(bioAuthDate).getTime() + BIO_AUTH_VALID_DAYS * 86400_000;
const effectiveBioStatus = isExpired ? undefined : bioAuthStatus;
```

---

## 4. 交互流程

### 4.1 Badge 入口

在 `ImageNode` 底部，现有 volcAsset Badge 旁边平级追加 `BioAuthBadge`：

```
[ 🔒 素材审核: 通过 ]   [ 👤 生物认证: 28天后过期 ]
```

点击 Badge（任何状态均可点击）→ 打开 `BioAuthModal`。

### 4.2 BioAuthModal 三步向导

**Step 1 — 授权说明**

- 说明认证目的：确认本人身份，授权图片用于 AI 生成
- 说明数据处理：认证信息仅用于验证，不存储人脸数据
- 说明有效期：30 天
- 操作：[取消] / [开始认证 →]

**Step 2 — 摄像头活体检测**

- 调用浏览器 `getUserMedia` 获取摄像头权限
- 若权限被拒：显示「请在浏览器设置中允许摄像头访问」，提供重试按钮
- 权限通过后：显示实时摄像头预览 + 动作提示（如「请缓慢左右转头」）
- 前端采集视频帧后调用 `POST /api/bio-auth/start` 发起任务，后端负责调用火山引擎活体检测 API
- `useBioAuthPolling` 开始轮询任务状态，检测通过 → 自动进入 Step 3
- 检测失败 → 当前步骤显示失败原因 + [重试] 按钮

**Step 3 — 结果反馈**

- 成功：「✅ 认证成功，有效至 YYYY-MM-DD」→ [关闭]
- 失败：「❌ 认证失败，请检查光线或重新尝试」→ [重试] / [取消]

### 4.3 Modal 关闭行为

- Step 2 检测进行中关闭 Modal：节点 Badge 保持 `processing` 状态，重新打开 Modal 可继续查看结果
- 检测完成前关闭不中断后台轮询（`useBioAuthPolling` 持续运行）

---

## 5. 组件架构

### 新增文件

```
src/services/bioAuthAPI.ts
  - startBioAuth(imageUrl: string): Promise<{ taskId: string }>
  - getBioAuthStatus(taskId: string): Promise<{ status, errorMessage? }>

src/hooks/useBioAuthPolling.ts
  - 类比 useVolcAssetPolling
  - status === 'processing' 时每 5s 轮询，2 分钟超时强制置 failed

src/components/flow/nodes/BioAuthModal.tsx
  - Props: { isOpen, imageUrl, onClose, onSuccess, onFail }
  - 内部管理摄像头 stream（组件卸载时 track.stop()）
  - 三步向导状态：'consent' | 'detecting' | 'result'
```

### 修改文件

```
src/components/flow/nodes/ImageNode.tsx
  - 读取 bioAuth* 字段
  - 计算 effectiveBioStatus 和 daysLeft
  - 恢复中断的 processing 状态（无 bioAuthId 时置 failed）
  - Badge 区域追加 BioAuthBadge
  - 集成 useBioAuthPolling
```

---

## 6. 后端 API 约定

```
POST /api/bio-auth/start
  body:     { imageUrl: string }
  response: { taskId: string }

GET /api/bio-auth/:taskId/status
  response: { status: 'processing' | 'active' | 'failed', errorMessage?: string }
```

后端负责：调用火山引擎活体检测 API、管理 taskId 生命周期。  
前端只轮询状态，不直接调用火山引擎。

---

## 7. 关键约束

- 摄像头 stream 必须在 Modal 卸载时调用 `track.stop()` 释放，防止摄像头指示灯常亮
- `bioAuthStatus === 'processing'` 且无 `bioAuthId` 时（上传中断），mount 时自动置为 `failed`（与现有 volcAsset 逻辑一致）
- 有效期过期后 `effectiveBioStatus` 视为 `undefined`（未认证），不直接修改节点数据，仅影响显示
- 生物认证字段在图片替换（`imageUrl` 变更）时需清空（防止旧认证挂在新图片上）

---

## 8. 不在本期范围内

- 下游节点（KlingVideoNode 等）对 `bioAuthStatus` 的读取和校验逻辑
- 后端火山引擎 SDK 的具体接入实现
- 管理员后台查看认证记录
