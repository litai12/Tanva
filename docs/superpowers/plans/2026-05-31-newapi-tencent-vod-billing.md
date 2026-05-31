# new-api 腾讯 VOD 视频任务计费 + 视频记录 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让经 `POST /proxy/tencent/vod` 创建的 Vidu/Seedance 任务在 new-api 留消费日志、真实扣减 apikey 额度，并镜像出一条随生命周期推进的 `model.Task` 视频记录。

**Architecture:** 在 `proxyTencent` 透传成功后旁路观察：`CreateAigcVideoTask` 成功（有 TaskId）时按 new-api 自带近似价格表算 `quota = credits × 5000` 扣费并插入 `model.Task`(platform=`tencent_vod`)；后端的 `DescribeTaskDetail` 轮询也经过本代理，new-api 被动镜像状态到该 Task（成功写腾讯临时 URL，失败整退 quota）。new-api 自身轮询器排除 `tencent_vod`，后端零改动。

**Tech Stack:** Go 1.22 / Gin / GORM；new-api 现成原语 `model.RecordConsumeLog`、`Decrease/IncreaseUserQuota`、`Decrease/IncreaseTokenQuota`、`UpdateUserUsedQuotaAndRequestCount`、`UpdateChannelUsedQuota`、`model.Task` + `UpdateWithStatus`(CAS)。所有 JSON 走 `common.Unmarshal`（CLAUDE.md Rule 1）。

**Spec:** `docs/superpowers/specs/2026-05-31-newapi-tencent-vod-billing-design.md`

**工作目录：** 所有路径相对 `/Users/libiqiang/business/Tanva/new-api`。命令在该目录下执行。

---

## File Structure

- `constant/task.go`（改）— 新增 `TaskPlatformTencentVod` 平台常量。
- `model/task.go`（改）— `GetAllUnFinishSyncTasks` 排除 `tencent_vod`（不让自身轮询器抢）。
- `controller/tencent_vod_pricing.go`（新）— 请求体解析 + 价格表 + 纯函数 `computeTencentVodCredits` / `tencentVodQuota` / `tencentVodDisplayModel` / 动作判定。
- `controller/tencent_vod_json.go`（新）— 纯函数：从腾讯请求/响应 JSON 里取 TaskId / Status / 视频 URL。
- `controller/tencent_vod_task.go`（新）— 状态映射 + 创建时计费&插任务 + 轮询镜像&失败退还（触 DB）。
- `controller/tencent_proxy.go`（改）— 缓冲响应体，转发后调用 `observeTencentVodTask`。
- `controller/tencent_vod_pricing_test.go`（新）— 价格/换算/展示名/动作判定 表驱动单测。
- `controller/tencent_vod_json_test.go`（新）— JSON 提取 + 状态映射 单测。

> DB 触达的编排函数（计费/插任务/镜像/退还）无 controller 级 DB 测试桩，靠纯函数单测覆盖核心决策 + 末尾手测整链路。

---

## Task 1: 新增 `tencent_vod` 平台常量

**Files:**
- Modify: `constant/task.go`

- [ ] **Step 1: 加常量**

把 `constant/task.go` 顶部平台常量块改成：

```go
const (
	TaskPlatformSuno       TaskPlatform = "suno"
	TaskPlatformMidjourney              = "mj"
	TaskPlatformTencentVod              = "tencent_vod"
)
```

- [ ] **Step 2: 编译**

Run: `go build ./constant/...`
Expected: 无输出（成功）。

- [ ] **Step 3: 提交**

```bash
git add constant/task.go
git commit -m "feat(task): add tencent_vod task platform constant"
```

---

## Task 2: 价格表 + 换算 + 展示名 + 动作判定（纯函数 TDD）

**Files:**
- Create: `controller/tencent_vod_pricing.go`
- Test: `controller/tencent_vod_pricing_test.go`

- [ ] **Step 1: 写失败测试**

创建 `controller/tencent_vod_pricing_test.go`：

```go
package controller

import "testing"

func TestComputeTencentVodCredits(t *testing.T) {
	cases := []struct {
		name string
		in   tencentVodCreatePayload
		want int
	}{
		{"vidu q3 参考时长1080P", tencentVodCreatePayload{"Vidu", "q3", 8, "1080P", "Disabled"}, 1080},   // 600 * (8/8) * 1.8
		{"vidu q2 默认5s720P", tencentVodCreatePayload{"Vidu", "q2", 5, "720P", "Disabled"}, 600},       // 600 * 1 * 1
		{"seedance 2.0-pro 5s720P", tencentVodCreatePayload{"Seedance", "2.0-pro", 5, "720P", "Disabled"}, 1100},
		{"seedance 2.0-mini 5s480P", tencentVodCreatePayload{"Seedance", "2.0-mini", 5, "480P", "Disabled"}, 300}, // 500 * 1 * 0.6
		{"未知模型走兜底600", tencentVodCreatePayload{"Whatever", "x", 5, "720P", ""}, 600},
		{"大小写不敏感", tencentVodCreatePayload{"vidu", "Q2", 5, "720p", ""}, 600},
		{"时长0按系数1", tencentVodCreatePayload{"Vidu", "q2", 0, "720P", ""}, 600},
	}
	for _, c := range cases {
		if got := computeTencentVodCredits(c.in); got != c.want {
			t.Errorf("%s: got %d want %d", c.name, got, c.want)
		}
	}
}

func TestTencentVodQuota(t *testing.T) {
	if got := tencentVodQuota(600); got != 3_000_000 {
		t.Fatalf("got %d want 3000000", got)
	}
	if got := tencentVodQuota(0); got != 0 {
		t.Fatalf("got %d want 0", got)
	}
}

func TestTencentVodDisplayModel(t *testing.T) {
	if got := tencentVodDisplayModel("Vidu", "q3"); got != "vidu-q3" {
		t.Fatalf("got %q", got)
	}
	if got := tencentVodDisplayModel("Seedance", "2.0-pro"); got != "seedance-2.0-pro" {
		t.Fatalf("got %q", got)
	}
	if got := tencentVodDisplayModel("", ""); got != "tencent-vod-video" {
		t.Fatalf("got %q", got)
	}
}

func TestTencentVodActionPredicates(t *testing.T) {
	if !isTencentVodCreateAction("CreateAigcVideoTask") || !isTencentVodCreateAction("createaigcvideotask") {
		t.Fatal("create predicate failed")
	}
	if !isTencentVodDescribeAction("DescribeTaskDetail") {
		t.Fatal("describe predicate failed")
	}
	if isTencentVodCreateAction("DescribeTaskDetail") {
		t.Fatal("create predicate false positive")
	}
}

func TestParseTencentVodCreatePayload(t *testing.T) {
	body := []byte(`{"ModelName":"Vidu","ModelVersion":"q3","OutputConfig":{"Duration":8,"Resolution":"1080P","AspectRatio":"16:9","AudioGeneration":"Disabled"}}`)
	p, ok := parseTencentVodCreatePayload(body)
	if !ok {
		t.Fatal("expected ok")
	}
	if p.ModelName != "Vidu" || p.ModelVersion != "q3" || p.Duration != 8 || p.Resolution != "1080P" || p.Audio != "Disabled" {
		t.Fatalf("bad parse: %+v", p)
	}
}
```

- [ ] **Step 2: 运行确认失败**

Run: `go test ./controller/ -run 'TencentVod' -v`
Expected: 编译失败（`undefined: tencentVodCreatePayload` 等）。

- [ ] **Step 3: 写实现**

创建 `controller/tencent_vod_pricing.go`：

```go
package controller

import (
	"fmt"
	"math"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// tencentVodCreatePayload 是从 CreateAigcVideoTask 请求体里提取的定价维度。
type tencentVodCreatePayload struct {
	ModelName    string
	ModelVersion string
	Duration     int
	Resolution   string
	Audio        string // OutputConfig.AudioGeneration
}

type tencentVodOutputConfig struct {
	Duration        float64 `json:"Duration"`
	Resolution      string  `json:"Resolution"`
	AspectRatio     string  `json:"AspectRatio"`
	AudioGeneration string  `json:"AudioGeneration"`
}

type tencentVodCreateBody struct {
	ModelName    string                 `json:"ModelName"`
	ModelVersion string                 `json:"ModelVersion"`
	OutputConfig tencentVodOutputConfig `json:"OutputConfig"`
}

// 价格表（近似、可调；过渡期仅用于统计）。baseCredits 取自后端 credits.config.ts。
type tencentVodPrice struct {
	baseCredits int
	refDuration float64
}

var tencentVodBasePrices = map[string]map[string]tencentVodPrice{
	"vidu": {
		"q2": {600, 5},
		"q3": {600, 8},
	},
	"seedance": {
		"1.5-pro":  {600, 5},
		"2.0":      {600, 5},
		"2.0-pro":  {1100, 5},
		"2.0-lite": {700, 5},
		"2.0-mini": {500, 5},
	},
}

var tencentVodResolutionFactor = map[string]float64{
	"480P":  0.6,
	"720P":  1.0,
	"1080P": 1.8,
}

const (
	tencentVodDefaultBaseCredits = 600
	tencentVodDefaultRefDuration = 5.0
	tencentVodQuotaPerCredit     = 5000 // 100积分=1元=$1=500000quota ⟹ 1积分=5000quota
)

// computeTencentVodCredits 按 (模型,版本) 基础价 × 时长系数 × 分辨率系数 计算积分。
func computeTencentVodCredits(p tencentVodCreatePayload) int {
	name := strings.ToLower(strings.TrimSpace(p.ModelName))
	ver := strings.ToLower(strings.TrimSpace(p.ModelVersion))

	base := tencentVodDefaultBaseCredits
	ref := tencentVodDefaultRefDuration
	if price, ok := tencentVodBasePrices[name][ver]; ok {
		base = price.baseCredits
		ref = price.refDuration
	} else {
		common.SysLog(fmt.Sprintf("tencent_vod pricing: unknown model %q/%q, using default %d credits", p.ModelName, p.ModelVersion, base))
	}

	durFactor := 1.0
	if p.Duration > 0 && ref > 0 {
		durFactor = float64(p.Duration) / ref
	}
	resFactor := 1.0
	if f, ok := tencentVodResolutionFactor[strings.ToUpper(strings.TrimSpace(p.Resolution))]; ok {
		resFactor = f
	}

	credits := float64(base) * durFactor * resFactor
	if credits < 0 {
		credits = 0
	}
	return int(math.Round(credits))
}

// tencentVodQuota 把积分换算为 new-api quota。
func tencentVodQuota(credits int) int {
	if credits <= 0 {
		return 0
	}
	return credits * tencentVodQuotaPerCredit
}

// tencentVodDisplayModel 生成日志/任务里展示的模型名，如 vidu-q3 / seedance-2.0-pro。
func tencentVodDisplayModel(modelName, modelVersion string) string {
	name := strings.ToLower(strings.TrimSpace(modelName))
	ver := strings.ToLower(strings.TrimSpace(modelVersion))
	if name == "" && ver == "" {
		return "tencent-vod-video"
	}
	if ver == "" {
		return name
	}
	return name + "-" + ver
}

func isTencentVodCreateAction(action string) bool {
	return strings.EqualFold(strings.TrimSpace(action), "CreateAigcVideoTask")
}

func isTencentVodDescribeAction(action string) bool {
	return strings.EqualFold(strings.TrimSpace(action), "DescribeTaskDetail")
}

// parseTencentVodCreatePayload 解析创建请求体的定价维度；解析失败返回 (零值,false)。
func parseTencentVodCreatePayload(body []byte) (tencentVodCreatePayload, bool) {
	var b tencentVodCreateBody
	if err := common.Unmarshal(body, &b); err != nil {
		return tencentVodCreatePayload{}, false
	}
	return tencentVodCreatePayload{
		ModelName:    b.ModelName,
		ModelVersion: b.ModelVersion,
		Duration:     int(math.Round(b.OutputConfig.Duration)),
		Resolution:   b.OutputConfig.Resolution,
		Audio:        b.OutputConfig.AudioGeneration,
	}, true
}
```

- [ ] **Step 4: 运行确认通过**

Run: `go test ./controller/ -run 'TencentVod' -v`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
gofmt -w controller/tencent_vod_pricing.go controller/tencent_vod_pricing_test.go
git add controller/tencent_vod_pricing.go controller/tencent_vod_pricing_test.go
git commit -m "feat(tencent-vod): pricing table + credits→quota conversion (pure funcs)"
```

---

## Task 3: 腾讯 JSON 提取 + 状态映射（纯函数 TDD）

**Files:**
- Create: `controller/tencent_vod_json.go`
- Test: `controller/tencent_vod_json_test.go`

- [ ] **Step 1: 写失败测试**

创建 `controller/tencent_vod_json_test.go`：

```go
package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
)

func TestExtractTencentVodResponseTaskId(t *testing.T) {
	resp := []byte(`{"Response":{"TaskId":"245****-procedurev2xxx","RequestId":"req-1"}}`)
	if got := extractTencentVodResponseTaskId(resp); got != "245****-procedurev2xxx" {
		t.Fatalf("got %q", got)
	}
}

func TestExtractTencentVodReqTaskId(t *testing.T) {
	req := []byte(`{"TaskId":"task-abc","SubAppId":1412292672}`)
	if got := extractTencentVodReqTaskId(req); got != "task-abc" {
		t.Fatalf("got %q", got)
	}
}

func TestExtractTencentVodStatus(t *testing.T) {
	resp := []byte(`{"Response":{"AigcVideoTask":{"Status":"FINISH"}}}`)
	if got := extractTencentVodStatus(resp); got != "FINISH" {
		t.Fatalf("got %q", got)
	}
	resp2 := []byte(`{"Response":{"TaskDetail":{"Status":"PROCESSING"}}}`)
	if got := extractTencentVodStatus(resp2); got != "PROCESSING" {
		t.Fatalf("got %q", got)
	}
}

func TestExtractTencentVodVideoURL(t *testing.T) {
	resp := []byte(`{"Response":{"AigcVideoTask":{"Output":{"VideoUrl":"https://vod.example.com/a.mp4"}}}}`)
	if got := extractTencentVodVideoURL(resp); got != "https://vod.example.com/a.mp4" {
		t.Fatalf("got %q", got)
	}
}

func TestMapTencentVodStatus(t *testing.T) {
	success := []string{"FINISH", "finished", "Success", "DONE", "completed"}
	for _, s := range success {
		if mapTencentVodStatus(s) != model.TaskStatusSuccess {
			t.Errorf("%q should map to SUCCESS", s)
		}
	}
	fail := []string{"FAILED", "fail", "ERROR", "cancel", "timeout", "exception"}
	for _, s := range fail {
		if mapTencentVodStatus(s) != model.TaskStatusFailure {
			t.Errorf("%q should map to FAILURE", s)
		}
	}
	proc := []string{"PROCESSING", "WAITING", "", "queued", "unknown-thing"}
	for _, s := range proc {
		if mapTencentVodStatus(s) != model.TaskStatusInProgress {
			t.Errorf("%q should map to IN_PROGRESS", s)
		}
	}
}
```

- [ ] **Step 2: 运行确认失败**

Run: `go test ./controller/ -run 'TencentVod' -v`
Expected: 编译失败（`undefined: extractTencentVodResponseTaskId` 等）。

- [ ] **Step 3: 写实现**

创建 `controller/tencent_vod_json.go`：

```go
package controller

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// extractTencentVodResponseTaskId 从创建响应里取 TaskId（兼容 Response.TaskId / 顶层 TaskId）。
func extractTencentVodResponseTaskId(respBytes []byte) string {
	return findFirstByKeys(respBytes, []string{"TaskId"})
}

// extractTencentVodReqTaskId 从轮询请求体里取 TaskId。
func extractTencentVodReqTaskId(reqBytes []byte) string {
	return findFirstByKeys(reqBytes, []string{"TaskId"})
}

// extractTencentVodStatus 从轮询响应里取状态（与后端 extractStatus 同口径，递归找首个 Status/TaskStatus/State）。
func extractTencentVodStatus(respBytes []byte) string {
	return findFirstByKeys(respBytes, []string{"Status", "TaskStatus", "State"})
}

// extractTencentVodVideoURL 尽力从响应里找一个视频结果 URL（腾讯临时地址即可）。
func extractTencentVodVideoURL(respBytes []byte) string {
	var root any
	if err := common.Unmarshal(respBytes, &root); err != nil {
		return ""
	}
	best := ""
	var walk func(v any)
	walk = func(v any) {
		switch t := v.(type) {
		case map[string]any:
			for _, val := range t {
				walk(val)
			}
		case []any:
			for _, val := range t {
				walk(val)
			}
		case string:
			low := strings.ToLower(t)
			if strings.HasPrefix(low, "http://") || strings.HasPrefix(low, "https://") {
				if strings.HasSuffix(low, ".mp4") {
					best = t // .mp4 优先，直接采用
				} else if best == "" {
					best = t
				}
			}
		}
	}
	walk(root)
	return best
}

// findFirstByKeys 递归在 JSON 里找首个命中 keys 的字符串值（数字会转成字符串）。
func findFirstByKeys(raw []byte, keys []string) string {
	var root any
	if err := common.Unmarshal(raw, &root); err != nil {
		return ""
	}
	found := ""
	var walk func(v any) bool
	walk = func(v any) bool {
		switch t := v.(type) {
		case map[string]any:
			for _, k := range keys {
				if val, ok := t[k]; ok {
					if s, ok := val.(string); ok && s != "" {
						found = s
						return true
					}
					if n, ok := val.(float64); ok {
						found = strconv.FormatInt(int64(n), 10)
						return true
					}
				}
			}
			for _, val := range t {
				if walk(val) {
					return true
				}
			}
		case []any:
			for _, val := range t {
				if walk(val) {
					return true
				}
			}
		}
		return false
	}
	walk(root)
	return found
}

// mapTencentVodStatus 把腾讯状态字符串归一映射到 new-api TaskStatus。
func mapTencentVodStatus(raw string) model.TaskStatus {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "finish", "finished", "success", "succeed", "succeeded", "completed", "complete", "done":
		return model.TaskStatusSuccess
	case "failed", "fail", "error", "cancel", "cancelled", "exception", "timeout":
		return model.TaskStatusFailure
	default:
		return model.TaskStatusInProgress
	}
}
```

- [ ] **Step 4: 运行确认通过**

Run: `go test ./controller/ -run 'TencentVod' -v`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
gofmt -w controller/tencent_vod_json.go controller/tencent_vod_json_test.go
git add controller/tencent_vod_json.go controller/tencent_vod_json_test.go
git commit -m "feat(tencent-vod): JSON extractors + status mapping (pure funcs)"
```

---

## Task 4: 自身轮询器排除 `tencent_vod`

**Files:**
- Modify: `model/task.go`（`GetAllUnFinishSyncTasks`，约 328-337 行）

- [ ] **Step 1: 改查询**

把 `GetAllUnFinishSyncTasks` 改为额外排除 `tencent_vod` 平台（这些任务由 proxy 被动镜像驱动，new-api 不轮询）：

```go
func GetAllUnFinishSyncTasks(limit int) []*Task {
	var tasks []*Task
	var err error
	// get all tasks progress is not 100%
	// tencent_vod 由 /proxy/tencent/vod 被动镜像驱动，new-api 不自行轮询，排除以免 "adaptor not found"
	err = DB.Where("progress != ?", "100%").
		Where("status != ?", TaskStatusFailure).
		Where("status != ?", TaskStatusSuccess).
		Where("platform != ?", constant.TaskPlatformTencentVod).
		Limit(limit).Order("id").Find(&tasks).Error
	if err != nil {
		return nil
	}
	return tasks
}
```

> 确认 `model/task.go` 顶部已 import `"github.com/QuantumNous/new-api/constant"`（文件已使用 `constant.TaskPlatform`，应已存在）。若未 import 则补上。

- [ ] **Step 2: 编译**

Run: `go build ./model/...`
Expected: 无输出（成功）。

- [ ] **Step 3: 提交**

```bash
git add model/task.go
git commit -m "fix(task): exclude tencent_vod from new-api self polling sweep"
```

---

## Task 5: 创建时计费 + 插入视频记录；轮询镜像 + 失败退还

**Files:**
- Create: `controller/tencent_vod_task.go`

> 本 Task 触达 DB（依赖 context 注入的 userId/tokenId/group），核心决策已由 Task 2/3 纯函数覆盖。这里写编排实现，整链路在 Task 7 手测验证。

- [ ] **Step 1: 写实现**

创建 `controller/tencent_vod_task.go`：

```go
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
```

- [ ] **Step 2: 编译**

Run: `go build ./controller/...`
Expected: 无输出（成功）。

- [ ] **Step 3: 提交**

```bash
gofmt -w controller/tencent_vod_task.go
git add controller/tencent_vod_task.go
git commit -m "feat(tencent-vod): bill+mirror on create, passive status mirror + refund on fail"
```

---

## Task 6: 接入 `proxyTencent`（缓冲响应 + 观察）

**Files:**
- Modify: `controller/tencent_proxy.go`（`proxyTencent`，约 89-103 行的响应写回段）

- [ ] **Step 1: 加观察入口函数**

在 `controller/tencent_proxy.go` 末尾追加：

```go
// observeTencentVodTask 在 /proxy/tencent/vod 透传成功后旁路记账/镜像。
// 仅对 vod 服务、且 action 命中时动作；任何失败只 SysLog，不影响透传。
func observeTencentVodTask(c *gin.Context, ch *model.Channel, action string, reqBody []byte, status int, respBytes []byte) {
	defer func() {
		if r := recover(); r != nil {
			common.SysLog(fmt.Sprintf("observeTencentVodTask panic: %v", r))
		}
	}()

	switch {
	case isTencentVodCreateAction(action):
		if status < 200 || status >= 300 {
			return
		}
		taskId := extractTencentVodResponseTaskId(respBytes)
		if taskId == "" {
			return
		}
		billAndMirrorTencentVodCreate(c, ch, reqBody, taskId)
	case isTencentVodDescribeAction(action):
		mirrorTencentVodPoll(c, reqBody, respBytes)
	}
}
```

> `controller/tencent_proxy.go` 顶部 import 需含 `"fmt"`、`"github.com/QuantumNous/new-api/common"`、`"github.com/QuantumNous/new-api/model"`。`model` 已使用（`*model.Channel`），`fmt` 已使用，`common` 若未 import 则补上。

- [ ] **Step 2: 改响应写回为「缓冲 → 写回 → 观察」**

在 `proxyTencent` 里，把当前结尾的：

```go
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/json"
	}
	c.Status(resp.StatusCode)
	c.Header("Content-Type", contentType)
	_, _ = io.Copy(c.Writer, resp.Body)
}
```

替换为：

```go
	respBytes, _ := io.ReadAll(resp.Body)

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/json"
	}
	c.Status(resp.StatusCode)
	c.Header("Content-Type", contentType)
	_, _ = c.Writer.Write(respBytes)

	// 仅 VOD 视频任务链路做旁路记账/镜像（MPS 等不命中 action，自然 no-op）。
	if svcName == "vod" {
		observeTencentVodTask(c, ch, action, body, resp.StatusCode, respBytes)
	}
}
```

> `body`（请求体）与 `action` 在函数前段已读出（`body, _ := io.ReadAll(c.Request.Body)`、`action := c.GetHeader("X-TC-Action")`），此处直接复用。`svcName` 是 `proxyTencent` 的入参（`ProxyTencentVOD` 传 `"vod"`）。

- [ ] **Step 3: 编译 + 全量单测**

Run: `go build ./... && go test ./controller/ -run 'TencentVod' -v`
Expected: 构建成功；纯函数测试全 PASS。

- [ ] **Step 4: 提交**

```bash
gofmt -w controller/tencent_proxy.go
git add controller/tencent_proxy.go
git commit -m "feat(tencent-vod): wire observe (bill+mirror) into /proxy/tencent/vod"
```

---

## Task 7: 整链路手测验证

**Files:** 无（验证）

- [ ] **Step 1: 构建并启动 new-api**

Run: `go build -o /tmp/new-api . && echo build-ok`
Expected: `build-ok`。
按本地常规方式启动 new-api（连同后端可用的同一套配置）。

- [ ] **Step 2: 触发一个真实 vidu-q3 任务**

从后端正常发起一个 Vidu Q3 视频生成（走 `/proxy/tencent/vod`）。

- [ ] **Step 3: 核对消费日志 + 扣费**

- new-api 后台「日志（消费）」出现一条该任务记录，ModelName=`vidu-q3`，Quota>0。
- 该 apikey 对应 token / user 余额下降；渠道「已用额度」上升。

预期：均满足。

- [ ] **Step 4: 核对视频记录生命周期**

- new-api「任务/视频」视图出现该任务，平台 `tencent_vod`，初始 `QUEUED/IN_PROGRESS`。
- 后端持续轮询（经 proxy）后，记录最终变为 `SUCCESS`，`data.result_url` 为腾讯视频地址。

预期：均满足。

- [ ] **Step 5: 核对失败退还（如可造失败）**

构造或等待一个失败任务，确认记录变 `FAILURE`，且余额被退还、日志里有一条负 Quota 退费记录，且**只退一次**（多轮 poll 不重复）。

预期：均满足。

- [ ] **Step 6: 核对轮询器无报错**

观察 new-api 日志，确认没有针对这些任务的 `UpdateVideoTasks fail: ... adaptor not found` 周期性报错（Task 4 的排除生效）。

预期：无该报错。

---

## Self-Review 记录

- **Spec 覆盖**：调用日志✅(Task5)、真扣余额✅(Task5)、quota=积分×5000✅(Task2)、含时长/分辨率系数✅(Task2 价格表)、视频记录被动镜像✅(Task5)、tencent_vod 排除轮询器✅(Task4)、失败退还✅(Task5)、腾讯临时 URL✅(Task5 extractTencentVodVideoURL)、后端零改动✅。
- **类型一致**：`tencentVodCreatePayload`/`computeTencentVodCredits`/`tencentVodQuota`/`tencentVodDisplayModel`/`mapTencentVodStatus`/`findFirstByKeys` 在定义与调用处签名一致；`model.TaskStatusQueued/Success/Failure/InProgress`、`UpdateWithStatus(fromStatus)`、`Increase/DecreaseTokenQuota(id,key,quota)` 均按已核实签名使用。
- **无占位符**：每步含完整代码与命令。
- **已知近似**：价格系数为统计口径近似值（spec 已声明），可在 `tencent_vod_pricing.go` 直接调。
