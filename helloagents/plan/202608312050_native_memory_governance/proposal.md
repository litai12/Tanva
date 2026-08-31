# 生产 Node 原生内存治理

## 背景

- `101.96.227.228` 的生产 `tanvas-api` 在图片队列空闲时仍保持约 4.6 GiB RSS，历史峰值约 7.5 GiB。
- V8 堆仅约 150 MiB；`/proc/<pid>/smaps` 显示约 4.6 GiB 私有匿名内存，主要集中为 64/128 MiB 大块映射。
- 生产进程加载 Sharp/libvips、Skia Canvas 与 Prisma 原生模块；测试进程同入口长期运行仅约 380 MiB，说明增长由生产负载触发。
- 页面显示的 4 GiB PM2 阈值来自后端默认常量，实际 PM2 进程没有 `max_memory_restart`，现有 ecosystem 配置也因进程名不一致而未生效。

## 目标

1. 把原生图像处理造成的 RSS 峰值和 allocator 滞留控制在可预测范围。
2. 避免 Base64/Buffer/上传链路制造无上限或重复的二进制副本。
3. 只在队列空闲时回收异常膨胀的进程，避免打断正在计费的任务。
4. 让监控展示真实配置，而不是把预警默认值冒充 PM2 保护。
5. 在不覆盖当前工作树其他改动的前提下完成构建、验证和受控生产切换。

## 方案

- Linux 生产进程优先预加载 jemalloc，并启用短 decay/background purge；没有 jemalloc 时回退到受限 glibc arena。
- 按业务要求维持图片 Worker 总并发上限 1000，并对非法环境变量做边界归一；内存治理不依赖降低吞吐上限。
- 增加空闲 RSS 回收：只有本进程无 active job、运行超过最小时间且 RSS 超阈值时，才先关闭 BullMQ consumer，再经 Nest/Fastify shutdown hook 排空普通 HTTP 请求后由 PM2 拉起；PM2 的更高阈值仅作为紧急保险丝。
- 图像任务输出增加 64 MiB 默认上限；远程响应使用有界读取；上传已有 Buffer 时直接 `putBuffer`，避免 `Readable -> Buffer.concat` 的额外整份复制。
- Sharp 全局缓存默认关闭、并发默认 1、输入像素数设置硬上限；PDF/Skia 改成调用时动态加载。
- PM2 进程名统一为 `tanvas-api`，显式传入监控阈值、并发和 allocator 环境。
- 监控快照增加“阈值是否真实配置”，未配置时不得显示自动重启承诺。

## 非目标

- 本轮不直接把图片 Worker 拆成独立 Nest 应用。当前任务的 worker 预扣信息没有完整持久化，强杀/重投递仍存在孤儿账务缺口；贸然拆分并按内存硬重启会扩大业务风险。
- PM2 重启不是根因修复，只是 jemalloc、输入/输出边界和副本治理之外的最后保险。

## 验收

- 后端 TypeScript 构建、前端构建和新增纯函数测试通过。
- 生产切换后 `/api/health` 正常、PM2 只存在一个 `tanvas-api`、实际 `max_memory_restart` 与监控一致。
- 重启后的空闲 RSS 明显低于历史 4.6 GiB；在队列空闲观察窗口内无持续增长。
- BullMQ active/waiting 无异常，最近任务状态与积分链路无新增错误。
