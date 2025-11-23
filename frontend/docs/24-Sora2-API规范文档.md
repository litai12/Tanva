# 生成视频（chat格式）

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /v1/chat/completions:
    post:
      summary: 生成视频（chat格式）
      deprecated: false
      description: |-
        逆向分组，模型名称“sora-2”
        可以通过提示词控制生成视频的比例，例如在提示词最后加上 横屏、竖屏、窄屏、16:9 、9:16 等
      tags:
        - 模型接口/sora2/逆向
      parameters:
        - name: Content-Type
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
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                model:
                  type: string
                stream:
                  type: boolean
                messages:
                  type: array
                  items:
                    type: object
                    properties:
                      role:
                        type: string
                      content:
                        type: array
                        items:
                          type: object
                          properties:
                            text:
                              type: string
                            type:
                              type: string
                            image_url:
                              type: object
                              properties:
                                url:
                                  type: string
                              required:
                                - url
                              x-apifox-orders:
                                - url
                          required:
                            - type
                          x-apifox-orders:
                            - text
                            - type
                            - image_url
                    x-apifox-orders:
                      - role
                      - content
              required:
                - model
                - messages
              x-apifox-orders:
                - model
                - stream
                - messages
            example:
              model: sora-2
              stream: true
              messages:
                - role: user
                  content:
                    - text: 一只狗在图片出场景中跑步
                      type: text
                    - image_url:
                        url: >-
                          https://filesystem.site/cdn/20250603/k0kVgLClcJyhH3vsLptmQV.png
                      type: image_url
      responses:
        '200':
          description: ''