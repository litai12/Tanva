package model

import (
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"gorm.io/gorm"
)

// TanvaAssetPlanModel mirrors service.TapCanvasAssetPlanModel (model cannot import service).
const TanvaAssetPlanModel = "tapcanvas-asset-plan"

// SyncTanvaAssetPlanTask mirrors an asset-plan order into the task log: the
// task appears once the order is parked on its TapCanvas job and turns
// terminal once the order settles, carrying the settled quota. finalized is
// true only on that single terminal transition, so the caller writes the
// consume log exactly once. jobStatus overrides the status recorded on the
// order's usage (used by the backfill of orders settled before it was recorded).
func SyncTanvaAssetPlanTask(orderID int64, jobStatus string) (task *Task, order *TanvaConsumption, finalized bool, err error) {
	// Read outside the transaction: the order's owner never changes, and the
	// user lookup must not need a second connection while the order is locked.
	var owner TanvaConsumption
	if err = DB.Select("user_id").First(&owner, orderID).Error; err != nil {
		return nil, nil, false, err
	}
	group, _ := GetUserGroup(owner.UserID, false)
	err = DB.Transaction(func(tx *gorm.DB) error {
		o, err := tanvaLockTx(tx, orderID)
		if err != nil {
			return err
		}
		order = o
		if o.Model != TanvaAssetPlanModel || o.TapCanvasJobID == "" {
			return nil
		}
		var found []Task
		if err := tx.Where("platform = ? AND task_id = ? AND user_id = ?", constant.TaskPlatformTapCanvas, o.TapCanvasJobID, o.UserID).
			Limit(1).Find(&found).Error; err != nil {
			return err
		}
		now := common.GetTimestamp()
		if len(found) == 0 {
			task = &Task{
				CreatedAt: now, UpdatedAt: now, TaskID: o.TapCanvasJobID, Platform: constant.TaskPlatformTapCanvas,
				UserId: o.UserID, Group: group, ChannelId: o.ChannelID, Quota: int(o.PreQuota),
				Action: constant.TaskActionAssetPlan, Status: TaskStatusInProgress,
				SubmitTime: o.StartedAt, StartTime: o.StartedAt,
				Properties:  Properties{OriginModelName: o.Model, UpstreamModelName: o.Model},
				PrivateData: TaskPrivateData{TokenId: o.TokenID, UpstreamTaskID: o.TapCanvasJobID},
			}
			task.SetData(map[string]interface{}{"tanva_order_id": o.OrderID, "reserved_quota": o.PreQuota})
			if err := tx.Create(task).Error; err != nil {
				return err
			}
		} else {
			task = &found[0]
		}
		if o.Status != "consumed" || task.Status == TaskStatusSuccess || task.Status == TaskStatusFailure {
			return nil
		}
		if jobStatus == "" {
			var usage dto.Usage
			if common.Unmarshal([]byte(o.UsageJSON), &usage) == nil {
				jobStatus = usage.TapCanvasJobStatus
			}
		}
		// A failed or canceled plan is still billed for the model usage it incurred.
		switch jobStatus {
		case "failed":
			task.Status, task.FailReason = TaskStatusFailure, "TapCanvas 规划失败，按已发生的模型用量结算"
		case "canceled":
			task.Status, task.FailReason = TaskStatusFailure, "规划已停止，按已发生的模型用量结算"
		default:
			task.Status = TaskStatusSuccess
		}
		task.Quota, task.Progress, task.FinishTime, task.UpdatedAt = int(o.ActualQuota), "100%", o.SettledAt, now
		task.SetData(map[string]interface{}{"tanva_order_id": o.OrderID, "reserved_quota": o.PreQuota,
			"cost_cny": o.Receipt().CostCny, "job_status": jobStatus})
		finalized = true
		return tx.Save(task).Error
	})
	return task, order, finalized, err
}

// RecordTanvaAssetPlanLog writes the consume log of a settled asset-plan order,
// dated at settlement so a backfilled entry lands where the charge happened.
func RecordTanvaAssetPlanLog(task *Task, o *TanvaConsumption) {
	if !common.LogConsumeEnabled {
		return
	}
	username, _ := GetUsernameById(o.UserID, false)
	tokenName := ""
	if o.TokenID > 0 {
		if token, err := GetTokenById(o.TokenID); err == nil {
			tokenName = token.Name
		}
	}
	costCny := o.Receipt().CostCny
	var jobStatus string
	if data := map[string]interface{}{}; common.Unmarshal(task.Data, &data) == nil {
		jobStatus, _ = data["job_status"].(string)
	}
	log := &Log{
		UserId: o.UserID, Username: username, CreatedAt: o.SettledAt, Type: LogTypeConsume,
		Content:   fmt.Sprintf("TapCanvas 资产规划 %s（%s），回执 ¥%s", o.TapCanvasJobID, assetPlanStatusText(task.Status), costCny),
		TokenName: tokenName, ModelName: o.Model, Quota: int(o.ActualQuota), ChannelId: o.ChannelID, TokenId: o.TokenID,
		UseTime: int(o.SettledAt - o.StartedAt), Group: task.Group, RequestId: o.RequestID,
		Other: common.MapToJsonStr(map[string]interface{}{"tanva_order_id": o.OrderID, "gateway_request_id": o.RequestID,
			"tapcanvas_job_id": o.TapCanvasJobID, "job_status": jobStatus, "usage_evidence": o.UsageEvidence,
			"cost_cny": costCny, "pre_quota": o.PreQuota}),
	}
	if err := LOG_DB.Create(log).Error; err != nil {
		common.SysLog("failed to record tanva asset plan log: " + err.Error())
	}
	if common.DataExportEnabled {
		LogQuotaData(o.UserID, username, o.Model, int(o.ActualQuota), o.SettledAt, 0)
	}
}

func assetPlanStatusText(status TaskStatus) string {
	if status == TaskStatusSuccess {
		return "规划成功"
	}
	return "规划未成功"
}

// ListTanvaAssetPlanOrdersToMirror returns asset-plan orders bound to a job
// whose task-log mirror is missing or not yet terminal while the order is settled.
func ListTanvaAssetPlanOrdersToMirror(limit int) ([]TanvaConsumption, error) {
	var rows []TanvaConsumption
	err := DB.Where("model = ? AND tap_canvas_job_id <> ?", TanvaAssetPlanModel, "").
		Where("NOT EXISTS (SELECT 1 FROM tasks WHERE tasks.platform = ? AND tasks.task_id = tanva_consumptions.tap_canvas_job_id"+
			" AND tasks.user_id = tanva_consumptions.user_id AND (tanva_consumptions.status <> ? OR tasks.status IN ?))",
			constant.TaskPlatformTapCanvas, "consumed", []string{TaskStatusSuccess, TaskStatusFailure}).
		Order("id").Limit(limit).Find(&rows).Error
	return rows, err
}
