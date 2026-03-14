Omni 视频
接口与可灵官网一致；Omni Video (O1)

路径 POST /kling/v1/videos/omni-video
与官网一致：本页所有请求体、字段命名与返回结构与可灵官网保持一致
字段详解：请参考官网权威文档
请求参数
参数	类型	必填	说明
model_name	string	否	模型名称，默认 kling-video-o1
prompt	string	是	文本提示词，可包含正向/负向描述
image_list	array	否	参考图片列表（可作为首帧/尾帧）
element_list	array	否	主体参考列表
video_list	array	否	参考视频列表
mode	string	否	生成模式：std/pro，默认 pro
aspect_ratio	string	否	画面纵横比：16:9、9:16、1:1
duration	string	否	视频时长：3~10
watermark_info	object	否	是否生成含水印结果
callback_url	string	否	回调通知地址
external_task_id	string	否	自定义任务ID

kling O3四种模态
图片/主体参考：支持最多7张参考图或主体（主体可上传视频和图片）
图生视频：可一张或两张作为首尾帧生成视频
指令变换：必须上传视频可根据描述和图片进行编辑或者替换，支持最长10s视频素材
视频参考：必须上传视频可根据参考图或text描述，支持最长10s视频素材
特点：有声角色驱动,直出音画和分镜
请求体补充说明
prompt：支持通过 <<<image_1>>>、<<<element_1>>>、<<<video_1>>> 引用图片/主体/视频占位符；长度 ≤ 2500 字符。
model_name 支持 kling-video-o1、kling-v3-omni。
image_list 结构：
字段：image_url（URL 或 Base64）、type（first_frame/end_frame，可选）
约束：.jpg/.jpeg/.png；大小 ≤ 10MB；最小边 ≥ 300px；宽高比 1:2.5 ~ 2.5:1
首尾帧：不支持仅尾帧；有 end_frame 必须有 first_frame
张数限制：有参考视频时 ≤ 4 张；无参考视频时 ≤ 7 张；超过 2 张时不支持设置尾帧
element_list 结构：[{ "element_id": <ID> }]；与 image_list 合计张数限制同上
video_list 结构：
video_url（必填）、refer_type（feature/base）、keep_original_sound（yes/no）
约束：仅支持 1 段视频；格式 MP4/MOV；时长 310s；分辨率 7202160px；帧率 24~60fps；大小 ≤ 200MB
refer_type=base 为视频编辑：不可设置首尾帧；输出时长与输入视频一致，duration 无效
aspect_ratio：
文生视频 / 图片或主体参考 / 视频参考（非编辑）需要填写
使用首帧/首尾帧或视频编辑（refer_type=base）不支持
duration：
文生视频、首帧图生视频：仅支持 5/10
图片/主体参考或视频参考（非编辑）：支持 3~10
视频编辑（refer_type=base）：忽略，以输入视频时长为准
​
场景一：图片参考生成
curl --request POST \
  --url https://models.kapon.cloud/kling/v1/videos/omni-video \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "model_name": "kling-video-o1",
    "prompt": "<<<image_1>>>中的场景转为电影镜头",
    "image_list": [
      {"image_url": "https://example.com/ref.jpg"}
    ],
    "mode": "pro",
    "aspect_ratio": "16:9",
    "duration": "7"
  }'
​
场景二：视频编辑（refer_type=base）
curl --request POST \
  --url https://models.kapon.cloud/kling/v1/videos/omni-video \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "model_name": "kling-video-o1",
    "prompt": "给<<<video_1>>>中的人物戴上皇冠",
    "video_list": [
      {
        "video_url": "https://example.com/base.mp4",
        "refer_type": "base",
        "keep_original_sound": "yes"
      }
    ],
    "mode": "pro"
  }'
示例响应（创建任务）
{
  "code": 0,
  "message": "success",
  "request_id": "req_...",
  "data": {
    "task_id": "task_01...",
    "task_status": "submitted",
    "created_at": 1735558800000,
    "updated_at": 1735558800000
  }
}