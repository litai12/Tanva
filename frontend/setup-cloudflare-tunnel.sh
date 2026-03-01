#!/bin/bash

# 🌐 Cloudflare Tunnel 完整配置脚本
# 用途: 配置 Cloudflare Tunnel 用于本地应用的内网穿透
# 用法: chmod +x setup-cloudflare-tunnel.sh && ./setup-cloudflare-tunnel.sh

set -e

CLOUDFLARED_CONFIG_DIR="$HOME/.cloudflared"
CONFIG_FILE="$CLOUDFLARED_CONFIG_DIR/config.yml"

echo "🚀 Cloudflare Tunnel 完整配置向导"
echo "===================================="
echo ""

# 检查cloudflared是否已安装
if ! command -v cloudflared &> /dev/null; then
    echo "❌ cloudflared 未安装"
    echo ""
    echo "请先安装cloudflared:"
    echo "  macOS:   brew install cloudflared"
    echo "  Linux:   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared"
    echo "  Windows: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/"
    exit 1
fi

echo "✅ cloudflared 已安装: $(cloudflared --version)"
echo ""

# 创建配置目录
mkdir -p "$CLOUDFLARED_CONFIG_DIR"
chmod 700 "$CLOUDFLARED_CONFIG_DIR"

# 获取用户输入
read -p "请输入隧道名称 (默认: tanva-app): " TUNNEL_NAME
TUNNEL_NAME=${TUNNEL_NAME:-tanva-app}

read -p "请输入本地前端端口 (默认: 5173): " LOCAL_PORT
LOCAL_PORT=${LOCAL_PORT:-5173}

read -p "请输入本地后端API端口 (默认: 3001，留空跳过): " API_PORT
API_PORT=${API_PORT:-}

read -p "请输入你的主域名 (默认: tai.tanva.tgtai.com): " DOMAIN
DOMAIN=${DOMAIN:-tai.tanva.tgtai.com}

echo ""
echo "📋 配置信息:"
echo "  隧道名: $TUNNEL_NAME"
echo "  前端URL: http://localhost:$LOCAL_PORT → https://$DOMAIN"
if [ -n "$API_PORT" ]; then
    echo "  后端URL: http://localhost:$API_PORT → https://api.$DOMAIN"
fi
echo ""

# 第1步: 认证
echo "第1步/5: 认证到 Cloudflare..."
echo "⚠️  浏览器会打开 Cloudflare 登录页面（请在 30 秒内完成）"
sleep 2

if ! cloudflared tunnel login 2>&1 | grep -q "success"; then
    echo "⚠️  认证已触发，请在浏览器中完成登录"
    echo "   等待凭证文件..."
    sleep 5
fi

if [ ! -f "$CLOUDFLARED_CONFIG_DIR/$TUNNEL_NAME.json" ] && [ ! -f "$CLOUDFLARED_CONFIG_DIR/cert.pem" ]; then
    echo "⚠️  凭证文件未找到，请确保已在浏览器中完成登录"
fi

echo "✅ 认证完成"
echo ""

# 第2步: 创建隧道
echo "第2步/5: 创建隧道 '$TUNNEL_NAME'..."
if cloudflared tunnel create $TUNNEL_NAME 2>&1; then
    TUNNEL_ID=$(cloudflared tunnel list | grep "^$TUNNEL_NAME " | awk '{print $1}' | head -1)
    if [ -z "$TUNNEL_ID" ]; then
        TUNNEL_ID=$(cloudflared tunnel list 2>&1 | tail -2 | head -1 | awk '{print $1}')
    fi
    echo "✅ 隧道已创建"
    echo "   隧道ID: $TUNNEL_ID"
else
    echo "⚠️  隧道已存在，继续配置..."
    TUNNEL_ID=$(cloudflared tunnel list 2>&1 | grep "^$TUNNEL_NAME " | awk '{print $1}' | head -1)
fi

echo ""

# 第3步: 创建完整的 config.yml
echo "第3步/5: 生成配置文件..."

if [ -f "$CONFIG_FILE" ]; then
    echo "   备份现有配置: $CONFIG_FILE.bak"
    cp "$CONFIG_FILE" "$CONFIG_FILE.bak"
fi

cat > "$CONFIG_FILE" << EOF
# Cloudflare Tunnel 配置
tunnel: $TUNNEL_NAME
credentials-file: $CLOUDFLARED_CONFIG_DIR/${TUNNEL_NAME}.json
metrics: 127.0.0.1:8000

# 日志配置
loglevel: info
logfile: $CLOUDFLARED_CONFIG_DIR/tunnel.log

# Ingress 路由规则
ingress:
  # 前端应用
  - hostname: $DOMAIN
    path: "/"
    service: http://localhost:$LOCAL_PORT

EOF

# 如果有后端端口，添加 API 路由
if [ -n "$API_PORT" ]; then
    cat >> "$CONFIG_FILE" << EOF
  # 后端 API
  - hostname: api.$DOMAIN
    service: http://localhost:$API_PORT

  # 前端 API 路由（同域）
  - hostname: $DOMAIN
    path: "/api/*"
    service: http://localhost:$API_PORT

EOF
fi

cat >> "$CONFIG_FILE" << EOF
  # 默认路由
  - service: http_status:404
EOF

echo "✅ 配置文件已生成: $CONFIG_FILE"
echo ""

# 第4步: 配置 DNS 路由
echo "第4步/5: 配置 DNS 路由..."
if cloudflared tunnel route dns $TUNNEL_NAME $DOMAIN 2>&1 | grep -q "success\|created"; then
    echo "✅ DNS 路由已配置: $DOMAIN"
else
    echo "⚠️  DNS 配置可能需要在 Cloudflare Dashboard 中手动完成"
    echo "   访问: https://dash.cloudflare.com/ → DNS → 添加记录"
fi

if [ -n "$API_PORT" ]; then
    if cloudflared tunnel route dns $TUNNEL_NAME "api.$DOMAIN" 2>&1 | grep -q "success\|created"; then
        echo "✅ DNS 路由已配置: api.$DOMAIN"
    fi
fi

echo ""

# 第5步: 配置 macOS 服务（仅 macOS）
echo "第5步/5: 配置开机自启服务..."

if [[ "$OSTYPE" == "darwin"* ]]; then
    LAUNCHD_DIR="$HOME/Library/LaunchAgents"
    PLIST_FILE="$LAUNCHD_DIR/com.cloudflare.tunnel.$TUNNEL_NAME.plist"

    mkdir -p "$LAUNCHD_DIR"

    cat > "$PLIST_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.cloudflare.tunnel.$TUNNEL_NAME</string>
    <key>Program</key>
    <string>/opt/homebrew/bin/cloudflared</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/cloudflared</string>
        <string>tunnel</string>
        <string>run</string>
        <string>--config</string>
        <string>$CONFIG_FILE</string>
        <string>$TUNNEL_NAME</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$CLOUDFLARED_CONFIG_DIR/launchd.log</string>
    <key>StandardErrorPath</key>
    <string>$CLOUDFLARED_CONFIG_DIR/launchd-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>
EOF

    chmod 644 "$PLIST_FILE"
    echo "✅ LaunchAgent 已生成: $PLIST_FILE"
    echo ""

    # 加载服务
    if launchctl load "$PLIST_FILE" 2>/dev/null; then
        echo "✅ 隧道服务已加载并启动"
    else
        echo "⚠️  服务加载失败，可能已加载。尝试重新启动..."
        launchctl unload "$PLIST_FILE" 2>/dev/null || true
        sleep 1
        launchctl load "$PLIST_FILE"
        echo "✅ 隧道服务已重新加载"
    fi
else
    echo "⚠️  非 macOS 系统，请手动配置 systemd 服务"
    echo "   参考: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/run-tunnel/as-a-service/"
fi

echo ""
echo "=================================="
echo "✅ Cloudflare Tunnel 配置完成！"
echo "=================================="
echo ""
echo "🌐 你的应用地址:"
echo ""
echo "  前端: https://$DOMAIN"
if [ -n "$API_PORT" ]; then
    echo "  API:  https://api.$DOMAIN"
fi
echo ""
echo "📊 查看隧道状态:"
echo "  launchctl list | grep cloudflare"
echo ""
echo "🔍 查看日志:"
echo "  tail -f $CLOUDFLARED_CONFIG_DIR/tunnel.log"
echo ""
echo "🛑 停止隧道:"
echo "  launchctl unload '$PLIST_FILE'"
echo ""
echo "🔄 重启隧道:"
echo "  launchctl unload '$PLIST_FILE' && sleep 1 && launchctl load '$PLIST_FILE'"
echo ""

