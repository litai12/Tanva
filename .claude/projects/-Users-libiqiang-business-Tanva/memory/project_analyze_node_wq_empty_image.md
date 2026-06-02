---
name: project_analyze_node_wq_empty_image
description: Image Chat/Analyze 节点发给上游空图 data:image/jpeg;base64,/w== 的根因与修复(2026-06-02)
metadata:
  type: project
---

Image Chat(AnalyzeNode)分析历史图时上游 new-api/Gemini 报 "Provided image is not valid"，请求里 `sourceImage` 是 `data:image/jpeg;base64,/w==`（1 字节 0xFF）。

**根因**：`AnalyzeNode` 走 `resolveImageToDataUrl(..., preferProxy:true)`，对 volces.com 托管 URL **第一个候选就是 `/api/assets/proxy?key=...`**。该 key 是悬空对象(NoSuchKey，见 [[project_asset_direct_load_and_404]])，代理返回 `200 + Content-Type: image/jpeg + 1字节体`；旧代码只校验 `blob.type` 不校验大小，于是把垃圾 base64 当成功返回。画布正常是因为 Paper.js 直连真实 OSS URL，没走代理。

**修复(2026-06-02, scope=analyze路径)**：
- `utils/imageSource.ts`：`resolveImageToDataUrl`/`resolveImageToBlob` 新增 `disableProxy?` 选项(默认 false，不影响其它调用方)，置 true 时跳过所有 `/api/assets/proxy` 候选仅直连 OSS/CDN(已配 TOS CORS)；并加 `MIN_VALID_IMAGE_BYTES=16` 防退化响应。
- `AnalyzeNode.tsx`：决策=**直发原图 URL**。新增 `resolveSendableRemoteUrl`(把 ref 还原成公网 URL，命中就直接发 URL 不再下载+base64) + `isUsableDataImageUrl`(payload<64 视为退化，拒收)。`resolveFirstCandidateDataUrl`→`resolveFirstCandidateRef`：①公网URL直发 ②可用内联dataURL ③blob/flow-asset/相对路径才直连(disableProxy)下载base64。裁剪/分割仍须本地canvas→base64，但 `resolveImageToBlob` 改 `disableProxy:true` 直连。

后端早已支持直发 URL：`new-api.provider.ts toImageReference()` 对 `http(s):` 原样透传为 `image_url.url`。`/ai/analyze-image` 不校验 dataURL。直发 URL 的唯一风险=上游需能抓取 cn-region TOS 公网 URL(过期签名/区域不可达会失败)。
