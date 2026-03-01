# 文生图（Imagine）

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /mj/submit/imagine:
    post:
      summary: 文生图（Imagine）
      deprecated: false
      description: >-
        prompt预设值参数解释：

        --ar 9:16

        功能：设置图像的宽高比

        说明：9:16是一个竖屏比例，适合手机屏幕和故事模式

        默认值：如不指定，默认为1:1（正方形）

        可选范围：支持多种比例，如16:9, 1:1, 4:3等

        --seed 4

        功能：设置生成图像的随机种子

        说明：固定种子可以在使用相同提示词时生成相似的图像

        默认值：随机

        可选范围：0-4294967295

        功能：控制图像生成的随机性/多样性

        说明：值越高，结果越多样化且不可预测

        默认值：0

        可选范围：0-100

        --style raw

        功能：应用特定的图像风格预设

        说明："raw"风格减少了Midjourney的艺术处理，更忠实于原始提示

        默认值：根据模型版本不同而不同

        常见选项：raw, cute, expressive, scenic等

        --q 1.00

        功能：设置图像质量和生成时间

        说明：标准质量设置，平衡生成时间和图像细节

        默认值：1

        可选值：0.25, 0.5, 1, 2 (较新版本)

        --tile

        功能：生成可无缝平铺的图像

        说明：启用后生成的图像可以在任何方向无缝重复

        默认值：不启用

        --v 5.1

        功能：指定使用的Midjourney模型版本

        说明：5.1是Midjourney的一个特定版本

        默认值：最新版本

        常见版本：4, 5, 5.1, 5.2等

        举例： prompt: 一片热带雨林 --ar 9:16 --seed 4 --c 100 --style raw --q 1.00
        --tile --v 5.1

        9:16比例的竖向图像

        使用种子4确保可重复性

        最大混沌度增加多样性

        原始风格减少艺术处理

        标准质量

        可平铺的图像

        使用5.1版本的模型
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
                prompt:
                  type: string
                  description: 提示词
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
              x-apifox-orders:
                - botType
                - prompt
                - base64Array
                - accountFilter
                - notifyHook
                - state
              required:
                - prompt
            example:
              mode: RELAX
              prompt: Cat
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
      x-run-in-apifox: https://app.apifox.com/web/project/6819841/apis/api-362697866-run
components:
  schemas: {}
  securitySchemes: {}
servers:
  - url: https://147ai.com
    description: api
security: []

```