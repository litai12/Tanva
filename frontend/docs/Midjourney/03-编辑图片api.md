# 编辑图片（Edit）

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /mj/submit/edits:
    post:
      summary: 编辑图片（Edit）
      deprecated: false
      description: 执行edit接口，可以编辑外部传入的图片，可以进行局部重绘，也可以直接改图
      tags:
        - 模型接口/Midjourney
      parameters:
        - name: Accept
          in: header
          description: ''
          required: false
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: sk-
          schema:
            type: string
        - name: Content-Type
          in: header
          description: ''
          required: false
          example: application/json
          schema:
            type: string
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                prompt:
                  type: string
                  description: 提示词
                action:
                  type: string
                  description: 固定 "EDITS"
                base64Array:
                  type: array
                  items:
                    type: string
                  description: 目标图片base64
                maskBase64:
                  type: string
                  description: 蒙版图（Base64，黑白/透明区域作为编辑区域）
                notifyHook:
                  type: string
                  description: 回调地址, 为空时使用全局notifyHook
                state:
                  type: string
                remix:
                  type: boolean
              x-apifox-orders:
                - action
                - prompt
                - base64Array
                - maskBase64
                - notifyHook
                - state
                - remix
              required:
                - action
                - prompt
                - base64Array
            example:
              action: EDITS
              prompt: 将图片转为吉卜力风格
              base64Array:
                - >-
                  data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTE。。。。。
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
                x-apifox-orders: []
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 模型接口/Midjourney
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/6819841/apis/api-362723026-run
components:
  schemas: {}
  securitySchemes: {}
servers:
  - url: https://147ai.com
    description: api
security: []

```