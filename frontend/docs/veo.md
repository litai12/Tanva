# 图生视频（chat格式）

> Base URL：`https://api1.147ai.com`（端点：`POST /v1/chat/completions`，`Authorization: Bearer <API_KEY>`）

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
      summary: 图生视频（chat格式）
      deprecated: false
      description: |-
        veo3-fast 文字快速生成视频
        veo3-pro 不垫图
        veo3-pro-frames 垫图
      tags:
        - 模型接口/veo
      parameters:
        - name: Accept
          in: header
          description: ''
          required: true
          example: ''
          schema:
            type: string
            default: application/json
        - name: Authorization
          in: header
          description: ''
          required: true
          example: ''
          schema:
            type: string
            default: sk-
        - name: Content-Type
          in: header
          description: ''
          required: true
          example: ''
          schema:
            type: string
            default: application/json
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                model:
                  type: string
                  description: 要使用的模型的 ID。有关哪些模型适用于聊天 API 的详细信息
                messages:
                  type: array
                  items:
                    type: object
                    properties:
                      role:
                        type: string
                      content:
                        type: string
                    x-apifox-orders:
                      - role
                      - content
                    required:
                      - role
                      - content
                temperature:
                  type: string
                  description: >-
                    使用什么采样温度，介于 0 和 2 之间。较高的值（如 0.8）将使输出更加随机，而较低的值（如
                    0.2）将使输出更加集中和确定。 我们通常建议改变这个或top_p但不是两者。
                top_p:
                  type: string
                  description: >-
                    一种替代温度采样的方法，称为核采样，其中模型考虑具有 top_p 概率质量的标记的结果。所以 0.1 意味着只考虑构成前
                    10% 概率质量的标记。 我们通常建议改变这个或temperature但不是两者。
                'n':
                  type: string
                  description: 为每个输入消息生成多少个聊天完成选项。
                stream:
                  type: string
                  description: >-
                    如果设置，将发送部分消息增量，就像在 ChatGPT 中一样。当令牌可用时，令牌将作为纯数据服务器发送事件data:
                    [DONE]发送，流由消息终止。
                stop:
                  type: string
                  description: API 将停止生成更多令牌的最多 4 个序列。
                max_tokens:
                  type: string
                  description: 聊天完成时生成的最大令牌数。 输入标记和生成标记的总长度受模型上下文长度的限制。
                presence_penalty:
                  type: string
                  description: '-2.0 和 2.0 之间的数字。正值会根据到目前为止是否出现在文本中来惩罚新标记，从而增加模型谈论新主题的可能性'
                frequency_penalty:
                  type: string
                  description: '-2.0 和 2.0 之间的数字。正值会根据新标记在文本中的现有频率对其进行惩罚，从而降低模型逐字重复同一行的可能性。'
                logit_bias:
                  type: string
                  description: >-
                    修改指定标记出现在完成中的可能性。 接受一个 json 对象，该对象将标记（由标记器中的标记 ID 指定）映射到从
                    -100 到 100 的关联偏差值。从数学上讲，偏差会在采样之前添加到模型生成的 logits
                    中。确切的效果因模型而异，但 -1 和 1 之间的值应该会减少或增加选择的可能性；像 -100 或 100
                    这样的值应该导致相关令牌的禁止或独占选择。
                user:
                  type: string
                  description: 代表您的最终用户的唯一标识符，可以帮助 OpenAI 监控和检测滥用行为。
              required:
                - model
                - messages
              x-apifox-orders:
                - model
                - messages
                - temperature
                - top_p
                - 'n'
                - stream
                - stop
                - max_tokens
                - presence_penalty
                - frequency_penalty
                - logit_bias
                - user
            example:
              model: veo3-pro-frames
              stream: true
              messages:
                - role: system
                  content: You are a helpful assistant.
                - role: user
                  content:
                    - type: text
                      text: What's in this image?
                    - type: image_url
                      image_url:
                        url: >-
                          https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/2560px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: string
                  object:
                    type: string
                  created:
                    type: string
                  choices:
                    type: array
                    items:
                      type: object
                      properties:
                        index:
                          type: string
                        message:
                          type: object
                          properties:
                            role:
                              type: string
                            content:
                              type: string
                          required:
                            - role
                            - content
                          x-apifox-orders:
                            - role
                            - content
                        finish_reason:
                          type: string
                      x-apifox-orders:
                        - index
                        - message
                        - finish_reason
                      required:
                        - index
                        - message
                        - finish_reason
                  usage:
                    type: object
                    properties:
                      prompt_tokens:
                        type: string
                      completion_tokens:
                        type: string
                      total_tokens:
                        type: string
                    required:
                      - prompt_tokens
                      - completion_tokens
                      - total_tokens
                    x-apifox-orders:
                      - prompt_tokens
                      - completion_tokens
                      - total_tokens
                required:
                  - id
                  - object
                  - created
                  - choices
                  - usage
                x-apifox-orders:
                  - id
                  - object
                  - created
                  - choices
                  - usage
              example:
                id: chatcmpl-89DheNHkXJZegjted4eBXeqGUGEpM
                object: chat.completion
                created: 1755853547
                model: veo3-pro
                choices:
                  - index: 0
                    message:
                      role: assistant
                      content: >-


                        > 视频生成任务已创建

                        > 任务ID: `veo3-pro:03bd6356-8ec6-4e06-be7f-c06febc5eb47`

                        > 为了防止任务中断，可以从以下链接持续获取任务进度:

                        >
                        [数据预览](https://asyncdata.net/web/veo3-pro:03bd6356-8ec6-4e06-be7f-c06febc5eb47)
                        |
                        [原始数据](https://asyncdata.net/source/veo3-pro:03bd6356-8ec6-4e06-be7f-c06febc5eb47)

                        > 等待处理中.


                        > 类型: 文字生成

                        > 🎬 开始生成视频...........................


                        > 🎉 高质量视频已生成


                        [▶️
                        在线观看](https://filesystem.site/cdn/20250822/2hO6Q2oDZtT5I2sZd1lmyGUjmXntfT.mp4)
                        | [⏬
                        下载视频](https://filesystem.site/cdn/download/20250822/2hO6Q2oDZtT5I2sZd1lmyGUjmXntfT.mp4)
                    finish_reason: stop
                usage:
                  prompt_tokens: 21
                  completion_tokens: 289
                  total_tokens: 310
                  prompt_tokens_details:
                    text_tokens: 14
                  completion_tokens_details:
                    content_tokens: 289
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 模型接口/veo
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/6819841/apis/api-360564081-run
components:
  schemas: {}
  securitySchemes: {}
servers:
  - url: https://147ai.com
    description: api
security: []

```
