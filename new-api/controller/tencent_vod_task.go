package controller

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// billAndMirrorTencentVodCreate 在 CreateAigcVideoTask 成功后：扣费 + 写消费日志 + 插入视频记录。
// 任何子步骤失败只 SysLog，绝不影响已成功的透传响应。
func billAndMirrorTencentVodCreate(c *gin.Context, ch *model.Channel, reqBody []byte, taskId string) {
	p, _ := parseTencentVodCreatePayload(reqBody) // 解析失败时 p 为零值，computeTencentVodCredits 走兜底
	credits := computeTencentVodCredits(p)
	quota := tencentVodQuota(credits)
	display := tencentVodDisplayModel(p.ModelName, p.ModelVersion)

	userId := c.GetInt("id")
	tokenId := c.GetInt("token_id")
	tokenKey := c.GetString("token_key")

	// 1. 真扣余额 + 用量统计
	if quota > 0 {
		if err := model.DecreaseUserQuota(userId, quota, true); err != nil {
			common.SysLog(fmt.Sprintf("tencent_vod bill: DecreaseUserQuota failed user=%d quota=%d: %s", userId, quota, err.Error()))
		}
		if err := model.DecreaseTokenQuota(tokenId, tokenKey, quota); err != nil {
			common.SysLog(fmt.Sprintf("tencent_vod bill: DecreaseTokenQuota failed token=%d quota=%d: %s", tokenId, quota, err.Error()))
		}
		model.UpdateUserUsedQuotaAndRequestCount(userId, quota)
		model.UpdateChannelUsedQuota(ch.Id, quota)
	}

	// 2. 消费日志
	model.RecordConsumeLog(c, userId, model.RecordConsumeLogParams{
		ChannelId: ch.Id,
		ModelName: display,
		TokenName: c.GetString("token_name"),
		Quota:     quota,
		Content:   fmt.Sprintf("腾讯VOD视频任务 %s %ds/%s, TaskId=%s", display, p.Duration, p.Resolution, taskId),
		TokenId:   tokenId,
		Group:     c.GetString("group"),
		Other: map[string]interface{}{
			"task_id":       taskId,
			"model_name":    p.ModelName,
			"model_version": p.ModelVersion,
			"duration":      p.Duration,
			"resolution":    p.Resolution,
			"audio":         p.Audio,
			"credits":       credits,
		},
	})

	// 3. 视频记录（被动镜像，初始 QUEUED）
	now := time.Now().Unix()
	task := &model.Task{
		TaskID:     taskId,
		Platform:   constant.TaskPlatformTencentVod,
		UserId:     userId,
		ChannelId:  ch.Id,
		Group:      c.GetString("group"),
		Quota:      quota,
		Action:     display,
		Status:     model.TaskStatusQueued,
		Progress:   "0%",
		SubmitTime: now,
		CreatedAt:  now,
		UpdatedAt:  now,
		Properties: model.Properties{
			UpstreamModelName: display,
			Resolution:        p.Resolution,
			Duration:          p.Duration,
		},
		PrivateData: model.TaskPrivateData{
			TokenId: tokenId,
			Key:     tokenKey,
		},
	}
	if err := task.Insert(); err != nil {
		common.SysLog(fmt.Sprintf("tencent_vod mirror: insert task %s failed: %s", taskId, err.Error()))
	}
}

// mirrorTencentVodPoll 观察到 DescribeTaskDetail 透传时，被动把状态镜像进对应 model.Task。
// 失败首次落地时退还创建时扣的 quota（靠 UpdateWithStatus CAS 保证只退一次）。
func mirrorTencentVodPoll(c *gin.Context, reqBody, respBytes []byte) {
	taskId := extractTencentVodReqTaskId(reqBody)
	if taskId == "" {
		return
	}
	task, exist, err := model.GetByOnlyTaskId(taskId)
	if err != nil || !exist || task == nil {
		return
	}
	if task.Platform != constant.TaskPlatformTencentVod {
		return
	}
	// 已终态，无需再处理
	if task.Status == model.TaskStatusSuccess || task.Status == model.TaskStatusFailure {
		return
	}

	rawStatus := extractTencentVodStatus(respBytes)
	newStatus := mapTencentVodStatus(rawStatus)
	fromStatus := task.Status

	switch newStatus {
	case model.TaskStatusInProgress:
		if task.Status == model.TaskStatusInProgress {
			return // 无变化，省一次写
		}
		task.Status = model.TaskStatusInProgress
		task.Progress = "50%"
		if task.StartTime == 0 {
			task.StartTime = time.Now().Unix()
		}
	case model.TaskStatusSuccess:
		url := extractTencentVodVideoURL(respBytes)
		task.Status = model.TaskStatusSuccess
		task.Progress = "100%"
		task.FinishTime = time.Now().Unix()
		task.PrivateData.ResultURL = url
		task.SetData(map[string]any{"result_url": url})
	case model.TaskStatusFailure:
		task.Status = model.TaskStatusFailure
		task.Progress = "100%"
		task.FinishTime = time.Now().Unix()
		if rawStatus != "" {
			task.FailReason = rawStatus
		} else {
			task.FailReason = "task failed"
		}
	}
	task.UpdatedAt = time.Now().Unix()

	won, err := task.UpdateWithStatus(fromStatus)
	if err != nil {
		common.SysLog(fmt.Sprintf("tencent_vod mirror: update task %s failed: %s", taskId, err.Error()))
		return
	}
	if !won {
		return // 已被其它 poll 抢先转移，跳过（也跳过退款，避免重复）
	}

	if newStatus == model.TaskStatusFailure {
		refundTencentVodTask(c, task)
	}
}

// refundTencentVodTask 失败退还：反向加回 user/token 额度并写一条退费日志。
func refundTencentVodTask(c *gin.Context, task *model.Task) {
	if task.Quota <= 0 {
		return
	}
	if err := model.IncreaseUserQuota(task.UserId, task.Quota, true); err != nil {
		common.SysLog(fmt.Sprintf("tencent_vod refund: IncreaseUserQuota failed user=%d quota=%d: %s", task.UserId, task.Quota, err.Error()))
	}
	if task.PrivateData.TokenId > 0 {
		if err := model.IncreaseTokenQuota(task.PrivateData.TokenId, task.PrivateData.Key, task.Quota); err != nil {
			common.SysLog(fmt.Sprintf("tencent_vod refund: IncreaseTokenQuota failed token=%d quota=%d: %s", task.PrivateData.TokenId, task.Quota, err.Error()))
		}
	}
	model.RecordConsumeLog(c, task.UserId, model.RecordConsumeLogParams{
		ChannelId: task.ChannelId,
		ModelName: task.Action,
		Quota:     -task.Quota,
		Content:   fmt.Sprintf("腾讯VOD视频任务失败退还 TaskId=%s", task.TaskID),
		TokenId:   task.PrivateData.TokenId,
		Group:     task.Group,
		Other: map[string]interface{}{
			"task_id": task.TaskID,
			"refund":  true,
		},
	})
}
