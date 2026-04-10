创建 AIGC 生视频任务
最近更新时间：2026-03-25 03:39:38

我的收藏
本页目录：
1. 接口描述
2. 输入参数
3. 输出参数
4. 示例
示例1 发起生成 AIGC 视频的任务
5. 开发者资源
腾讯云 API 平台
API Inspector
SDK
命令行工具
6. 错误码
1. 接口描述
接口请求域名： vod.tencentcloudapi.com 。

该接口用于生成 AIGC 视频。接口处于内测阶段，如需使用请联系我们，接口调用会产生实际费用，请参考点播 AIGC 生视频计费文档。该功能结算模式为后付费，日结客户当天使用将在第二天出账，月结客户将在次月1日统一出上月使用费用。

默认接口请求频率限制：20次/秒。

推荐使用 API Explorer
点击调试
API Explorer 提供了在线调用、签名验证、SDK 代码生成和快速检索接口等能力。您可查看每次调用的请求内容和返回结果以及自动生成 SDK 调用示例。
2. 输入参数
以下请求参数列表仅列出了接口请求参数和部分公共参数，完整公共参数列表见 公共请求参数。

参数名称	必选	类型	描述
Action	是	String	公共参数，本接口取值：CreateAigcVideoTask。
Version	是	String	公共参数，本接口取值：2018-07-17。
Region	否	String	公共参数，此参数为可选参数。
SubAppId	是	Integer	
点播应用 ID。从2023年12月25日起开通点播的客户，如访问点播应用中的资源（无论是默认应用还是新创建的应用），必须将该字段填写为应用 ID。


示例值：251007502
ModelName	是	String	
模型名称。取值：
Kling：可灵；
Vidu；
Hailuo：海螺；
Jimeng：即梦；
Hunyuan：混元；
Mingmou：明眸；
GV；
OS；


示例值：Kling
ModelVersion	是	String	
模型版本。取值：
当 ModelName 是 Hailuo，可选值为 02、2.3、2.3-fast；
当 ModelName 是 Kling，可选值为 1.6、2.0、2.1、2.5、2.6、O1、3.0、3.0-Omni；
当 ModelName 是 Jimeng，可选值为 3.0pro；
当 ModelName 是 Vidu，可选值为 q2、q2-pro、q2-turbo、q3、q3-pro、q3-turbo；
当 ModelName 是 GV，可选值为 3.1、3.1-fast；
当 ModelName 是 OS，可选值为 2.0；
当 ModelName 是 Hunyuan，可选值为 1.5；
当 ModelName 是 Mingmou，可选值为 1.0；


示例值：O1
FileInfos.N	否	Array of AigcVideoTaskInputFileInfo	
用于描述模型在生成视频时要使用的资源文件，分为首尾帧模式、参考图、视频参考、视频编辑等模式。

首尾帧视频生成：FileInfos 第一张表示首帧（此时 FileInfos 最多包含一张图片），LastFrameFileId 或者 LastFrameUrl 表示尾帧。可以单独传首帧，不能单独传尾帧。首尾帧生成会参考图片比例。
参考图片生成：可传入单张图片或者多张，单张时候ObjectId字段必须不为空（区别于首帧生成）；参考图片，可以调整生成视频的宽高比例。
视频编辑、视频参考：Vidu、Kling可输入视频作为参考或者进行编辑。传入视频的同时也可以传入图片。

注意：

图片大小不超过10M。
支持的图片格式：jpeg、jpg、png。
关于模型某个版本是否支持参考图、首尾帧、视频编辑等功能，可向我们索取文档或者参考原厂文档信息。
SubjectInfos.N	否	Array of AigcVideoTaskInputSubjectInfo	
固定主体输入信息。

LastFrameFileId	否	String	
用于作为尾帧画面来生成视频的媒体文件 ID。该文件在云点播上的全局唯一标识符，在上传成功后由云点播后台分配。可以在 视频上传完成事件通知 或 云点播控制台 获取该字段。

指定该参数时，须同时通过 FileInfos 指定首帧画面。
图片大小需小于10M。
图片格式的取值为：jpeg，jpg, png, webp。

示例值：3704211***509911
LastFrameUrl	否	String	
用于作为尾帧画面来生成视频的媒体文件 URL。说明：

指定该参数时，须同时通过 FileInfos 指定首帧画面。
图片大小需小于5M。
图片格式的取值为：jpeg，jpg, png, webp。

示例值：https://test.com/1.png
Prompt	否	String	
生成视频的提示词。
当未传入参考文件，没有使用场景类型，ExtInfo不为空，Prompt 为必填。


示例值：generate a car
NegativePrompt	否	String	
要阻止模型生成视频的提示词。


示例值：red
EnhancePrompt	否	String	
是否自动优化提示词。开启时将自动优化传入的 Prompt，以提升生成质量。取值有：

Enabled：开启；
Disabled：关闭；

示例值：Enabled
OutputConfig	否	AigcVideoOutputConfig	
生视频任务的输出媒体文件配置。

InputRegion	否	String	
输入文件的区域信息。当文件url是国外地址时候，可选Oversea。默认Mainland。


示例值：Mainland
SceneType	否	String	
场景类型。取值如下：

当 ModelName 为 Kling 时： motion_control 表示动作控制； avatar_i2v 表示数字人； lip_sync 表示对口型；
当 ModelName 为 Vidu 时： template_effect 表示特效模板；
其他 ModelName 暂不支持。

示例值：motion_control
SessionId	否	String	
用于去重的识别码，如果三天内曾有过相同的识别码的请求，则本次的请求会返回错误。最长 50 个字符，不带或者带空字符串表示不做去重。


示例值：mysession2
SessionContext	否	String	
来源上下文，用于透传用户请求信息，音画质重生完成回调将返回该字段值，最长 1000 个字符。


示例值：mysessionContext
TasksPriority	否	Integer	
任务的优先级，数值越大优先级越高，取值范围是 -10 到 10，不填代表 0。


示例值：10
ExtInfo	否	String	
保留字段，特殊用途时使用。
可用于传入模型特殊参数、分镜prompt等


示例值：myextinfo
3. 输出参数
参数名称	类型	描述
TaskId	String	
任务 ID。


示例值：251007502-AigcVideo***25dacdcef7dd2b20fdt
RequestId	String	唯一请求 ID，由服务端生成，每次请求都会返回（若请求因其他原因未能抵达服务端，则该次请求不会获得 RequestId）。定位问题时需要提供该次请求的 RequestId。
4. 示例
示例1 发起生成 AIGC 视频的任务
输入示例
POST / HTTP/1.1
Host: vod.tencentcloudapi.com
Content-Type: application/json
X-TC-Action: CreateAigcVideoTask
<公共请求参数>

{
    "SubAppId": 251007502,
    "ModelName": "GV",
    "ModelVersion": "3.1-fast",
    "FileInfos": [
        {
            "FileId": "3704211***509819"
        }
    ],
    "LastFrameFileId": "3704211***509911",
    "Prompt": "generate a car",
    "NegativePrompt": "red",
    "EnhancePrompt": "Enabled",
    "OutputConfig": {
        "StorageMode": "Temporary",
        "AspectRatio": "9:16",
        "AudioGeneration": "Enabled",
        "PersonGeneration": "AllowAdult",
        "InputComplianceCheck": "Enabled",
        "OutputComplianceCheck": "Enabled"
    },
    "SessionId": "mysession2",
    "SessionContext": "mysessionContext",
    "TasksPriority": "10",
    "ExtInfo": "myextinfo"
}
输出示例
{
    "Response": {
        "TaskId": "251007502-AigcVideo***25dacdcef7dd2b20fdt",
        "RequestId": "d68920a4-c989-4afe-ac4d-2f06de99368e"
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
InvalidParameterValue.SessionIdTooLong	SessionId 过长。
InvalidParameterValue.SubAppId	参数值错误：应用 ID。
UnauthorizedOperation	未授权操作。