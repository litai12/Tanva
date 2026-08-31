# 任务清单：Seedance 参考媒体时长交由上游裁决

- [x] 确认截图错误来自 Tanva `validateSeedance20ReferenceMedia`，发生在上游提交之前。
- [x] 移除 Seedance 参考视频单条及总时长范围校验。
- [x] 移除 Seedance 参考音频单条及总时长范围校验。
- [x] 撤销未采用的 ffmpeg 尾差修正、OSS 派生上传及相关测试。
- [x] 保留参考素材数量、任务类型、输出时长与计费时长探测。
- [x] 增加参考视频/音频不探测时长、素材数量仍拦截的回归测试。
- [x] 运行后端构建与差异检查（Seedance 全量计费脚本另受并行改动的促销标签期望值不一致影响）。
- [x] 同步 helloagents SSOT、Wiki 与变更记录。
