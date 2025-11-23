**SU截图转效果图——API使用文档**

![img](file:///C:\Users\Administrator\AppData\Local\Temp\ksohtml15884\wps5.png)![img](file:///C:\Users\Administrator\AppData\Local\Temp\ksohtml15884\wps6.png)

![img](file:///C:\Users\Administrator\AppData\Local\Temp\ksohtml15884\wps7.jpg)![img](file:///C:\Users\Administrator\AppData\Local\Temp\ksohtml15884\wps8.png)

**效果预览**



1. **发起AI应用任务**

**请求地址**

POST https://www.runninghub.ai/task/openapi/ai-app/run

**请求方式**

POST，请求体格式为 application/json

**请求头部**

| Header       | 是否必填 | 示例值            | 说明                   |
| ------------ | -------- | ----------------- | ---------------------- |
| Host         | 是       | www.runninghub.cn | API 域名，必须精确填写 |
| Content-Type | 是       | application/json  | 请求体类型             |

**请求参数**

| 参数名       | 类型   | 是否必填 | Description                                          |
| ------------ | ------ | -------- | ---------------------------------------------------- |
| apiKey       | string | 是       | 用户的 API 密钥，用于身份认证                        |
| webappId     | string | 是       | 工作流模板 ID，可通过平台导出获得                    |
| nodeInfoList | array  | 否       | 节点参数修改列表，用于在执行前替换默认参数           |
| WebhookUrl   | string | 否       | 任务完成后回调的 URL，平台会主动向该地址发送任务结果 |

 

**nodeinfoList结构说明**

每项表示一个节点参数的修改：

| 字段       | 类型   | 说明                                   |
| ---------- | ------ | -------------------------------------- |
| nodeId     | string | 节点的唯一编号，来源于工作流 JSON 文件 |
| fieldName  | string | 要修改的字段名，例如 text、seed、steps |
| fieldValue | any    | 替换后的新值，需与原字段类型一致       |

示例请求体（请在fieldValue中填写您想要上传的图片地址）

```
JSON
{

  "webappId": "1983061233110790146",

  "apiKey": "71ee8ebbd0dc4daab7bbd3af4a945edd",

  "nodeInfoList": [

    {

      "nodeId": "112",

      "fieldName": "image",

      "fieldValue": "aada02b02fa42dee7f9366e0d1771d63fa85501de3c3190f1cb76a8617121584.jpg",

      "description": "SU截图"

    },

    {

      "nodeId": "158",

      "fieldName": "image",

      "fieldValue": "48bd97d8f8e97ab953a356afd474c4a095a4d38466da9a5962e5bd34f0b1adc0.jpg",

      "description": "参考图（只参考色温、色调）"

    }

  ]

}
```

**返回结果**

```
{
    "code": 0,
    "msg": "success",
    "errorMessages": null,
    "data": {
        "netWssUrl": null,
        "taskId": "1983070826507472898",
        "clientId": "4c8a885af070060139abecdbffc97978",
        "taskStatus": "QUEUED",
        "promptTips": "{\"result\": true, \"error\": null, \"outputs_to_execute\": [\"160\"], \"node_errors\": {}}"
    }
}
```

返回字段说明

| 字段名 | 类型   | 说明                 |
| ------ | ------ | -------------------- |
| code   | int    | 状态码，0 表示成功   |
| msg    | string | 提示信息             |
| data   | object | 返回数据对象，见下表 |

data 子字段说明

| 字段名     | 类型   | 说明                                                         |
| ---------- | ------ | ------------------------------------------------------------ |
| taskId     | string | 创建的任务 ID，可用于查询状态或获取结果                      |
| taskStatus | string | 初始状态，可能为：QUEUED、RUNNING、FAILED                    |
| clientId   | string | 平台内部标识，用于排错，无需关注                             |
| netWssUrl  | string | WebSocket 地址（当前不稳定，不推荐使用）                     |
| promptTips | string | ComfyUI 校验信息（字符串格式的 JSON），可用于识别配置异常节点 |

***\*webhookUrl 使用说明\****

若希望任务执行完成后平台自动通知结果，可设置 webhookUrl 参数。例如：

```
{
  "webappId": "1877265245566922753",
  "apiKey": "{{apiKey}}",
  "webhookUrl": "https://your-webhook-url",
  "nodeInfoList": [
    {
      "nodeId": "122",
      "fieldName": "prompt",
      "fieldValue": "1 golden hair girl in bathroom"
    }
  ]
}
```

任务完成后，RunningHub 会向该地址发送如下 POST 请求：

```
{
  "event": "TASK_END",
  "taskId": "1904163390028185602",
  "eventData": "{\"code\":0,\"msg\":\"success\",\"data\":[{\"fileUrl\":\"https://rh-images.xiaoyaoyou.com/de0db6f2564c8697b07df55a77f07be9/output/ComfyUI_00033_hpgko_1742822929.png\",\"fileType\":\"png\",\"taskCostTime\":0,\"nodeId\":\"9\"}]}"
}
```

event：固定为 TASK_END

taskId：对应任务 ID

eventData：与“查询任务生成结果”接口返回结构一致

2. **查询任务生成结果**

**请求地址**

POST https://www.runninghub.ai/task/openapi/outputs

**请求方式**

POST，请求体格式为 application/json

**请求头部**

| Header | 是否必填 | 示例值            | 说明                   |
| ------ | -------- | ----------------- | ---------------------- |
| Host   | 是       | www.runninghub.cn | API 域名，必须精确填写 |

**请求参数**

| 参数名 | 类型   | 是否必填 | 说明                                    |
| ------ | ------ | -------- | --------------------------------------- |
| apiKey | string | 是       | 用户的 API 密钥，用于身份认证           |
| taskId | string | 是       | 创建的任务 ID，可用于查询状态或获取结果 |

请求示例

```
{
 "apiKey": "{{apiKey}}",
 "taskId": "1904152026220003329"
}
```

**返回结果**

成功示例

```
{
  "code": 0,
  "msg": "success",
  "data": [
    {
      "fileUrl": "https://rh-images.xiaoyaoyou.com/de0db6f2564c8697b07df55a77f07be9/output/ComfyUI_00033_hpgko_1742822929.png",
      "fileType": "png",
      "taskCostTime": "0",
      "nodeId": "9"
    }
  ]
}
```

点击fileUrl中的链接，即可获取发起APP任务生成的结果。