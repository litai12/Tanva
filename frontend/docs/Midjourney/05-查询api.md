# 查询

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /mj/task/{id}/fetch:
    get:
      summary: 查询
      deprecated: false
      description: ''
      tags:
        - 模型接口/Midjourney
      parameters:
        - name: id
          in: path
          description: 任务ID
          required: true
          schema:
            type: string
        - name: Accept
          in: header
          description: ''
          required: true
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: true
          example: sk-
          schema:
            type: string
        - name: Content-Type
          in: header
          description: ''
          required: true
          example: application/json
          schema:
            type: string
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 模型接口/Midjourney
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/6819841/apis/api-362733962-run
components:
  schemas: {}
  securitySchemes: {}
servers:
  - url: https://147ai.com
    description: api
security: []

```

## 慢速模式-查询json结果
{
  "id": "1762500770151958",
  "action": "IMAGINE",
  "customId": "",
  "botType": "",
  "prompt": "画一只可爱的橘猫，戴着太空头盔，在月球漫步",
  "promptEn": "Draw a cute orange cat wearing a space helmet, walking on the moon.",
  "description": "提交成功",
  "state": "",
  "submitTime": 1762500770151,
  "startTime": 1762500773005,
  "finishTime": 0,
  "imageUrl": "",
  "videoUrl": "",
  "videoUrls": null,
  "status": "IN_PROGRESS",
  "progress": "40%",
  "failReason": "",
  "buttons": [],
  "maskBase64": "",
  "properties": {
    "finalPrompt": "Draw a cute orange cat wearing a space helmet, walking on the moon. --ar 1:1 --v 7 --stylize 100 --relax",
    "finalZhPrompt": ""
  }
}

## 完整的查询命令
curl -X GET "https://api1.147ai.com/mj/task/{任务ID}/fetch" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Authorization: sk-Olq9NljtTS8cRMfZhg5RnJLRgcqsMh2CSP1tlWqWxhYL59Dd"

## 完整的提交任务命令 - 慢速模式
curl -X POST "https://api1.147ai.com/mj/submit/imagine" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Authorization: sk-Olq9NljtTS8cRMfZhg5RnJLRgcqsMh2CSP1tlWqWxhYL59Dd" \
  -d '{
    "prompt": "画一只可爱的橘猫，戴着太空头盔，在月球漫步",
    "mode": "RELAX"
  }'

## 完整的提交任务命令 - 快速模式
curl -X POST "https://api1.147ai.com/mj/submit/imagine" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Authorization: sk-P4VQNwSKcqiVvlwKzut6MZHCGqfbMtBuw4ngcRnb5NeUZR75" \
  -d '{
    "prompt": "画一只可爱的橘猫，戴着太空头盔，在月球漫步",
    "mode": "FAST"
  }'

## 快速模式响应
{
  "code": 1,
  "description": "Submit success",
  "result": "1762501146700502",
  "properties": {
    "discordInstanceId": "4c2dc1123d504d0a8d876d72d971a847"
  }
}