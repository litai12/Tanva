package service

import (
	"bytes"
	"errors"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/shopspring/decimal"
)

// TapCanvas 资产规划（asset plan）异步任务经 Tanva 订单中转：受理即按固定单价预扣，
// 任务回执结清后按 TapCanvas 真实金额结算。
const TapCanvasAssetPlanModel = "tapcanvas-asset-plan"
const TapCanvasReceiptKindAssetPlan = "asset_plan"

const tapCanvasAssetPlanMaxBody = 32 << 20

// Submits stay well inside the 180s dispatch lease, so no heartbeat is needed.
var tapCanvasAssetPlanClient = &http.Client{Timeout: 60 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

type TapCanvasUpstreamResponse struct {
	Status int
	Header http.Header
	Body   []byte
}

func IsTanvaIdentifier(value string) bool { return tanvaIdentifier(value) }

// TapCanvasAssetPlanPreQuota is the fixed per-call price (ModelPrice) the order
// reserves; without one the model cannot be ordered.
func TapCanvasAssetPlanPreQuota(name string) (int64, float64, bool) {
	price, ok := ratio_setting.GetModelPrice(name, false)
	if !ok || price <= 0 || math.IsNaN(price) || math.IsInf(price, 0) {
		return 0, 0, false
	}
	quota := decimal.NewFromFloat(price).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).Ceil()
	return quota.IntPart(), price, true
}

// TapCanvasAssetPlanDefinitive reports upstream statuses that prove no job
// (and so no TapCanvas charge) was created.
func TapCanvasAssetPlanDefinitive(status int) bool {
	switch status {
	case http.StatusBadRequest, http.StatusUnauthorized, http.StatusPaymentRequired, http.StatusForbidden,
		http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity:
		return true
	}
	return false
}

// TapCanvasAssetPlanJobID extracts data.jobId from an accepted submit/retry.
func TapCanvasAssetPlanJobID(body []byte) string {
	var envelope struct {
		Data struct {
			JobID string `json:"jobId"`
		} `json:"data"`
	}
	if common.Unmarshal(body, &envelope) != nil || !tanvaIdentifier(envelope.Data.JobID) {
		return ""
	}
	return envelope.Data.JobID
}

// ParkTapCanvasAssetPlan binds the order to its accepted job and leaves the
// pre-consumed quota reserved until the job receipt settles.
func ParkTapCanvasAssetPlan(orderID int64, jobID string) error {
	raw, err := common.Marshal(dto.Usage{TapCanvasRequestID: jobID, TapCanvasReceiptKind: TapCanvasReceiptKindAssetPlan, TapCanvasBillingStatus: "pending"})
	if err != nil {
		return err
	}
	return model.AwaitTanvaAssetPlanReceipt(orderID, jobID, string(raw), time.Now().Unix())
}

// Submits always use the channel's first enabled key: an idempotent resend
// must reach the same TapCanvas account to get the same job back.
func tapCanvasSubmitKey(channel *model.Channel) (string, error) {
	for i, key := range channel.GetKeys() {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if channel.ChannelInfo.IsMultiKey {
			if status, ok := channel.ChannelInfo.MultiKeyStatusList[i]; ok && status != common.ChannelStatusEnabled {
				continue
			}
		}
		return key, nil
	}
	return "", errors.New("channel has no enabled key")
}

func TapCanvasAssetPlanChannelReady(channel *model.Channel) error {
	_, err := tapCanvasSubmitKey(channel)
	return err
}

// SubmitTapCanvasAssetPlan forwards a create (body = AssetPlanRequest) or a
// retry (body = nil) with the order's Idempotency-Key.
func SubmitTapCanvasAssetPlan(channel *model.Channel, path, idempotencyKey string, body []byte) (*TapCanvasUpstreamResponse, error) {
	key, err := tapCanvasSubmitKey(channel)
	if err != nil {
		return nil, err
	}
	return doTapCanvasAssetPlan(channel, http.MethodPost, path, key, idempotencyKey, body)
}

// ReadTapCanvasAssetPlan forwards status/result/cancel. Like the receipt
// reader it falls through keys on 404, since only the submitting key owns the job.
func ReadTapCanvasAssetPlan(channel *model.Channel, method, pathAndQuery string) (*TapCanvasUpstreamResponse, error) {
	first, err := tapCanvasSubmitKey(channel)
	if err != nil {
		return nil, err
	}
	keys := []string{first}
	for _, key := range channel.GetKeys() {
		if key = strings.TrimSpace(key); key != "" && key != first {
			keys = append(keys, key)
		}
	}
	var last *TapCanvasUpstreamResponse
	for _, key := range keys {
		resp, err := doTapCanvasAssetPlan(channel, method, pathAndQuery, key, "", nil)
		if err != nil {
			return nil, err
		}
		last = resp
		if resp.Status != http.StatusNotFound {
			break
		}
	}
	return last, nil
}

func doTapCanvasAssetPlan(channel *model.Channel, method, pathAndQuery, key, idempotencyKey string, body []byte) (*TapCanvasUpstreamResponse, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, strings.TrimRight(channel.GetBaseURL(), "/")+pathAndQuery, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", idempotencyKey)
	}
	resp, err := tapCanvasAssetPlanClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, tapCanvasAssetPlanMaxBody+1))
	if err != nil {
		return nil, err
	}
	if len(data) > tapCanvasAssetPlanMaxBody {
		return nil, errors.New("tapcanvas response too large")
	}
	return &TapCanvasUpstreamResponse{Status: resp.StatusCode, Header: resp.Header, Body: data}, nil
}
