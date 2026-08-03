package tencentvod

import (
	"net/http/httptest"
	"strings"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

func hailuoContext(t *testing.T, body string) *gin.Context {
	t.Helper()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/videos", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	return c
}

func TestHailuoH3TwoKOutputAndExcessImages(t *testing.T) {
	c := hailuoContext(t, `{"model":"hailuo-h3","prompt":"test","duration":10,"resolution":"2K","images":["a","b","c","d","e","f"]}`)
	a := &TaskAdaptor{}
	info := &relaycommon.RelayInfo{OriginModelName: "hailuo-h3", TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
	if taskErr := a.ValidateRequestAndSetAction(c, info); taskErr != nil {
		t.Fatal(taskErr)
	}
	ratios, taskErr := a.EstimateBillingChecked(c, info)
	if taskErr != nil {
		t.Fatal(taskErr)
	}
	if got := ratios["seconds"]; got != 10.25 {
		t.Fatalf("seconds=%v want 10.25", got)
	}
	if got := c.Writer.Header().Get("X-NewApi-Consumed-Credits"); got != "1230" {
		t.Fatalf("consumed credits header=%q want 1230", got)
	}
}

func TestHailuoH3FourKUsesResolutionRatioAndFixedImageFee(t *testing.T) {
	c := hailuoContext(t, `{"model":"hailuo-h3","prompt":"test","duration":10,"resolution":"4K","images":["a","b","c","d","e","f"]}`)
	a := &TaskAdaptor{}
	info := &relaycommon.RelayInfo{OriginModelName: "hailuo-h3", TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
	if taskErr := a.ValidateRequestAndSetAction(c, info); taskErr != nil {
		t.Fatal(taskErr)
	}
	ratios, taskErr := a.EstimateBillingChecked(c, info)
	if taskErr != nil {
		t.Fatal(taskErr)
	}
	if got := ratios["seconds"]; got != 10.2 {
		t.Fatalf("seconds=%v want 10.2", got)
	}
	if got := ratios["resolution"]; got != 1.25 {
		t.Fatalf("resolution=%v want 1.25", got)
	}
	if got := c.Writer.Header().Get("X-NewApi-Consumed-Credits"); got != "1530" {
		t.Fatalf("consumed credits header=%q want 1530", got)
	}
}

func TestHailuoH3RejectsUnsupportedResolution(t *testing.T) {
	c := hailuoContext(t, `{"model":"hailuo-h3","prompt":"test","duration":4,"resolution":"1080P"}`)
	a := &TaskAdaptor{}
	info := &relaycommon.RelayInfo{OriginModelName: "hailuo-h3", TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
	if taskErr := a.ValidateRequestAndSetAction(c, info); taskErr != nil {
		t.Fatal(taskErr)
	}
	_, taskErr := a.EstimateBillingChecked(c, info)
	if taskErr == nil || taskErr.Code != "invalid_resolution" {
		t.Fatalf("error=%v", taskErr)
	}
}
