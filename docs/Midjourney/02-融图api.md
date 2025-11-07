# 图片融合（Blend）

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /mj/submit/blend:
    post:
      summary: 图片融合（Blend）
      deprecated: false
      description: 执行Blend操作，提交融图任务。
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
                botType:
                  type: string
                base64Array:
                  type: array
                  items:
                    type: string
                  description: 垫图base64数组
                accountFilter:
                  type: object
                  properties:
                    channelId:
                      type: string
                      description: 频道ID
                    instanceId:
                      type: string
                      description: 账号实例ID
                    modes:
                      type: array
                      items:
                        type: string
                      description: 账号模式
                    remark:
                      type: string
                      description: 备注
                    remix:
                      type: string
                      description: 账号是否remix
                    remixAutoConsidered:
                      type: boolean
                      description: 账号过滤时，remix自动提交 视为 账号的remix为false
                  x-apifox-orders:
                    - channelId
                    - instanceId
                    - modes
                    - remark
                    - remix
                    - remixAutoConsidered
                notifyHook:
                  type: string
                state:
                  type: string
                dimensions:
                  type: string
                  description: |-
                    比例: PORTRAIT(2:3); SQUARE(1:1); LANDSCAPE(3:2)
                    枚举值:PORTRAIT SQUARE LANDSCAPE
                    示例值:SQUARE
              x-apifox-orders:
                - botType
                - base64Array
                - dimensions
                - accountFilter
                - notifyHook
                - state
              required:
                - dimensions
                - base64Array
            example:
              mode: RELAX
              base64Array:
                - data:image/png;base64,xxx1
                - data:image/png;base64,xxx2
              dimensions: SQUARE
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: integer
                  description:
                    type: string
                  properties:
                    type: object
                    properties: {}
                    x-apifox-orders: []
                  result:
                    type: integer
                required:
                  - code
                  - description
                  - properties
                  - result
                x-apifox-orders:
                  - code
                  - description
                  - properties
                  - result
              example:
                code: 1
                description: 提交成功
                properties: {}
                result: 1320098173412546
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 模型接口/Midjourney
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/6819841/apis/api-362709075-run
components:
  schemas: {}
  securitySchemes: {}
servers:
  - url: https://147ai.com
    description: api
security: []

```