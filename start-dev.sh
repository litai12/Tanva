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

# 启动 Docker 数据库和 Redis
start_docker_db() {
    print_status "启动 Docker 数据库和 Redis..."

    # 检查 Docker 是否运行
    if ! docker info > /dev/null 2>&1; then
        print_error "Docker 未运行，请先启动 Docker Desktop"
        exit 1
    fi

    # 启动数据库和 Redis 容器
    cd "$PROJECT_ROOT"
    docker compose up -d postgres redis

    if [ $? -eq 0 ]; then
        print_success "Docker 服务已启动"

        # 等待 PostgreSQL 就绪
        print_status "等待 PostgreSQL 数据库就绪..."
        local max_attempts=30
        local attempt=0
        while [ $attempt -lt $max_attempts ]; do
            if docker exec tanva-postgres pg_isready -U postgres > /dev/null 2>&1; then
                print_success "PostgreSQL 数据库已就绪"
                break
            fi
            attempt=$((attempt + 1))
            sleep 1
        done

        # 等待 Redis 就绪
        print_status "等待 Redis 就绪..."
        attempt=0
        while [ $attempt -lt $max_attempts ]; do
            if docker exec tanva-redis redis-cli ping > /dev/null 2>&1; then
                print_success "Redis 已就绪"
                return 0
            fi
            attempt=$((attempt + 1))
            sleep 1
        done

        print_warning "Redis 启动超时，但将继续尝试启动服务"
    else
        print_error "Docker 服务启动失败"
        exit 1
    fi
}

# 停止 Docker 服务
stop_docker_db() {
    print_status "停止 Docker 服务..."
    cd "$PROJECT_ROOT"
    docker compose down
    print_success "Docker 服务已停止"
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
    pkill -f "vite.*frontend" 2>/dev/null
    pkill -f "ts-node-dev.*backend" 2>/dev/null

    # 停止 Docker 数据库
    stop_docker_db

    print_success "所有服务已停止"
}

# 启动后端
start_backend() {
    print_status "启动后端服务..."
    cd "$BACKEND_DIR"
    npm run dev > "$PROJECT_ROOT/logs/backend.log" 2>&1 &

    # 等待后端启动
    sleep 2
    if pgrep -f "ts-node-dev.*backend" > /dev/null; then
        print_success "后端服务已启动"
    else
        print_error "后端服务启动失败，请查看 logs/backend.log"
        return 1
    fi
}

# 启动前端
start_frontend() {
    print_status "启动前端服务..."
    cd "$FRONTEND_DIR"
    npm run dev > "$PROJECT_ROOT/logs/frontend.log" 2>&1 &

    # 等待前端启动
    sleep 2
    if pgrep -f "vite.*frontend" > /dev/null; then
        print_success "前端服务已启动"
    else
        print_error "前端服务启动失败，请查看 logs/frontend.log"
        return 1
    fi
}

# 显示服务状态
show_status() {
    echo ""
    echo -e "${CYAN}════════════════════════════════════════${NC}"
    echo -e "${GREEN}  服务启动成功！${NC}"
    echo -e "${CYAN}════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${YELLOW}前端地址:${NC} http://localhost:5173"
    echo -e "  ${YELLOW}后端地址:${NC} http://localhost:3000"
    echo ""
    echo -e "  ${BLUE}日志文件:${NC}"
    echo -e "    - 前端: logs/frontend.log"
    echo -e "    - 后端: logs/backend.log"
    echo ""
    echo -e "  ${PURPLE}常用命令:${NC}"
    echo -e "    - 停止服务: ${CYAN}./start-dev.sh stop${NC}"
    echo -e "    - 查看状态: ${CYAN}./start-dev.sh status${NC}"
    echo -e "    - 查看日志: ${CYAN}tail -f logs/frontend.log${NC}"
    echo -e "                ${CYAN}tail -f logs/backend.log${NC}"
    echo ""
    echo -e "${CYAN}════════════════════════════════════════${NC}"
}

# 查看服务状态
check_status() {
    echo ""
    print_status "检查服务状态..."

    if pgrep -f "vite.*frontend" > /dev/null; then
        print_success "前端服务正在运行"
    else
        print_warning "前端服务已停止"
    fi

    if pgrep -f "ts-node-dev.*backend" > /dev/null; then
        print_success "后端服务正在运行"
    else
        print_warning "后端服务已停止"
    fi

    if docker ps | grep -q "tanva-postgres"; then
        print_success "PostgreSQL 数据库正在运行"
    else
        print_warning "PostgreSQL 数据库已停止"
    fi

    if docker ps | grep -q "tanva-redis"; then
        print_success "Redis 正在运行"
    else
        print_warning "Redis 已停止"
    fi

    echo ""
}

# 查看日志
show_logs() {
    if [ "$1" == "frontend" ]; then
        tail -f "$PROJECT_ROOT/logs/frontend.log"
    elif [ "$1" == "backend" ]; then
        tail -f "$PROJECT_ROOT/logs/backend.log"
    else
        print_status "同时显示前后端日志 (按 Ctrl+C 退出)"
        tail -f "$PROJECT_ROOT/logs/frontend.log" "$PROJECT_ROOT/logs/backend.log"
    fi
}

# 主函数
main() {
    print_header
    
    # 创建日志目录
    mkdir -p "$PROJECT_ROOT/logs"
    
    case "$1" in
        stop)
            stop_services
            ;;
        status)
            check_status
            ;;
        logs)
            show_logs "$2"
            ;;
        restart)
            stop_services
            sleep 1
            start_docker_db
            check_dependencies
            start_backend
            start_frontend
            show_status
            ;;
        *)
            stop_services
            sleep 1
            start_docker_db
            check_dependencies
            start_backend
            start_frontend
            show_status
            ;;
    esac
}

# 运行主函数
main "$@"

