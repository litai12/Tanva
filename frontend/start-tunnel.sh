#!/bin/bash

# Cloudflare Tunnel 快速启动脚本
# 用途: 快速启动内网穿透，显示公网URL

echo "🚀 正在启动 Cloudflare Tunnel..."
echo "================================"
echo ""
echo "📡 正在连接到 Cloudflare..."
echo "⏳ 请稍候，正在生成公网URL..."
echo ""

# 启动 tunnel 并捕获输出
cloudflared tunnel --url http://localhost:5173 2>&1 | while IFS= read -r line; do
    echo "$line"
    
    # 检测到URL后显示并继续运行
    if echo "$line" | grep -q "https://.*trycloudflare.com"; then
        URL=$(echo "$line" | grep -oE "https://[a-zA-Z0-9-]+\.trycloudflare\.com")
        if [ ! -z "$URL" ]; then
            echo ""
            echo "✅ ========================================"
            echo "✅ 内网穿透已启动成功！"
            echo "✅ ========================================"
            echo ""
            echo "🌍 公网访问地址:"
            echo "   $URL"
            echo ""
            echo "📝 说明:"
            echo "   - 这个URL可以在任何网络环境下访问"
            echo "   - 按 Ctrl+C 停止隧道"
            echo "   - 免费版URL每次启动可能会变化"
            echo ""
            echo "✅ ========================================"
            echo ""
        fi
    fi
done

