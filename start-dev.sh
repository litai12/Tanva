#!/bin/bash

# ============================================
# Tanva 一键启动脚本
# 同时启动前端和后端开发服务器
# ============================================

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 项目根目录
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
BACKEND_DIR="$PROJECT_ROOT/backend"

# 打印带颜色的消息
print_header() {
    echo ""
    echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}     ${PURPLE}🚀 Tanva 开发环境启动器${NC}           ${CYAN}║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════╝${NC}"
    echo ""
}

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

# 检查依赖是否安装
check_dependencies() {
    print_status "检查依赖..."

    # 检查前端依赖
    if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
        print_warning "前端依赖未安装，正在安装..."
        cd "$FRONTEND_DIR" && npm install
        if [ $? -ne 0 ]; then
            print_error "前端依赖安装失败"
            exit 1
        fi
    fi

    # 检查后端依赖
    if [ ! -d "$BACKEND_DIR/node_modules" ]; then
        print_warning "后端依赖未安装，正在安装..."
        cd "$BACKEND_DIR" && npm install
        if [ $? -ne 0 ]; then
            print_error "后端依赖安装失败"
            exit 1
        fi
    fi

    print_success "依赖检查完成"
}

# 停止所有服务
stop_services() {
    print_status "停止现有服务..."

    # 杀掉前后端进程
    pkill -f "vite" 2>/dev/null
    pkill -f "ts-node-dev" 2>/dev/null
    pkill -f "node.*dist/main" 2>/dev/null

    print_success "所有服务已停止"
}

# 启动后端
start_backend() {
    print_status "启动后端服务 (日志直接输出到终端)..."
    cd "$BACKEND_DIR"
    npm run dev &
}

# 启动前端
start_frontend() {
    print_status "启动前端服务 (日志直接输出到终端)..."
    cd "$FRONTEND_DIR"
    npm run dev &
}

# 显示服务状态
show_status() {
    echo ""
    echo -e "${CYAN}════════════════════════════════════════${NC}"
    echo -e "${GREEN}  服务正在终端运行！${NC}"
    echo -e "${CYAN}════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${YELLOW}前端地址:${NC} http://localhost:5173"
    echo -e "  ${YELLOW}后端地址:${NC} http://localhost:3000"
    echo ""
    echo -e "  ${BLUE}提示:${NC} 按 ${RED}Ctrl+C${NC} 停止所有服务"
    echo ""
    echo -e "${CYAN}════════════════════════════════════════${NC}"
}

# 查看服务状态
check_status() {
    echo ""
    print_status "检查服务状态..."

    if pgrep -f "vite" > /dev/null; then
        print_success "前端服务 (Vite) 正在运行"
    else
        print_warning "前端服务已停止"
    fi

    if pgrep -f "ts-node-dev" > /dev/null; then
        print_success "后端服务 (NestJS) 正在运行"
    else
        print_warning "后端服务已停止"
    fi

    echo ""
}

# 查看日志 (传统模式下不再需要，因为日志已直接输出)
show_logs() {
    print_warning "传统模式下日志已直接输出到当前终端。"
}

# 主函数
main() {
    print_header
    
    case "$1" in
        stop)
            stop_services
            ;;
        status)
            check_status
            ;;
        restart)
            stop_services
            sleep 1
            check_dependencies
            start_backend
            start_frontend
            show_status
            wait
            ;;
        *)
            # 默认启动流程
            # 如果已有服务正在运行，先停止
            if pgrep -f "vite" > /dev/null || pgrep -f "ts-node-dev" > /dev/null; then
                print_warning "检测到已有服务正在运行，正在重启..."
                stop_services
                sleep 1
            fi
            
            check_dependencies
            
            # 设置退出时自动杀掉子进程
            trap "echo -e '\n${RED}停止所有服务...${NC}'; pkill -P $$; exit" INT TERM EXIT
            
            start_backend
            start_frontend
            show_status
            
            # 保持脚本运行，直到 Ctrl+C
            wait
            ;;
    esac
}

# 运行主函数
main "$@"

