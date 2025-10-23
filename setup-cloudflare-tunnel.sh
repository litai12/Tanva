#!/bin/bash

# 🌐 Cloudflare Tunnel 快速配置脚本
# 用途: 让局域网外的用户通过Cloudflare隧道访问你的本地应用
# 用法: chmod +x setup-cloudflare-tunnel.sh && ./setup-cloudflare-tunnel.sh

set -e

echo "🚀 Cloudflare Tunnel 快速配置"
echo "================================"
echo ""

# 检查cloudflared是否已安装
if ! command -v cloudflared &> /dev/null; then
    echo "❌ cloudflared 未安装"
    echo ""
    echo "请先安装cloudflared:"
    echo "  macOS:   brew install cloudflared"
    echo "  Linux:   curl -L https://github.com/cloudflare/wrangler/releases/latest/download/wrangler-linux-x64 -o wrangler"
    echo "  Windows: 访问 https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/"
    exit 1
fi

echo "✅ cloudflared 已安装: $(cloudflared --version)"
echo ""

# 获取用户输入
read -p "请输入隧道名称 (默认: tanva-app): " TUNNEL_NAME
TUNNEL_NAME=${TUNNEL_NAME:-tanva-app}

read -p "请输入本地前端端口 (默认: 5173): " LOCAL_PORT
LOCAL_PORT=${LOCAL_PORT:-5173}

read -p "请输入你的域名 (默认: tai.tanva.tgtai.com): " DOMAIN
DOMAIN=${DOMAIN:-tai.tanva.tgtai.com}

echo ""
echo "📋 配置信息:"
echo "  隧道名: $TUNNEL_NAME"
echo "  本地URL: http://localhost:$LOCAL_PORT"
echo "  公网域名: https://$DOMAIN"
echo ""

# 第1步: 认证
echo "第1步/4: 认证到Cloudflare..."
echo "⚠️  浏览器会打开Cloudflare登录页面"
sleep 2

if cloudflared tunnel login; then
    echo "✅ 认证成功"
else
    echo "❌ 认证失败，请检查网络连接"
    exit 1
fi

echo ""

# 第2步: 创建隧道
echo "第2步/4: 创建隧道 '$TUNNEL_NAME'..."
if cloudflared tunnel create $TUNNEL_NAME 2>/dev/null || true; then
    echo "✅ 隧道已创建或已存在"
else
    echo "⚠️  隧道可能已存在，继续..."
fi

echo ""

# 第3步: 配置域名路由
echo "第3步/4: 配置DNS路由..."
if cloudflared tunnel route dns $TUNNEL_NAME $DOMAIN 2>/dev/null; then
    echo "✅ DNS路由配置成功"
    echo "   $DOMAIN 现在指向你的本地应用"
else
    echo "⚠️  DNS路由配置可能需要手动设置，或已存在"
fi

echo ""

# 第4步: 启动隧道
echo "第4步/4: 启动隧道..."
echo ""
echo "🌐 隧道正在启动..."
echo "===================="
echo ""
echo "你的应用现在可以在以下地址访问:"
echo ""
echo "  🌍 前端:     https://$DOMAIN"
echo "  🔗 API:      https://$DOMAIN/api/public/ai/*"
echo ""
echo "===================="
echo ""
echo "⏸️  按 Ctrl+C 停止隧道"
echo ""

# 启动隧道
cloudflared tunnel run \
  --url http://localhost:$LOCAL_PORT \
  --name $TUNNEL_NAME \
  $TUNNEL_NAME

# 清理 (Ctrl+C时执行)
trap "echo ''; echo '✅ 隧道已停止'; exit 0" SIGINT SIGTERM

