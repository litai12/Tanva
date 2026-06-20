# 导演台节点（Director Console Node）— 设计 spec

**日期**: 2026-06-20
**来源**: 从 TapCanvas-pro `apps/web/src/canvas/nodes/directorConsole/` 复刻到 Tanva 画布
**范围**: 仅交互式（搭 3D 场景→截图→发画布生成图片节点）。**不做** Agent 离屏 claim/report 后端桥与 DirectorCaptureRunner。保真度尽量 1:1。

## 目标

新增独立 ReactFlow 节点 `directorConsole`：全屏 3D 编辑器，放置素体角色（Mixamo 骨骼 GLB）+ 家具/道具，
逐关节摆姿势（51 预设 + 16 滑块 + 直接拖骨骼 gizmo），布置机位，挂等距全景天空盒，
按画幅截图（渲染目标读像素，纯客户端），把截图作为图片节点发到画布。

## 架构

全部前端。3D 用 three + @react-three/fiber v9 + @react-three/drei v10（Tanva 已装）。
截图：`captureView()` 渲染到 `WebGLRenderTarget` → `gl.readRenderTargetPixels` → canvas → `toDataURL('image/jpeg',0.92)`。
发图：截图 dataURL → `ossUploadService.uploadToOSS`（image）→ 通过 Tanva 既有 `triggerQuickImageUpload` CustomEvent 在画布生成 image 节点（或直接发到下游）。

## 文件 `frontend/src/components/flow/nodes/directorConsole/`

**纯逻辑（已逐字移植，仅依赖 three + import.meta.env）**：
- `types.ts` ✅ — 数据模型（DirectorScene/CharacterObj/CameraObj/CameraShot/DirectorConsoleData + createDefault）
- `state/aspect.ts` ✅ — 画幅比例 + 截图尺寸（长边 1280）
- `state/scene.ts` ✅ — 纯 mutation（addCharacter/addCamera/patch.../removeObject/setAspect/setSkybox/setViewpoint/setActiveCamera）
- `state/pose.ts` ✅ — 骨骼映射 mapBones（Mixamo 精确+模糊）、calibrateRig、applyPoseToRig、poseEulerFromRig、JOINT_SLIDERS(16)、POSE_PRESETS(51)
- `assets.ts` ✅ — 角色库 BODY_TYPES(8)/FURNITURE_TYPES(10)/PROP_TYPES(5)、getLibraryItem。GLB 默认 `/director/xbot.glb`

**R3F 场景层（需 fiber v8→v9 / drei v9→v10 适配，逻辑照搬）**：
- `scene/Viewport.tsx` — Canvas(preserveDrawingBuffer)、OrbitControls、Grid、GizmoHelper、PerspectiveCamera、TransformControls(平移/旋转/缩放，挂 body/camera/bone)、天空盒(等距)、captureView 截图、ViewportHandle ref
- `scene/CharacterObject.tsx` — useGLTF 加载、SkeletonUtils.clone、归一化身高/体宽、落地、calibrateRig + applyPoseToRig、关节标记球（编辑模式）、Html 标签
- `scene/CameraRig.tsx` — CameraHelper 视锥可视化 + 同步参数

**UI（Mantine→Radix/Tailwind/lucide，@tabler→lucide，xyflow→reactflow v11，store→flow:updateNodeData）**：
- `panels/Field.tsx` — Section/TextField/NumberField/Vec3Row/SliderField
- `panels/Toolbar.tsx` — gizmo 模式 V/R/S、加角色/道具菜单、天空盒、加机位、画幅、截图、删除
- `panels/SceneTreePanel.tsx` — 场景树（机位+角色，搜索、显隐、锁定）
- `panels/CharacterPropertiesPanel.tsx` — 属性 tab（位置/旋转/缩放/颜色）+ 姿势 tab（预设分类 + 16 滑块）
- `panels/CameraPropertiesPanel.tsx` — 属性 tab（位置/lookAt/FOV/切换机位）+ 截图 tab（画廊、发送/删除/全部发送）
- `DirectorConsoleModal.tsx` — 全屏 portal 编辑器，state 同步、键盘快捷键(V/R/S/方向/Delete)、天空盒读上游图片、截图与发送流程
- `DirectorConsoleNode.tsx` — 节点卡片（图标+标题+「打开导演台」按钮）
- `sendToCanvas.ts` — 截图→画布 image 节点（用 Tanva triggerQuickImageUpload）
- `uploadCanvasImageBlob.ts` — 截图 blob 上传（ossUploadService）

**排除（不移植）**：DirectorCaptureRunner.tsx、claimDirectorCapture/reportDirectorCapture、agent bridge。

## 资源

`frontend/public/director/`（已拷贝：xbot.glb 2.9MB + cesium-man.glb + rigged-figure.glb + ATTRIBUTION.md）。可用 env `VITE_DIRECTOR_GLB_MALE/FEMALE` 覆盖。

## 接入 `FlowOverlay.tsx`

- import + `rawNodeTypes: directorConsole`
- `NODE_CREDITS_MAP: directorConsole: 0`
- `NODE_PALETTE_ITEMS`: `{ key:"directorConsole", zh:"导演台", en:"Director Console", category:"three"/"image" }`
- `NODE_PANEL_GROUP_BY_TYPE`、`FLOW_NODE_DEFAULT_SIZE`（卡片小，~ 260×160）
- handle：左 target image（全景图输入，可选）、右 source image（截图输出）。`isValidConnection` 加分支：image→directorConsole(target image)。
- 截图发图走 triggerQuickImageUpload（与 ThreeNode/Seed3DNode 一致）。

## 适配要点 / 坑

- @react-three/fiber v9 + drei v10：OrbitControls/TransformControls/Grid/GizmoHelper/useGLTF/Html/PerspectiveCamera 仍在；注意 fiber v9 的 `gl`/`camera` 通过 useThree，事件签名微调。
- 全屏弹窗用 createPortal 到 body（ReactFlow transform 容器内 fixed 失效）。
- Canvas 必须 `gl={{ preserveDrawingBuffer:true }}` 才能截图。
- 天空盒等距贴图：SRGBColorSpace + EquirectangularReflectionMapping；跨域图走 `/api/assets/proxy`。
- useGLTF 预加载用 drei `useGLTF.preload('/director/xbot.glb')`。
- 无测试框架，验证 = tsc -b + 手动联调。

## 验证

`tsc -b` + 手动：拖出导演台 → 加角色摆姿势/加道具 → 加机位调 FOV → 截图 → 发画布生成图片节点。Chrome（WebGL）。
