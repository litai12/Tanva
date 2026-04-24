【对外】VOD AIGC生文能力接入指南

能力介绍
本文档介绍腾讯云生文能力正式版本，使用前请详细阅读以下关键点：
1.接口目前支持以下2种协议：OpenAI-chat协议、OpenAI-Response 协议、Anthropic协议。
2.调用生文能力整体需要3步：
a.开通服务
b.通过腾讯云API获取生文API token
c.使用token 调取llm模型能力
3.整体计费方式与原厂模型保持一致，折扣情况找商务侧咨询，每日结算出账。
4.平台入口：
a.国内站：https://console.cloud.tencent.com/vod 
b.国际站：https://www.tencentcloud.com/zh/products/vod 
5.产品计费文档
国内站：https://cloud.tencent.com/document/product/266/95125#f4d1de32-4d7a-40f0-bdd0-4c9b1f2bdd93 
国际站：
6.接口用量查询文档：
国内站：https://cloud.tencent.com/document/product/266/126446 
国际站：https://www.tencentcloud.com/zh/document/product/266/78365 
可视化页面：云点播-用量统计-AIGC

●TOG-gpt
●TGG-gemini

资源维度成本分析 登录 - 腾讯云
资源维度账单：登录 - 腾讯云
明细账单：登录 - 腾讯云

模型清单
目前支持以下模型，更新补齐中...
价格指南：https://doc.weixin.qq.com/sheet/e3_AG0ALgbHACcCNNZhi1wsiRsS03lPl?scode=AJEAIQdfAAofcS4rcMAG0ALgbHACc&tab=BB08J2 
模型厂商	模型可选值	资源说明	官网链接	tokens限制	支持输入的数据类型	输出
OpenAI	gpt-5.4-pro	超过200w TPM需提前3天申请	https://developers.openai.com/api/docs/models/gpt-5.4-pro 	上下文：1050 k
最大输出：128k	文本、图片	文本
	gpt-5.4		https://developers.openai.com/api/docs/models/gpt-5.4 			
	gpt-5.4-mini		https://developers.openai.com/api/docs/models/gpt-5.4-mini 			
	gpt-5.2		https://developers.openai.com/api/docs/models/gpt-5.2 	上下文：400k
最大输出：128k		
	gpt-5.1		https://developers.openai.com/api/docs/models/gpt-5.1 			
	gpt-5.1-chat		https://developers.openai.com/api/docs/models/gpt-5.1-chat-latest 			
	gpt-5-chat
官方4月15日已下架		https://developers.openai.com/api/docs/models/gpt-5 			
	gpt-5-nano		https://developers.openai.com/api/docs/models/gpt-5 			
	gpt-4o		https://developers.openai.com/api/docs/models/gpt-4o 	上下文：128k最大输出：16,384		
Gemini	gemini-3.1-pro-preview	⚠️资源紧缺	https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview?hl=zh-cn 	输入：1,048,576
输出：65,536	文本、 代码、 图片、 音频、 视频	
	gemini-3.1-flash-lite-preview	超过200w TPM需提前3天申请	https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-preview?hl=zh-cn 			
	gemini-3-pro-preview
官方3月9日已下线		https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-pro?hl=zh-cn 			
	gemini-3-flash-preview		https://ai.google.dev/gemini-api/docs/models/gemini-3-flash-preview?hl=zh-cn 			
	gemini-2.5-pro		https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-pro 			
	gemini-2.5-flash		https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash?hl=zh-cn 			
GK
仅国际站	gk-4-1-fast-reasoning	⚠️暂无资源	https://docs.x.ai/developers/models/grok-4-1-fast-reasoning 	上下文：2M
最大输出：2M	文本，图片	
CD
仅国际站	cd-opus-4.7	New-新上资源
超过200w TPM需提前3天申请	https://platform.claude.com/docs/zh-CN/about-claude/models/overview 	对齐官网
注意使用Anthropic协议接入	文本，图片	
	cd-sonnet-4.6					
	cd-opus-4.6					
	cd-opus-4.5					
	cd-haiku-4.5					
●pro模型，目前谷歌整体资源都不足，无法做到保障，可以先考虑用flash。
●其他模型调用值：https://doc.weixin.qq.com/sheet/e3_AYYAPAbVAIASGGvSHRvBZSy6PDWkd?scode=AJEAIQdfAAoPhd2S23AYYAPAbVAIA&tab=BB08J2 
●文件和图片处理，访问谷歌是通过"内嵌数据"方式传输，文件大小限制在70MB以内。
●默认限速： RPM（每分钟10个请求）, TPM（每分钟10W tokens）。可咨询调整（需要提供API Key的SubAppId，按照SubAppId进行限频）。


开通服务
【服务开通】腾讯云官网开通云点播和媒体处理产品服务
国内站：https://cloud.tencent.com/product/vod?Is=sdk-topnav   
国际站：https://www.tencentcloud.com/zh/products/vod?from_qcintl=topnav 


开通后自动创建SubAppId（创建apikey需要使用）：

国内站：https://console.cloud.tencent.com/vod/app-manage 国际站：https://console.intl.cloud.tencent.com/vod/app-manage 
按照SubAppId维度限频，提交调频申请时候请说明使用哪个SubAppId。
SubAppId一旦被删除，SubAppId下所有的API Key都将失效。


Token（APIKey）接口
1.创建接口
接口：CreateAigcApiToken
文档：
国内站：https://cloud.tencent.com/document/product/266/128054 
国际站：https://www.tencentcloud.com/zh/document/product/266/78287 
使用界面和代码：
国内站：https://console.cloud.tencent.com/api/explorer?Product=vod&Version=2018-07-17&Action=CreateAigcApiToken 
如下图界面，可以直接操作生成，也可参考代码创建。

国际站：https://console.tencentcloud.com/api/explorer?Product=vod&Version=2018-07-17&Action=CreateAigcApiToken    （国际站和国内站APIKey不通用，一些模型只能使用国际站）
APIKey没有过期时间，不需要每次调用都创建一个APIKey。APIKey需要一分钟同步到网关，创建之后马上使用可能会失败。目前每个用户限制最多50个token，可删除，可以查询。



2.删除接口
接口：DeleteAigcApiToken
文档：
国内站:https://cloud.tencent.com/document/product/266/128053 
国际站：https://www.tencentcloud.com/zh/document/product/266/78286 
使用界面和代码：
国内站https://console.cloud.tencent.com/api/explorer?Product=vod&Version=2018-07-17&Action=DeleteAigcApiToken 
国际站 https://console.tencentcloud.com/api/explorer?Product=vod&Version=2018-07-17&Action=DeleteAigcApiToken 
删除后网关需要小段时间才能失效。


3.查询接口
接口：DescribeAigcApiTokens
文档
国内站：https://cloud.tencent.com/document/product/266/128052 
国际站：https://www.tencentcloud.com/zh/document/product/266/78285 
使用界面和代码：
国内站https://console.cloud.tencent.com/api/explorer?Product=vod&Version=2018-07-17&Action=DescribeAigcApiTokens 
国际站https://console.tencentcloud.com/api/explorer?Product=vod&Version=2018-07-17&Action=DescribeAigcApiTokens 


●如果子帐户需要调用这些接口，需要主账户赋予其权限：
策略1，赋予所有SubAppId权限：
{
    "statement": [
        {
            "action": [
                "vod:CreateAigcApiToken",
                "vod:DeleteAigcApiToken"
            ],
            "effect": "allow",
            "resource": "*"
        }
    ],
    "version": "2.0"
}


策略2，赋予部份SubAppId权限。
如下示例，赋予部分SubAppId（1500050693）权限。
{
    "statement": [
        {
            "action": [
                "vod:CreateAigcApiToken",
                "vod:DeleteAigcApiToken"
            ],
            "effect": "allow",
            "resource": "qcs::vod::uin/*:subAppId/1500050693"
        }
    ],
    "version": "2.0"
}



生文接口
接口名称：腾讯云点播AIGC文生文接口
接口目前支持以下3种协议：OpenAI completions兼容协议、Anthropic协议、Responses协议。

1.OpenAI completions兼容协议
协议介绍：最主流协议，生文调用方法及参数业界较统一，整体都以OpenAI为主，各家主流模型厂商也都兼容该调用方式；
支持模型：gpt系列（除gpt-5.4-pro(走Response协议）），gemini，gk，minimax，kimi，deepseek
请求地址 (URL)：https://text-aigc.vod-qcloud.com/v1/chat/completions
请求方式：POST

1.1 使用OpenAI SDK
安装sdk
pip install openai


调用api
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="https://text-aigc.vod-qcloud.com/v1"
)

response = client.chat.completions.create(
    model="gpt-5-nano",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hi, how are you?"},
    ],
    extra_body={"reasoning_split": True},
)

print(f"Thinking:\n{response.choices[0].message.reasoning_details[0]['text']}\n")
print(f"Text:\n{response.choices[0].message.content}\n")


1.2 使用Curl
curl -X POST https://text-aigc.vod-qcloud.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -d '{
    "model": "gpt-5.1",
    "stream": true,
    "messages": [
      {
        "role": "user",
        "content": "who are you?"
      }
    ]
  }'


1.3 OpenClaw
baseUrl：https://text-aigc.vod-qcloud.com/v1
api模式选择openai-completions


1.4 文档&参数

请求头 (Request Header) 
HTTP头名称	是否必需携带	说明
Authorization	是（如果有x-api-key则不需要）	格式：Bearer ${TOKEN}token通过本文档中的token(API Key)接口获取，token没有过期时间，不需要每次请求都获取一个
X-Request-Id	否	用户可传入自己的request id
x-api-key	是（如果有Authorization则不需要）	格式：${TOKEN}anthropic使用这种http头
HTTP头名称不区分大小写。

请求体参数 (Request Body)
这里展示的是OpenAI兼容接口

请求体为 JSON 格式，主要包含模型选择和对话上下文。
参数名	类型	是否必填	说明
model	String	是	指定使用的AI模型。
可选值见模型清单。
messages	List<Object>	是	对话消息列表，用于提供上下文和当前问题。详见下表。
stream	bool	是	是否使用流式
thinking_enabled	Boolean	否	是否开启推理（思考）模式。
• true: 模型在回答前会进行深度链式思考（CoT），适合复杂的逻辑分析、数学计算或代码生成任务。开启后响应延迟会增加。
• false: 标准对话模式，响应速度更快。
(注：开启后，usage 中的 reasoning_tokens 将会产生消耗)
注意：
gpt-5.1,gpt-5.2,gpt-4o不支持该参数
调用时不需要携带该参数信息
gemini-3-pro-preview不支持关闭gemini-3-flash-preview 默认开启

temperature	Float	否	控制输出的随机性和创造性。
- 取值范围通常为 0~2，默认值一般为 0.7。- 值越接近 0：输出越精准、确定，适合事实性问答、代码生成等场景。- 值越接近 2：输出越发散、富有创意，适合文案创作、头脑风暴等场景。
max_tokens	Integer	否	控制单次请求的最大生成令牌（Token）数量，包含输入和输出的总 Token。
- 需结合所选模型的最大 Token 限制设置，超出会触发截断或报错。
- 合理设置可避免生成过长内容，控制请求成本与响应速度。
reasoning_effort	string	否	思考等级。
取值范围: none/minimal/low/medium/high/xhigh
同时配置thinking_enabled，以reasoning_effort为准
gemini-3-pro-preview: low/medium/high
gemini-3-flash-preview: minimal/low/medium/high
tools	array of https://developers.openai.com/api/reference/resources/chat#(resource)%20chat.completions%20%3E%20(model)%20chat_completion_tool%20%3E%20(schema) 	否	工具列表，详细参考openai文档。
tool_choice	https://developers.openai.com/api/reference/resources/chat#(resource)%20chat.completions%20%3E%20(model)%20chat_completion_tool_choice_option%20%3E%20(schema) 	否	工具选项，详细参考openai文档。
response_format	https://developers.openai.com/api/reference/resources/$shared#(resource)%20%24shared%20%3E%20(model)%20response_format_text%20%3E%20(schema)  or https://developers.openai.com/api/reference/resources/$shared#(resource)%20%24shared%20%3E%20(model)%20response_format_json_schema%20%3E%20(schema)  or https://developers.openai.com/api/reference/resources/$shared#(resource)%20%24shared%20%3E%20(model)%20response_format_json_object%20%3E%20(schema) 	否	格式化输出，详细参考openai文档。
input_compliance_check	bool	否	是否开启输入文本审核（审核不过直接返回400错误，并标明哪类型错误）
output_compliance_check	bool	否	是否开启输出文本审核（非流式审核不过返回400错误，流式中断输出，finish_reason为content_filter）

messages 数组中对象的结构：
字段名	类型	说明
role	String	消息发送者的角色。常见值：
- system: 系统指令（设定AI的人设）
- user: 用户（提问者）
- assistant: AI助手（之前的回答历史）
- tool: 用户的工具（输入模型需要工具的结果）
content	String / Array Of Part	String类型时,消息的具体文本内容。
数组类型时参考Part对象。
role为tool时,用户工具的输出结果。
tool_calls	Array Of array of https://developers.openai.com/api/reference/resources/chat#(resource)%20chat.completions%20%3E%20(model)%20chat_completion_message_tool_call%20%3E%20(schema) 	role为assisant时,工具使用过程中模型返回的需要调用的工具和输出参数，详情参考openai协议。gemini只支持function工具。
tool_call_id	string	role为tool时, 模型需要调用工具的id，在响应包中tool_calls信息中。
extra_content	ExtraContent结构	gemini模型:
role为assistant时, 可能有思考签名。

Part对象的结构：
字段名	类型	说明
type	String	数据类型。常见值：
- text: 文本
- image_url: 图片url
- input_audio: 音频数据，需填写
- file: 文件,需填写file_url,可选填file_name。
text	String	消息的具体文本内容。type为text时，必填。
image_url	String	图片的url(支持data url scheme)。type为image_url时，必填。（大小限制在70MB以内）
input_audio	Object	音频数据。type为input_audio时，必填。
└ data	String	音频数据的Base64编码。
└ format	String	音频格式。当前只支持mp3/wav。
file_name	String	文件/视频名。
file_url	String	文件/视频URL(视频支持data url scheme)。type为file时，必填。（大小限制在70MB以内）
  └ extra_content	ExtraContent结构	gemini模型，进行文件分析时,可以通过media_resolution
和fps进行控制。

ExtraContent对象的结构：
字段名	类型	说明
google	Object	gemini模型使用
└ fps	Float	视频帧率，请求时指定，用于gemini模型的fps功能.参考文档:https://ai.google.dev/gemini-api/docs/video-understanding?hl=zh-cn#custom-frame-rate 
└media_resolution	String	控制输入媒体的处理方式,参考文档https://ai.google.dev/gemini-api/docs/media-resolution?hl=zh-cn 
└thought_signature	String	模型输出字段: 思考签名


返回参数 (Response Body)
这里展示的是OpenAI兼容接口

参数名	类型	说明
id	String	本次对话任务的唯一标识符（例如：chatcmpl-...）。
object	String	对象类型，固定为 chat.completion。
created	Integer	响应创建的时间戳（Unix Timestamp）。
model	String	实际用于生成响应的模型版本（例如：gpt-5.1-2025-11-13）。
choices	List	生成结果的选择列表（通常包含一条或多条回复）。
└ index	Integer	结果在列表中的索引。
└ message	Object	AI生成的回复消息对象。
  └ role	String	固定为 assistant。
  └ content	String	核心返回数据，即AI生成的文本回答。
  └ reasoning_content	String	AI生成的思考内容。
  └ extra_content	ExtraContent结构	gemini模型可能会输出思考签名thought_signature。
  └ tool_calls	Array Of array of https://developers.openai.com/api/reference/resources/chat#(resource)%20chat.completions%20%3E%20(model)%20chat_completion_message_tool_call%20%3E%20(schema) 	调用工具信息，具体参考openai协议文档

gemini模型时,会多一个extra_content结构,用于输出模型的工具关联思考签名
└ finish_reason	String	停止生成的原因（例如 stop 表示正常结束）。
usage	Object	Token 使用量统计。
└ prompt_tokens	Integer	提问（输入）消耗的 Token 数。
└ completion_tokens	Integer	回答（输出）消耗的 Token 数。
└ total_tokens	Integer	总消耗 Token 数。

返回示例:
{
  "id": "chatcmpl-CjFQ2DVpDRL7zVf6gHRYIPiXx4JJN",
  "object": "chat.completion",
  "created": 1764900066,
  "model": "gpt-5.1-2025-11-13",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "I’m an AI assistant created by OpenAI. I can help answer questions, explain concepts, brainstorm ideas, or assist with tasks like writing, planning, and debugging code.\n\nWhat would you like to do?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 40,
    "completion_tokens": 53,
    "total_tokens": 93,
    "completion_tokens_details": {
      "accepted_prediction_tokens": 0,
      "audio_tokens": 0,
      "reasoning_tokens": 0,
      "rejected_prediction_tokens": 0
    },
    "prompt_tokens_details": {
      "audio_tokens": 0,
      "cached_tokens": 0
    }
  }
}



2.Anthropic协议
协议介绍：Anthropic公司推出的，主要支持CD模型的协议；
支持模型：CD系列模型；
请求地址（URL）：https://text-aigc.vod-qcloud.com/v1/messages
请求方式：POST
官方文档：https://platform.claude.com/docs/en/api/messages/create 

2.1 使用Anthropic SDK
安装sdk
pip install anthropic


调用api
import anthropic

client = anthropic.Anthropic(
    api_key="YOUR_API_KEY",
    base_url="https://text-aigc.vod-qcloud.com/v1"
)

message = client.messages.create(
    model="cd-sonnet-4.6",
    max_tokens=1000,
    system="You are a helpful assistant.",
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "Hi, how are you?"
                }
            ]
        }
    ]
)

for block in message.content:
    if block.type == "thinking":
        print(f"Thinking:\n{block.thinking}\n")
    elif block.type == "text":
        print(f"Text:\n{block.text}\n")


2.2 使用Curl
curl https://text-aigc.vod-qcloud.com/v1/messages \
    -H 'Content-Type: application/json' \
    -H "X-Api-Key: $YOUR_API_KEY" \
    -d '{
          "max_tokens": 1024,
          "messages": [
            {
              "content": "Hello, world",
              "role": "user"
            }
          ],
          "model": "cd-sonnet-4.6"
        }'


3.Responses协议
支持模型：GPT系列模型；
请求地址（URL）：https://text-aigc.vod-qcloud.com/v1/responses
请求方式：POST
原厂文档：https://developers.openai.com/api/reference/resources/responses/methods/create 

curl https://text-aigc.vod-qcloud.com/v1/responses -v \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "Authorization: Bearer $YOUR_API_KEY" \
  -d '{
    "model": "gpt-5.1-chat",
    "instructions": "You are a helpful assistant.",
    "input": "Hello!",
    "stream": true
  }'


from openai import OpenAI

client = OpenAI(
    api_key="YOUR API KEY",
    base_url="https://text-aigc.vod-qcloud.com/v1"
)

response = client.responses.create(
    model="gpt-5.1-chat",
    input=[
        {
            "role": "user",
            "content": [
                {"type": "input_text", "text": "这张图片里有什么？"},
                {
                    "type": "input_image",
                    "image_url": "https://graphic-design-cos.kujiale.com/krp/prod/page/mj_tool/repair/2025/04/23/174542181072538017.png"
                }
            ]
        }
    ]
)

print(response)



4.错误码

HTTP状态码：
200: 成功
400: 请求参数错误。
401: 认证失败
403: 权限不足/已停服（可能欠费等原因）
404: 模型/端点不存在。比如model名不支持；请求了错误的path。
429: 速率限制。默认限速： RPM（每分钟10个请求）, TPM（每分钟10W tokens）。可咨询调整。
500/502/503: 服务器错误/上游错误

每个错误都会返回具体错误信息和request_id字段。
每个请求都返回X-Request-Id头。



用量查询
查询整体生文的用量情况，目前支持接口查询和页面查询。

接口文档
国内站https://cloud.tencent.com/document/product/266/126446 
国际站https://www.tencentcloud.com/zh/document/product/266/78365 

用量统计界面
https://console.cloud.tencent.com/vod/dosage-statistics 


资源维度成本分析https://console.cloud.tencent.com/expense/cost/analysis?billType=1&recentTimeType=13&dimensions=resourceId&periodType=day 
资源维度账单：https://console.cloud.tencent.com/expense/bill/view?tab=resource 
明细账单：https://console.cloud.tencent.com/expense/bill/view?tab=detail 


实践教程
场景描述	关联解决方案
VOD CD模型应用在Claudecode	https://doc.weixin.qq.com/doc/w3_AYYAPAbVAIASGGwC1om64SqWUatvP?scode=AJEAIQdfAAoYKeKBBLAYYAPAbVAIA 
VOD所有生文模型应用于Codebuddy	https://doc.weixin.qq.com/doc/w3_ACAAPgawAFQCNVOoyAq38QYOCAAsM?scode=AJEAIQdfAAo83jitgcAYYAPAbVAIA 
VOD所有生文模型应用于Openclaw	https://doc.weixin.qq.com/doc/w3_ABsALwaJAEoSGb8DdEZ5mSoO0UrZ1?scode=AJEAIQdfAAo714j2E6AYYAPAbVAIA 


常见Q&A
分类	问题	答案
接口调用	当前支持tools么	3.11已支持，详情查看接口参数说明
	如果有模型不在已有列表怎么办	联系对接同事进行评估支持
	可以不带instruction么	可以的
instruction 可以不带的，如果想设定，可以通过system进行设定
{"content":"You are a helpful assistant.","role":"system"}
	默认调用并发	测试期间资源有限，默认支持TPM 10
如果需要升级TPM请正式接入后提出申请我们评估支持
法务支持	目前AI调用的相关合规说明	https://cloud.tencent.com/document/product/301/128365 

