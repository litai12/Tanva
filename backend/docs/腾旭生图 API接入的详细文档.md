【通用】VOD AIGC服务接入指南
更新记录
时间	内容
2026.04.30	H2（快乐马） 1.0 生视频模型上线
版本传参：
1）ModelName: H2
2）ModelVersion:1.0
3）resolution：720P、1080P、2K、4K
4）AspectRatio：16:9，9:16，1:1，3:4，4:3
5）支持模式：文生、首帧生、参考生（1-9张）
6）音频：支持
7）生成时长3-15秒
价格文档：https://doc.weixin.qq.com/sheet/e3_AG0ALgbHACcCNNZhi1wsiRsS03lPl?scode=AJEAIQdfAAofcS4rcMAG0ALgbHACc&tab=1tani3 
2026.04.24	kling 3.0& 3.0-Omni   4K上线

使用方式：
OutPutConfig.Resolution="4K"

注意：请联系腾讯云技术同学开启相关服务
2026.04.23	gpt-image2上线，支持low、medium、high三种版本，价格文档：https://doc.weixin.qq.com/sheet/e3_AG0ALgbHACcCNNZhi1wsiRsS03lPl?scode=AJEAIQdfAAofcS4rcMAG0ALgbHACc&tab=ta993j 版本传参：
1）ModelName: OG
2）ModelVersion: image2_low, image2_medium, image2_high
3）resolution：1K、2K、4K
4）AspectRatio：1:1,3:2,2:3,3:4,4:3,16:9,9:16,21:9,9:21
5）FileInfos.N：3（最大支持3张参考图），更大参考图请联系技术配置
Image 2 的核心优势：首次将语言模型链式推理融入图像生成，实现先理解规划再渲染，文字精准、细节逼真、可控性强，直达商业级生产力。
2026.04.15	上线Pixverse（爱诗）生视频模型，个版本特色如下：
Pixverse V5.6全球第二的通用型视频生成模型，以极致写实、毫秒级音画同步与稳定运镜，兼顾高质量与高性价比。
Pixverse V6.0一站式电影级生成，单提示词完成多镜头叙事、原生音画与专业运镜，物理真实与角色连贯全面突破。PixVerse
Pixverse C1影视工业垂直模型，专攻打斗、特效与分镜转视频，在多镜头一致性与成片落地性上行业领先。
参考3.12
2026.04.03	上线Vidu q3-mix，对比q3
1.各版本特色如下：
a.viduq3-mix：画面质感强，支持智能切镜，动态效果好，均衡性最强
b.viduq3：支持智能切镜，多机位的一致性更出色
2.viduq3-mix模型暂不支持主体库调用，持续迭代中。
使用参考【3.11.8 Vidu q3-mix 参考生视频】
3.更新vidu系列的使用样例
2026.03.30	生视频新增如下参数：
●FileInfos.N 新增 "Usage"参数用于声明是首帧还是参考帧，用于优化和兼容之前使用ObjectId参数来声明的模式
○Usage：
■ "FirstFrame"：首帧声明
■"Reference":参考帧声明
●新增SubjectInfos.N，参数用于传递主体信息，对Kling、Vidu有效，用于优化和兼容之前使用ExtInfo参数来传递主体的模式

●注意：需要更新SDK
2026.03.13	上线Vidu q3参考生
2026.03.12	图片视频更新大模型超分直出价格（标红框）https://doc.weixin.qq.com/sheet/e3_AG0ALgbHACcCNNZhi1wsiRsS03lPl?scode=AJEAIQdfAAofcS4rcMAG0ALgbHACc&tab=1tani3 
2026.03.11	更新大模型AIGC错误码指引https://doc.weixin.qq.com/doc/w3_AcEALgZGALoCNfI96BH0mTKCELED2?scode=AJEAIQdfAAoOsavL7cAG0ALgbHACc 
2026.03.10	视频新增Vidu q3-turbo模型，图片新增Seedream 5.0-lite、Kling3.0、3.0-Omni模型
2026.03.09	新增Kling人脸识别、自定义音色能力定价，新增Vidu主体识别定价
2026.02.28	新增q2和q2-pro参考生视频定价：https://cloud.tencent.com/document/product/266/95125#96b3b59a-f9e1-49e9-966a-bedb70a4bf12 
2026.02.27	新增GEM3.1（nano banana 2）
"ModelName":"GEM"
"ModelVersion":"3.1"
2026.02.14	新增Kling 3.0、3.0-Omni，
1.“文生视频”与“图生视频”支持智能分镜，模型会根据提示词内容智能切分内容实现多镜头效果，相关参数"multi_shot":  "intelligence"
2.short_type、multi_shot、multi_prompt这三个参数可以通过extinfo传入
3.std（720P）（3s～15s）、pro（1080P）（3s～15s）
接入样例，参考【3.9 Kling 3.0 & 3.0-Omni（生视频）接入说明】
2026.02.04	新增Vidu q3-pro
2026.02.04	1.新增Kling【对口型】参考 3.6 对口型 - Kling
2.新增Kling【数字人】 参考3.7 数字人 - Kling
3.新增Vidu【特效模板】
说明：
1）需要使用最新版本SDK

2026.01.30	新增Kling生图、Vidu生图能力
2026.01.19	1.新增Kling【动作控制】 ，SceneType参数，当 ModelName 为 Kling 时，取值 motion_control 表示动作控制；用例参考见【3.5 动作控制】
说明：
1）需要使用最新版本SDK
2）功能可参考https://app.klingai.com/cn/dev/document-api/apiReference/model/motionControl 
3）动作控制场景下，模型耗时片长，预计8分钟左右
2026.01.13	1.支持Kling2.6【动作控制】
2.视频超分增强，支持AIGC直出（见3.4 AIGC超分输出），以及异步调用超分（超分增强服务）方案两种模式
2026.01.04	1.Kling 2.6 上线
2025.12.31	1.生文，已支持测试接口，欢迎咨询
2.生音频（音乐），已支持测试接口，欢迎咨询
2025.12.19	1.kling O1，已上线
2.veo 3.1-fast 已上线
2025.12.17	1、kling O1，预计本周上线
2、veo 3.1-fast 预计本周上线
2025.12.09
（重要）	1.更新说明文档，正式上线官网
2.更新SDK，直接使用官方SDK，不再需要独立安装
3.输入支持URL
4.多分辨率支持AIGC直出或者AIGC+超分输出高分辨视频（下下文第4点）
5.上线：vidu Q2 、 Q2-turbo、Q2-Pro ，Kling-V2.5-Turbo
2025.12.04	1、更新部分大模型的上线计划
vidu Q2 、 Q2-turbo、Q2-Pro ，Kling-V2.5-Turbo，Kling-V2.1大师版 预计12月12日之前上线
2、更新说明文档
1）新：vod-aigc-doc-20251204.tar.gz
2）老：vod-aigc-doc.tar.gz
2025.12.02	Google（GEM）banana 支持3.0
2025.11.25	交付基于腾讯云VOD AIGC生成方案文档

AIGC官网文档汇总
	国内站	国际站
AIGC生图	https://cloud.tencent.com/document/product/266/126240 	https://www.tencentcloud.com/zh/document/product/266/76685 
AIGC生视频	https://cloud.tencent.com/document/product/266/126239 	https://www.tencentcloud.com/zh/document/product/266/76684 
AIGC计费官网	https://cloud.tencent.com/document/product/266/95125#b66b8cec-fdfd-4dd8-af22-5704b9d24763 	https://www.tencentcloud.com/zh/document/product/266/14666#96b3b59a-f9e1-49e9-966a-bedb70a4bf12 
AIGC价格表	https://doc.weixin.qq.com/sheet/e3_AG0ALgbHACcCNNZhi1wsiRsS03lPl?scode=AJEAIQdfAAofcS4rcMAG0ALgbHACc&tab=1tani3 

1.背景
① 腾讯云AIGC功能，集成了业界多个知名大模型方案，为客户提供融合服务平台，免去多平台对接，支持文生图、图生图、图生视频等内容生成模式，为了方便用户进行测试，如下提供接入和测试DEMO。
② 同时为了帮助优化AIGC视频画质，腾讯云为客户提供云端增强方案，帮助客户对内容进行超分，如720P超分到1080P，可降低生产1080P的成本50%左右

如需接入，请联系腾讯云官方技术同学，进行账号开白，以及辅助进行接入指导
同时需开通VOD服务，实现功能调用，具体入口如下：
国内站入口	https://console.cloud.tencent.com/vod/ 
国际站入口	https://console.tencentcloud.com/vod/register 


1.1 AIGC 模型广场
1.1.1 模型列表

当前支持的模型列表，传参数如模型的参数和版本（持续补充中）
类型	模型参数
ModelName	版本
ModelVersion	对应模型名称	备注
生图	GEM	●2.5
●3.0
●3.1	2.5对应nano banana
3.0对应nano banana pro
3.1对应nano2	支持扩图，效果相对较好
GEM 时最多指定3个
	OG	●image2_low
●image2_medium
●image2_high		分辨率：1K、2K、4K；尺寸：1:1,3:2,2:3,3:4,4:3,16:9,9:16,21:9,9:21
最大参考图：3
	Qwen	●0925	千问	
	SI	●4.5
●5.0-lite	豆包（对应：计费文档SI）	SI对应Seedream image
	Kling	●2.1
●3.0
●3.0-Omni		
	Vidu	●q2		
	Jimeng	●4.0	即梦（对应：计费文档SI）	风格化效果较优
	Hunyuan	●3.0	混元	
生视频	Pixverse	●V5.6
●V6.0
●C1		
	Hailuo	●02
●2.3
●2.3-fast	海螺（Minimax）	
	 Kling	●1.6
●2.0
●2.1
●2.5
●O1 
●2.6
●3.0
●3.0-Omni	可灵	
1、支持有声、无声，声音参数字段：OutputConfig.AudioGeneration，开启Enabled，关闭Disabled
2、支持动作控制，参数字段SceneType，当 ModelName 为 Kling 时，取值 motion_control 表示动作控制；
3、2.6 支持首尾帧，但是需要注意只支持无声模式
PS：支持动作控制、数字人、对口型等

	Vidu	●q2
●q2-turbo
●q2-pro 
●q3
●q3-pro
●q3-turbo
●q3-mix	生数	动画场景效果好
支持多图参考生视频。q2模型1-7张图片，可通过FileInfos里面的ObjectId作为主体id来传入
q3-pro仅支持文生和图生

1.各版本特色如下：
a.viduq3-mix：画面质感强，支持智能切镜，动态效果好，均衡性最强
b.viduq3：支持智能切镜，多机位的一致性更出色
2.viduq3-mix模型暂不支持主体库调用，持续迭代中
3.viduq3-mix只支持参考生，Usage字段传Reference
	Jimeng	●3.0pro	即梦	
	Seedance	●1.0-pro
●1.0-lite-i2v
●1.0-pro-fast；
●1.5-pro	豆包（对应：计费文档SV）	1、其中1.5-pro区分有声、无声，声音参数字段：OutputConfig.AudioGeneration，开启Enabled，关闭Disabled
2、1.5-pro不支持1080P
	GV	●3.1
●3.1-fast 	Google Veo	音画同出，
不拦截人脸
1. GV，使用多图输入时，不可使用LastFrameFileId和LastFrameUrl。
	OS	●2.0	OpenAI Sora	音画同出，
对人脸比较敏感，会被拦截
1.1.2 模型能力汇总
整理输出生图、生视频的能力数据包括：
●分辨率	
●生成图像横纵比	
●支持模式：文生视频	图生视频	
●生成时长		
●首尾帧	
●最大参考图片	
●是否支持音画同出	
●代表性拓展参数
●等等
https://doc.weixin.qq.com/sheet/e3_AOcASwZGACkCNPE0YsRJjS761Zng7?scode=AJEAIQdfAAokzsWJAIAcEALgZGALo&tab=4yed7o 
1.2 画质超分增强能力（按需）
腾讯云VOD为客户提供超分增强能力，兼顾用户体验与成本，满足2K、4K等分辨率的生成需求。
① 一方面，优化大模型输出视频的画质，提供超分、综合增强、降噪、插帧等能力
② 另一方面，降低企业大模型的输出成本

我们为客户提供了两种超分增强方案
方案1：见【3.4 AIGC超分输出】，直出超分视频
方案2：见【4. 超分增强服务接入】，串行异步输出超分视频，为客户提供场景化，定制化的视频增强服务

2.开发接入
2.1 开发流程
2.1.1 AIGC开发逻辑
在提交AIGC任务时，如下两种模式
模式	输入	输出
【URL】模式	1、参考素材（图片、视频等）通过URL提交
2、国内客户如果数据存储在海外，若未做全球加速，注意需要指定inputregion = oversea	1、输出支持临时存储（返回URL）和永久存储（返回URL+Fileid）两种模式
2、建议使用永久存储，后处理（如超分增强等）可通过内网拉取，更稳定，并节省出口流量
【Fileid】模式	参考素材上传VOD，生成Fileid，实现内网传输	

https://doc.weixin.qq.com/flowchart-addon
说明：推荐使用永久存储，将文件存储存在在VOD中，后续进行图片/视频的超分增强或者
2.1.2 超分增强开发逻辑
超分增强服务，目前根据客户的输入需要有如下几种开发逻辑供客户参考
具体参考下文第4点【视频超分增强】
模式	入口	输入	输出	文档入口
【URL】模式	1.VOD 	支持拉取URL上传，并通过【Procedure】指定任务流自动触发超分增强任务	VOD	https://cloud.tencent.com/document/product/266/35575 
	1.MPS
	API以URL作为输出参数触发相关任务	VOD、COS、OSS、S3等	https://doc.weixin.qq.com/doc/w3_AUUAAQaDAMYCN0Q5asMnfS1On0J60?scode=AJEAIQdfAAoIMfrwklAUUAAQaDAMY 
【Fileid】模式	1.VOD	针对以及存储在VOD的文件发起（如AIGC永久存储的素材）超分增强服务。	VOD	https://cloud.tencent.com/document/product/266/33427 

https://doc.weixin.qq.com/flowchart-addon
说明：推荐使用永久存储，将文件存储存在在VOD中，后续进行图片/视频的超分增强或者

2.2 开通VOD标准版
●服务入口：获取SubAppId
国内站入口	https://console.cloud.tencent.com/vod/ 
国际站入口	https://console.tencentcloud.com/vod/register 
PS：完成VOD服务开通之后，会创建一个默认的应用（SubAppId），用户后续AIGC调用使用。也可以根据新下面的说明创建应用ID

●创建VOD 标准版（按需）
用于AIGC数据存储，后续处理时可实现内网通信，节省流量成本

●获取VOD相关账号信息
主要信息
"SubAppId": 1500044236


●在线功能体验

2.3 媒资上传VOD生成Fileid（按需）

2.3.1 平台可视化
https://cloud.tencent.com/document/product/266/115416

2.3.2 API接入
https://cloud.tencent.com/document/product/266/9760


1.服务端接入-拉取本地文件
https://cloud.tencent.com/document/product/266/31784

2.服务端接入-拉取URL文件
https://cloud.tencent.com/document/product/266/35575

2.3.3 代码样例
# -*- coding: utf-8 -*-
from qcloud_vod.vod_upload_client import VodUploadClient
from qcloud_vod.model import VodUploadRequest
#pip install vod-python-sdk

ak = 'xxx'
sk = 'xxx'

client = VodUploadClient(ak, sk)

request = VodUploadRequest()

#指定应用
request.SubAppId = 1500044236
#指定路径
request.MediaFilePath = "/Users/zhengguoliang/Documents/image/watermarker.jpeg"

try:
    response = client.upload("ap-guangzhou", request)
    print(response.FileId)
    print(response.MediaUrl)

    '''
    返回
    FileId：5145403720640671256
    URL：https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/a7a403595145403720640671256/fiVMpquaYXMA.jpeg
    
    Fileid可用于素材参考
    
    '''

except Exception as err:
    # 处理业务异常
    print(err)

2.4 查询&回调
业务可通过接口查询或者回调获取任务结果，推荐使用回调服务，详情见
1	DescribeTaskDetail	https://cloud.tencent.com/document/product/266/33431 	任务查询，推荐优先使用普通回调或者可靠回调获取任务结果
2	普通回调	配置：https://cloud.tencent.com/document/product/266/33781 
回调结构：
●生图 AigcImageTask：
https://cloud.tencent.com/document/api/266/31773#AigcImageTask 
●生视频AigcVideoTask：https://cloud.tencent.com/document/api/266/31773#AigcVideoTask 
●场景化生图SceneAigcImageTask：
https://cloud.tencent.com/document/api/266/31773#SceneAigcImageTask 
●场景化生视频SceneAigcVideoTask：
https://cloud.tencent.com/document/api/266/31773#SceneAigcVideoTask 	普通回调，支持任务完成之后回调结果，建议使用
3	可靠查询	配置：
https://cloud.tencent.com/document/product/266/33781 
API：
https://cloud.tencent.com/document/product/266/33433 	拉取事件通知，建议使用

2.5 FAQ
2.5.1 谷歌Gemini模型报错说明
https://ai.google.dev/api/generate-content?hl=zh-cn#FinishReason

FinishReason-定义模型停止生成词元的原因。
枚举
FINISH_REASON_UNSPECIFIED	默认值。此值未使用。
STOP	模型的自然停止点或提供的停止序列。
MAX_TOKENS	已达到请求中指定的 token 数量上限。
SAFETY	出于安全原因，回答候选内容被标记。
RECITATION	回答候选内容因背诵原因而被标记。
LANGUAGE	系统标记了候选回答内容，原因是其使用了不受支持的语言。
OTHER	原因未知。
BLOCKLIST	由于内容包含禁用词，因此 token 生成操作已停止。
PROHIBITED_CONTENT	由于可能包含禁止的内容，因此 token 生成操作已停止。
SPII	由于内容可能包含敏感的个人身份信息 (SPII)，因此 token 生成操作已停止。
MALFORMED_FUNCTION_CALL	模型生成的函数调用无效。
IMAGE_SAFETY	由于生成的图片包含违规内容，词元生成已停止。
IMAGE_PROHIBITED_CONTENT	图片生成已停止，因为生成的图片包含其他禁止的内容。
IMAGE_OTHER	由于其他杂项问题，图片生成已停止。
NO_IMAGE	模型本应生成图片，但却未生成任何图片。
IMAGE_RECITATION	由于存在重复内容，图片生成操作已停止。
UNEXPECTED_TOOL_CALL	模型生成了工具调用，但请求中未启用任何工具。
TOO_MANY_TOOL_CALLS	模型连续调用了过多的工具，因此系统退出了执行。
MISSING_THOUGHT_SIGNATURE	请求至少缺少一个思路签名。
2.5.2 常见错误码提示
https://doc.weixin.qq.com/doc/w3_AcEALgZGALoCNfI96BH0mTKCELED2?scode=AJEAIQdfAAoOsavL7cAG0ALgbHACc 
2.5.3 使用问题参考
包括主体参考等用法可参考如下文档
https://doc.weixin.qq.com/doc/w3_AGMAQgaCACcCNox3ADbIvQVmP3lbf?scode=AJEAIQdfAAobDzJej1AGMAQgaCACc 
①Vidu 参考图片/视频 生视频
②Kling 参考图片/视频/主体 生视频
③ExInfo参数传额外参数
④首尾帧/参考生模式传参区别（必读）
⑤Kling3.0 分镜参数 short_type、multi_shot、multi_prompt参数
⑥Vidu错峰模式
⑦字段太新，sdk没有/字段缺失
⑧国外图片拉不到
⑨没有声音
⑩处理慢
⑪ 不同模型输出的时长、分辨率、能力

3.AIGC 服务接入
3.1 可视化操作
支持在线可视化操作，服务入口如下：
【云点播】>> 【应用管理】 >> 【AIGC内容生成】

3.2 文档&SDK说明
3.2.1 主要接口文档说明
编号	主要接口	文档站	说明
1	CreateAigcVideoTask	https://cloud.tencent.com/document/product/266/126239 	通用AIGC生视频文档，支持自定义模型等特性，返回任务taskid，可通过主动查询或者配置回调获取结果
2	CreateAigcImageTask	https://cloud.tencent.com/document/product/266/126240 	通用AIGC生视频文档，支持自定义模型等特性，返回任务taskid，可通过主动查询或者配置回调获取结果
3	CreateSceneAigcImageTask	https://cloud.tencent.com/document/api/266/126968 	1、场景化：电商场景自动化prompt
2、支持一次性生多图
4	DescribeTaskDetail	https://cloud.tencent.com/document/product/266/33431 	任务查询，推荐优先使用普通回调或者可靠回调获取任务结果
5	普通回调	配置：https://cloud.tencent.com/document/product/266/33781 
回调结构：
●生图 AigcImageTask：
https://cloud.tencent.com/document/api/266/31773#AigcImageTask 
●生视频AigcVideoTask：https://cloud.tencent.com/document/api/266/31773#AigcVideoTask 
●场景化生图SceneAigcImageTask：
https://cloud.tencent.com/document/api/266/31773#SceneAigcImageTask 
●场景化生视频SceneAigcVideoTask：
https://cloud.tencent.com/document/api/266/31773#SceneAigcVideoTask 	普通回调，支持任务完成之后回调结果，建议使用
6	可靠查询	配置：
https://cloud.tencent.com/document/product/266/33781 
API：
https://cloud.tencent.com/document/product/266/33433 	拉取事件通知，建议使用
3.2.2 关键参数
详细参数参考官方接口文档，如下说明重点参数
参数名称	必选	类型	描述
SubAppId	是	Integer	点播https://cloud.tencent.com/document/product/266/14574  ID。从2023年12月25日起开通点播的客户，如访问点播应用中的资源（无论是默认应用还是新创建的应用），必须将该字段填写为应用 ID。
示例值：251007502
ModelName	是	String	模型名称。
示例值：Hailuo
ModelVersion	是	String	模型版本。
示例值：当 ModelName 是 Hailuo，可选值为 02、2.3、2.3-fast；

FileInfos.N	否	Array of https://cloud.tencent.com/document/api/266/31773#AigcVideoTaskInputFileInfo 	用于描述模型在生成视频时要使用的资源文件，包括参考帧、主体等信息
首尾帧视频生成：用 FileInfos 第一张表示首帧（此时 FileInfos 最多包含一张图片），LastFrameFileId 或者 LastFrameUrl 表示尾帧。
●Type：String，输入的视频文件类型。取值有：
○File：点播媒体文件；
○Url：可访问的 Url；
○示例值：File
●Category：String，文件分类。取值为：
○Image: 图片；
○Video: 视频。
○示例值：Image
●FileId：String，媒体文件 ID，对应当 Type 取值为 File 时，本参数有效。
○示例值：3704211***509819
●Url：String，可访问的文件 URL。当 Type 取值为 Url 时，本参数有效。
○示例值：https://test.com/1.png
●ReferenceType：String，参考类型，GV模型适用。注意：
○当使用 GV 模型时，可作为参考方式，可选值：asset 表示素材、style 表示风格；
○当使用 Kling 模型以及 Category 为 Video 时，可区分参考视频类型，feature 表示特征参考视频，base 表示待编辑视频。
○示例值：asset
●ObjectId：String，用法：Vidu主体Id、参考图模式。
○参考图模式：只有一张图时候，ObjectId必须不为空（一张图、ObjectId为空，为首帧模式）。
○Vidu主体Id：prompt可以通过 @主体Id 的方式使用。当 Category 为 Image 时有效。
○示例值：obj1
●VoiceId：String，适用于 Vidu-q2 模型。
○当全部图片携带主体 Id 时，可针对主体设置音色 Id。 当 Category 为 Image 时有效。音色列表：https://shengshu.feishu.cn/sheets/EgFvs6DShhiEBStmjzccr5gonOg
○示例值：male-qn-qingse
●KeepOriginalSound：String，是否保留视频原声。当 Category 为 Video 时有效。取值如下：
○Enabled：保留
○Disabled：不保留
○示例值：Enabled
●Usage：String，用于区分输入是首帧或参考帧。可选值：
○FirstFrame：首帧；
○Reference：参考帧；
○示例值：FirstFrame

说明：
1）首帧参考模式：FileInfos只有一张图情况下实现首帧参考生视频，有两种处理方案
① 方案1：当FileInfos只有一张图片，且未指定ObjectId参数时，表示参考首帧生视频；
② 方案2：使用Usage参数，Usage指定值"FirstFrame"
此处搭配LastFrameFileId 或者LastFrameUrl 表示尾帧，可实现参考首尾帧生视频。
备注： ①此时视频或者图片输出的长宽比与图片长宽比保持一致② 如果使用Usage参数，在多参考场景下，每个参考物都必须携带Usage参数

2）参考生视频模式：FileInfos只有一张图情况下实现参考生视频，有两种处理方案：
①方案1：可通过指定ObjectId参数来实现，ObjectId的值只要是非空即可；
②方案2：使用Usage参数，Usage指定值"Reference"
SubjectInfos.N	否	Array of https://cloud.tencent.com/document/api/266/31773#AigcVideoTaskInputSubjectInfo 	固定主体输入信息。

●Id：String，主体ID
○可灵必填
○Vidu选填
○String示例值：92951***593344
●Name：String，固定名称
○Vidu主体必选，可在 prompt 中加入 [@name] 使用。如 name 为小明时，prompt 中描述为 [@小明] 。
○Kling主体可选。
○示例值：猫猫
●VoiceId：String，仅Vidu有效。
○音色ID用来决定视频中的声音音色，为空时系统会自动推荐
○示例值：male-qn-badao
●ImageUrls：Array of String，仅Vidu有效。
○临时主体图片，最多3张图片
○注1：支持传入图片URL（确保可访问）；
○注2：图片支持 png、jpeg、jpg、webp格式；
○注3：图片像素不能小于 128*128，且比例需要小于1:4或者4:1。
○示例值：["https://xxx/0.jpg"]
●VideoUrls：Array of String，仅Vidu有效。
○临时主体视频，最多1个5秒视频注1：仅参考生viduq2-pro模型支持使用视频主体；注2：最多支持上传 1个5秒 的视频；注3：视频支持 mp4、avi、mov格式；注4：视频像素不能小于 128*128，且比例需要小于1:4或者4:1；
示例值：["https://xxx/video.mp4"]

LastFrameUrl	否	String	用于作为尾帧画面来生成视频的媒体文件 URL。说明：
1.只支持模型 GV 、Kling、Vidu，其他模型暂不支持。当 ModelName 为 GV 时，如果指定该参数，则需同时指定 FileInfos 作为待生成视频的首帧。当 ModelName 为 Kling 、ModelVersion 为 2.1 并且指定输出分辨率 Resolution 为 1080P 时，才能指定该参数。当 ModelName 为 Vidu、ModelVersion 为 q2-pro、q2-turbo 时，才能指定该参数。
2.图片大小需小于5M。
3.图片格式的取值为：jpeg，jpg, png, webp。

示例值：https://test.com/1.png
Prompt	否	String	生成视频的提示词。当 FileInfos 为空时，此参数必填。
示例值：move the picture
示例值：generate a car
OutputConfig	否	https://cloud.tencent.com/document/api/266/31773#AigcVideoOutputConfig 	生视频任务的输出媒体文件配置，包括：
●"StorageMode":存储类型
○"Temporary" -- 临时存储
○"Permanent" -- 永久存储
●"Duration":5, 视频时长配置，具体可参考模型支持的具体时长
●"Resolution": "1080P", 视频分辨率配置
●"AspectRatio":"16:9",视频长宽比配置
●"AudioGeneration":是否生成音频
○Enabled：开启；
○Disabled：关闭；
●"InputComplianceCheck":  是否开启输入内容的合规性检查
○Enabled：开启；
○Disabled：关闭；
●"OutputComplianceCheck"：是否开启输出内容的合规性检查
○Enabled：开启；
○Disabled：关闭；
●"OffPeak":是否开启错峰
○Enabled：开启；
○Disabled：关闭；
●"FrameInterpolate":是否开启vidu智能插帧
○Enabled：开启；
○Disabled：关闭；
●"LogoAdd":是否开启图标水印,目前支持的模型有 Vidu，其他模型暂不支持
○Enabled：开启；
○Disabled：关闭；

备注：以及其他参数，详情参考在线文档
ExtInfo	否	String	保留字段，特殊用途时使用。
例如用于可灵参3.0 智能分镜等场景

3.2.3 SDK文档
为了方便企业用户对接腾讯云VOD服务，可通过安装官网SDK辅助开发
SDK中心：https://cloud.tencent.com/document/sdk/Description 
支持的语言：
●PHP
●Python
●Java
●Go
●.Net
●Node.js
●C++
●Ruby
如有特殊需求请联系腾讯云的技术同学

3.2.4 错误码目录
0 正确
40000 参数错误
60000 源文件错误
70000 任务失败
●具体70000的任务错误，需要结合message进行判断，参考下表
message	说明	备注	解决方案
CreateAigcImageTask process return rsp err:{RequestLimitExceeded GenerateImage task reached the maximum concurrency	生图模型超并发	腾讯反馈	反馈并评估添加并发
CreateAigcImageTask process return rsp err:{InvalidParameter.VoilationContent Input Prompt violates policy}	prompt	prompt违规拦截	修改
task failed with status: FAIL, message: Your request was blocked by our moderation system	审核拦截	Google nano banana 反馈	




3.3 接入Demo
3.3.2 生视频场景 - CreateAigcVideoTask
3.3.2.1 Json数据
{
        "SubAppId": 1500044236,
        "ModelName": "GV",   #Google veo
        "ModelVersion": "3.1",
        "FileInfos": [
            {
                "Type": "Url",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/demo/picture/2k_20251105956f542b.jpeg"
            }
        ],
        "Prompt": "微笑的向我走来",
        "EnhancePrompt": "Disabled",
        "OutputConfig": {
        #输入配置参考：https://cloud.tencent.com/document/api/266/31773#AigcVideoOutputConfig
            "StorageMode": "Temporary", #存储类型
            "Resolution": "1080P",      #视频分辨率配置
            "Duration":5,               #视频时长配置
            "AspectRatio":"16:9"        #视频长宽比配置
        }

3.3.2.2 代码示例 - Python
# -*- coding: utf-8 -*-

import os
import json
import types
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.vod.v20180717 import vod_client, models
try:
    # 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
    # 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
    # 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
    # 请参见：https://cloud.tencent.com/document/product/1278/85305
    # 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
    cred = credential.Credential(os.getenv("TENCENTCLOUD_SECRET_ID"), os.getenv("TENCENTCLOUD_SECRET_KEY"))
    # 使用临时密钥示例
    # cred = credential.Credential("SecretId", "SecretKey", "Token")
    # 实例化一个http选项，可选的，没有特殊需求可以跳过
    httpProfile = HttpProfile()
    httpProfile.endpoint = "vod.tencentcloudapi.com"

    # 实例化一个client选项，可选的，没有特殊需求可以跳过
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    # 实例化要请求产品的client对象,clientProfile是可选的
    client = vod_client.VodClient(cred, "ap-guangzhou", clientProfile)

    # 实例化一个请求对象,每个接口都会对应一个request对象
    req = models.CreateAigcVideoTaskRequest()
    params = {
        "SubAppId": 1500044236,
        "ModelName": "OS",
        "ModelVersion": "2.0",
        "FileInfos": [
            {
                "Type": "Url",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/demo/picture/2k_20251105956f542b.jpeg"
            }
        ],
        "Prompt": "微笑的向我走来",
        "EnhancePrompt": "Enabled",
        "OutputConfig": {
        #输入配置参考：https://cloud.tencent.com/document/api/266/31773#AigcVideoOutputConfig
            "StorageMode": "Temporary", #存储类型
            "Resolution": "1080P",      #视频分辨率配置
            "Duration":5,               #视频时长配置
            "AspectRatio":"16:9"        #视频长宽比配置
        }

    }
    req.from_json_string(json.dumps(params))

    # 返回的resp是一个CreateAigcVideoTaskResponse的实例，与请求对象对应
    resp = client.CreateAigcVideoTask(req)
    # 输出json格式的字符串回包
    print(resp.to_json_string())

except TencentCloudSDKException as err:
    print(err)


3.3.2.3 结果输出
{
    "TaskId": "1500044236-AigcVideoTask-cd35c792def037f1edc9455a692608f3t",
    "RequestId": "7a7a55db-6260-485d-948e-431a955d8308"
}


3.3.2 生图场景 - CreateAigcImageTask
3.3.2.1 Json数据
{
        "SubAppId": 1500044236,
        "ModelName": "GEM",
        "ModelVersion": "3.0",
        "FileInfos": [
        #输入参考图：https://cloud.tencent.com/document/api/266/31773#AigcImageTaskInputFileInfo
            {
                "Type": "Url",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/demo/picture/2k_20251105956f542b.jpeg"
            }
        ],
        "Prompt": "她微笑的向我走来",
        "OutputConfig": {
        #输入配置参考：https://cloud.tencent.com/document/api/266/31773#AigcImageOutputConfig
            "StorageMode": "Temporary", #存储类型
            "Resolution": "1080P",      #图片分辨率配置
            "AspectRatio":"16:9"        #图片长宽比配置
        }

    }

3.3.2.2 代码实例 - Python
# -*- coding: utf-8 -*-

import os
import json
import types
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.vod.v20180717 import vod_client, models
try:
    # 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
    # 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
    # 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
    # 请参见：https://cloud.tencent.com/document/product/1278/85305
    # 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
    cred = credential.Credential(os.getenv("TENCENTCLOUD_SECRET_ID"), os.getenv("TENCENTCLOUD_SECRET_KEY"))
    # 使用临时密钥示例
    # cred = credential.Credential("SecretId", "SecretKey", "Token")
    # 实例化一个http选项，可选的，没有特殊需求可以跳过
    httpProfile = HttpProfile()
    httpProfile.endpoint = "vod.tencentcloudapi.com"

    # 实例化一个client选项，可选的，没有特殊需求可以跳过
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    # 实例化要请求产品的client对象,clientProfile是可选的
    client = vod_client.VodClient(cred, "", clientProfile)

    # 实例化一个请求对象,每个接口都会对应一个request对象
    req = models.CreateAigcImageTaskRequest()
    params = {
        "SubAppId": 1500044236,
        "ModelName": "Jimeng",
        "ModelVersion": "4.0",
        "FileInfos": [
            {
                "Type": "Url",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/demo/picture/2k_20251105956f542b.jpeg"
            }
        ],
        "Prompt": "她微笑的向我走来"
    }
    req.from_json_string(json.dumps(params))

    # 返回的resp是一个CreateAigcImageTaskResponse的实例，与请求对象对应
    resp = client.CreateAigcImageTask(req)
    # 输出json格式的字符串回包
    print(resp.to_json_string())

except TencentCloudSDKException as err:
    print(err)

3.3.2.3 结果输出
{
    "TaskId": "1500044236-AigcImageTask-65c1e8621b509033a1a766c56c673745t",
    "RequestId": "b0fdad6c-49d0-40fd-b4b6-9e0c94e712c2"
}

3.3.3 任务查询 - DescribeTaskDetail
3.3.3.2 Json数据
{
        "TaskId": "1500044236-AigcVideoTask-cd35c792def037f1edc9455a692608f3t",
        "SubAppId": 1500044236
}

3.3.3.3 代码实例
# -*- coding: utf-8 -*-

import os
import json
import types
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.vod.v20180717 import vod_client,models

try:
    # 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
    # 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
    # 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
    # 请参见：https://cloud.tencent.com/document/product/1278/85305
    # 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
    cred = credential.Credential(os.getenv("TENCENTCLOUD_SECRET_ID"), os.getenv("TENCENTCLOUD_SECRET_KEY"))
    # 使用临时密钥示例
    # cred = credential.Credential("SecretId", "SecretKey", "Token")
    # 实例化一个http选项，可选的，没有特殊需求可以跳过
    httpProfile = HttpProfile()
    httpProfile.endpoint = "vod.tencentcloudapi.com"

    # 实例化一个client选项，可选的，没有特殊需求可以跳过
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    # 实例化要请求产品的client对象,clientProfile是可选的
    client = vod_client.VodClient(cred, "", clientProfile)

    # 实例化一个请求对象,每个接口都会对应一个request对象
    #{"TaskId": "2147484595", "RequestId": "4be58668-2073-4cfe-8fc7-052774eccefc"}
    req = models.DescribeTaskDetailRequest()
    #{"TaskId": "1500044236-AigcVideoTask-cd35c792def037f1edc9455a692608f3t", "RequestId": "7a7a55db-6260-485d-948e-431a955d8308"}

    params = {
        "TaskId": "1500044236-AigcVideoTask-cd35c792def037f1edc9455a692608f3t",
        "SubAppId": 1500044236
    }
    req.from_json_string(json.dumps(params))

    # 返回的resp是一个ProcessMediaResponse的实例，与请求对象对应
    resp = client.DescribeTaskDetail(req)
    # 输出json格式的字符串回包
    print(resp.to_json_string())

except TencentCloudSDKException as err:
    print(err)

3.3.3.4 结果输出
{
  "Response": {
    "AigcImageTask": {
      "ErrCode": 0,
      "Input": {
        "EnhancePrompt": "",
        "FileInfos": [
          {
            "FileId": "",
            "Type": "Url",
            "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/demo/picture/2k_20251105956f542b.jpeg"
          }
        ],
        "GenerationMode": "",
        "ModelName": "Mingmou",
        "ModelVersion": "4.0",
        "NegativePrompt": "",
        "OutputConfig": {
          "AspectRatio": "",
          "ClassId": 0,
          "ExpireTime": "0000-00-00T00:00:00Z",
          "InputComplianceCheck": "",
          "MediaName": "",
          "OutputComplianceCheck": "",
          "PersonGeneration": "",
          "Resolution": ""
        },
        "Prompt": "她微笑的向我走来"
      },
      "Message": "",
      "Output": {
        "FileInfos": [
          {
            "ClassId": 0,
            "ExpireTime": "2025-12-16T12:34:22Z",
            "FileId": "",
            "FileType": "",
            "FileUrl": "http://251000800.vod2.myqcloud.com/1a168d62vodcq251000800/36c53c755145403708526326201/aigcImageGenFile.png",
            "MediaName": "",
            "MetaData": null,
            "StorageMode": "Temporary"
          }
        ]
      },
      "Progress": 100,
      "SessionContext": "",
      "SessionId": "",
      "Status": "FINISH",
      "TaskId": "1500044236-AigcImageTask-1602bdb6293ad48ff216744f3ee60232t"
    },
    "AigcVideoTask": null,
    "BeginProcessTime": "2025-12-09T12:33:23Z",
    "ClipTask": null,
    "ComplexAdaptiveDynamicStreamingTask": null,
    "ComposeMediaTask": null,
    "ConcatTask": null,
    "CreateImageSpriteTask": null,
    "CreateTime": "2025-12-09T12:33:23Z",
    "DescribeFileAttributesTask": null,
    "EditMediaTask": null,
    "ExtractCopyRightWatermarkTask": null,
    "ExtractTraceWatermarkTask": null,
    "FinishTime": "2025-12-09T12:33:42Z",
    "ProcedureTask": null,
    "ProcessMediaByMPSTask": null,
    "PullUploadTask": null,
    "QualityEnhanceTask": null,
    "QualityInspectTask": null,
    "RebuildMediaTask": null,
    "ReduceMediaBitrateTask": null,
    "RemoveWatermarkTask": null,
    "RequestId": "4846f66e-4fdc-4af0-ab28-b4d37bf3c854",
    "ReviewAudioVideoTask": null,
    "SnapshotByTimeOffsetTask": null,
    "SplitMediaTask": null,
    "Status": "FINISH",
    "TaskType": "AigcImageTask",
    "TranscodeTask": null,
    "WechatMiniProgramPublishTask": null,
    "WechatPublishTask": null
  }
}


3.4 AIGC 超分输出
当前在AIGC 场景下，客户可能会遇到如下场景
●1、AIGC如何输出大于1080P的视频（如2k、4k）
●2、1080P分辨率成本太高了，如何有效的节省成本
●3、AIGC生成的视频，画质貌似不太好，希望能够进一步增强
●等等问题，欢迎反馈

腾讯云为客户在视频场景下提供了基于超分增强的方案，帮助客户解决实际问题，具体思路如下：
① 模型直出一个低分辨率的视频，如720P
② 通过超分生成高分辨率的视频，如1080P、2k、4k
3.4.1 关键参数
通过搭配Resolution+EnhanceSwitch，帮助客户实现超分增强方案
对应文档
https://cloud.tencent.com/document/api/266/31773#AigcVideoOutputConfig


Resolution	String	否	生成视频的分辨率。
当 ModelName 是 Kling，可选值为 720P、1080P，默认为 720P；当 ModelName 是 Jimeng，可选值为 768P、1080P，默认为 768P；当 ModelName 是 Hailuo，可选值为 1080P；当 ModelName 是 Vidu，可选值为 720P、1080P，默认为 720P；当 ModelName 是 GV，可选值为 720P、1080P，默认为 720P；当 ModelName 是 OS，可选值为 720P；
说明：除模型可支持的分辨率外，还支持 2K、4K分辨率。
示例值：720P
EnhanceSwitch	String	否	是否启用视频增强。取值有：Enabled：开启；Disabled：关闭；
说明：
1. 对于选择的分辨率超过模型可生成分辨率时，默认会启用增强。
2. 对于模型可以直出的分辨率，也可以主动选择模型直出低分辨率，使用增强获得指定分辨率。
示例值：Disabled
3.4.2 策略说明
场景	Resolution	EnhanceSwitch	备注
如何通过超分生成1080P	1080P	Enabled	1、传参配置EnhanceSwitch = Enabled
2、大模型直出，720P
3、对720P的视频超分到1080P
如何通过超分生成2k、4k	2k、4k	默认开启	1、支持 2K、4K分辨率时
2、默认EnhanceSwitch = Enabled
3、模型直出一个最优的分辨率（默认按照模型支持的最高档进行直出，再超分）
① 如果选择的模型支持720P+1080P，则默认使用1080P
② 如果模型支持720P，则默认按照使用720P
暂时不支持指定模型直出的分辨率

3.4.3 JSON样例
3.4.3.2 通过超分输出1080P样例
{
        "SubAppId": 1500044236,
        "ModelName": "GV",
        "ModelVersion": "3.2",
        "FileInfos": [
            {
                "Type": "Url",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/demo/picture/logo_dji.webp"
            }
        ],
        "Prompt": "让文字飞起来",
        "EnhancePrompt": "Enabled",
        "OutputConfig": {
            "StorageMode": "Temporary",
            "Resolution": "1080P",
            "EnhanceSwitch": "Enabled"  #开启超分模式
        }
    }

3.4.3.3 输出高分辨率视频（2K、4K）
{
        "SubAppId": 1500044236,
        "ModelName": "GV",
        "ModelVersion": "3.2",
        "FileInfos": [
            {
                "Type": "Url",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/demo/picture/logo_dji.webp"
            }
        ],
        "Prompt": "微笑的向我走来",
        "EnhancePrompt": "Enabled",
        "OutputConfig": {
            "StorageMode": "Temporary",
            "Resolution": "2K"    #指定分辨率
        }
    }


3.5 动作控制 - Kling 
如果需要使用 3.0 版本的动作控制，则指定版本为 3.0；如需使用非 3.0 版本的动作控制，模型版本（ModelVersion）填写2.6。
https://app.klingai.com/cn/dev/document-api/apiReference/model/motionControl 
3.5.1 关键参数
参数值	类型	说明
FileInfos.N.Category	Array of https://cloud.tencent.com/document/api/266/31773#AigcVideoTaskInputFileInfo 	支持指定参考的文件类型
文件分类。取值为：
Image: 图片；
Video: 视频。
SceneType	String	场景类型。取值如下：
当 ModelName 为 Kling 时，取值 motion_control 表示动作控制；其他 ModelName 暂不支持。
示例值：motion_control
ExtInfo	JSON	额外参数可以通过 ExtInfo 指定，可参考可灵官方文档：https://app.klingai.com/cn/dev/document-api/apiReference/model/motionControl 

如果需要指定 keep_original_sound 或者 character_orientation，可以通过 ExtInfo 指定
{"AdditionalParameters":xxx}

●keep_original_sound:可选择是否保留视频原声

枚举值：yes，no
其中yes：保留视频原声
其中no：不保留视频原声

●character_orientation:生成视频中人物的朝向，可选择与图片一致或与视频一致

枚举值：image，video，其中：
其中image：与图片中人物朝向一致；此时参考视频时长不得超过10秒；
其中video：与视频中人物朝向一致；此时参考视频时长不得超过30秒；。
ExtInfo 参考
{"AdditionalParameters":"{\"keep_original_sound\":\"no\",\"character_orientation\":\"video\"}"}

3.5.2 Json数据
① 2.6 版本
{
        "SubAppId": 1500044236,
        "ModelName": "Kling",
        "ModelVersion": "2.6",
        "FileInfos": [
            {
                "Type": "Url",
                "Category": "Video",
                "Url": "https://1500013788.vod2.myqcloud.com/6cab4d43vodcq1500013788/b9bf1a495145403712730999249/vKeAsRYAm1cA.mp4"
            },
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://1500013788.vod2.myqcloud.com/6cab4d43vodcq1500013788/4087c38b5145403712732122005/f0.webp"
            }
        ],
        "Prompt": "参考视频生成一个新视频",
        "OutputConfig": {
            "StorageMode": "Temporary"
        },
        "SceneType": "motion_control",
        "ExtInfo": "{\"AdditionalParameters\":\"{\\\"keep_original_sound\\\":\\\"no\\\",\\\"character_orientation\\\":\\\"video\\\"}\"}"
    }


② 3.0 版本
{
        "SubAppId": 1500044236,
        "ModelName": "Kling",
        "ModelVersion": "3.0",
        "FileInfos": [
            {
                "Type": "Url",
                "Category": "Video",
                "Url": "https://1500013788.vod2.myqcloud.com/6cab4d43vodcq1500013788/b9bf1a495145403712730999249/vKeAsRYAm1cA.mp4"
            },
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://1500013788.vod2.myqcloud.com/6cab4d43vodcq1500013788/4087c38b5145403712732122005/f0.webp"
            }
        ],
        "Prompt": "参考视频生成一个新视频",
        "OutputConfig": {
            "StorageMode": "Temporary"
        },
        "SceneType": "motion_control",
        "ExtInfo": "{\"AdditionalParameters\":\"{\\\"keep_original_sound\\\":\\\"no\\\",\\\"character_orientation\\\":\\\"video\\\"}\"}"
    }

3.5.3 代码示例
●python
# -*- coding: utf-8 -*-

import os
import json
import types
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.vod.v20180717 import vod_client, models
try:
    # 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
    # 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
    # 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
    # 请参见：https://cloud.tencent.com/document/product/1278/85305
    # 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
    cred = credential.Credential(os.getenv("TENCENTCLOUD_SECRET_ID"), os.getenv("TENCENTCLOUD_SECRET_KEY"))
    # 使用临时密钥示例
    # cred = credential.Credential("SecretId", "SecretKey", "Token")
    # 实例化一个http选项，可选的，没有特殊需求可以跳过
    httpProfile = HttpProfile()
    httpProfile.endpoint = "vod.tencentcloudapi.com"

    # 实例化一个client选项，可选的，没有特殊需求可以跳过
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    # 实例化要请求产品的client对象,clientProfile是可选的
    client = vod_client.VodClient(cred, "", clientProfile)

    # 实例化一个请求对象,每个接口都会对应一个request对象
    req = models.CreateAigcVideoTaskRequest()
    params = {
        "SubAppId": 1500044236,
        "ModelName": "Kling",
        "ModelVersion": "2.6",
        "FileInfos": [
            {
                "Type": "Url",
                "Category": "Video",
                "Url": "https://1500013788.vod2.myqcloud.com/6cab4d43vodcq1500013788/b9bf1a495145403712730999249/vKeAsRYAm1cA.mp4"
            },
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://1500013788.vod2.myqcloud.com/6cab4d43vodcq1500013788/4087c38b5145403712732122005/f0.webp"
            }
        ],
        "Prompt": "参考视频生成一个新视频",
        "OutputConfig": {
            "StorageMode": "Temporary"
        },
        "SceneType": "motion_control",
        "ExtInfo": "{\"AdditionalParameters\":\"{\\\"keep_original_sound\\\":\\\"no\\\",\\\"character_orientation\\\":\\\"video\\\"}\"}"
    }
    req.from_json_string(json.dumps(params))

    # 返回的resp是一个CreateAigcVideoTaskResponse的实例，与请求对象对应
    resp = client.CreateAigcVideoTask(req)
    # 输出json格式的字符串回包
    print(resp.to_json_string())

except TencentCloudSDKException as err:
    print(err)

●Go

package main

import (
        "os"
        "fmt"

        "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common"
        "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common/errors"
        "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common/profile"
        vod "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/vod/v20180717"
)

func main() {
        // 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
        // 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
        // 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
        // 请参见：https://cloud.tencent.com/document/product/1278/85305
        // 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
        credential := common.NewCredential(
                os.Getenv("TENCENTCLOUD_SECRET_ID"),
                os.Getenv("TENCENTCLOUD_SECRET_KEY"),
        )
        // 使用临时密钥示例
        // credential := common.NewTokenCredential("SecretId", "SecretKey", "Token")
        // 实例化一个client选项，可选的，没有特殊需求可以跳过
        cpf := profile.NewClientProfile()
        cpf.HttpProfile.Endpoint = "vod.tencentcloudapi.com"
        // 实例化要请求产品的client对象,clientProfile是可选的
        client, _ := vod.NewClient(credential, "", cpf)

        // 实例化一个请求对象,每个接口都会对应一个request对象
        request := vod.NewCreateAigcVideoTaskRequest()
        
        request.SubAppId = common.Uint64Ptr(1500044236)
        request.ModelName = common.StringPtr("Kling")
        request.ModelVersion = common.StringPtr("3.0")
        request.FileInfos = []*vod.AigcVideoTaskInputFileInfo {
                &vod.AigcVideoTaskInputFileInfo {
                        Type: common.StringPtr("Url"),
                        Category: common.StringPtr("Video"),
                        Url: common.StringPtr("https://1500013788.vod2.myqcloud.com/6cab4d43vodcq1500013788/b9bf1a495145403712730999249/vKeAsRYAm1cA.mp4"),
                },
                &vod.AigcVideoTaskInputFileInfo {
                        Type: common.StringPtr("Url"),
                        Category: common.StringPtr("Image"),
                        Url: common.StringPtr("https://1500013788.vod2.myqcloud.com/6cab4d43vodcq1500013788/4087c38b5145403712732122005/f0.webp"),
                },
        }
        request.Prompt = common.StringPtr("参考视频生成一个新视频")
        request.OutputConfig = &vod.AigcVideoOutputConfig {
                StorageMode: common.StringPtr("Temporary"),
        }
        request.SceneType = common.StringPtr("motion_control")
        request.ExtInfo = common.StringPtr("{\"AdditionalParameters\":\"{\\\"keep_original_sound\\\":\\\"no\\\",\\\"character_orientation\\\":\\\"video\\\"}\"}")
        // 返回的resp是一个CreateAigcVideoTaskResponse的实例，与请求对象对应
        response, err := client.CreateAigcVideoTask(request)
        if _, ok := err.(*errors.TencentCloudSDKError); ok {
                fmt.Printf("An API error has returned: %s", err)
                return
        }
        if err != nil {
                panic(err)
        }
        // 输出json格式的字符串回包
        fmt.Printf("%s", response.ToJsonString())
} 

3.5.4 效果展示 
https://drive.weixin.qq.com/s?k=AJEAIQdfAAoafVWXMtAUUAAQaDAMY   https://drive.weixin.qq.com/s?k=AJEAIQdfAAoYuxIphkAUUAAQaDAMY 

3.6 对口型 - Kling 
与版本无关，模型版本（ModelVersion）随意填写一个

#keling对口型文档参考
https://app.klingai.com/cn/dev/document-api/apiReference/model/videoTolip

3.6.1 使用说明
https://doc.weixin.qq.com/flowchart-addon
先用通过人脸信息接口获取人脸信息，再调用AIGC 生视频接口生成视频
接口	说明
DescribeAigcFaceInfo	获取人脸信息，记录session_id、face_id等信息
CreateAigcVideoTask	通过ExiInfo接口传递对口型参数

3.6.2 关键参数
3.6.2.1 DescribeAigcFaceInfo
获取人脸信息
入参
参数值	类型	说明
FileInfos.N	Array of https://cloud.tencent.com/document/api/266/31773#AigcVideoTaskInputFileInfo 	支持指定参考文件，支持URL、Fileid
- 通过 FileInfos 指定视频信息；
示例：
{
    "SubAppId": 1500044236,
    "FileInfos": [
        {
            "Type": "Url",
            "Url": "https://1500013788.vod2.myqcloud.com/a288b1b2vodtranssh1500013788/ee8d47685145403714700322201/v.f100020.mp4"
        }
    ]
}


出参
{
  "Response": {
    "FaceInfoSet": [
      {
        "FaceInfoList": [
          {
            "StarTime": 0,//该人脸可对口型区间起点时间，可作为对口型最佳开始时间
            "FaceId": "string",//视频中的人脸ID；同一个人脸在视频中间隔超过1s时会视作不同ID
            "FaceImage": "url",//从视频中截图的人脸的示意图
            "StartTime": 5200  //该人脸可对口型区间终点时间；注：此结果存在毫秒级误差，会长于实际区间终点 
          }
        ],
        "SessionId": "847954711466119245" //会话ID，会基于视频初始化任务生成，不会随编辑选区行为而改变，有效期24小时
      }
    ],
    "RequestId": "d142c59a-8ce8-4fc0-9a2a-fcbc82a2e04e"
  }
}

3.6.2.2 CreateAigcVideoTask
入参
参数值	类型	说明
FileInfos	Array of https://cloud.tencent.com/document/api/266/31773#AigcVideoTaskInputFileInfo 	在对口型场景下，该参数不需要赋值，其中
1.音频文件：在ExtInfo中指定
2.视频文件：在ExtInfo中指定session_id，会基于对口型人脸识别接口生成
SceneType	String	场景类型。取值如下：
当 ModelName 为 Kling 时，取值 lip_sync 表示对口型；Prompt 可以写入「对口型」，实际不起作用；其他 ModelName 暂不支持。
示例值： lip_sync
ExtInfo	JSON	 额外参数可以通过 ExtInfo 指定，可参考可灵官方文档：Kling AI: Next-Gen AI Video & AI Image Generator

格式：
{"AdditionalParameters":xxx}

关键参数
●session_id
会话ID，会基于对口型人脸识别接口生成
●face_choose
指定人脸对口型
包括人脸ID、口型参考等内容等
暂时仅支持指定单人对口型

具体传参，参考下面的用例
{
  "SubAppId": 1500013788,
  "ModelName": "Kling",
  "ModelVersion": "2.6",
  "Prompt": "对口型",
  "SceneType": "lip_sync",
    "ExtInfo": "{\"AdditionalParameters\":\"{\\\"session_id\\\":\\\"845736590818832460\\\",\\\"face_choose\\\":[{\\\"face_id\\\":0,\\\"sound_file\\\":\\\"https://1500013788.vod2.myqcloud.com/a288b1b2vodtranssh1500013788/295a189b5145403714698046012/v.f1010.mp3\\\",\\\"sound_start_time\\\":0,\\\"sound_end_time\\\":5000,\\\"sound_insert_time\\\":2000,\\\"sound_volume\\\":2,\\\"original_audio_volume\\\":0}]}\"}"
}


出参
{
  "Response": {
    "RequestId": "73a0d0e5-24ed-4b76-8a0b-0fa64d67fe76",
    "TaskId": "1500044236-AigcVideoTask-01c9f0fc8e3940f8abc0be748b021966t"
  }
}


3.6.3 代码示例
3.6.3.1 DescribeAigcFaceInfo
# -*- coding: utf-8 -*-

import os
import json
import types
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.vod.v20180717 import vod_client, models
try:
    # 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
    # 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
    # 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
    # 请参见：https://cloud.tencent.com/document/product/1278/85305
    # 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
    cred = credential.Credential(os.getenv("TENCENTCLOUD_SECRET_ID"), os.getenv("TENCENTCLOUD_SECRET_KEY"))
    # 使用临时密钥示例
    # cred = credential.Credential("SecretId", "SecretKey", "Token")
    # 实例化一个http选项，可选的，没有特殊需求可以跳过
    httpProfile = HttpProfile()
    httpProfile.endpoint = "vod.tencentcloudapi.com"

    # 实例化一个client选项，可选的，没有特殊需求可以跳过
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    # 实例化要请求产品的client对象,clientProfile是可选的
    client = vod_client.VodClient(cred, "", clientProfile)

    # 实例化一个请求对象,每个接口都会对应一个request对象
    req = models.DescribeAigcFaceInfoRequest()
    params = {
        "SubAppId": 1500044236,
        "FileInfos": [
            {
                "Type": "Url",
                "Url": "https://1500013788.vod2.myqcloud.com/a288b1b2vodtranssh1500013788/ee8d47685145403714700322201/v.f100020.mp4"
            }
        ]
    }
    req.from_json_string(json.dumps(params))

    # 返回的resp是一个DescribeAigcFaceInfoResponse的实例，与请求对象对应
    resp = client.DescribeAigcFaceInfo(req)
    # 输出json格式的字符串回包
    print(resp.to_json_string())

except TencentCloudSDKException as err:
    print(err)


结果输出
{
  "Response": {
    "FaceInfoSet": [
      {
        "FaceInfoList": [
          {
            "EndTime": 8300,
            "FaceId": "0",
            "FaceImage": "https://p2-fdl.klingai.com/ksc2/K48Vaix-MLHCqJW75gYfA2MYXLgVMpQTYUjeBnl8VDjOhBZ0TIPcSzp29Hh1AaeRBJyJhKihb0qy9A7XPSUsqr6oSj3625VlR4xAtjyX5NI.jpg?cacheKey=ChtzZWN1cml0eS5rbGluZy5tZXRhX2VuY3J5cHQSYF8kPUcHVlYPFVuhMRmjeJTm82nFSf9HzJ3mD24rkTIIVMnt-AZpDRgan0_L1sTNYRHxxxRzIlsD-X2Wb7vBMjGSlih0JPvmWDqUJNb7HDyhGuaslrMQIuSFWEddx7JWFxoSLL46pEJbTw3u2hySdPDYoj5mIiBb-SVYju6JmLu_gqM6b2ofISkdxs9kSCxv2r1lko97ZSgFMAE&x-kcdn-pid=112757&pkey=AAVXqgK0KA-R4jzcvoEefMz4Lw8lf4vUxSYuUmmQ_u_OtiT-ANLcLmTuiYFPu3iE1jOwZ40TFMpIzqIoh5BlGVfieHOJZGR73t802w2Egml4ft-l1sYMPycBIoKsH_xW68c",
            "StartTime": 0
          }
        ],
        "SessionId": "847865160428957783"
      }
    ],
    "RequestId": "0807c733-b107-420e-9d45-ad3f065dd4e0"
  }
}

3.6.3.2 CreateAigcVideoTask
# -*- coding: utf-8 -*-

import os
import json
import types
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.vod.v20180717 import vod_client, models
try:
    # 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
    # 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
    # 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
    # 请参见：https://cloud.tencent.com/document/product/1278/85305
    # 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
    cred = credential.Credential(os.getenv("TENCENTCLOUD_SECRET_ID"), os.getenv("TENCENTCLOUD_SECRET_KEY"))
    # 使用临时密钥示例
    # cred = credential.Credential("SecretId", "SecretKey", "Token")
    # 实例化一个http选项，可选的，没有特殊需求可以跳过
    httpProfile = HttpProfile()
    httpProfile.endpoint = "vod.tencentcloudapi.com"

    # 实例化一个client选项，可选的，没有特殊需求可以跳过
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    # 实例化要请求产品的client对象,clientProfile是可选的
    client = vod_client.VodClient(cred, "", clientProfile)

    # 实例化一个请求对象,每个接口都会对应一个request对象
    req = models.CreateAigcVideoTaskRequest()
    params = {
        "SubAppId": 1500044236,
        "ModelName": "Kling",
        "ModelVersion": "2.6",
        "Prompt": "对口型",
        "SceneType": "lip_sync",
        "ExtInfo": "{\"AdditionalParameters\":\"{\\\"session_id\\\":\\\"847954711466119245\\\",\\\"face_choose\\\":[{\\\"face_id\\\":0,\\\"sound_file\\\":\\\"https://1500013788.vod2.myqcloud.com/a288b1b2vodtranssh1500013788/295a189b5145403714698046012/v.f1010.mp3\\\",\\\"sound_start_time\\\":0,\\\"sound_end_time\\\":5000,\\\"sound_insert_time\\\":2000,\\\"sound_volume\\\":2,\\\"original_audio_volume\\\":0}]}\"}"
    }
    req.from_json_string(json.dumps(params))

    # 返回的resp是一个CreateAigcVideoTaskResponse的实例，与请求对象对应
    resp = client.CreateAigcVideoTask(req)
    # 输出json格式的字符串回包
    print(resp.to_json_string())

except TencentCloudSDKException as err:
    print(err)


结果输出
{
  "Response": {
    "RequestId": "73a0d0e5-24ed-4b76-8a0b-0fa64d67fe76",
    "TaskId": "1500044236-AigcVideoTask-01c9f0fc8e3940f8abc0be748b021966t"
  }
}

3.6.4 效果展示
https://drive.weixin.qq.com/s?k=AJEAIQdfAAo0FgfwW4AUUAAQaDAMY  https://drive.weixin.qq.com/s?k=AJEAIQdfAAoLV1O49WAUUAAQaDAMY 
3.7 数字人 - Kling 
与版本无关，模型版本（ModelVersion）随意填写一个

3.7.1 关键参数
入参
参数值	类型	说明
FileInfos.N	Array of https://cloud.tencent.com/document/api/266/31773#AigcVideoTaskInputFileInfo 	1.图片文件：通过参数 FileInfos 指定图片
●Category ：指定类型 "Image"

2. 音频文件在 ExtInfo 中指定
SceneType	String	场景类型。取值如下：
当 ModelName 为 Kling 时，取值 avatar_i2v表示对口型；其他 ModelName 暂不支持。
示例值： avatar_i2v
ExtInfo	JSON	额外参数可以通过 ExtInfo 指定，可参考可灵官方文档：Kling AI: Next-Gen AI Video & AI Image Generator

格式：
{"AdditionalParameters":xxx}

关键参数
●sound_file
支持传入音频Base64编码或图音频URL（确保可访问）
音频文件支持.mp3/.wav/.m4a/.aac，文件大小不超过5MB，格式不匹配或文件过大会返回错误码等信息
仅支持使用时长不短于2秒且不长于300秒的音频
audio_id、sound_file参数二选一，不能同时为空，也不能同时有值
系统会校验音频内容，如有问题会返回错误码等信息
{
        "SubAppId": 1500044236,
        "ModelName": "Kling",
        "ModelVersion": "2.6",
        "FileInfos": [
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://1500013788.vod2.myqcloud.com/6cab4d43vodcq1500013788/3e6249c25145403714718180954/AhAzYF7bRWAA.png"
            }
        ],
        "Prompt": "dance",
        "SceneType": "avatar_i2v",
        "ExtInfo": "{\"AdditionalParameters\":\"{\\\"sound_file\\\":\\\"https://1500013788.vod2.myqcloud.com/6cab4d43vodcq1500013788/ff554e3c5145403714717771043/WxiOtKmdUnEA.mp3\\\"}\"}"
    }

出参
{
  "Response": {
    "RequestId": "e4e1406d-7c5c-4424-9262-af830d85c45e",
    "TaskId": "1500044236-AigcVideoTask-f74af07438016e57560d94d315c79474t"
  }
}


3.7.2 代码示例
# -*- coding: utf-8 -*-

import os
import json
import types
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.vod.v20180717 import vod_client, models
try:
    # 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
    # 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
    # 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
    # 请参见：https://cloud.tencent.com/document/product/1278/85305
    # 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
    cred = credential.Credential(os.getenv("TENCENTCLOUD_SECRET_ID"), os.getenv("TENCENTCLOUD_SECRET_KEY"))
    # 使用临时密钥示例
    # cred = credential.Credential("SecretId", "SecretKey", "Token")
    # 实例化一个http选项，可选的，没有特殊需求可以跳过
    httpProfile = HttpProfile()
    httpProfile.endpoint = "vod.tencentcloudapi.com"

    # 实例化一个client选项，可选的，没有特殊需求可以跳过
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    # 实例化要请求产品的client对象,clientProfile是可选的
    client = vod_client.VodClient(cred, "", clientProfile)

    # 实例化一个请求对象,每个接口都会对应一个request对象
    req = models.CreateAigcVideoTaskRequest()
    params = {
        "SubAppId": 1500044236,
        "ModelName": "Kling",
        "ModelVersion": "2.6",
        "FileInfos": [
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://1500013788.vod2.myqcloud.com/6cab4d43vodcq1500013788/3e6249c25145403714718180954/AhAzYF7bRWAA.png"
            }
        ],
        "Prompt": "dance",
        "SceneType": "avatar_i2v",
        "ExtInfo": "{\"AdditionalParameters\":\"{\\\"sound_file\\\":\\\"https://1500013788.vod2.myqcloud.com/6cab4d43vodcq1500013788/ff554e3c5145403714717771043/WxiOtKmdUnEA.mp3\\\"}\"}"
    }
    req.from_json_string(json.dumps(params))

    # 返回的resp是一个CreateAigcVideoTaskResponse的实例，与请求对象对应
    resp = client.CreateAigcVideoTask(req)
    # 输出json格式的字符串回包
    print(resp.to_json_string())

except TencentCloudSDKException as err:
    print(err)


结果输出
{
  "Response": {
    "RequestId": "e4e1406d-7c5c-4424-9262-af830d85c45e",
    "TaskId": "1500044236-AigcVideoTask-f74af07438016e57560d94d315c79474t"
  }
}


3.7.3 效果展示
https://drive.weixin.qq.com/s?k=AJEAIQdfAAooy5p18UAUUAAQaDAMY 
3.8 特效模板 - Vidu
与版本无关，模型版本（ModelVersion）随意填写一个
3.8.1 关键参数
入参
参数值	类型	说明
FileInfos.N	Array of https://cloud.tencent.com/document/api/266/31773#AigcVideoTaskInputFileInfo 	1.图片文件：通过参数 FileInfos 指定图片
●Category ：指定类型 "Image"
SceneType	String	场景类型。取值如下：
当 ModelName 为 Vidu 时，取值 template_effect表示特效模板；其他 ModelName 暂不支持。
示例值： template_effect
ExtInfo	JSON	额外参数可以通过 ExtInfo 指定，可参考 Vidu 官方文档Vidu API - 特效模板


格式：
{"AdditionalParameters":xxx}

示例中使用「爆炸」模版 morphlab，其他特效模板可参考下面售卖

关键参数
●template
场景模版参数
不同的场景模板，对应的调用参数不同，我们提供两种查看方式：
●官方示例中心：https://platform.vidu.cn/docs/templates 
●在线文档文档（支持按上线时间查询）：https://shengshu.feishu.cn/wiki/L2Dbwi7QeilCAgkdJKjcrj2Lnrg?from=from_copylink 
{
        "SubAppId": 1500044236,
        "ModelName": "Vidu",
        "ModelVersion": "q2-turbo",
        "FileInfos": [
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://image01.vidu.zone/vidu/example/20241206-175531.jpeg"
            }
        ],
        "Prompt": "视频内容\\n画面开始主体突然爆炸，细碎的颗粒爆炸开来\\n# 要求\\n1.根据用户上传图片确定主体数量,每个主体都要爆炸\\n2.Motion Level 设定为:Middle\\n3.以>我的视频内容为第一要素，背景的描述统一、合理，不要描述两次.",
        "SceneType": "template_effect",
        "ExtInfo": "{\"AdditionalParameters\":\"{\\\"template\\\":\\\"morphlab\\\"}\"}"
    }

出参
{
  "Response": {
    "RequestId": "e4e1406d-7c5c-4424-9262-af830d85c45e",
    "TaskId": "1500044236-AigcVideoTask-f74af07438016e57560d94d315c79474t"
  }
}


3.8.2 代码示例
# -*- coding: utf-8 -*-

import os
import json
import types
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.vod.v20180717 import vod_client, models
try:
    # 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
    # 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
    # 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
    # 请参见：https://cloud.tencent.com/document/product/1278/85305
    # 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
    cred = credential.Credential(os.getenv("TENCENTCLOUD_SECRET_ID"), os.getenv("TENCENTCLOUD_SECRET_KEY"))
    # 使用临时密钥示例
    # cred = credential.Credential("SecretId", "SecretKey", "Token")
    # 实例化一个http选项，可选的，没有特殊需求可以跳过
    httpProfile = HttpProfile()
    httpProfile.endpoint = "vod.tencentcloudapi.com"

    # 实例化一个client选项，可选的，没有特殊需求可以跳过
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    # 实例化要请求产品的client对象,clientProfile是可选的
    client = vod_client.VodClient(cred, "", clientProfile)

    # 实例化一个请求对象,每个接口都会对应一个request对象
    req = models.CreateAigcVideoTaskRequest()
    params = {
        "SubAppId": 1500044236,
        "ModelName": "Vidu",
        "ModelVersion": "q2-turbo",
        "FileInfos": [
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://image01.vidu.zone/vidu/example/20241206-175531.jpeg"
            }
        ],
        "Prompt": "视频内容\\n画面开始主体突然爆炸，细碎的颗粒爆炸开来\\n# 要求\\n1.根据用户上传图片确定主体数量,每个主体都要爆炸\\n2.Motion Level 设定为:Middle\\n3.以>我的视频内容为第一要素，背景的描述统一、合理，不要描述两次.",
        "SceneType": "template_effect",
        "ExtInfo": "{\"AdditionalParameters\":\"{\\\"template\\\":\\\"morphlab\\\"}\"}"
    }
    req.from_json_string(json.dumps(params))

    # 返回的resp是一个CreateAigcVideoTaskResponse的实例，与请求对象对应
    resp = client.CreateAigcVideoTask(req)
    # 输出json格式的字符串回包
    print(resp.to_json_string())

except TencentCloudSDKException as err:
    print(err)


结果输出
{
  "Response": {
    "RequestId": "5c0aeb9f-6097-4b3e-8932-7264331575a2",
    "TaskId": "1500044236-AigcVideoTask-9f079c580c5f4382fbb240c8565609bbt"
  }
}

3.8.3 效果展示
https://drive.weixin.qq.com/s?k=AJEAIQdfAAo5sNpXpTAUUAAQaDAMY 

3.9 Kling 3.0 & 3.0-Omni（生视频）接入说明
3.9.1 模型能力
kling-v3-omni	std（3s～15s）	pro（3s～15s）
文生视频	单镜头视频生成	✅	✅
	多镜头视频生成	✅	✅
	声音控制（指定音色）	❌	❌
	其他	-	-
图生视频	单镜头视频生成	✅	✅
	多镜头视频生成	✅	✅
	首尾帧（一镜到底）	✅	✅
	主体控制
（视频角色主体+多图主体）	✅	✅
	视频参考	✅（仅3s～10s）	✅（仅3s～10s）
	声音控制（指定音色）	❌	❌
	其他	-	-

kling-v3	std（3～15s）	pro（3～15s）
文生视频	单镜头视频生成	✅	✅
	多镜头视频生成	✅	✅
	声音控制（指定音色）	❌	❌
	其他	-	-
图生视频	单镜头视频生成（仅首帧）	✅	✅
	多镜头视频生成	✅	✅
	首尾帧（一镜到底）	✅	✅
	主体控制
（视频角色主体+多图主体）	✅	✅
	动作控制	（即将上线）	（即将上线）
	声音控制（指定音色）	❌	❌
	其他	-	-

3.9.2 文生/参考图生视频（通用）
！说明：
1）若FileInfos只传入一张图的情况下，默认是参考首帧生视频，此时搭配LastFrameFileId 或者 LastFrameUrl 表示尾帧）实现参考首尾帧生视频；在此模式下无法指定视频的长宽比、分辨率等信息会直接参考首帧
2）若希望实现参考生视频：①若FileInfos只传入一张图的情况下，需要指定ObjectId为非空，实现参考生视频，可指定长宽比、分辨率等参数；多图情况下，默认参考生视频。
如下提供示例
① JSON实例 - 单图参考生视频
{
        "SubAppId": 1500044236,
        "ModelName": "Kling",
        "ModelVersion": "3.0",
        "FileInfos": [
            {
                "Type": "Url",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/demo/picture/2k_20251105956f542b.jpeg",
                "Usage":"Reference"    
            }
        ],
        "Prompt": "微笑的向我走来",
        "EnhancePrompt": "Enabled",
        "OutputConfig": {
            "StorageMode": "Temporary",
            "Resolution": "1080P"    #std -- 720P,pro -- 1080P,Omni -- 4K
        }
    }


② JSON实例 - 多图参考生视频
{
        "SubAppId": 1500044236,
        "ModelName": "Kling",
        "ModelVersion": "3.0",
        "FileInfos": [
            {
                "Type": "Url",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/demo/picture/2k_20251105956f542b.jpeg",
            },
            {
                "Type": "Url",
                "Url": "https://1500013788.vod2.myqcloud.com/6cab4d43vodcq1500013788/3e6249c25145403714718180954/AhAzYF7bRWAA.png",
            }
        ],
        "Prompt": "微笑的向我走来",
        "EnhancePrompt": "Enabled",
        "OutputConfig": {
            "StorageMode": "Temporary",
            "Resolution": "1080P"
        }
    }


③ 代码参考
●Python
# -*- coding: utf-8 -*-

import os
import json
import types
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.vod.v20180717 import vod_client, models
try:
    # 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
    # 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
    # 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
    # 请参见：https://cloud.tencent.com/document/product/1278/85305
    # 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
    cred = credential.Credential(os.getenv("TENCENTCLOUD_SECRET_ID"), os.getenv("TENCENTCLOUD_SECRET_KEY"))
    # 使用临时密钥示例
    # cred = credential.Credential("SecretId", "SecretKey", "Token")
    # 实例化一个http选项，可选的，没有特殊需求可以跳过
    httpProfile = HttpProfile()
    httpProfile.endpoint = "vod.tencentcloudapi.com"

    # 实例化一个client选项，可选的，没有特殊需求可以跳过
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    # 实例化要请求产品的client对象,clientProfile是可选的
    client = vod_client.VodClient(cred, "", clientProfile)

    # 实例化一个请求对象,每个接口都会对应一个request对象
    req = models.CreateAigcVideoTaskRequest()
    params = {
        "SubAppId": 1500044236,
        "ModelName": "Kling",
        "ModelVersion": "3.0",
        "FileInfos": [
            {
                "Type": "Url",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/demo/picture/2k_20251105956f542b.jpeg",
                "ObjectId":"image"
            }
        ],
        "Prompt": "微笑的向我走来",
        "EnhancePrompt": "Enabled",
        "OutputConfig": {
            "StorageMode": "Temporary",
            "Resolution": "1080P"
        }
    }
    req.from_json_string(json.dumps(params))

    # 返回的resp是一个CreateAigcVideoTaskResponse的实例，与请求对象对应
    resp = client.CreateAigcVideoTask(req)
    # 输出json格式的字符串回包
    print(resp.to_json_string())

except TencentCloudSDKException as err:
    print(err)

●Java

package com.tencent;
import com.tencentcloudapi.common.AbstractModel;

import com.tencentcloudapi.common.Credential;
import com.tencentcloudapi.common.profile.ClientProfile;
import com.tencentcloudapi.common.profile.HttpProfile;
import com.tencentcloudapi.common.exception.TencentCloudSDKException;
import com.tencentcloudapi.vod.v20180717.VodClient;
import com.tencentcloudapi.vod.v20180717.models.*;

public class Sample
{
    public static void main(String [] args) {
        try{
            // 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
            // 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
            // 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
            // 请参见：https://cloud.tencent.com/document/product/1278/85305
            // 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
            Credential cred = new Credential(System.getenv("TENCENTCLOUD_SECRET_ID"), System.getenv("TENCENTCLOUD_SECRET_KEY"));
            // 使用临时密钥示例
            // Credential cred = new Credential("SecretId", "SecretKey", "Token");
            // 实例化一个http选项，可选的，没有特殊需求可以跳过
            HttpProfile httpProfile = new HttpProfile();
            httpProfile.setEndpoint("vod.tencentcloudapi.com");
            // 实例化一个client选项，可选的，没有特殊需求可以跳过
            ClientProfile clientProfile = new ClientProfile();
            clientProfile.setHttpProfile(httpProfile);
            // 实例化要请求产品的client对象,clientProfile是可选的
            VodClient client = new VodClient(cred, "", clientProfile);
            // 实例化一个请求对象,每个接口都会对应一个request对象
            CreateAigcVideoTaskRequest req = new CreateAigcVideoTaskRequest();
            req.setSubAppId(1500044236L);
            req.setModelName("Kling");
            req.setModelVersion("3.0");

            AigcVideoTaskInputFileInfo[] aigcVideoTaskInputFileInfos1 = new AigcVideoTaskInputFileInfo[1];
            AigcVideoTaskInputFileInfo aigcVideoTaskInputFileInfo1 = new AigcVideoTaskInputFileInfo();
            aigcVideoTaskInputFileInfo1.setType("Url");
            aigcVideoTaskInputFileInfo1.setUrl("https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/demo/picture/2k_20251105956f542b.jpeg");
            aigcVideoTaskInputFileInfos1[0] = aigcVideoTaskInputFileInfo1;

            req.setFileInfos(aigcVideoTaskInputFileInfos1);

            req.setPrompt("微笑的向我走来");
            req.setEnhancePrompt("Enabled");
            AigcVideoOutputConfig aigcVideoOutputConfig1 = new AigcVideoOutputConfig();
            aigcVideoOutputConfig1.setStorageMode("Temporary");
            aigcVideoOutputConfig1.setResolution("1080P");
            req.setOutputConfig(aigcVideoOutputConfig1);

            // 返回的resp是一个CreateAigcVideoTaskResponse的实例，与请求对象对应
            CreateAigcVideoTaskResponse resp = client.CreateAigcVideoTask(req);
            // 输出json格式的字符串回包
            System.out.println(AbstractModel.toJsonString(resp));
        } catch (TencentCloudSDKException e) {
            System.out.println(e.toString());
        }
    }
}

④ 结果输出
{
  "Response": {
    "RequestId": "e648a38f-8f1f-4196-ae5f-f31e108a2054",
    "TaskId": "1500044236-AigcVideoTask-8d0891f7746573e3658e6ca1e4dff527t"
  }
}

3.9.3 首帧或者首尾帧生视频
模式	使用方式
首帧生视频	1、方式1（推荐）：使用FileInfos.Usage参数，"Usage":"FirstFrame"
2、方式2：当在FileInfos只有一张图片，且该图片未传ObjectId参数时，表示参考首帧生视频
参考首尾帧生视频	1、方式1（推荐）：
1）首帧：使用FileInfos.Usage参数，"Usage":"FirstFrame"
2）尾帧：LastFrameFileId 或者 LastFrameUrl 表示尾帧，实现参考首尾帧
2、方式2：当在FileInfos只有一张图片，同时指定LastFrameFileId 或者 LastFrameUrl 表示尾帧，实现参考首尾帧
① JSON示例 - 参考首帧
{
        "SubAppId": 1500044236,
        "ModelName": "Kling",
        "ModelVersion": "3.0",
        "FileInfos": [
            {
                "Type": "Url",
                "Usage":"FirstFrame",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/demo/picture/2k_20251105956f542b.jpeg",
            }
        ],
        "Prompt": "微笑的向我走来",
        "EnhancePrompt": "Enabled",
        "OutputConfig": {
            "StorageMode": "Temporary",
            "Resolution": "1080P"
        }
    }

② JSON示例 - 参考首尾帧
{
        "SubAppId": 1500044236,
        "ModelName": "Kling",
        "ModelVersion": "3.0",
        "FileInfos": [
            {
                "Type": "Url",
                "Usage":"FirstFrame",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/demo/picture/2k_20251105956f542b.jpeg",
            }
        ],
        "LastFrameUrl":"https://1500013788.vod2.myqcloud.com/6cab4d43vodcq1500013788/3e6249c25145403714718180954/AhAzYF7bRWAA.png"
        "Prompt": "微笑的向我走来",
        "EnhancePrompt": "Enabled",
        "OutputConfig": {
            "StorageMode": "Temporary",
            "Resolution": "1080P"
        }
    }


③ 代码参考
# -*- coding: utf-8 -*-

import os
import json
import types
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.vod.v20180717 import vod_client, models
try:
    # 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
    # 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
    # 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
    # 请参见：https://cloud.tencent.com/document/product/1278/85305
    # 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
    cred = credential.Credential(os.getenv("TENCENTCLOUD_SECRET_ID"), os.getenv("TENCENTCLOUD_SECRET_KEY"))
    # 使用临时密钥示例
    # cred = credential.Credential("SecretId", "SecretKey", "Token")
    # 实例化一个http选项，可选的，没有特殊需求可以跳过
    httpProfile = HttpProfile()
    httpProfile.endpoint = "vod.tencentcloudapi.com"

    # 实例化一个client选项，可选的，没有特殊需求可以跳过
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    # 实例化要请求产品的client对象,clientProfile是可选的
    client = vod_client.VodClient(cred, "", clientProfile)

    # 实例化一个请求对象,每个接口都会对应一个request对象
    req = models.CreateAigcVideoTaskRequest()
    params = {
        "SubAppId": 1500044236,
        "ModelName": "Kling",
        "ModelVersion": "3.0",
        "FileInfos": [
            {
                "Type": "Url",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/demo/picture/2k_20251105956f542b.jpeg",
            }
        ],
        "Prompt": "微笑的向我走来",
        "EnhancePrompt": "Enabled",
        "OutputConfig": {
            "StorageMode": "Temporary",
            "Resolution": "1080P"
        }
    }
    req.from_json_string(json.dumps(params))

    # 返回的resp是一个CreateAigcVideoTaskResponse的实例，与请求对象对应
    resp = client.CreateAigcVideoTask(req)
    # 输出json格式的字符串回包
    print(resp.to_json_string())

except TencentCloudSDKException as err:
    print(err)


④ 结果输出
{
  "Response": {
    "RequestId": "e648a38f-8f1f-4196-ae5f-f31e108a2054",
    "TaskId": "1500044236-AigcVideoTask-8d0891f7746573e3658e6ca1e4dff527t"
  }
}


3.9.4 Kling主体/参考生视频
如下图，kling在prompt中可以通过<<<>>>引用图像列表、element（主体）列表、视频列表，因此，需要给有字段传这些列表。


3.9.4.1 使用视频（video_list）和图片列表（image_list）进行主体参考
① 参数说明
1、视频（video_list）和图片列表（image_list）可以通过FileInfos传入，使用Category参数区分不同类型。
注意，video可以传入可作为特征参考视频和待编辑视频，和主体不一样。
2、在参考时使用<<<>>>符号进行引入
3、根据视频和图片的index，可灵定义参考主体为
<<<image_1>>>、<<<image_2>>>、以此类推
<<<video_1>>>、<<<video_2>>>、以此类推
https://cloud.tencent.com/document/api/266/31773#AigcVideoTaskInputFileInfo


参数名称	必选	类型	描述
FileInfos	否	Array of https://cloud.tencent.com/document/api/266/31773#AigcVideoTaskInputFileInfo 	用于描述模型在生成视频时要使用的资源文件。
AigcVideoTaskInputFileInfo
AIGC 生视频任务输入的图片文件信息。

说明：
● 参考图片数量与有无参考视频、参考主体数量有关，其中：
	○ 有参考视频时，参考图片数量和参考主体数量之和不得超过4；
	○ 无参考视频时，参考图片数量和参考主体数量之和不得超过7；
	○ 参考图片数量超过2时，不支持设置尾帧；
名称	类型	必选	描述
Type	String	否	输入的视频文件类型。取值有：File：点播媒体文件；Url：可访问的 Url；
示例值：File
Category	String	否	文件分类。取值为：
Image: 图片；Video: 视频。
示例值：Image
FileId	String	否	媒体文件 ID，即该文件在云点播上的全局唯一标识符，在上传成功后由云点播后台分配。可以在 https://cloud.tencent.com/document/product/266/7830  或 https://console.cloud.tencent.com/vod/media  获取该字段。当 Type 取值为 File 时，本参数有效。说明：
1. 推荐使用小于10M的图片；
2. 图片格式的取值为：jpeg，jpg, png。
示例值：3704211***509819
Url	String	否	可访问的文件 URL。当 Type 取值为 Url 时，本参数有效。
说明：
1. 推荐使用小于10M的图片；
2. 图片格式的取值为：jpeg，jpg, png。
示例值：https://test.com/1.png
ReferenceType	String	否	参考类型，GV模型适用。
注意：
当使用 GV 模型时，可作为参考方式，可选值：asset 表示素材、style 表示风格；
当使用 Kling 模型以及 Category 为 Video 时，可区分参考视频类型，feature 表示特征参考视频，base 表示待编辑视频。
示例值：asset
ObjectId	String	否	主体 Id。
当需要对图片标识主体时，需要每个图片都带主体 Id，当 Category 为 Image 时有效。
1、VIdu，后续生成时可以通过@主体 Id 的方式使用。
2、Kling，Object不为空时表示使用参考生视频，在prompt中使用<<<>>>进行引用
示例值：obj1
VoiceId	String	否	适用于 Vidu-q2 模型。
当全部图片携带主体 Id 时，可针对主体设置音色 Id。 当 Category 为 Image 时有效。音色列表：https://shengshu.feishu.cn/sheets/EgFvs6DShhiEBStmjzccr5gonOg
示例值：male-qn-qingse
KeepOriginalSound	String	否	是否保留视频原声。当 Category 为 Video 时有效。取值如下：
Enabled：保留Disabled：不保留
示例值：Enabled
"FileInfos": [
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/picture/input/f0.jpeg",
                "ObjectId": "id1"
            },
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/picture/input/f1.jpeg",
                "ObjectId": "id2"
            }
        ]


② JSON用例
●示例1：单图参考
{
  "SubAppId": 1500044236,
  "ModelName": "Kling",
  "ModelVersion": "3.0-Omni",
  "FileInfos": [
    {
      "Url": "https://cdn.jeff1992.com/ai-video/2026/01/16/gxewii_1768561064567.png",
      "Type": "Url",
      "ObjectId": "image"
    }
  ],
  "OutputConfig": {
    "Duration": 8,
    "StorageMode": "Temporary",
    "AspectRatio": "16:9",
    "AudioGeneration": "Disabled",
    "Resolution": "1080P"
  },
  "ExtInfo": "{\"AdditionalParameters\":\"{\\\"multi_shot\\\":false}\"}",
  "Prompt": "参考<<<image_1>>>，二维动漫风，特写镜头，黑衣红发男人不停说话，随后嘴角一抹微笑，夜晚，校道，黑衣红发男人转身，对天空张开双臂，最后画面定格在黑衣红发男人的侧脸"
}


●实例2：多图参考
{
        "SubAppId": 1500044236,
        "ModelName": "Kling",
        "ModelVersion": "3.0-Omni",
        "FileInfos": [
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/picture/input/f0.jpeg",
                "ObjectId": "id1"
            },
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/picture/input/f1.jpeg",
                "ObjectId": "id2"
            }
        ],
        "Prompt": "让 <<<image_1>>> 牵着 <<<image_2>>> 转圈圈",
       "OutputConfig": {
            "Duration": 8,
            "StorageMode": "Temporary",
            "AspectRatio": "16:9",
            "AudioGeneration": "Disabled",
            "Resolution": "1080P"
          },
    }


③ 代码实例
●Python
# -*- coding: utf-8 -*-

import os
import json
import types
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.vod.v20180717 import vod_client, models
try:
    # 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
    # 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
    # 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
    # 请参见：https://cloud.tencent.com/document/product/1278/85305
    # 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
    cred = credential.Credential(os.getenv("TENCENTCLOUD_SECRET_ID"), os.getenv("TENCENTCLOUD_SECRET_KEY"))
    # 使用临时密钥示例
    # cred = credential.Credential("SecretId", "SecretKey", "Token")
    # 实例化一个http选项，可选的，没有特殊需求可以跳过
    httpProfile = HttpProfile()
    httpProfile.endpoint = "vod.tencentcloudapi.com"

    # 实例化一个client选项，可选的，没有特殊需求可以跳过
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    # 实例化要请求产品的client对象,clientProfile是可选的
    client = vod_client.VodClient(cred, "", clientProfile)

    # 实例化一个请求对象,每个接口都会对应一个request对象
    req = models.CreateAigcVideoTaskRequest()
    params = {
        "SubAppId": 1500044236,
        "ModelName": "Kling",
        "ModelVersion": "3.0-Omni",
        "FileInfos": [
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/picture/input/f0.jpeg",
                "ObjectId": "id1"
            },
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/picture/input/f1.jpeg",
                "ObjectId": "id2"
            }
        ],
        "Prompt": "让 <<<image_1>>> 牵着 <<<image_2>>> 转圈圈",
        "OutputConfig": {
            "Duration": 8,
            "StorageMode": "Temporary",
            "AspectRatio": "16:9",
            "AudioGeneration": "Disabled",
            "Resolution": "1080P"
          },

    }
    req.from_json_string(json.dumps(params))

    # 返回的resp是一个CreateAigcVideoTaskResponse的实例，与请求对象对应
    resp = client.CreateAigcVideoTask(req)
    # 输出json格式的字符串回包
    print(resp.to_json_string())

except TencentCloudSDKException as err:
    print(err)

●Java

package com.tencent;
import com.tencentcloudapi.common.AbstractModel;

import com.tencentcloudapi.common.Credential;
import com.tencentcloudapi.common.profile.ClientProfile;
import com.tencentcloudapi.common.profile.HttpProfile;
import com.tencentcloudapi.common.exception.TencentCloudSDKException;
import com.tencentcloudapi.vod.v20180717.VodClient;
import com.tencentcloudapi.vod.v20180717.models.*;

public class Sample
{
    public static void main(String [] args) {
        try{
            // 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
            // 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
            // 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
            // 请参见：https://cloud.tencent.com/document/product/1278/85305
            // 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
            Credential cred = new Credential(System.getenv("TENCENTCLOUD_SECRET_ID"), System.getenv("TENCENTCLOUD_SECRET_KEY"));
            // 使用临时密钥示例
            // Credential cred = new Credential("SecretId", "SecretKey", "Token");
            // 实例化一个http选项，可选的，没有特殊需求可以跳过
            HttpProfile httpProfile = new HttpProfile();
            httpProfile.setEndpoint("vod.tencentcloudapi.com");
            // 实例化一个client选项，可选的，没有特殊需求可以跳过
            ClientProfile clientProfile = new ClientProfile();
            clientProfile.setHttpProfile(httpProfile);
            // 实例化要请求产品的client对象,clientProfile是可选的
            VodClient client = new VodClient(cred, "", clientProfile);
            // 实例化一个请求对象,每个接口都会对应一个request对象
            CreateAigcVideoTaskRequest req = new CreateAigcVideoTaskRequest();
            req.setSubAppId(1500044236L);
            req.setModelName("Kling");
            req.setModelVersion("3.0-Omni");

            AigcVideoTaskInputFileInfo[] aigcVideoTaskInputFileInfos1 = new AigcVideoTaskInputFileInfo[2];
            AigcVideoTaskInputFileInfo aigcVideoTaskInputFileInfo1 = new AigcVideoTaskInputFileInfo();
            aigcVideoTaskInputFileInfo1.setType("Url");
            aigcVideoTaskInputFileInfo1.setCategory("Image");
            aigcVideoTaskInputFileInfo1.setUrl("https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/picture/input/f0.jpeg");
            aigcVideoTaskInputFileInfo1.setObjectId("id1");
            aigcVideoTaskInputFileInfos1[0] = aigcVideoTaskInputFileInfo1;

            AigcVideoTaskInputFileInfo aigcVideoTaskInputFileInfo2 = new AigcVideoTaskInputFileInfo();
            aigcVideoTaskInputFileInfo2.setType("Url");
            aigcVideoTaskInputFileInfo2.setCategory("Image");
            aigcVideoTaskInputFileInfo2.setUrl("https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/picture/input/f1.jpeg");
            aigcVideoTaskInputFileInfo2.setObjectId("id2");
            aigcVideoTaskInputFileInfos1[1] = aigcVideoTaskInputFileInfo2;

            req.setFileInfos(aigcVideoTaskInputFileInfos1);

            req.setPrompt("让 <<<id1>>> 牵着 <<<id2>>> 转圈圈");
            AigcVideoOutputConfig aigcVideoOutputConfig1 = new AigcVideoOutputConfig();
            aigcVideoOutputConfig1.setStorageMode("Temporary");
            aigcVideoOutputConfig1.setResolution("1080P");
            req.setOutputConfig(aigcVideoOutputConfig1);

            // 返回的resp是一个CreateAigcVideoTaskResponse的实例，与请求对象对应
            CreateAigcVideoTaskResponse resp = client.CreateAigcVideoTask(req);
            // 输出json格式的字符串回包
            System.out.println(AbstractModel.toJsonString(resp));
        } catch (TencentCloudSDKException e) {
            System.out.println(e.toString());
        }
    }
}


④ 结果输出
{
  "Response": {
    "RequestId": "f8f003fe-0afd-41ca-8b08-4c9c98f49c43",
    "TaskId": "1500044236-AigcVideoTask-5144d39cbfc8ef4f5c95467f2b5e1808t"
  }
}

⑤ 效果展示
https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/picture/input/kling-element.mp4 
3.9.4.2 使用element_list 主体参考
① 使用说明
1.先创建主体，并记录主体的ElementId： https://doc.weixin.qq.com/doc/w3_AcEALgZGALoCNWMSOpfnHSiiWp0PX?scode=AJEAIQdfAAoOxfW4cVAcEALgZGALo&from=weixin 
2.然后在CreateAigcVideoTask的ExtInfo字段传过来。

ExInfo参数传额外参数
ExtInfo是json字符串，kling的额外参数放在第一层的AdditionalParameters参数上(也是一个json字符串)，类似这样"ExtInfo": "{\"AdditionalParameters\": \"{\\\"element_list\\\": [{\\\"element_id\\\": 12345}]}\"}"

●kling的额外参数都可以通过AdditionalParameters参数传过来

kling_params = {
"element_list": [{"element_id": 12345}]
}
kling_params_str = json.dumps(kling_params, ensure_ascii=False)
ext_info_obj = {"AdditionalParameters": kling_params_str}
ext_info_str= json.dumps(ext_info_obj, ensure_ascii=False)


② 创建主体
1）主要接口
序号	接口名称	对接文档	说明
1	CreateAigcCustomElement	https://cloud.tencent.com/document/product/266/127544 	●同步接口
●只支持图片
●接口的使用见下文
2	CreateAigcAdvancedCustomElement	https://doc.weixin.qq.com/doc/w3_AcEALgZGALoCNWMSOpfnHSiiWp0PX?scode=AJEAIQdfAAoOxfW4cVAcEALgZGALo&from=weixin 	●异步接口
●支持图片、视频等
●接口的使用见对接文档

2）JSON实例-CreateAigcCustomElement
{
        "ElementName": "kling-3-obj-1",
        "ElementDescription": "可灵-主体-1",
        "ElementFrontalImage": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/picture/input/f0.jpeg"
    }

3）结果输出
{
  "Response": {
    "ElementId": "857348715911598110",
    "RequestId": "62f828dc-9e24-487d-afc2-aefbfba6497c"
  }
}

③ 参考生视频
1）JSON实例
{
        "SubAppId": 1500044236,
        "ModelName": "Kling",
        "ModelVersion": "3.0-Omni",
        "Prompt": "让 <<<element_1>>> 牵着 <<<element_2>>> 转圈圈",
        "OutputConfig": {
            "StorageMode": "Temporary",
            "Resolution": "1080P"
        },
        "ExtInfo":"{\"AdditionalParameters\": \"{\\\"element_list\\\": [{\\\"element_id\\\": 858477278396170315}, {\\\"element_id\\\": 858477602846711835}]}\"}"
}


2）代码参考
●Python
# -*- coding: utf-8 -*-

import os
import json
import types
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.vod.v20180717 import vod_client, models
try:
    # 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
    # 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
    # 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
    # 请参见：https://cloud.tencent.com/document/product/1278/85305
    # 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
    cred = credential.Credential(os.getenv("TENCENTCLOUD_SECRET_ID"), os.getenv("TENCENTCLOUD_SECRET_KEY"))
    # 使用临时密钥示例
    # cred = credential.Credential("SecretId", "SecretKey", "Token")
    # 实例化一个http选项，可选的，没有特殊需求可以跳过
    httpProfile = HttpProfile()
    httpProfile.endpoint = "vod.tencentcloudapi.com"

    # 实例化一个client选项，可选的，没有特殊需求可以跳过
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    # 实例化要请求产品的client对象,clientProfile是可选的
    client = vod_client.VodClient(cred, "", clientProfile)
    
    kl_ext_info = {
        "element_list": [
          {"element_id": 857348715911598110},
          {"element_id": 857350390282084353}
        ]
    }
    kling_params_str = json.dumps(kl_ext_info, ensure_ascii=False)
    ext_info_obj = {"AdditionalParameters": kling_params_str}
    ext_info_str = json.dumps(ext_info_obj, ensure_ascii=False)

    # 实例化一个请求对象,每个接口都会对应一个request对象
    req = models.CreateAigcVideoTaskRequest()
    params = {
        "SubAppId": 1500044236,
        "ModelName": "Kling",
        "ModelVersion": "3.0-Omni",
        "Prompt": "让 <<<element_1>>> 牵着 <<<element_2>>> 转圈圈",
        "OutputConfig": {
            "StorageMode": "Temporary",
            "Resolution": "1080P"
        },
        "ExtInfo": ext_info_str
    }
    req.from_json_string(json.dumps(params))

    # 返回的resp是一个CreateAigcVideoTaskResponse的实例，与请求对象对应
    resp = client.CreateAigcVideoTask(req)
    # 输出json格式的字符串回包
    print(resp.to_json_string())

except TencentCloudSDKException as err:
    print(err)

●Java

package com.tencent;
import com.tencentcloudapi.common.AbstractModel;

import com.tencentcloudapi.common.Credential;
import com.tencentcloudapi.common.profile.ClientProfile;
import com.tencentcloudapi.common.profile.HttpProfile;
import com.tencentcloudapi.common.exception.TencentCloudSDKException;
import com.tencentcloudapi.vod.v20180717.VodClient;
import com.tencentcloudapi.vod.v20180717.models.*;

public class Sample
{
    public static void main(String [] args) {
        try{
            // 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
            // 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
            // 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
            // 请参见：https://cloud.tencent.com/document/product/1278/85305
            // 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
            Credential cred = new Credential(System.getenv("TENCENTCLOUD_SECRET_ID"), System.getenv("TENCENTCLOUD_SECRET_KEY"));
            // 使用临时密钥示例
            // Credential cred = new Credential("SecretId", "SecretKey", "Token");
            // 实例化一个http选项，可选的，没有特殊需求可以跳过
            HttpProfile httpProfile = new HttpProfile();
            httpProfile.setEndpoint("vod.tencentcloudapi.com");
            // 实例化一个client选项，可选的，没有特殊需求可以跳过
            ClientProfile clientProfile = new ClientProfile();
            clientProfile.setHttpProfile(httpProfile);
            // 实例化要请求产品的client对象,clientProfile是可选的
            VodClient client = new VodClient(cred, "", clientProfile);
            // 实例化一个请求对象,每个接口都会对应一个request对象
            CreateAigcVideoTaskRequest req = new CreateAigcVideoTaskRequest();
            req.setSubAppId(1500044236L);
            req.setModelName("Kling");
            req.setModelVersion("3.0-Omni");
            req.setPrompt("让 <<<element_1>>> 牵着 <<<element_2>>> 转圈圈");
            AigcVideoOutputConfig aigcVideoOutputConfig1 = new AigcVideoOutputConfig();
            aigcVideoOutputConfig1.setStorageMode("Temporary");
            aigcVideoOutputConfig1.setResolution("1080P");
            req.setOutputConfig(aigcVideoOutputConfig1);

            req.setExtInfo("{\"AdditionalParameters\": \"{\\\"element_list\\\": [{\\\"element_id\\\": 857348715911598110}, {\\\"element_id\\\": 857350390282084353}]}\"}");
            // 返回的resp是一个CreateAigcVideoTaskResponse的实例，与请求对象对应
            CreateAigcVideoTaskResponse resp = client.CreateAigcVideoTask(req);
            // 输出json格式的字符串回包
            System.out.println(AbstractModel.toJsonString(resp));
        } catch (TencentCloudSDKException e) {
            System.out.println(e.toString());
        }
    }
}


3）结果输出
{
  "Response": {
    "RequestId": "e279dfd0-ec40-4bdf-9d1d-5ad4657bd063",
    "TaskId": "1500044236-AigcVideoTask-10fa8406e848043b677fc44452495e33t"
  }
}


4）效果参考
3.9.5 智能分镜
使用说明
1、关于用法
当 multi_shot 为 true 时，开启多镜头

此时分镜方式有两种：
1）shot_type == "customize",自定义分镜
① 通过multi_prompt 定义多个分镜脚本==>[时长，提示词]
② prompt 无效

2）shot_type == "intelligence"，智能分镜
multi_prompt无效，通过prompt 输入提示词

① 主题：【3.Kling3.0 short_type、multi_shot、multi_prompt参数】
●multi_shot
字段	类型	默认值	描述
multi_shot	bool	false	是否生成多镜头视频
●当前参数为true时，prompt参数无效
●当前参数为false时，shot_type参数及multi_prompt参数无效
shot_type	string	空	分镜方式
●枚举值：customize、intelligence
当multi_shot参数为true时，当前参数必填
multi_prompt	array	空	各分镜信息，如提示词、时长等
●通过index、prompt、duration参数定义分镜序号及相应提示词和时长，其中：
○最多支持6个分镜，最小支持1个分镜
○每个分镜相关内容的最大长度不超过512
○每个分镜的时长不大于当前任务的总时长，不小于1
○所有分镜的时长之和等于当前任务的总时长
用key:value承载，
参考用例
    {
        "multi_shot": true,
        "shot_type": "customize",
        "multi_prompt": [
            {
                "index": int,
                "prompt": "string",
                "duration": "5"
            },
            {
                "index": int,
                "prompt": "string",
                "duration": "5"
            }
        ]
    }


② ExInfo参数传额外参数
ExtInfo是json字符串，kling的额外参数放在第一层的AdditionalParameters参数上(也是一个json字符串)，类似这样"ExtInfo": "{\"AdditionalParameters\": \"{\\\"multi_shot\\\": \\\"true\\\"}]}\"}"
kl_ext_info = {
        "multi_shot": true,
        "shot_type": "customize",
        "multi_prompt": [
            {
                "index": 1,
                "prompt": "A person sitting on a park bench, sunlight filtering through trees",
                "duration": 2
            },
            {
                "index": 2,
                "prompt": "A car speeding down a rainy street, headlights glowing.  Dynamic angle, focus on motion.",
                "duration": "3"
            }
        ]
    }
    kling_params_str = json.dumps(kl_ext_info, ensure_ascii=False)
    ext_info_obj = {"AdditionalParameters": kling_params_str}
    ext_info_str = json.dumps(ext_info_obj, ensure_ascii=False)
    ext_info = json.dumps(ext_info_str, ensure_ascii=False)

    print(ext_info) #"{\"AdditionalParameters\": \"{\\\"multi_shot\\\": true, \\\"shot_type\\\": \\\"customize\\\", \\\"multi_prompt\\\": [{\\\"index\\\": 1, \\\"prompt\\\": \\\"A person sitting on a park bench, sunlight filtering through trees\\\", \\\"duration\\\": 2}, {\\\"index\\\": 2, \\\"prompt\\\": \\\"A car speeding down a rainy street, headlights glowing.  Dynamic angle, focus on motion.\\\", \\\"duration\\\": \\\"3\\\"}]}\"}"


③ JSON用例
1）智能分镜 - JSON
params = {
        "SubAppId": 1500044236,
        "ModelName": "Kling",
        "ModelVersion": "3.0",
        "FileInfos": [
            {
                "Type": "Url",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/demo/picture/2k_20251105956f542b.jpeg"
            }
        ],
        "Prompt": "微笑的向我走来",
        "EnhancePrompt": "Enabled",
        "OutputConfig": {
            "StorageMode": "Temporary",
            "Resolution": "1080P",
            "Duration":5,
            "AspectRatio":"16:9",
            "AudioGeneration":"Enabled"
        }
        "ExtInfo": "{\"AdditionalParameters\": \"{\\\"multi_shot\\\": true, \\\"shot_type\\\": \\\"customize\\\", \\\"multi_prompt\\\": [{\\\"index\\\": 1, \\\"prompt\\\": \\\"A person sitting on a park bench, sunlight filtering through trees\\\", \\\"duration\\\": 2}, {\\\"index\\\": 2, \\\"prompt\\\": \\\"A car speeding down a rainy street, headlights glowing.  Dynamic angle, focus on motion.\\\", \\\"duration\\\": \\\"3\\\"}]}\"}"
    }


2）智能分镜&主体（image_list，vide_list） - JSON
params = {
        "SubAppId": 1500044236,
        "ModelName": "Kling",
        "ModelVersion": "3.0",
        "FileInfos": [
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/picture/input/f0.jpeg",
                "ObjectId": "id1"
            },
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/picture/input/f1.jpeg",
                "ObjectId": "id2"
            }
        ],
        "EnhancePrompt": "Enabled",
        "OutputConfig": {
            "StorageMode": "Temporary",
            "Resolution": "1080P",
            "Duration":5,
            "AspectRatio":"16:9",
            "AudioGeneration":"Enabled"
        }
        "ExtInfo": "{\"AdditionalParameters\": \"{\\\"multi_shot\\\": true, \\\"shot_type\\\": \\\"customize\\\", \\\"multi_prompt\\\": [{\\\"index\\\": 1, \\\"prompt\\\": \\\"A person sitting on a park bench, sunlight filtering through trees\\\", \\\"duration\\\": 2}, {\\\"index\\\": 2, \\\"prompt\\\": \\\"A car speeding down a rainy street, headlights glowing.  Dynamic angle, focus on motion.\\\", \\\"duration\\\": \\\"3\\\"}]}\"}"
    }




代码整合一起是：
kl_ext_info = {
        "multi_shot": True,
        "shot_type": "customize",
        "multi_prompt": [
            {
                "index": 1,
                "prompt": "A person sitting on a park bench, sunlight filtering through trees",
                "duration": 2
            },
            {
                "index": 2,
                "prompt": "A car speeding down a rainy street, headlights glowing.  Dynamic angle, focus on motion.",
                "duration": "3"
            }
        ]
    }
    kling_params_str = json.dumps(kl_ext_info, ensure_ascii=False)
    ext_info_obj = {"AdditionalParameters": kling_params_str}
    ext_info_str = json.dumps(ext_info_obj, ensure_ascii=False)

params = {
        "SubAppId": 1500044236,
        "ModelName": "Kling",
        "ModelVersion": "3.0",
        "FileInfos": [
            {
                "Type": "Url",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/demo/picture/2k_20251105956f542b.jpeg"
            }
        ],
        "Prompt": "微笑的向我走来",
        "EnhancePrompt": "Enabled",
        "OutputConfig": {
            "StorageMode": "Temporary",
            "Resolution": "1080P",
            "Duration":5,
            "AspectRatio":"16:9",
            "AudioGeneration":"Enabled"
        }
        "ExtInfo": ext_info_str   # 注意变量不需要再序列化一次     ext_info = json.dumps(ext_info_str, ensure_ascii=False)
}



④ 代码示例
# -*- coding: utf-8 -*-

import os
import json
import types
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.vod.v20180717 import vod_client, models
try:
    # 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
    # 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
    # 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
    # 请参见：https://cloud.tencent.com/document/product/1278/85305
    # 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
    cred = credential.Credential(os.getenv("TENCENTCLOUD_SECRET_ID"), os.getenv("TENCENTCLOUD_SECRET_KEY"))
    # 使用临时密钥示例
    # cred = credential.Credential("SecretId", "SecretKey", "Token")
    # 实例化一个http选项，可选的，没有特殊需求可以跳过
    httpProfile = HttpProfile()
    httpProfile.endpoint = "vod.tencentcloudapi.com"

    # 实例化一个client选项，可选的，没有特殊需求可以跳过
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    # 实例化要请求产品的client对象,clientProfile是可选的
    client = vod_client.VodClient(cred, "ap-guangzhou", clientProfile)

    # 实例化一个请求对象,每个接口都会对应一个request对象
    req = models.CreateAigcVideoTaskRequest()
    params = {
        "SubAppId": 1500044236,
        "ModelName": "Kling",
        "ModelVersion": "3.0",
        "FileInfos": [
            {
                "Type": "Url",
                "Url": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/demo/picture/2k_20251105956f542b.jpeg"
            }
        ],
        "Prompt": "微笑的向我走来",
        "EnhancePrompt": "Enabled",
        "OutputConfig": {
            "StorageMode": "Temporary",
            "Resolution": "1080P"
        }
        "ExtInfo": "{\"AdditionalParameters\": \"{\\\"multi_shot\\\": true, \\\"shot_type\\\": \\\"customize\\\", \\\"multi_prompt\\\": [{\\\"index\\\": 1, \\\"prompt\\\": \\\"A person sitting on a park bench, sunlight filtering through trees\\\", \\\"duration\\\": 2}, {\\\"index\\\": 2, \\\"prompt\\\": \\\"A car speeding down a rainy street, headlights glowing.  Dynamic angle, focus on motion.\\\", \\\"duration\\\": \\\"3\\\"}]}\"}"
    }
    req.from_json_string(json.dumps(params))

    # 返回的resp是一个CreateAigcVideoTaskResponse的实例，与请求对象对应
    resp = client.CreateAigcVideoTask(req)
    # 输出json格式的字符串回包
    print(resp.to_json_string())

except TencentCloudSDKException as err:
    print(err)



⑤ 结果输出
{
        "TaskId": "1500044236-AigcVideoTask-cd35c792def037f1edc9455a692608f3t",
        "SubAppId": 1500044236
}



3.10 可灵指定音色（voice_id）-Kling 2.6
备注：Kling2.6 仅 1080P分辨率支持指定音色ID
3.10.1 关键参数
入参
参数值	类型	说明
FileInfos.N	Array of https://cloud.tencent.com/document/api/266/31773#AigcVideoTaskInputFileInfo 	1.图片文件：通过参数 FileInfos 指定图片
●Category ：指定类型 "Image"


Prompt	string	通过<<<voice_id>>>的形式在Prompt中引用对应的音色ID
ExtInfo	JSON	额外参数可以通过 ExtInfo 指定，可参考可灵官方文档：Kling AI: Next-Gen AI Video & AI Image Generator



格式：
{"AdditionalParameters":"<voice_list>"}

注意：

关键参数
voice_list
"voice_list":[{"voice_id":"voice_id_1"},{"voice_id":"voice_id_2"}]
{
        "SubAppId": 1500044236,
        "ModelName": "Kling",
        "ModelVersion": "2.6",
        "FileInfos": [
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://1500013788.vod2.myqcloud.com/6cab4d43vodcq1500013788/3e6249c25145403714718180954/AhAzYF7bRWAA.png"
            }
        ],
        "Prompt": "参考图片中的任务，使用音色ID<<<voice_1>>>大声的说：我要自由",
        "OutputConfig": {
            "StorageMode": "Permanent",
            "MediaName": "可灵2.6_voiceid_测试",
            "Duration": 5,
            "Resolution": "1080P",
            "AspectRatio": "9:19",
            "AudioGeneration": "Enabled"
        },
        "ExtInfo": "{\"AdditionalParameters\": \"{\\\"voice_list\\\": [{\\\"voice_id\\\": 869048851066937391}]}\"}"
    }

出参
{
  "Response": {
    "RequestId": "3703dbb9-3af8-465f-ad9e-cee84f529e12",
    "TaskId": "1500044236-AigcVideoTask-5ff4a9691b57e57bebe3fcface520d6bt"
  }
}


3.10.2 Step1：创建音色
参考如下文档进行音色创建
https://doc.weixin.qq.com/doc/w3_AcEALgZGALoCNcCvPneoDTtyeiC3N?scode=AJEAIQdfAAodBlGyfZAcEALgZGALo 

3.10.3 Step2：提交任务
●Python
# -*- coding: utf-8 -*-

import os
import json
import types
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.vod.v20180717 import vod_client, models
try:
    # 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
    # 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
    # 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
    # 请参见：https://cloud.tencent.com/document/product/1278/85305
    # 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
    cred = credential.Credential(os.getenv("TENCENTCLOUD_SECRET_ID"), os.getenv("TENCENTCLOUD_SECRET_KEY"))
    # 使用临时密钥示例
    # cred = credential.Credential("SecretId", "SecretKey", "Token")
    # 实例化一个http选项，可选的，没有特殊需求可以跳过
    httpProfile = HttpProfile()
    httpProfile.endpoint = "vod.tencentcloudapi.com"

    # 实例化一个client选项，可选的，没有特殊需求可以跳过
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    # 实例化要请求产品的client对象,clientProfile是可选的
    client = vod_client.VodClient(cred, "", clientProfile)

    # 实例化一个请求对象,每个接口都会对应一个request对象
    req = models.CreateAigcVideoTaskRequest()
    params = {
        "SubAppId": 1500044236,
        "ModelName": "Kling",
        "ModelVersion": "2.6",
        "FileInfos": [
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://1500013788.vod2.myqcloud.com/6cab4d43vodcq1500013788/3e6249c25145403714718180954/AhAzYF7bRWAA.png"
            }
        ],
        "Prompt": "参考图片中的任务，使用音色ID<<<869048851066937391>>>大声的说：我要自由",
        "OutputConfig": {
            "StorageMode": "Permanent",
            "MediaName": "可灵2.6_voiceid_测试",
            "Duration": 5,
            "Resolution": "1080P",
            "AspectRatio": "9:16",
            "AudioGeneration": "Enabled"
        },
        "ExtInfo": "{\"AdditionalParameters\": \"{\\\"voice_list\\\": [{\\\"voice_id\\\": 869048851066937391}]}\"}"
    }
    req.from_json_string(json.dumps(params))

    # 返回的resp是一个CreateAigcVideoTaskResponse的实例，与请求对象对应
    resp = client.CreateAigcVideoTask(req)
    # 输出json格式的字符串回包
    print(resp.to_json_string())

except TencentCloudSDKException as err:
    print(err)

●Go

package main

import (
        "os"
        "fmt"

        "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common"
        "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common/errors"
        "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common/profile"
        vod "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/vod/v20180717"
)

func main() {
        // 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
        // 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
        // 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
        // 请参见：https://cloud.tencent.com/document/product/1278/85305
        // 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
        credential := common.NewCredential(
                os.Getenv("TENCENTCLOUD_SECRET_ID"),
                os.Getenv("TENCENTCLOUD_SECRET_KEY"),
        )
        // 使用临时密钥示例
        // credential := common.NewTokenCredential("SecretId", "SecretKey", "Token")
        // 实例化一个client选项，可选的，没有特殊需求可以跳过
        cpf := profile.NewClientProfile()
        cpf.HttpProfile.Endpoint = "vod.tencentcloudapi.com"
        // 实例化要请求产品的client对象,clientProfile是可选的
        client, _ := vod.NewClient(credential, "", cpf)

        // 实例化一个请求对象,每个接口都会对应一个request对象
        request := vod.NewCreateAigcVideoTaskRequest()
        
        request.SubAppId = common.Uint64Ptr(1500044236)
        request.ModelName = common.StringPtr("Kling")
        request.ModelVersion = common.StringPtr("2.6")
        request.FileInfos = []*vod.AigcVideoTaskInputFileInfo {
                &vod.AigcVideoTaskInputFileInfo {
                        Type: common.StringPtr("Url"),
                        Category: common.StringPtr("Image"),
                        Url: common.StringPtr("https://1500013788.vod2.myqcloud.com/6cab4d43vodcq1500013788/3e6249c25145403714718180954/AhAzYF7bRWAA.png"),
                },
        }
        request.Prompt = common.StringPtr("参考图片中的任务，使用音色ID<<<869048851066937391>>>大声的说：我要自由")
        request.OutputConfig = &vod.AigcVideoOutputConfig {
                StorageMode: common.StringPtr("Permanent"),
                MediaName: common.StringPtr("可灵2.6_voiceid_测试"),
                Duration: common.Float64Ptr(5),
                Resolution: common.StringPtr("1080P"),
                AspectRatio: common.StringPtr("9:16"),
                AudioGeneration: common.StringPtr("Enabled"),
        }
        request.ExtInfo = common.StringPtr("{\"AdditionalParameters\": \"{\\\"voice_list\\\": [{\\\"voice_id\\\": 869048851066937391}]}\"}")
        // 返回的resp是一个CreateAigcVideoTaskResponse的实例，与请求对象对应
        response, err := client.CreateAigcVideoTask(request)
        if _, ok := err.(*errors.TencentCloudSDKError); ok {
                fmt.Printf("An API error has returned: %s", err)
                return
        }
        if err != nil {
                panic(err)
        }
        // 输出json格式的字符串回包
        fmt.Printf("%s", response.ToJsonString())
} 

3.10.4结果输出
{
  "Response": {
    "RequestId": "a4087267-30dd-457a-a198-0697d3bb78dd",
    "TaskId": "1500044236-AigcVideoTask-fc45c82a1cb9cfcfe2b572e807ba945bt"
  }
}


3.10.5 效果展示
① 音色文件：https://cg-sdk-1258344699.cos.ap-nanjing.myqcloud.com/BackendBeauty/testcase/input.mp4 
② 效果展示：
https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/4607b0c55145403722136444988/aigcVideoGenFile.mp4 
https://drive.weixin.qq.com/s?k=AJEAIQdfAAoU06kMOwAUUAAQaDAMY 
3.11 Vidu 模型使用指南
3.11.1 使用说明
① 官网文档
1）通用：https://platform.vidu.cn/docs/introduction 
2）q3-max：https://shengshu.feishu.cn/wiki/URYzwxfMWizDM7kRlCwcRI3Ynzf 

② 模型版本与特征
模型版本	ModelVersion	特征
viduq3-mix	q3-mix	●画面质感强，支持智能切镜，支持音画同出，动态效果好，均衡性最强
●只支持参考生视频（非主体模式）
viduq3-turbo	q3-turbo	●支持智能切镜，支持音画同出，生成速度最快，性价比最高
●对比viduq3-pro，生成速度更快
viduq3-pro	q3-pro	●高效生成优质音视频内容，让视频内容更生动、更形象、更立体，效果更好
viduq3	q3	●支持智能切镜，支持音画同出，多机位的一致性更出色
viduq2-pro	q2-pro	●支持参考视频，支持视频编辑，视频替换
viduq2	q2	●动态效果好，生成细节丰富
vidu2.0（未上架）	2.0	●生成速度快
viduq1（未上架）	1	●画面清晰，平滑转场，运镜稳定

③ 模型支持的模式
模式	描述	支持模型
文生视频	●通过文本提示词，生成视频
●注：字符长度不能超过 5000 个字符	●模型名称可选值：viduq3-turbo 、viduq3-pro 、viduq2 、viduq1
图生视频	●模型将以此参数中传入的图片为首帧画面来生成视频
●只支持输入 1 张图	●模型名称可选值：viduq3-turbo、viduq3-pro、viduq2-pro-fast、viduq2-pro-fast、viduq2-pro、viduq2-turbo、viduq1 、viduq1-classic 、vidu2.0
首尾帧	●支持输入两张图，上传的第一张图片视作首帧图，第二张图片视作尾帧图，模型将以此参数中传入的图片来生成视频	●模型名称可选值：viduq3-turbo、viduq3-pro、viduq2-pro-fast、viduq2-pro、viduq2-turbo、viduq1 、viduq1-classic、vidu2.0

参考生视频（非主体调用）	●图像参考支持多张图片，模型将以此参数中传入的图片中的主题为参考生成具备主体一致的视频	●模型名称可选值：viduq3-mix、viduq3-turbo、viduq3、viduq2-pro、viduq2、viduq1、vidu2.0
参考生视频（主体调用）	●指定主体id，后续生成时可以通过@主体id的方式使用	●模型名称可选值：viduq3-turbo、viduq3、viduq2-pro、viduq2、viduq1、vidu2.0
●仅viduq2-pro模型支持使用视频主体
3.11.2 Vidu创建自定义主体
Vidu的参考主体模式，分为临时主体和固定主体，其中固定主体可重复使用，该章节用于说明如何创建Vidu固定主体，用于后续的主体引用
●异步模式，通过创建任务并查询任务获取主体信息
●客户需要存储主体ID等信息以便后续复用
① 参考文档
●创建固定主体
https://cloud.tencent.com/document/product/266/129192 
●任务查询
https://cloud.tencent.com/document/product/266/33431 
② 创建固定主体任务
https://doc.weixin.qq.com/doc/w3_AcEALgZGALoCNpVYYX4QDSQaFFwmr?scode=AJEAIQdfAAoJfeLC0K 
1）请求接口
接口：CreateAigcSubject

2）关键参数
参数值	类型	说明
SubAppId	string	点播https://cloud.tencent.com/document/product/266/14574  ID。
示例值：221073
SubjectName	string	主体名称。

示例值：myObjectName
SubjectImages.N	Array of String	主体图片，至少上传 1 张主体图片。* 注1：支持传入图片URL（确保可访问）；* 注2：最多支持输入 3 张图；* 注3：图片支持 png、jpeg、jpg、webp格式；* 注4：图片比例需要小于 1:4 或者 4:1 ；* 注5：图片大小不超过 50 MB；

示例值：["url"]
SubjectVideos.N	Array of String	视频参考支持上传 1 个主体视频
●注1：仅参考生viduq2-pro模型支持使用视频主体
●注2：最多支持上传 1个5秒 的视频
●注3：视频支持 mp4、avi、mov格式
●注4：视频像素不能小于 128128，且比例需要小于1:4或者4:1，且大小不超过100M。

示例值：["**"]
VoiceId	String	主体音色Id，该信息仅在创建音视频直出任务时使用
●注1：不传音色id 生成音视频直出任务时，系统会自动推荐音色
●注2：q2-pro不支持使用音色id

示例值：male-qn-qingse
3）请求示例
3-1）生成图片主体
●JSON示例
{
  "SubAppId": 1500044236,
  "SubjectName": "Vidu-Ojb-Princess",
  "SubjectImages": [
      "https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/8e55bda35145403718492542527/aigcImageGenFile.png"
  ],
  "VoiceId": null,
  "SessionId": null,
  "SessionContext": null,
  "TasksPriority": null
}

●代码示例（Python）：
# -*- coding: utf-8 -*-

import os
import json
import types
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.vod.v20180717 import vod_client, models
try:
    # 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
    # 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
    # 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
    # 请参见：https://cloud.tencent.com/document/product/1278/85305
    # 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
    cred = credential.Credential(os.getenv("TENCENTCLOUD_SECRET_ID"), os.getenv("TENCENTCLOUD_SECRET_KEY"))
    # 使用临时密钥示例
    # cred = credential.Credential("SecretId", "SecretKey", "Token")
    # 实例化一个http选项，可选的，没有特殊需求可以跳过
    httpProfile = HttpProfile()
    httpProfile.endpoint = "vod.tencentcloudapi.com"

    # 实例化一个client选项，可选的，没有特殊需求可以跳过
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    # 实例化要请求产品的client对象,clientProfile是可选的
    client = vod_client.VodClient(cred, "", clientProfile)

    # 实例化一个请求对象,每个接口都会对应一个request对象
    req = models.CreateAigcSubjectRequest()
    params = {
        "SubAppId": 1500044236,
        "SubjectName": "Vidu-Ojb-Princess",
        "SubjectImages": [ "https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/8e55bda35145403718492542527/aigcImageGenFile.png" ]
    }
    req.from_json_string(json.dumps(params))

    # 返回的resp是一个CreateAigcSubjectResponse的实例，与请求对象对应
    resp = client.CreateAigcSubject(req)
    # 输出json格式的字符串回包
    print(resp.to_json_string())

except TencentCloudSDKException as err:
    print(err)

●结果输出
{
  "Response": {
    "RequestId": "cd868e96-6465-41b5-b3d7-2e5cde042d77",
    "TaskId": "1500044236-CreateAigcSubject-433fdd3832de6f3efade4d3503f8afedt"
  }
}

3-2）生成视频主体
●JSON示例
{
  "SubAppId": 1500044236,
  "SubjectName": "Vidu-Ojb-Princess-2",
  "SubjectVideos": [
      "https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/ba7902435145403722932619735/aigcVideoGenFile.mp4"
  ],
  "VoiceId": null,
  "SessionId": null,
  "SessionContext": null,
  "TasksPriority": null
}


●代码示例（Python）：
# -*- coding: utf-8 -*-

import os
import json
import types
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.vod.v20180717 import vod_client, models
try:
    # 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
    # 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
    # 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
    # 请参见：https://cloud.tencent.com/document/product/1278/85305
    # 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
    cred = credential.Credential(os.getenv("TENCENTCLOUD_SECRET_ID"), os.getenv("TENCENTCLOUD_SECRET_KEY"))
    # 使用临时密钥示例
    # cred = credential.Credential("SecretId", "SecretKey", "Token")
    # 实例化一个http选项，可选的，没有特殊需求可以跳过
    httpProfile = HttpProfile()
    httpProfile.endpoint = "vod.tencentcloudapi.com"

    # 实例化一个client选项，可选的，没有特殊需求可以跳过
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    # 实例化要请求产品的client对象,clientProfile是可选的
    client = vod_client.VodClient(cred, "", clientProfile)

    # 实例化一个请求对象,每个接口都会对应一个request对象
    req = models.CreateAigcSubjectRequest()
    params = {
        "SubAppId": 1500044236,
        "SubjectName": "Vidu-Ojb-Princess-2",
        "SubjectVideos": [ "https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/ba7902435145403722932619735/aigcVideoGenFile.mp4" ]
    }
    req.from_json_string(json.dumps(params))

    # 返回的resp是一个CreateAigcSubjectResponse的实例，与请求对象对应
    resp = client.CreateAigcSubject(req)
    # 输出json格式的字符串回包
    print(resp.to_json_string())

except TencentCloudSDKException as err:
    print(err)

●结果输出
{
  "Response": {
    "RequestId": "7fd1a4cb-0605-4a33-bd68-7b013023a32f",
    "TaskId": "1500044236-CreateAigcSubject-f24cbc9aaf66834cdc9139d56f8acd02t"
  }
}

③ 查询固定任务详情
1）JSON示例
{
        "TaskId": "1500044236-CreateAigcSubject-433fdd3832de6f3efade4d3503f8afedt",
        "SubAppId": 1500044236
    }

2）代码示例 - Python
# -*- coding: utf-8 -*-

import os
import json
import types
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.vod.v20180717 import vod_client, models
try:
    # 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
    # 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
    # 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
    # 请参见：https://cloud.tencent.com/document/product/1278/85305
    # 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
    cred = credential.Credential(os.getenv("TENCENTCLOUD_SECRET_ID"), os.getenv("TENCENTCLOUD_SECRET_KEY"))
    # 使用临时密钥示例
    # cred = credential.Credential("SecretId", "SecretKey", "Token")
    # 实例化一个http选项，可选的，没有特殊需求可以跳过
    httpProfile = HttpProfile()
    httpProfile.endpoint = "vod.tencentcloudapi.com"

    # 实例化一个client选项，可选的，没有特殊需求可以跳过
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    # 实例化要请求产品的client对象,clientProfile是可选的
    client = vod_client.VodClient(cred, "", clientProfile)

    # 实例化一个请求对象,每个接口都会对应一个request对象
    req = models.DescribeTaskDetailRequest()
    params = {
        "TaskId": "1500044236-CreateAigcSubject-433fdd3832de6f3efade4d3503f8afedt",
        "SubAppId": 1500044236
    }
    req.from_json_string(json.dumps(params))

    # 返回的resp是一个DescribeTaskDetailResponse的实例，与请求对象对应
    resp = client.DescribeTaskDetail(req)
    # 输出json格式的字符串回包
    print(resp.to_json_string())

except TencentCloudSDKException as err:
    print(err)

3）结果输出
{
  "Response": {
    "AigcImageTask": null,
    "AigcVideoTask": null,
    "BeginProcessTime": "2026-04-11T16:31:38Z",
    "ClipTask": null,
    "ComplexAdaptiveDynamicStreamingTask": null,
    "ComposeMediaTask": null,
    "ConcatTask": null,
    "CreateAigcAdvancedCustomElementTask": null,
    "CreateAigcCustomVoiceTask": null,
    "CreateAigcSubjectTask": {
      "ErrCode": 0,
      "ErrCodeExt": "",
      "Input": {
        "SubjectImages": [
          "https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/8e55bda35145403718492542527/aigcImageGenFile.png"
        ],
        "SubjectName": "Vidu-Ojb-Princess",
        "SubjectVideos": [],
        "VoiceId": ""
      },
      "Message": "",
      "Output": {
        "SubjectId": "940587721733181440",
        "SubjectInfo": "{\"created_at\":\"2026-04-11T16:31:56.872819Z\",\"creator_id\":\"893323338682748928\",\"credits\":5,\"description\":\"一位年轻女性，拥有深色波浪卷发，头上戴着一顶华丽的金色王冠和额饰，耳朵上戴着精致的金色吊坠耳环，脖子上佩戴着多层金色项链，项链中央有复杂的装饰。她身穿一件优雅的蓝绿色褶皱长袍，肩部和腰部饰有金色细节，右臂上戴着金色臂环，左肩 draped 着一块浅蓝色轻纱。她的面部表情宁静而沉思，眼神望向画面的右侧。背景是柔和模糊的古典建筑，有拱门和柱子，沐浴在温暖的日出或日落金光中，营造出宏伟而宁静的氛围。\",\"id\":\"940587721733181440\",\"images\":[\"https://prod-ss-vidu.s3.cn-northwest-1.amazonaws.com.cn/infer_40/tasks/26/0411/16/940587721733181440/input/prompt-01.jpeg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Checksum-Mode=ENABLED&X-Amz-Credential=AKIARRHG6JR7EMNHVUWT%2F20260411%2Fcn-northwest-1%2Fs3%2Faws4_request&X-Amz-Date=20260411T163156Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&response-cache-control=max-age%3D86400&x-id=GetObject&X-Amz-Signature=f7ccfe13010106cbc4ef46f2f751d06a9bacb29b5d3311eb6704d23e838af788\"],\"name\":\"Vidu-Ojb-Princess\",\"ownership\":\"private\",\"status\":\"enabled\",\"style\":\"写实\",\"type\":\"image\",\"user_id\":\"893322994741432320\",\"videos\":[],\"voice_id\":\"\"}\n"
      },
      "SessionContext": "",
      "SessionId": "",
      "Status": "FINISH",
      "TaskId": "1500044236-CreateAigcSubject-433fdd3832de6f3efade4d3503f8afedt"
    },
    "CreateImageSpriteTask": null,
    "CreateTime": "2026-04-11T16:31:38Z",
    "DescribeFileAttributesTask": null,
    "EditMediaTask": null,
    "ExtractBlindWatermarkTask": null,
    "ExtractCopyRightWatermarkTask": null,
    "ExtractTraceWatermarkTask": null,
    "FinishTime": "2026-04-11T16:31:56Z",
    "ImportMediaKnowledge": null,
    "ProcedureTask": null,
    "ProcessImageAsyncTask": null,
    "ProcessMediaByMPSTask": null,
    "PullUploadTask": null,
    "QualityEnhanceTask": null,
    "QualityInspectTask": null,
    "RebuildMediaTask": null,
    "ReduceMediaBitrateTask": null,
    "RemoveWatermarkTask": null,
    "RequestId": "bfacdc0a-724f-46c5-8331-6f7b5c6b8de0",
    "ReviewAudioVideoTask": null,
    "SceneAigcImageTask": null,
    "SceneAigcVideoTask": null,
    "SnapshotByTimeOffsetTask": null,
    "SplitMediaTask": null,
    "Status": "FINISH",
    "TaskType": "CreateAigcSubject",
    "TranscodeTask": null,
    "WechatMiniProgramPublishTask": null,
    "WechatPublishTask": null
  }
}

3.11.3 Vidu文生视频
① 关键入参
参数值	类型	说明
ModelName	string	Vidu
ModelVersion	string	viduq3-turbo 、viduq3-pro 、viduq2 、viduq1
Prompt	string	提示词
OutputConfig	Array ofhttps://cloud.tencent.com/document/api/266/31773#AigcVideoOutputConfig 	生视频任务的输出媒体文件配置，包括指定分辨率、长宽比、时长、声音控制等

② 请求JSON示例
{
        "SubAppId": 1500044236,
        "ModelName": "Vidu",
        "ModelVersion": "q3-pro",
        "Prompt": "真人风格，公主在城堡的房间里头看着关闭的门表情凝重转过头，打开窗户眺望着远方，呼喊着我要自由，表情从愁容变的释然，并露出微小",
        "OutputConfig": {
            "StorageMode": "Permanent",
            "MediaName": "q3-pro文生视频_测试",
            "Duration": 10,
            "Resolution": "720P",
            "AspectRatio": "9:16",
            "AudioGeneration": "Enabled"
        }
    }


③ 效果展示
https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/2d6a63be5145403722937020685/aigcVideoGenFile.mp4 
3.11.4 图生视频（首帧生视频）
① 关键入参
参数值	类型	说明
FileInfos.N	Array of https://cloud.tencent.com/document/api/266/31773#AigcVideoTaskInputFileInfo 	1.图片文件：通过参数 FileInfos 指定图片
●Category ：指定类型 "Image"
●Usage：FirstFrame   -- 声明首帧生视频，可不填写
2.只支持一张图
ModelName	string	Vidu
ModelVersion	string	viduq3-turbo、viduq3-pro、viduq2-pro-fast、viduq2-pro-fast、viduq2-pro、viduq2-turbo、viduq1 、viduq1-classic 、vidu2.0
Prompt	string	提示词
OutputConfig	Array ofhttps://cloud.tencent.com/document/api/266/31773#AigcVideoOutputConfig 	生视频任务的输出媒体文件配置，包括指定分辨率、长宽比、时长、声音控制等

② 请求JSON示例
{
        "SubAppId": 1500044236,
        "ModelName": "Vidu",
        "ModelVersion": "q3-turbo",
        "FileInfos": [
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/8e55bda35145403718492542527/aigcImageGenFile.png",
                "Usage":"FirstFrame"
            }
        ],
        "Prompt": "真人风格，打开窗户眺望着远方，呼喊着我要自由，表情从愁容变的释然，并露出微笑",
        "OutputConfig": {
            "StorageMode": "Permanent",
            "MediaName": "Vidu_q3-turbo图生视频_测试",
            "Duration": 10,
            "Resolution": "720P",
            "AspectRatio": "9:16",
            "AudioGeneration": "Enabled"
        }
    }

③ 效果展示
https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/ba7902435145403722932619735/aigcVideoGenFile.mp4 
https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/72b818a75145403722931896094/aigcVideoGenFile.mp4 
3.11.5 首尾帧生视频
① 关键入参
参数值	类型	说明
FileInfos.N	Array of https://cloud.tencent.com/document/api/266/31773#AigcVideoTaskInputFileInfo 	1.图片文件：通过参数 FileInfos 指定图片
●Type：输入类型
○File：点播媒体文件；
○Url：可访问的 Url；
●Category ：指定文件类型 
○Image: 图片
○Video: 视频
●Usage："FirstFrame"   -- 声明首帧视频
只支持一张图
LastFrameFileId	string	●配合首帧输入类型Type=File时使用，用于作为尾帧画面来生成视频的媒体文件 ID
●指定参数时，标识首尾帧生视频，否则首帧生视频
LastFrameUrl	string	●配合首帧输入类型Type=Url时使用，用于作为尾帧画面来生成视频的媒体文件 ID
指定参数时，标识首尾帧生视频，否则首帧生视频
ModelName	string	Vidu
ModelVersion	string	viduq3-turbo、viduq3-pro、viduq2-pro-fast、viduq2-pro、viduq2-turbo、viduq1 、viduq1-classic、vidu2.0
Prompt	string	提示词
OutputConfig	Array ofhttps://cloud.tencent.com/document/api/266/31773#AigcVideoOutputConfig 	生视频任务的输出媒体文件配置，包括指定分辨率、长宽比、时长、声音控制等
② 请求JSON示例
{
        "SubAppId": 1500044236,
        "ModelName": "Vidu",
        "ModelVersion": "q3-turbo",
        "FileInfos": [
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/8e55bda35145403718492542527/aigcImageGenFile.png",
                "Usage":"FirstFrame"
            }
        ],
        "LastFrameUrl":"https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/4fbe2a195145403722934410338/aigcImageGenFile.jpg",
        "Prompt": "真人风格，公主打开窗户眺望着远方，快速跑出城堡骑上马",
        "OutputConfig": {
            "StorageMode": "Permanent",
            "MediaName": "Vidu_q3-turbo首尾帧生视频_测试",
            "Duration": 10,
            "Resolution": "720P",
            "AspectRatio": "9:16",
            "AudioGeneration": "Enabled"
        }
    }


③ 效果展示
https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/e5430bb15145403723033039521/aigcVideoGenFile.mp4 
3.11.6 参考生视频（多图，非主体调用）
① 关键入参
参数值	类型	说明
FileInfos.N	Array of https://cloud.tencent.com/document/api/266/31773#AigcVideoTaskInputFileInfo 	1.图片文件：通过参数 FileInfos 指定图片
●Type：输入类型
○File：点播媒体文件；
○Url：可访问的 Url；
●Category ：指定文件类型 
○Image: 图片
○Video: 视频
●Usage："Reference"   -- 注意单图情况下，传参标识使用参考生视频；多图情况下可不传参
ModelName	string	Vidu
ModelVersion	string	viduq3-mix、viduq3-turbo、viduq3、viduq2-pro、viduq2、viduq1、vidu2.0
Prompt	string	提示词
OutputConfig	Array ofhttps://cloud.tencent.com/document/api/266/31773#AigcVideoOutputConfig 	生视频任务的输出媒体文件配置，包括指定分辨率、长宽比、时长、声音控制等
② 请求JSON示例
●单图模式
{
        "SubAppId": 1500044236,
        "ModelName": "Vidu",
        "ModelVersion": "q3",
        "FileInfos": [
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/8e55bda35145403718492542527/aigcImageGenFile.png",
                "Usage":"Reference"
            } 
        ],
        "Prompt": "公主转过头，打开窗户眺望着远方，呼喊着我要自由，表情从愁容变的释然，并露出微笑",
        "OutputConfig": {
            "StorageMode": "Permanent",
            "MediaName": "Vidu_q3单图，非主体参考生视频_测试",
            "Duration": 10,
            "Resolution": "720P",
            "AspectRatio": "9:16",
            "AudioGeneration": "Enabled"
        }
    }


●多图模式
{
        "SubAppId": 1500044236,
        "ModelName": "Vidu",
        "ModelVersion": "q3-turbo",
        "FileInfos": [
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/8e55bda35145403718492542527/aigcImageGenFile.png",
            },
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/5bc5bde85145403722934966409/aigcImageGenFile.jpg",
            }       
        ],
        "Prompt": "图1 公主牵着图2 王子的手，跑出城堡的大门，来到到了外面的草地上",
        "OutputConfig": {
            "StorageMode": "Permanent",
            "MediaName": "Vidu_q3-turbo多图，非主体参考生视频_测试",
            "Duration": 10,
            "Resolution": "720P",
            "AspectRatio": "9:16",
            "AudioGeneration": "Enabled"
        }
    }


③ 效果展示
●单图模式
https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/c17494dc5145403722932912363/aigcVideoGenFile.mp4 
●多图模式
https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/e58b766b5145403722936288854/aigcVideoGenFile.mp4 
3.11.7 参考生视频（多图，主体调用）
① 关键入参
参数值	类型	说明
FileInfos.N	Array of https://cloud.tencent.com/document/api/266/31773#AigcVideoTaskInputFileInfo 	1.图片文件：通过参数 FileInfos 指定图片
●Type：输入类型
○File：点播媒体文件；
○Url：可访问的 Url；
●Category ：指定文件类型 
○Image: 图片
○Video: 视频
●ObjectId：参考主体命名
○"obj1"   -- 声明一个临时主体"obj1"
只支持一张图
ModelName	string	Vidu
ModelVersion	string	●viduq3-turbo、viduq3、viduq2-pro、viduq2、viduq1、vidu2.0
●仅viduq2-pro模型支持使用视频主体
SubjectInfos.N	Array of https://cloud.tencent.com/document/api/266/31773#AigcVideoTaskInputSubjectInfo 	固定主体输入信息。

●Id：String，主体ID
○可灵必填
○Vidu选填
○String示例值：92951***593344
●Name：String，固定名称
○Vidu主体必选，可在 prompt 中加入 [@name] 使用。如 name 为小明时，prompt 中描述为 [@小明] 。
○Kling主体可选。
○示例值：猫猫
●VoiceId：String，仅Vidu有效。
○音色ID用来决定视频中的声音音色，为空时系统会自动推荐
○示例值：male-qn-badao
●ImageUrls：Array of String，仅Vidu有效。
○临时主体图片，最多3张图片
○注1：支持传入图片URL（确保可访问）；
○注2：图片支持 png、jpeg、jpg、webp格式；
○注3：图片像素不能小于 128*128，且比例需要小于1:4或者4:1。
○示例值：["https://xxx/0.jpg"]
●VideoUrls：Array of String，仅Vidu有效。
○临时主体视频，最多1个5秒视频注1：仅参考生viduq2-pro模型支持使用视频主体；注2：最多支持上传 1个5秒 的视频；注3：视频支持 mp4、avi、mov格式；注4：视频像素不能小于 128*128，且比例需要小于1:4或者4:1；
○示例值：["https://xxx/video.mp4"]
Prompt	string	提示词
OutputConfig	Array ofhttps://cloud.tencent.com/document/api/266/31773#AigcVideoOutputConfig 	生视频任务的输出媒体文件配置，包括指定分辨率、长宽比、时长、声音控制等
② 请求JSON示例
●临时主体
{
        "SubAppId": 1500044236,
        "ModelName": "Vidu",
        "ModelVersion": "q3-turbo",
        "FileInfos": [
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/8e55bda35145403718492542527/aigcImageGenFile.png",
                "ObjectId":"Princess"
            },
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/5bc5bde85145403722934966409/aigcImageGenFile.jpg",
                "ObjectId":"Prince"
            },
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/42e910575145403723034784114/aigcImageGenFile.jpg",
                "ObjectId":"Soldier"
            }
        ],
        "Prompt": "@Princess 牵着@Prince 的手，跑出@Soldier 看护的门，来到到了外面的草地上",
        "OutputConfig": {
            "StorageMode": "Permanent",
            "MediaName": "Vidu_q3-turbo多图，主体参考生视频_测试",
            "Duration": 10,
            "Resolution": "720P",
            "AspectRatio": "9:16",
            "AudioGeneration": "Enabled"
        }
    }

●固定主体
{
        "SubAppId": 1500044236,
        "ModelName": "Vidu",
        "ModelVersion": "q2-pro",
        "SubjectInfos": [
            {
                "Id": "940599910921682944",
                "Name": "Princess"
            },
            {
                "Id": "940599790679379968",
                "Name": "Prince"
            },
            {
                "Id": "940599521245675520",
                "Name": "Soldier"
            }
        ],
        "Prompt": "@Princess 牵着@Prince 的手，跑出@Soldier 看护的门，来到到了外面的草地上",
        "OutputConfig": {
            "StorageMode": "Permanent",
            "MediaName": "Vidu_q2-pro多图，固定主体参考生视频_测试",
            "Duration": 10,
            "Resolution": "720P",
            "AspectRatio": "9:16",
            "AudioGeneration": "Enabled"
        }
    }


③ 效果展示
●临时主体
https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/8b4905805145403723035590964/aigcVideoGenFile.mp4 
●固定主体

3.11.8 Vidu q3-mix 参考生视频
说明：q3-mix只支持参考生
① 关键入参说明
参数值	类型	说明
FileInfos.N	Array of https://cloud.tencent.com/document/api/266/31773#AigcVideoTaskInputFileInfo 	1.图片文件：通过参数 FileInfos 指定图片
●Category ：指定类型 "Image"
●Usage：Reference   -- 声明参考生视频
ModelName	string	Vidu
ModelVersion	string	q3-mix
Prompt	string	提示词
OutputConfig	Array ofhttps://cloud.tencent.com/document/api/266/31773#AigcVideoOutputConfig 	生视频任务的输出媒体文件配置，包括指定分辨率、长宽比、时长、声音控制等
② 请求JSON示例
{
        "SubAppId": 1500044236,
        "ModelName": "Vidu",
        "ModelVersion": "q3-mix",
        "FileInfos": [
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/8e55bda35145403718492542527/aigcImageGenFile.png",
                "Usage":"Reference"
            }
        ],
        "Prompt": "真人风格，第一个镜头，公主在城堡的房间里头看着关闭的门表情凝重；第二个镜头，公主转过头，打开窗户眺望着远方，呼喊着我要自由，表情从愁容变的释然，并露出微笑",
        "OutputConfig": {
            "StorageMode": "Permanent",
            "MediaName": "Vidu_q3-max参考生视频_测试",
            "Duration": 16,
            "Resolution": "1080P",
            "AspectRatio": "9:16",
            "AudioGeneration": "Enabled"
        }
    }



③ 出参样例
{
  "Response": {
    "RequestId": "77c7913b-a492-42f8-b9ee-689de892c930",
    "TaskId": "1500044236-AigcVideoTask-220bac88f28d41a08de292b4797ce77bt"
  }
}


④ 提交任务
●Python
# -*- coding: utf-8 -*-

import os
import json
import types
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.vod.v20180717 import vod_client, models
try:
    # 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
    # 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
    # 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
    # 请参见：https://cloud.tencent.com/document/product/1278/85305
    # 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
    cred = credential.Credential(os.getenv("TENCENTCLOUD_SECRET_ID"), os.getenv("TENCENTCLOUD_SECRET_KEY"))
    # 使用临时密钥示例
    # cred = credential.Credential("SecretId", "SecretKey", "Token")
    # 实例化一个http选项，可选的，没有特殊需求可以跳过
    httpProfile = HttpProfile()
    httpProfile.endpoint = "vod.tencentcloudapi.com"

    # 实例化一个client选项，可选的，没有特殊需求可以跳过
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    # 实例化要请求产品的client对象,clientProfile是可选的
    client = vod_client.VodClient(cred, "", clientProfile)

    # 实例化一个请求对象,每个接口都会对应一个request对象
    req = models.CreateAigcVideoTaskRequest()
    params = {
        "SubAppId": 1500044236,
        "ModelName": "Vidu",
        "ModelVersion": "q3-mix",
        "FileInfos": [
            {
                "Type": "Url",
                "Category": "Image",
                "Url": "https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/8e55bda35145403718492542527/aigcImageGenFile.png",
                "Usage": "Reference"
            }
        ],
        "Prompt": "真人风格，第一个镜头，公主在城堡的房间里头看着关闭的门表情凝重；第二个镜头，公主转过头，打开窗户眺望着远方，呼喊着我要自由，表情从愁容变的释然，并露出微小",
        "OutputConfig": {
            "StorageMode": "Permanent",
            "MediaName": "Vidu_q3-max参考生视频_测试",
            "Duration": 16,
            "Resolution": "1080P",
            "AspectRatio": "9:16",
            "AudioGeneration": "Enabled"
        }
    }
    req.from_json_string(json.dumps(params))

    # 返回的resp是一个CreateAigcVideoTaskResponse的实例，与请求对象对应
    resp = client.CreateAigcVideoTask(req)
    # 输出json格式的字符串回包
    print(resp.to_json_string())

except TencentCloudSDKException as err:
    print(err)

●Go

package main

import (
        "os"
        "fmt"

        "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common"
        "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common/errors"
        "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common/profile"
        vod "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/vod/v20180717"
)

func main() {
        // 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
        // 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
        // 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
        // 请参见：https://cloud.tencent.com/document/product/1278/85305
        // 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
        credential := common.NewCredential(
                os.Getenv("TENCENTCLOUD_SECRET_ID"),
                os.Getenv("TENCENTCLOUD_SECRET_KEY"),
        )
        // 使用临时密钥示例
        // credential := common.NewTokenCredential("SecretId", "SecretKey", "Token")
        // 实例化一个client选项，可选的，没有特殊需求可以跳过
        cpf := profile.NewClientProfile()
        cpf.HttpProfile.Endpoint = "vod.tencentcloudapi.com"
        // 实例化要请求产品的client对象,clientProfile是可选的
        client, _ := vod.NewClient(credential, "", cpf)

        // 实例化一个请求对象,每个接口都会对应一个request对象
        request := vod.NewCreateAigcVideoTaskRequest()
        
        request.SubAppId = common.Uint64Ptr(1500044236)
        request.ModelName = common.StringPtr("Vidu")
        request.ModelVersion = common.StringPtr("q3-mix")
        request.FileInfos = []*vod.AigcVideoTaskInputFileInfo {
                &vod.AigcVideoTaskInputFileInfo {
                        Type: common.StringPtr("Url"),
                        Category: common.StringPtr("Image"),
                        Url: common.StringPtr("https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/8e55bda35145403718492542527/aigcImageGenFile.png"),
                        Usage: common.StringPtr("Reference"),
                },
        }
        request.Prompt = common.StringPtr("真人风格，第一个镜头，公主在城堡的房间里头看着关闭的门表情凝重；第二个镜头，公主转过头，打开窗户眺望着远方，呼喊着我要自由，表情从愁容变的释然，并露出微小")
        request.OutputConfig = &vod.AigcVideoOutputConfig {
                StorageMode: common.StringPtr("Permanent"),
                MediaName: common.StringPtr("Vidu_q3-max参考生视频_测试"),
                Duration: common.Float64Ptr(16),
                Resolution: common.StringPtr("1080P"),
                AspectRatio: common.StringPtr("9:16"),
                AudioGeneration: common.StringPtr("Enabled"),
        }
        // 返回的resp是一个CreateAigcVideoTaskResponse的实例，与请求对象对应
        response, err := client.CreateAigcVideoTask(request)
        if _, ok := err.(*errors.TencentCloudSDKError); ok {
                fmt.Printf("An API error has returned: %s", err)
                return
        }
        if err != nil {
                panic(err)
        }
        // 输出json格式的字符串回包
        fmt.Printf("%s", response.ToJsonString())
} 

⑤ 结果输出
{
  "Response": {
    "RequestId": "787f4761-4f6f-4f79-b9c1-b6b593e39426",
    "TaskId": "1500044236-AigcVideoTask-fe50a3de98f875bc16ae295782b7fde2t"
  }
}


⑥ 效果展示
https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/381742155145403722217811065/aigcVideoGenFile.mp4 
https://drive.weixin.qq.com/s?k=AJEAIQdfAAo7HEP1fFAUUAAQaDAMY 
3.12 Pixverse 模型使用指南
以下是在云点播（VOD）中调用 PixVerse 的完整说明：
PixVerse 调用方式
调用接口：CreateAigcVideoTask
 接口域名：vod.tencentcloudapi.com
 文档：云点播 创建 AIGC 生视频任务_腾讯云
核心参数
参数	必选	值	说明
ModelName	是	PixVerse	固定值
ModelVersion	是	v5.6 / v6 / c1	三个版本可选
SubAppId	是	你的点播应用ID	2023年12月25日后开通必填
Prompt	条件必填	提示词文本	未传参考图时必填
文生视频
import json
from tencentcloud.common import credential
from tencentcloud.vod.v20180717 import vod_client, models

cred = credential.Credential("SecretId", "SecretKey")
client = vod_client.VodClient(cred, "ap-guangzhou")

req = models.CreateAigcVideoTaskRequest()
req.SubAppId = 251007502
req.ModelName = "PixVerse"
req.ModelVersion = "v6"       # 可选 v5.6 / v6 / c1
req.Prompt = "A cat walking on the beach at sunset"

resp = client.CreateAigcVideoTask(req)
print("TaskId:", resp.TaskId)

图生视频
req = models.CreateAigcVideoTaskRequest()
req.SubAppId = 251007502
req.ModelName = "PixVerse"
req.ModelVersion = "v6"
req.Prompt = "Make the cat walk slowly"

# 传入参考图
file_info = models.AigcVideoTaskInputFileInfo()
file_info.Type = "Url"
file_info.Url = "https://your-bucket.cos.ap-guangzhou.myqcloud.com/cat.jpg"
file_info.Usage = "Reference"
req.FileInfos = [file_info]

resp = client.CreateAigcVideoTask(req)

首尾帧生视频
req = models.CreateAigcVideoTaskRequest()
req.SubAppId = 251007502
req.ModelName = "PixVerse"
req.ModelVersion = "v6"
req.Prompt = "Smooth transition"

# 首帧
first_frame = models.AigcVideoTaskInputFileInfo()
first_frame.Type = "Url"
first_frame.Url = "https://xxx/first.jpg"
first_frame.Usage = "FirstFrame"
req.FileInfos = [first_frame]

# 尾帧
req.LastFrameUrl = "https://xxx/last.jpg"

resp = client.CreateAigcVideoTask(req)


其他可用参数
参数	说明
NegativePrompt	负向提示词，避免生成某些内容
EnhancePrompt	Enabled/Disabled，是否自动优化提示词
Seed	随机种子，控制生成结果可复现
OutputConfig	输出配置（分辨率、时长等）
SessionContext	回调透传信息，最长1000字符
SessionId	去重标识，3天内相同ID不重复生成
注意事项
1.不支持 SceneType：PixVerse 不支持 motioncontrol、avatari2v、lip_sync 等场景类型，该参数仅 Kling/Vidu 可用
2.图片要求：大小 ≤10M，格式 jpeg/jpg/png
3.尾帧 URL 大小：≤5M
4.版本选择建议：c1 为最新角色一致性版本，v6 为通用高质量版本，v5.6 为上一代稳定版本

3.13 Kling 文生音效 视频配音效
调用接口：CreateAigcAudioTask
接口域名：vod.tencentcloudapi.com
文档：待补充

●文生音效
{
    "ModelName": "Kling",
    "SubAppId": 123,
    "SceneType": "sfx",
    "Prompt": "春节庆祝时的烟花声",
    "OutputConfig": {
        "StorageMode": "Temporary",
        "Duration": 6.0
    }
}


●视频配音效
{
    "ModelName": "Kling",
    "SceneType": "sfx",
    "SubAppId": 123,
    "VideoInfos": [
        {
            "Type": "Url",
            "Url": "https://static.youart.ai/media/user_uploads/1/b737792e-c273-436e-b515-cb2d501f140a.mp4"
        }
    ],
    "Prompt": "温柔的风声，远处鸟鸣，偶尔的脚步声，翻书声，雨滴打在窗玻璃上的声音",  // 音效生成提示词
    // bgm_prompt: 配乐生成提示词; 
    // asmr_mode: 是否开启 ASMR 模式；该模式会增强细节音效，适合高沉浸内容场景
    "AdditionalParameters": "{\"bgm_prompt\": \"治愈系钢琴曲，轻柔的弦乐伴奏，温暖舒缓的旋律，带有淡淡的情感起伏，适合剧情类视频\", \"asmr_mode\": true}",
    "OutputConfig": {
        "StorageMode": "Temporary",
        "Duration": 6.0
    }
}



4.超分增强服务
为了满足不同客户的业务需要，超分增强服务提供了多个服务入口。
●VOD
●MPS
超分增强服务，目前根据客户的输入需要有如下几种开发逻辑供客户参考
模式	入口	输入	输出	文档入口
【URL】模式	1.VOD 	支持拉取URL上传，并通过【Procedure】指定任务流自动触发超分增强任务	VOD	https://cloud.tencent.com/document/product/266/35575 
	1.MPS
	API以URL作为输出参数触发相关任务	VOD、COS、OSS、S3等	https://doc.weixin.qq.com/doc/w3_AUUAAQaDAMYCN0Q5asMnfS1On0J60?scode=AJEAIQdfAAoIMfrwklAUUAAQaDAMY 
【Fileid】模式	1.VOD	针对以及存储在VOD的文件发起（如AIGC永久存储的素材）超分增强服务。	VOD	https://cloud.tencent.com/document/product/266/33427 

https://doc.weixin.qq.com/flowchart-addon
说明：推荐使用永久存储，将文件存储存在在VOD中，后续进行图片/视频的超分增强或者

4.1 VOD 超分增强 - 单独调用API
适用于
4.1.0 文档说明
https://cloud.tencent.com/document/product/266/33427

4.1.1 模板配置&工作流配置
在使用超分增强能力时涉及到超分增强模板的配置
4.1.1.1  模板配置
① 内置模板-针对AI短剧优化（推荐）
如有特殊的视频效果增强需求，可联系腾讯云技术同学协助进行超分增强的模板配置与调优
编号	中文配置描述	英文标识符	关键特征解读
101550	漫剧场景 - 大模型增强 - 2K - 帧率随源 - 计费 - 降噪 + 超分 + 综合增强	AnimatedDrama-DiffusionEnhance-2K-SourceResolutionFrameRate	动漫 / 漫画类剧集、2K 分辨率、AI 扩散增强
101560	真人场景 - 大模型增强 - 2K - 帧率随源 - 计费 - 降噪 + 超分 + 综合增强	LiveActionDrama-DiffusionEnhance-2K-SourceResolutionFrameRate	真人拍摄剧集、2K 分辨率、AI 扩散增强
101570	漫剧场景 - 大模型增强 - 4K - 帧率随源 - 计费 - 降噪 + 超分 + 综合增强	AnimatedDrama-DiffusionEnhance-4K-SourceResolutionFrameRate	动漫 / 漫画类剧集、4K 超高清分辨率
101580	真人场景 - 大模型增强 - 4K - 帧率随源 - 计费 - 降噪 + 超分 + 综合增强	LiveActionDrama-DiffusionEnhance-4K-SourceResolutionFrameRate	真人拍摄剧集、4K 超高清分辨率
101510	漫剧场景 - 大模型增强 - 720P - 帧率随源 - 计费 - 降噪 + 超分 + 综合增强	AnimatedDrama-DiffusionEnhance-720P-SourceResolutionFrameRate	动漫 / 漫画类剧集、720P 高清分辨率
101520	真人场景 - 大模型增强 - 720P - 帧率随源 - 计费 - 降噪 + 超分 + 综合增强	LiveActionDrama-DiffusionEnhance-720P-SourceResolutionFrameRate	真人拍摄剧集、720P 高清分辨率
101530	漫剧场景 - 大模型增强 - 1080P - 帧率随源 - 计费 - 降噪 + 超分 + 综合增强	AnimatedDrama-DiffusionEnhance-1080P-SourceResolutionFrameRate	动漫 / 漫画类剧集、1080P 全高清分辨率
101540	真人场景 - 大模型增强 - 1080P - 帧率随源 - 计费 - 降噪 + 超分 + 综合增强	LiveActionDrama-DiffusionEnhance-1080P-SourceResolutionFrameRate	真人拍摄剧集、1080P 全高清分辨率

② 自助配置
https://cloud.tencent.com/document/product/266/89538



4.1.1.2 工作流配置
当前转码为AIGC场景优化的模板还没上控制台，可以通过如下文档指引进行工作流配置
https://doc.weixin.qq.com/doc/w3_AUUAAQaDAMYCNwkSB6enyQU6AWAeD?scode=AJEAIQdfAAoCBT4TQMAUUAAQaDAMY 
4.1.2 主要接口
编号	主要接口	文档站	说明
1	ProcessMedia	https://cloud.tencent.com/document/product/266/33427 	提交超分增强视频任务，并返回任务ID Taskid
2	DescribeTaskDetail	https://cloud.tencent.com/document/product/266/33431 	通过任务 ID 查询任务的执行状态和结果的详细信息（最多可以查询3天之内提交的任务）
输出Fileid以及文件的访问地址
4.1.3 接入demo
4.1.3.1 Json数据
{
        "FileId": "5145403712067473436", #输入对应的文件Fileid
        "SubAppId": 1500044236,
        "MediaProcessTask": {
            "TranscodeTaskSet": [
                {
                    "Definition": 10185    #输入模板ID
                }
            ]
        }
    }

4.1.3.2 代码实例 - Python
# -*- coding: utf-8 -*-

import os
import json
import types
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.vod.v20180717 import vod_client, models
try:
    # 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
    # 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
    # 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
    # 请参见：https://cloud.tencent.com/document/product/1278/85305
    # 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
    cred = credential.Credential(os.getenv("TENCENTCLOUD_SECRET_ID"), os.getenv("TENCENTCLOUD_SECRET_KEY"))
    # 使用临时密钥示例
    # cred = credential.Credential("SecretId", "SecretKey", "Token")
    # 实例化一个http选项，可选的，没有特殊需求可以跳过
    httpProfile = HttpProfile()
    httpProfile.endpoint = "vod.tencentcloudapi.com"

    # 实例化一个client选项，可选的，没有特殊需求可以跳过
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    # 实例化要请求产品的client对象,clientProfile是可选的
    client = vod_client.VodClient(cred, "", clientProfile)

    # 实例化一个请求对象,每个接口都会对应一个request对象
    req = models.ProcessMediaRequest()
    params = {
        "FileId": "5145403712067473436",
        "SubAppId": 1500044236,
        "MediaProcessTask": {
            "TranscodeTaskSet": [
                {
                    "Definition": 10185
                }
            ]
        }
    }
    req.from_json_string(json.dumps(params))

    # 返回的resp是一个ProcessMediaResponse的实例，与请求对象对应
    resp = client.ProcessMedia(req)
    # 输出json格式的字符串回包
    print(resp.to_json_string())

except TencentCloudSDKException as err:
    print(err)


4.1.3.2 代码实例 - Java

package com.tencent;
import com.tencentcloudapi.common.AbstractModel;

import com.tencentcloudapi.common.Credential;
import com.tencentcloudapi.common.profile.ClientProfile;
import com.tencentcloudapi.common.profile.HttpProfile;
import com.tencentcloudapi.common.exception.TencentCloudSDKException;
import com.tencentcloudapi.vod.v20180717.VodClient;
import com.tencentcloudapi.vod.v20180717.models.*;

public class Sample
{
    public static void main(String [] args) {
        try{
            // 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
            // 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
            // 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
            // 请参见：https://cloud.tencent.com/document/product/1278/85305
            // 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
            Credential cred = new Credential(System.getenv("TENCENTCLOUD_SECRET_ID"), System.getenv("TENCENTCLOUD_SECRET_KEY"));
            // 使用临时密钥示例
            // Credential cred = new Credential("SecretId", "SecretKey", "Token");
            // 实例化一个http选项，可选的，没有特殊需求可以跳过
            HttpProfile httpProfile = new HttpProfile();
            httpProfile.setEndpoint("vod.tencentcloudapi.com");
            // 实例化一个client选项，可选的，没有特殊需求可以跳过
            ClientProfile clientProfile = new ClientProfile();
            clientProfile.setHttpProfile(httpProfile);
            // 实例化要请求产品的client对象,clientProfile是可选的
            VodClient client = new VodClient(cred, "", clientProfile);
            // 实例化一个请求对象,每个接口都会对应一个request对象
            ProcessMediaRequest req = new ProcessMediaRequest();
            req.setFileId("5145403712067473436");
            req.setSubAppId(1500044236L);
            MediaProcessTaskInput mediaProcessTaskInput1 = new MediaProcessTaskInput();

            TranscodeTaskInput[] transcodeTaskInputs1 = new TranscodeTaskInput[1];
            TranscodeTaskInput transcodeTaskInput1 = new TranscodeTaskInput();
            transcodeTaskInput1.setDefinition(1807421L);
            transcodeTaskInputs1[0] = transcodeTaskInput1;

            mediaProcessTaskInput1.setTranscodeTaskSet(transcodeTaskInputs1);

            req.setMediaProcessTask(mediaProcessTaskInput1);

            // 返回的resp是一个ProcessMediaResponse的实例，与请求对象对应
            ProcessMediaResponse resp = client.ProcessMedia(req);
            // 输出json格式的字符串回包
            System.out.println(AbstractModel.toJsonString(resp));
        } catch (TencentCloudSDKException e) {
            System.out.println(e.toString());
        }
    }
}



4.1.3.3 结果输出
{
  "Response": {
    "RequestId": "29fe4b34-2e0d-435f-b3e7-0cce96f22940",
    "TaskId": "1500044236-procedurev2-ec2f48fd6f7b6228e339da79deafe561tt0"
  }
}

4.1.3 任务查询 - DescribeTaskDetail
4.1.3.1 Json数据
{
        "TaskId": "1500044236-AigcVideoTask-cd35c792def037f1edc9455a692608f3t",
        "SubAppId": 1500044236
}

4.1.3.2 代码实例 - Python
# -*- coding: utf-8 -*-

import os
import json
import types
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.vod.v20180717 import vod_client,models

try:
    # 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
    # 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
    # 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
    # 请参见：https://cloud.tencent.com/document/product/1278/85305
    # 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
    cred = credential.Credential(os.getenv("TENCENTCLOUD_SECRET_ID"), os.getenv("TENCENTCLOUD_SECRET_KEY"))
    # 使用临时密钥示例
    # cred = credential.Credential("SecretId", "SecretKey", "Token")
    # 实例化一个http选项，可选的，没有特殊需求可以跳过
    httpProfile = HttpProfile()
    httpProfile.endpoint = "vod.tencentcloudapi.com"

    # 实例化一个client选项，可选的，没有特殊需求可以跳过
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    # 实例化要请求产品的client对象,clientProfile是可选的
    client = vod_client.VodClient(cred, "", clientProfile)

    # 实例化一个请求对象,每个接口都会对应一个request对象
    #{"TaskId": "2147484595", "RequestId": "4be58668-2073-4cfe-8fc7-052774eccefc"}
    req = models.DescribeTaskDetailRequest()
    #{"TaskId": "1500044236-AigcVideoTask-cd35c792def037f1edc9455a692608f3t", "RequestId": "7a7a55db-6260-485d-948e-431a955d8308"}

    params = {
        "TaskId": "1500044236-AigcVideoTask-cd35c792def037f1edc9455a692608f3t",
        "SubAppId": 1500044236
    }
    req.from_json_string(json.dumps(params))

    # 返回的resp是一个ProcessMediaResponse的实例，与请求对象对应
    resp = client.DescribeTaskDetail(req)
    # 输出json格式的字符串回包
    print(resp.to_json_string())

except TencentCloudSDKException as err:
    print(err)

4.1.3.2 代码实例 - Java

package com.tencent;
import com.tencentcloudapi.common.AbstractModel;

import com.tencentcloudapi.common.Credential;
import com.tencentcloudapi.common.profile.ClientProfile;
import com.tencentcloudapi.common.profile.HttpProfile;
import com.tencentcloudapi.common.exception.TencentCloudSDKException;
import com.tencentcloudapi.vod.v20180717.VodClient;
import com.tencentcloudapi.vod.v20180717.models.*;

public class Sample
{
    public static void main(String [] args) {
        try{
            // 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
            // 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
            // 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
            // 请参见：https://cloud.tencent.com/document/product/1278/85305
            // 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
            Credential cred = new Credential(System.getenv("TENCENTCLOUD_SECRET_ID"), System.getenv("TENCENTCLOUD_SECRET_KEY"));
            // 使用临时密钥示例
            // Credential cred = new Credential("SecretId", "SecretKey", "Token");
            // 实例化一个http选项，可选的，没有特殊需求可以跳过
            HttpProfile httpProfile = new HttpProfile();
            httpProfile.setEndpoint("vod.tencentcloudapi.com");
            // 实例化一个client选项，可选的，没有特殊需求可以跳过
            ClientProfile clientProfile = new ClientProfile();
            clientProfile.setHttpProfile(httpProfile);
            // 实例化要请求产品的client对象,clientProfile是可选的
            VodClient client = new VodClient(cred, "", clientProfile);
            // 实例化一个请求对象,每个接口都会对应一个request对象
            DescribeTaskDetailRequest req = new DescribeTaskDetailRequest();
            req.setTaskId("1500044236-AigcVideoTask-cd35c792def037f1edc9455a692608f3t");
            req.setSubAppId(1500044236L);
            // 返回的resp是一个DescribeTaskDetailResponse的实例，与请求对象对应
            DescribeTaskDetailResponse resp = client.DescribeTaskDetail(req);
            // 输出json格式的字符串回包
            System.out.println(AbstractModel.toJsonString(resp));
        } catch (TencentCloudSDKException e) {
            System.out.println(e.toString());
        }
    }
}



4.1.3.3 结果输出
{
  "Response": {
    "AigcImageTask": null,
    "AigcVideoTask": null,
    "BeginProcessTime": "2026-01-13T14:59:10Z",
    "ClipTask": null,
    "ComplexAdaptiveDynamicStreamingTask": null,
    "ComposeMediaTask": null,
    "ConcatTask": null,
    "CreateImageSpriteTask": null,
    "CreateTime": "2026-01-13T14:59:10Z",
    "DescribeFileAttributesTask": null,
    "EditMediaTask": null,
    "ExtractCopyRightWatermarkTask": null,
    "ExtractTraceWatermarkTask": null,
    "FinishTime": "2026-01-13T14:59:16Z",
    "ImportMediaKnowledge": null,
    "ProcedureTask": {
      "AiAnalysisResultSet": [],
      "AiContentReviewResultSet": [],
      "AiRecognitionResultSet": [],
      "FileId": "5145403712067473436",
      "FileName": "aigcVideoGenFile",
      "FileUrl": "https://1500044236.vod-qcloud.com/6ce20d3bvodcq1500044236/5e23ed1d5145403712067473436/aigcVideoGenFile.mp4",
      "MediaProcessResultSet": [],
      "MetaData": {
        "AudioDuration": 0,
        "AudioStreamSet": [],
        "Bitrate": 5556961,
        "Container": "mov,mp4,m4a,3gp,3g2,mj2",
        "Duration": 8,
        "Height": 720,
        "Md5": "",
        "Rotate": 0,
        "Size": 5556961,
        "VideoDuration": 8,
        "VideoStreamSet": [
          {
            "Bitrate": 5553765,
            "Codec": "h264",
            "CodecTag": "",
            "DynamicRangeInfo": {
              "HDRType": "",
              "Type": "Unknown"
            },
            "Fps": 24,
            "Height": 720,
            "Width": 1280
          }
        ],
        "Width": 1280
      },
      "OperationType": "",
      "Operator": "",
      "SessionContext": "",
      "SessionId": "",
      "Status": "FINISH",
      "TaskId": "1500044236-procedurev2-ec2f48fd6f7b6228e339da79deafe561tt0",
      "TasksNotifyMode": "Finish",
      "TasksPriority": 0
    },
    "ProcessMediaByMPSTask": null,
    "PullUploadTask": null,
    "QualityEnhanceTask": null,
    "QualityInspectTask": null,
    "RebuildMediaTask": null,
    "ReduceMediaBitrateTask": null,
    "RemoveWatermarkTask": null,
    "RequestId": "e93971c8-b3e0-43c7-9d71-35725cf449d0",
    "ReviewAudioVideoTask": null,
    "SceneAigcImageTask": null,
    "SnapshotByTimeOffsetTask": null,
    "SplitMediaTask": null,
    "Status": "FINISH",
    "TaskType": "Procedure",
    "TranscodeTask": null,
    "WechatMiniProgramPublishTask": null,
    "WechatPublishTask": null
  }
}

4.2 VOD 超分增强 - 上传&任务流主动触发
4.2.0 文档说明
VOD支持在文件上传是通过工作流【Procedure】主动触发超分增强任务，其中文件上传支持本地文件上传，也支持拉取URL上传
●我们强烈建议您使用云点播提供的 https://cloud.tencent.com/document/product/266/9759#1.-.E5.8F.91.E8.B5.B7.E4.B8.8A.E4.BC.A0  来上传文件。直接调用 API 进行上传的难度和工作量都显著大于使用 SDK。
模式	文档站（API文档）	备注
本地上传	https://cloud.tencent.com/document/product/266/31767 	
URL拉取上传	https://cloud.tencent.com/document/product/266/35575 	
●Procedure工作流
通过任务流可根据需要一次触发多个转码任务


4.2.1 模板配置&工作流配置
在使用超分增强能力时涉及到超分增强模板的配置
4.2.1.1 模板配置
① 内置模板-针对AI短剧优化（推荐）
如有特殊的视频效果增强需求，可联系腾讯云技术同学协助进行超分增强的模板配置与调优
编号	中文配置描述	英文标识符	关键特征解读
101550	漫剧场景 - 大模型增强 - 2K - 帧率随源 - 计费 - 降噪 + 超分 + 综合增强	AnimatedDrama-DiffusionEnhance-2K-SourceResolutionFrameRate	动漫 / 漫画类剧集、2K 分辨率、AI 扩散增强
101560	真人场景 - 大模型增强 - 2K - 帧率随源 - 计费 - 降噪 + 超分 + 综合增强	LiveActionDrama-DiffusionEnhance-2K-SourceResolutionFrameRate	真人拍摄剧集、2K 分辨率、AI 扩散增强
101570	漫剧场景 - 大模型增强 - 4K - 帧率随源 - 计费 - 降噪 + 超分 + 综合增强	AnimatedDrama-DiffusionEnhance-4K-SourceResolutionFrameRate	动漫 / 漫画类剧集、4K 超高清分辨率
101580	真人场景 - 大模型增强 - 4K - 帧率随源 - 计费 - 降噪 + 超分 + 综合增强	LiveActionDrama-DiffusionEnhance-4K-SourceResolutionFrameRate	真人拍摄剧集、4K 超高清分辨率
101510	漫剧场景 - 大模型增强 - 720P - 帧率随源 - 计费 - 降噪 + 超分 + 综合增强	AnimatedDrama-DiffusionEnhance-720P-SourceResolutionFrameRate	动漫 / 漫画类剧集、720P 高清分辨率
101520	真人场景 - 大模型增强 - 720P - 帧率随源 - 计费 - 降噪 + 超分 + 综合增强	LiveActionDrama-DiffusionEnhance-720P-SourceResolutionFrameRate	真人拍摄剧集、720P 高清分辨率
101530	漫剧场景 - 大模型增强 - 1080P - 帧率随源 - 计费 - 降噪 + 超分 + 综合增强	AnimatedDrama-DiffusionEnhance-1080P-SourceResolutionFrameRate	动漫 / 漫画类剧集、1080P 全高清分辨率
101540	真人场景 - 大模型增强 - 1080P - 帧率随源 - 计费 - 降噪 + 超分 + 综合增强	LiveActionDrama-DiffusionEnhance-1080P-SourceResolutionFrameRate	真人拍摄剧集、1080P 全高清分辨率

② 自助配置
VOD服务 >> 应用管理 >> 媒体处理设置 >> 模板设置 >> 视频转码模板
https://cloud.tencent.com/document/product/266/89538



4.2.1.2 工作流配置
VOD服务 >> 应用管理 >> 媒体处理设置 >> 任务流 
① 漫剧场景
https://doc.weixin.qq.com/doc/w3_AUUAAQaDAMYCNwkSB6enyQU6AWAeD?scode=AJEAIQdfAAoCBT4TQMAUUAAQaDAMY 	

② 通用场景
文档参考
https://cloud.tencent.com/document/product/266/33819

① 创建任务流

② 配置任务流并加载对应的模板
记录【任务流名称】


4.2.3 上传触发任务流
如下以URL拉流上传触发任务流为例子进行说明
4.2.3.1 JSON数据
{
        "MediaUrl": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/mps/aigc/jrl/20260210/jrl_test_1.mp4",
        "SubAppId": 1500044236,
        "Procedure": "AIGC-超分增强"
    }

4.2.3.2 代码实例 -Python
# -*- coding: utf-8 -*-

import os
import json
import types
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.vod.v20180717 import vod_client, models
try:
    # 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
    # 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
    # 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
    # 请参见：https://cloud.tencent.com/document/product/1278/85305
    # 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
    cred = credential.Credential(os.getenv("TENCENTCLOUD_SECRET_ID"), os.getenv("TENCENTCLOUD_SECRET_KEY"))
    # 使用临时密钥示例
    # cred = credential.Credential("SecretId", "SecretKey", "Token")
    # 实例化一个http选项，可选的，没有特殊需求可以跳过
    httpProfile = HttpProfile()
    httpProfile.endpoint = "vod.tencentcloudapi.com"

    # 实例化一个client选项，可选的，没有特殊需求可以跳过
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    # 实例化要请求产品的client对象,clientProfile是可选的
    client = vod_client.VodClient(cred, "", clientProfile)

    # 实例化一个请求对象,每个接口都会对应一个request对象
    req = models.PullUploadRequest()
    params = {
        "MediaUrl": "https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/mps/aigc/jrl/20260210/jrl_test_1.mp4",
        "SubAppId": 1500044236,
        "Procedure": "AIGC-超分增强"
    }
    req.from_json_string(json.dumps(params))

    # 返回的resp是一个PullUploadResponse的实例，与请求对象对应
    resp = client.PullUpload(req)
    # 输出json格式的字符串回包
    print(resp.to_json_string())

except TencentCloudSDKException as err:
    print(err)


4.2.3.2 代码实例 - Java

package com.tencent;
import com.tencentcloudapi.common.AbstractModel;

import com.tencentcloudapi.common.Credential;
import com.tencentcloudapi.common.profile.ClientProfile;
import com.tencentcloudapi.common.profile.HttpProfile;
import com.tencentcloudapi.common.exception.TencentCloudSDKException;
import com.tencentcloudapi.vod.v20180717.VodClient;
import com.tencentcloudapi.vod.v20180717.models.*;

public class Sample
{
    public static void main(String [] args) {
        try{
            // 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
            // 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
            // 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
            // 请参见：https://cloud.tencent.com/document/product/1278/85305
            // 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
            Credential cred = new Credential(System.getenv("TENCENTCLOUD_SECRET_ID"), System.getenv("TENCENTCLOUD_SECRET_KEY"));
            // 使用临时密钥示例
            // Credential cred = new Credential("SecretId", "SecretKey", "Token");
            // 实例化一个http选项，可选的，没有特殊需求可以跳过
            HttpProfile httpProfile = new HttpProfile();
            httpProfile.setEndpoint("vod.tencentcloudapi.com");
            // 实例化一个client选项，可选的，没有特殊需求可以跳过
            ClientProfile clientProfile = new ClientProfile();
            clientProfile.setHttpProfile(httpProfile);
            // 实例化要请求产品的client对象,clientProfile是可选的
            VodClient client = new VodClient(cred, "", clientProfile);
            // 实例化一个请求对象,每个接口都会对应一个request对象
            PullUploadRequest req = new PullUploadRequest();
            req.setMediaUrl("https://cz-cos-1300781609.cos.ap-guangzhou.myqcloud.com/mps/aigc/jrl/20260210/jrl_test_1.mp4");
            req.setSubAppId(1500044236L);
            req.setProcedure("AIGC-超分增强");
            // 返回的resp是一个PullUploadResponse的实例，与请求对象对应
            PullUploadResponse resp = client.PullUpload(req);
            // 输出json格式的字符串回包
            System.out.println(AbstractModel.toJsonString(resp));
        } catch (TencentCloudSDKException e) {
            System.out.println(e.toString());
        }
    }
}



4.2.3.3 结果输出
{
  "Response": {
    "RequestId": "e753bb2e-6f7d-4b03-91ac-ea5dbc233ce5",
    "TaskId": "1500044236-PullUpload-1bcb6e48e71647af49015c09e5b071c4t"
  }
}

可通过
VOD服务 >> 应用管理 >> 任务中心
查看任务的执行情况


4.2.3.4 结果查询（回调）
支持回调或者主动查询的形式获取任务结果，具体可参考【4.1.3 任务查询 - DescribeTaskDetail】

---

## Tanva GPT-image-2 尊享路线切换方案（2026-05）

### 目标
- 将 Tanva `gpt-image-2` 的尊享路线（`bananaImageRoute=stable`）从 Apimart 切换到腾讯 VOD AIGC。
- 普通路线（`bananaImageRoute=normal`）保持现状，不影响现有 Apimart 逻辑。

### 路由与供应商规则
- 命中条件：`model` 包含 `gpt-image-2` 且 `providerOptions.banana.imageRoute=stable`（兼容 `providerOptions.bananaImageRoute=stable`）。
- 命中后：后端 `Nano2Provider` 直接走 `TencentVodAigcService.createImageTask`，不再提交到 `api.apimart.ai`。
- 普通路线：继续走 Nano2/Apimart 既有任务提交流程。

### 腾讯 GPT-image-2 参数映射
- `ModelName`: 固定 `OG`
- `ModelVersion` 映射：
  - `quality=low` -> `image2_low`
  - `quality=medium` -> `image2_medium`
  - `quality=high` -> `image2_high`
  - 未显式给 `quality` 时按分辨率回退：
    - `4K` -> `image2_high`
    - `2K` -> `image2_medium`
    - `1K` -> `image2_low`
- `OutputConfig.Resolution`：使用 `1K/2K/4K`
- `OutputConfig.AspectRatio`：透传请求中的 `aspectRatio`
- `FileInfos`：支持两类参考图输入
  - `fileid:xxxx` / `tencent-fileid:xxxx` / 纯数字 FileId -> `Type=File`
  - `http(s)://...` -> `Type=Url`

### 环境变量要求
- `TENCENT_VOD_SECRET_ID`
- `TENCENT_VOD_SECRET_KEY`
- `TENCENT_VOD_SUB_APP_ID`
- 可选：`TENCENT_VOD_REGION`、`TENCENT_VOD_SESSION_TOKEN`、`TENCENT_VOD_ENDPOINT`
- 说明：这里直接复用 Nano Banana 尊享路线（stable -> 腾讯）当前已在用的同一套腾讯 VOD 凭证配置，不新增独立 key。

### 验证方式
1. 设置请求路由为 `stable`，模型选 `gpt-image-2`。
2. 发起生图请求后，日志应出现 `Nano2/Image/Tencent` 映射日志（`OG/image2_*`）。
3. 返回 `metadata` 中应包含：
   - `provider=tencent`
   - `channel=tencent_vod_aigc`
4. 不应再出现 GPT-image-2 尊享路线调用 `api.apimart.ai/v1/images/generations`。
