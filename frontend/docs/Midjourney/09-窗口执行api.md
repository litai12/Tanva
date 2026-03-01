# 窗口执行（Modal）

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /mj/submit/modal:
    post:
      summary: 窗口执行（Modal）
      deprecated: false
      description: 当执行其他任务，code返回21时，需要执行modal接口，传入新的提示词用来修改细节。
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
                maskBase64:
                  type: string
                  description: |
                    局部重绘的蒙版base64
                prompt:
                  type: string
                taskId:
                  type: string
              required:
                - taskId
              x-apifox-orders:
                - maskBase64
                - prompt
                - taskId
            example:
              maskBase64: data:image/png;base64,xxx1
              prompt: Cat
              taskId: '1712204995849324'
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
      x-run-in-apifox: https://app.apifox.com/web/project/6819841/apis/api-362712958-run
components:
  schemas: {}
  securitySchemes: {}
servers:
  - url: https://147ai.com
    description: api
security: []

```