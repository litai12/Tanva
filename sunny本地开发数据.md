# Sunny 本地开发数据

## 数据库（PostgreSQL）
- Host: localhost
- Port: 5432
- Database: tanva_dev
- User: tanva_dev
- Password: jz0102
- DATABASE_URL: postgresql://tanva_dev:jz0102@localhost:5432/tanva_dev?schema=public


## WSL 前后端联通（Windows 访问）
- 获取 WSL IP：`hostname -I | awk '{print $1}'`
- Windows 浏览器测试后端：`http://<WSL_IP>:4000/api/health`（能返回 OK 即可）
- 用 WSL IP 启动前端（不改文件）：
  - `cd /home/haley/mycode/Tanvas/frontend`
  - `VITE_API_BASE_URL=http://<WSL_IP>:4000 npm run dev`
  - 示例：`VITE_API_BASE_URL=http://172.18.217.21:4000 npm run dev`
