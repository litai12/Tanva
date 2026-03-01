# 获取种子（Seed）接口

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /mj/task/{id}/image-seed:
    get:
      summary: 获取种子（Seed）接口
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
              example:
                code: 0
                description: string
                result: string
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 模型接口/Midjourney
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/6819841/apis/api-362735263-run
components:
  schemas: {}
  securitySchemes: {}
servers:
  - url: https://147ai.com
    description: api
security: []

```