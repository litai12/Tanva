#!/bin/bash

# 获取脚本所在目录的绝对路径
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=======================================${NC}"
echo -e "${BLUE}    Tanva 项目开发环境一键启动脚本    ${NC}"
echo -e "${BLUE}=======================================${NC}"

# 检查依赖函数
check_node_modules() {
    local dir=$1
    if [ ! -d "$dir/node_modules" ]; then
        echo -e "${YELLOW}检测到 $dir/node_modules 缺失，正在安装依赖...${NC}"
        cd "$dir" && npm install
        cd "$SCRIPT_DIR"
    fi
}

# 检查并安装依赖
check_node_modules "backend"
check_node_modules "frontend"

# 终止后台任务的清理函数
cleanup() {
    echo -e "\n${BLUE}正在停止服务...${NC}"
    # 杀掉所有由该脚本启动的子进程
    pkill -P $$
    exit
}

# 捕获 Ctrl+C (SIGINT) 和 退出信号 (SIGTERM)
trap cleanup SIGINT SIGTERM

echo -e "${GREEN}🚀 正在启动后端服务 (预计运行在 http://localhost:4000)...${NC}"
cd "$SCRIPT_DIR/backend" && npm run dev &
BACKEND_PID=$!

# 等待几秒让后端启动
sleep 2

echo -e "${GREEN}🚀 正在启动前端服务 (预计运行在 http://localhost:5173)...${NC}"
cd "$SCRIPT_DIR/frontend" && npm run dev

# 等待后台进程（实际上前端 vite 会一直运行在控制台）
wait

