# 任务清单

- [x] 读取生产进程、PM2、内存映射、队列和 Redis 状态。
- [x] 对比生产与测试 Node 进程的匿名内存形态。
- [x] 新增图片 Worker 运行时配置解析与空闲回收判定。
- [x] 维持 Worker 并发上限 1000，并增加空闲 RSS 自回收。
- [x] 为图片输出读取/上传增加硬上限并去除重复 Buffer 复制。
- [x] 收紧 Sharp 运行时与按需加载 PDF/Skia。
- [x] 修正 ecosystem 与系统监控真实阈值。
- [x] 添加针对性测试并完成前后端构建。
- [ ] 由用户统一提交、受控部署并验证新 RSS 基线。
- [x] 同步 `helloagents/project.md`、wiki 与 CHANGELOG。
