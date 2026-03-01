#!/bin/bash

# Gemini API 测试脚本 - 使用JSON配置文件
# 使用方法: ./test-gemini-from-json.sh

echo "🎨 使用JSON配置文件测试 Gemini API..."

# 检查jq是否安装
if ! command -v jq &> /dev/null; then
    echo "❌ 错误: 需要安装jq工具来解析JSON"
    echo "请运行: brew install jq"
    exit 1
fi

# 检查JSON文件是否存在
if [ ! -f "gemini-api-request.json" ]; then
    echo "❌ 错误: gemini-api-request.json 文件不存在"
    exit 1
fi

echo "📄 读取JSON配置..."

# 从JSON文件提取配置
URL=$(jq -r '.url' gemini-api-request.json)
OE_KEY=$(jq -r '.headers."OE-Key"' gemini-api-request.json)
OE_GATEWAY_NAME=$(jq -r '.headers."OE-Gateway-Name"' gemini-api-request.json)
OE_AI_PROVIDER=$(jq -r '.headers."OE-AI-Provider"' gemini-api-request.json)
CONTENT_TYPE=$(jq -r '.headers."Content-Type"' gemini-api-request.json)
BODY=$(jq -c '.body' gemini-api-request.json)

echo "🔗 API URL: $URL"
echo "🔑 OE-Key: ${OE_KEY:0:10}..."
echo "🌐 Gateway: $OE_GATEWAY_NAME"
echo "🤖 Provider: $OE_AI_PROVIDER"
echo "📝 请求体: $BODY"
echo ""

echo "🚀 发送请求..."

# 发送请求
curl -X POST "$URL" \
 -H "OE-Key: $OE_KEY" \
 -H "OE-Gateway-Name: $OE_GATEWAY_NAME" \
 -H "OE-AI-Provider: $OE_AI_PROVIDER" \
 -H "Content-Type: $CONTENT_TYPE" \
 -d "$BODY" \
 --write-out "\nHTTP Status: %{http_code}\n" \
 --silent --show-error

echo ""
echo "✅ API 调用完成"



