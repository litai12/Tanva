# 按钮点击（Action）

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /mj/submit/action:
    post:
      summary: 按钮点击（Action）
      deprecated: false
      description: 该接口是用于点击图片下方的按钮，customId通过任务查询接口可以获取到。
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
                customId:
                  type: string
                  description: '动作标识 '
                taskId:
                  type: string
                  description: 任务ID
                chooseSameChannel:
                  type: string
                  description: 是否选择同一频道下的账号，默认只使用任务关联的账号
              x-apifox-orders:
                - chooseSameChannel
                - customId
                - taskId
                - accountFilter
                - notifyHook
                - state
              required:
                - taskId
                - customId
            example:
              customId: MJ::JOB::upsample::1::0bc41848-dc7f-42f9-893c-9c33b00ebdf3
              taskId: '1734937261701345'
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
      x-run-in-apifox: https://app.apifox.com/web/project/6819841/apis/api-362710527-run
components:
  schemas: {}
  securitySchemes: {}
servers:
  - url: https://147ai.com
    description: api
security: []

```