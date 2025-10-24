#!/bin/bash

echo "🔍 测试Kuai API配置..."

# 测试Kuai API端点
echo "📡 测试Kuai API连接..."
curl -X POST "https://apis.kuai.host/v1beta/models/gemini-2.5-flash-image-preview:generateContent" \
  -H "Authorization: Bearer sk-YO5bqpHjJ7zcm2iuukjsybBEKn9roLMrH4wLFYu15TBhY5lt" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [
      {
        "role": "user",
        "parts": [
          {
            "text": "画一只可爱的小猫"
          }
        ]
      }
    ],
    "generationConfig": {
      "responseModalities": ["IMAGE"]
    }
  }' \
  --max-time 30 \
  --connect-timeout 10

echo ""
echo "✅ 测试完成"

