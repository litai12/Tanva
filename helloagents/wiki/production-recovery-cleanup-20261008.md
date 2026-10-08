# 2026-10-08 生产后端恢复与磁盘清理

## 范围和授权

用户授权对 `101.96.227.228` 安全清理并删除 TapCanvas 数据库备份，随后要求恢复 Tanva 后端。此前 SSH 握手超时未执行清理；本次连接恢复后执行，未部署新代码。

## 后端恢复

- 原 PM2 列表只有 `pm2-logrotate`，`pm2 restart 1` 报进程不存在。
- 在 `/www/wwwroot/tanvas.cn/backend` 使用既有 `ecosystem.config.js` 启动 `tanvas-api`，保留生产内存、jemalloc 和队列配置，再执行 `pm2 save`。
- 非交互 SSH 的 PATH 不含 PM2；实际 CLI 为 `/root/.nvm/versions/node/v24.16.0/lib/node_modules/pm2/bin/pm2`，可由 `/usr/bin/node` 调用。
- 发现已启用的 `pm2-undefined.service` 因 `User=undefined` 以 `217/USER` 失败。新增 `/etc/systemd/system/pm2-undefined.service.d/10-root-user.conf`，仅覆盖 `User=root`，保留既有 `/root/.pm2` 和启动路径；daemon-reload 后启动成功。服务为 active/enabled，现有后端 PID 未变化。
- `http://127.0.0.1:4000/api/health` 和 `https://tanvas.cn/api/health` 均返回 HTTP 200 / status ok。最终 PM2 ID 1、online、重启计数 0。

## 清理及验证

- 双重核对 `hono-api_hono_api_db_backups` 卷及 `hono-api-api-1:/app/backups` 挂载。
- 删除该卷根目录 30 个历史 `predeploy-*.dump`，共 16,659,053,075 字节（约 15.52 GiB）。删除前检查 PGDMP 文件头、超过一天、无打开的文件描述符及文件身份未变化。保留卷本身及三个会员配置 JSON 快照。
- 无构建进程时执行 `docker builder prune -a -f --filter until=24h --keep-storage 4GB`，回执 4.407 GB；再执行 `docker image prune -f --filter until=168h`，回执 30.5 MB。保留带标签镜像、容器、数据库卷和 Agent 数据。
- 清理前后按 `df -B1 /` 实测释放约 19.60 GiB，占用从 81% 降至 70%，可用约 57.16 GiB（`df -h` 显示 58G）。
- 16 个容器身份、运行状态及重启计数一致，其中 15 个运行；已定义的容器健康检查全部 healthy，PostgreSQL `pg_isready` 接受连接。
- 服务器操作清单和核验结果保存于 `/root/tanva-cleanup-20261008-manifest.json`，权限 0600；仅记录文件元数据，不保存已删除备份内容。
- 未修改后续自动备份计划或应用日志保留策略。
