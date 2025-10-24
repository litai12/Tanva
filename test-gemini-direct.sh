#!/bin/bash

# Google Gemini 2.5 Flash Image 生图测试脚本
# 基于修改后的JSON配置

echo "🎨 测试 Google Gemini 2.5 Flash Image 生图API..."

curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=AIzaSyDUKP60M4YLpyyStCOvntwDtPX0zvl5F64" \
 -H 'Content-Type: application/json' \
 -d '{
        "contents": "Create a picture of a nano banana dish in a fancy restaurant with a Gemini theme",
        "safetySettings": [
          { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
          { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
          { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
          { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" },
          { "category": "HARM_CATEGORY_CIVIC_INTEGRITY", "threshold": "BLOCK_NONE" }
        ],
        "generationConfig": {
          "responseModalities": ["IMAGE"],
          "imageConfig": {
            "aspectRatio": "1:1"
          }
        }
      }' \
 --write-out "\nHTTP Status: %{http_code}\n" \
 --silent --show-error

echo "✅ API 调用完成"

