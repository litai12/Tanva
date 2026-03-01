# 图生文（Describe）

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /mj/submit/describe:
    post:
      summary: 图生文（Describe）
      deprecated: false
      description: 执行Describe操作，提交图生文任务。
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
                base64:
                  type: string
                  description: 图片base64
              x-apifox-orders:
                - botType
                - base64
                - dimensions
                - accountFilter
                - notifyHook
                - state
              required:
                - base64
                - dimensions
            example:
              mode: RELAX
              base64: data:image/png;base64,xxx
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
      x-run-in-apifox: https://app.apifox.com/web/project/6819841/apis/api-362720196-run
components:
  schemas: {}
  securitySchemes: {}
servers:
  - url: https://147ai.com
    description: api
security: []

```