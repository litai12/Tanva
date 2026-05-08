创建 AIGC 生图任务
最近更新时间：2026-05-01 03:45:45

我的收藏
本页目录：
1. 接口描述
2. 输入参数
3. 输出参数
4. 示例
示例1 发起生成 AIGC 图片的任务
5. 开发者资源
腾讯云 API 平台
API Inspector
SDK
命令行工具
6. 错误码
1. 接口描述
接口请求域名： vod.tencentcloudapi.com 。

该接口用于生成 AIGC 图片。接口处于内测阶段，如需使用请联系我们，接口调用会产生实际费用，请参考点播 AIGC 生图片计费文档。该功能结算模式为后付费，日结客户当天使用将在第二天出账，月结客户将在次月1日统一出上月使用费用。

默认接口请求频率限制：20次/秒。

推荐使用 API Explorer
点击调试
API Explorer 提供了在线调用、签名验证、SDK 代码生成和快速检索接口等能力。您可查看每次调用的请求内容和返回结果以及自动生成 SDK 调用示例。
2. 输入参数
以下请求参数列表仅列出了接口请求参数和部分公共参数，完整公共参数列表见 公共请求参数。

参数名称	必选	类型	描述
Action	是	String	公共参数，本接口取值：CreateAigcImageTask。
Version	是	String	公共参数，本接口取值：2018-07-17。
Region	否	String	公共参数，此参数为可选参数。
SubAppId	是	Integer	
点播应用 ID。从2023年12月25日起开通点播的客户，如访问点播应用中的资源（无论是默认应用还是新创建的应用），必须将该字段填写为应用 ID。


示例值：251007502
ModelName	是	String	
模型名称。取值：

OG
GG
SI
Qwen
Hunyuan
Vidu
Kling

示例值：Hunyuan
ModelVersion	是	String	
模型版本。取值：

当 ModelName 是 OG，可选值为 image2_low、image2_medium、image2_high；
当 ModelName 是 GG，可选值为 2.5、3.0、3.1；
当 ModelName 是 Jimeng，可选值为 4.0；
当 ModelName 是 SI，可选值为 4.0、4.5、5.0-lite；
当 ModelName 是 Qwen，可选值为 0925；
当 ModelName 是 Hunyuan，可选值为 3.0；
当 ModelName 是 Vidu，可选值为 q2；
当 ModelName 是 Kling，可选值为 2.1、3.0、3.0-Omni、O1；

示例值：3.0
FileInfos.N	否	Array of AigcImageTaskInputFileInfo	
AIGC 生图任务的输入图片的文件信息。各模型支持最大参考图数量：

GG 2.5： 3张；
GG 3.0：14张；
GG 3.1：14张；
Kling 2.1：4张；
Kling 3.0：1张；
Kling 3.0-Omni：10张；
Kling O1：10张；
SI 4.0：14张；
SI 4.5：14张；
SI 5.0-lite：14张；
Vidu q2：7张；
Hunyuan 3.0：3张；
Qwen 0925：1张；
MJ v7：3张。
Prompt	否	String	
生成图片的提示词。当 FileInfos 为空时，此参数必填。


示例值：generate a car
NegativePrompt	否	String	
要阻止模型生成图片的提示词。


示例值：red
EnhancePrompt	否	String	
是否自动优化提示词。开启时将自动优化传入的 Prompt，以提升生成质量。取值有：

Enabled：开启；
Disabled：关闭；

示例值：Enabled
OutputConfig	否	AigcImageOutputConfig	
生图任务的输出媒体文件配置。

InputRegion	否	String	
输入的区域信息。可选值：

Mainland：中国大陆；
Oversea：海外；
OverseaUSWest：海外-美西；

示例值：Mainland
SceneType	否	String	
场景类型。取值如下：

当 ModelName 为 Hunyuan 时： 3d_panorama 表示全景图；
其他 ModelName 暂不支持。

示例值：3d_panorama
Seed	否	Integer	
模型随机种子。


示例值：123
SessionId	否	String	
用于去重的识别码，如果三天内曾有过相同的识别码的请求，则本次的请求会返回错误。最长 50 个字符，不带或者带空字符串表示不做去重。


示例值：mysession
SessionContext	否	String	
来源上下文，用于透传用户请求信息，音画质重生完成回调将返回该字段值，最长 1000 个字符。


示例值：mySessionContext
TasksPriority	否	Integer	
任务的优先级，数值越大优先级越高，取值范围是 -10 到 10，不填代表 0。


示例值：10
ExtInfo	否	String	
保留字段，特殊用途时使用。

Hunyuan 3.0

支持自由设置分辨率宽高，宽、高均在 [512, 2048] 像素范围内，宽高乘积 ≤ 1024x1024 像素。示例：{"AdditionalParameters": "{"size":"728x1024"}"}
SI 系列

支持自由设置分辨率宽高：
SI 4.0：合法总像素范围 [1280x720=921600, 4096x4096=16777216]，示例：{"AdditionalParameters": "{"size":"728x1356"}"}
SI 4.5：合法总像素范围 [2560x1440=3686400, 4096x4096=16777216]，示例：{"AdditionalParameters": "{"size":"2560x1440"}"}
SI 5.0-lite：合法总像素范围 [2560x1440=3686400, 3072x3072x1.1025=10404496]，示例：{"AdditionalParameters": "{"size":"2560x1440"}"}
可用于开启输出多张图像，示例：{"AdditionalParameters": "{"sequential_image_generation":"auto"}"}。除此之外，还需要在Prompt中说明需要输出图片张数，如：输出3张图片。
Qwen 0925

支持自由设置分辨率宽高，合法总像素范围 [512x512=261632, 2048x2048=4194304]。示例：{"AdditionalParameters": "{"size":"728*1024"}"}

示例值：{"AdditionalParameters": ""}
3. 输出参数
参数名称	类型	描述
TaskId	String	
任务 ID。


示例值：251007502-AigcImage***2782aff1e896673f1ft
RequestId	String	唯一请求 ID，由服务端生成，每次请求都会返回（若请求因其他原因未能抵达服务端，则该次请求不会获得 RequestId）。定位问题时需要提供该次请求的 RequestId。
4. 示例
示例1 发起生成 AIGC 图片的任务
输入示例
POST / HTTP/1.1
Host: vod.tencentcloudapi.com
Content-Type: application/json
X-TC-Action: CreateAigcImageTask
<公共请求参数>

{
    "SubAppId": 251007502,
    "ModelName": "GEM",
    "ModelVersion": "2.5",
    "FileInfos": [
        {
            "FileId": "3704211***509819"
        }
    ],
    "Prompt": "generate a car",
    "NegativePrompt": "red",
    "EnhancePrompt": "Enabled",
    "OutputConfig": {
        "StorageMode": "Temporary",
        "AspectRatio": "16:9",
        "PersonGeneration": "AllowAdult",
        "InputComplianceCheck": "Enabled",
        "OutputComplianceCheck": "Enabled"
    },
    "SessionId": "mysession",
    "SessionContext": "mySessionContext",
    "TasksPriority": "10",
    "ExtInfo": "myextinfo"
}
输出示例
{
    "Response": {
        "TaskId": "251007502-AigcImage***2782aff1e896673f1ft",
        "RequestId": "f50d7667-72d8-46bb-a7e3-0613588971b6"
    }
}
5. 开发者资源
腾讯云 API 平台
腾讯云 API 平台 是综合 API 文档、错误码、API Explorer 及 SDK 等资源的统一查询平台，方便您从同一入口查询及使用腾讯云提供的所有 API 服务。

API Inspector
用户可通过 API Inspector 查看控制台每一步操作关联的 API 调用情况，并自动生成各语言版本的 API 代码，也可前往 API Explorer 进行在线调试。

SDK
云 API 3.0 提供了配套的开发工具集（SDK），支持多种编程语言，能更方便的调用 API。

Tencent Cloud SDK 3.0 for Python: CNB, GitHub, Gitee
Tencent Cloud SDK 3.0 for Java: CNB, GitHub, Gitee
Tencent Cloud SDK 3.0 for PHP: CNB, GitHub, Gitee
Tencent Cloud SDK 3.0 for Go: CNB, GitHub, Gitee
Tencent Cloud SDK 3.0 for Node.js: CNB, GitHub, Gitee
Tencent Cloud SDK 3.0 for .NET: CNB, GitHub, Gitee
Tencent Cloud SDK 3.0 for C++: CNB, GitHub, Gitee
Tencent Cloud SDK 3.0 for Ruby: CNB, GitHub, Gitee
命令行工具
Tencent Cloud CLI 3.0
6. 错误码
以下仅列出了接口业务逻辑相关的错误码，其他错误码详见 公共错误码。

错误码	描述
FailedOperation	操作失败。
FailedOperation.InvalidVodUser	没有开通点播业务。
InternalError	内部错误。
InvalidParameter	参数错误。
InvalidParameterValue.FileId	FileId 不存在。
InvalidParameterValue.SessionContextTooLong	SessionContext 过长。
InvalidParameterValue.SessionId	去重识别码重复，请求被去重。
InvalidParameterValue.SessionIdTooLong	SessionId 过长。
InvalidParameterValue.SubAppId	参数值错误：应用 ID。
UnauthorizedOperation	未授权操作。
