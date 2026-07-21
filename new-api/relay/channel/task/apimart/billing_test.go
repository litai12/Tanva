package apimart

import (
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/gin-gonic/gin"
)

func newSeedance2BillingContext(t *testing.T, body string) *gin.Context {
	t.Helper()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/videos/generations", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	return c
}

func TestSeedance2BillingAddsInputAndOutputDurations(t *testing.T) {
	c := newSeedance2BillingContext(t, `{
		"model":"seedance-public-alias",
		"prompt":"test",
		"duration":5,
		"reference_videos":["https://cdn.example/ref.mp4"]
	}`)
	adaptor := &TaskAdaptor{
		videoDurationProbe: func(_ *gin.Context, rawURL string) (float64, error) {
			if rawURL != "https://cdn.example/ref.mp4" {
				t.Fatalf("unexpected reference URL: %s", rawURL)
			}
			return 5, nil
		},
	}
	info := &relaycommon.RelayInfo{
		OriginModelName: "seedance-public-alias",
		TaskRelayInfo:   &relaycommon.TaskRelayInfo{},
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "seedance-2",
		},
	}

	if taskErr := adaptor.ValidateRequestAndSetAction(c, info); taskErr != nil {
		t.Fatalf("ValidateRequestAndSetAction() error = %v", taskErr)
	}
	ratios, taskErr := adaptor.EstimateBillingChecked(c, info)
	if taskErr != nil {
		t.Fatalf("EstimateBillingChecked() error = %v", taskErr)
	}
	if got := ratios["seconds"]; got != 10 {
		t.Fatalf("billing seconds = %v, want 10", got)
	}
}

func TestSeedance2BillingSumsUniqueReferenceVideos(t *testing.T) {
	c := newSeedance2BillingContext(t, `{
		"model":"seedance-2-mini",
		"prompt":"test",
		"duration":5,
		"reference_videos":["https://cdn.example/a.mp4"],
		"video_with_roles":[
			{"url":"https://cdn.example/a.mp4","role":"reference_video"}
		],
		"metadata":{
			"video_urls":["https://cdn.example/b.mp4"],
			"video_with_roles":[
				{"url":"https://cdn.example/b.mp4","role":"reference_video"}
			]
		}
	}`)
	durations := map[string]float64{
		"https://cdn.example/a.mp4": 5,
		"https://cdn.example/b.mp4": 3,
	}
	probeCalls := 0
	adaptor := &TaskAdaptor{
		videoDurationProbe: func(_ *gin.Context, rawURL string) (float64, error) {
			probeCalls++
			return durations[rawURL], nil
		},
	}
	info := &relaycommon.RelayInfo{
		OriginModelName: "seedance-2-mini",
		TaskRelayInfo:   &relaycommon.TaskRelayInfo{},
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "seedance-2-mini",
		},
	}

	if taskErr := adaptor.ValidateRequestAndSetAction(c, info); taskErr != nil {
		t.Fatalf("ValidateRequestAndSetAction() error = %v", taskErr)
	}
	ratios, taskErr := adaptor.EstimateBillingChecked(c, info)
	if taskErr != nil {
		t.Fatalf("EstimateBillingChecked() error = %v", taskErr)
	}
	// Channel retries reuse the same Gin context. Real durations must come from
	// the request-local cache instead of downloading the same videos again.
	if _, taskErr := adaptor.EstimateBillingChecked(c, info); taskErr != nil {
		t.Fatalf("second EstimateBillingChecked() error = %v", taskErr)
	}
	if probeCalls != 2 {
		t.Fatalf("duration probe calls = %d, want 2 unique URLs", probeCalls)
	}
	if got := ratios["seconds"]; got != 13 {
		t.Fatalf("billing seconds = %v, want 13", got)
	}
}

func TestSeedance2BillingWithoutVideoUsesOutputDuration(t *testing.T) {
	c := newSeedance2BillingContext(t, `{
		"model":"seedance-2-fast",
		"prompt":"test",
		"duration":7
	}`)
	adaptor := &TaskAdaptor{}
	info := &relaycommon.RelayInfo{
		OriginModelName: "seedance-2-fast",
		TaskRelayInfo:   &relaycommon.TaskRelayInfo{},
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "seedance-2-fast",
		},
	}

	if taskErr := adaptor.ValidateRequestAndSetAction(c, info); taskErr != nil {
		t.Fatalf("ValidateRequestAndSetAction() error = %v", taskErr)
	}
	ratios, taskErr := adaptor.EstimateBillingChecked(c, info)
	if taskErr != nil {
		t.Fatalf("EstimateBillingChecked() error = %v", taskErr)
	}
	if got := ratios["seconds"]; got != 7 {
		t.Fatalf("billing seconds = %v, want output duration 7", got)
	}
}

func TestSeedance2BillingRejectsUnprobeableVideo(t *testing.T) {
	c := newSeedance2BillingContext(t, `{
		"model":"seedance-2-fast",
		"prompt":"test",
		"duration":5,
		"reference_videos":["https://cdn.example/broken.mp4"]
	}`)
	adaptor := &TaskAdaptor{
		videoDurationProbe: func(_ *gin.Context, _ string) (float64, error) {
			return 0, errors.New("unreadable")
		},
	}
	info := &relaycommon.RelayInfo{
		OriginModelName: "seedance-2-fast",
		TaskRelayInfo:   &relaycommon.TaskRelayInfo{},
	}

	if taskErr := adaptor.ValidateRequestAndSetAction(c, info); taskErr != nil {
		t.Fatalf("ValidateRequestAndSetAction() error = %v", taskErr)
	}
	_, taskErr := adaptor.EstimateBillingChecked(c, info)
	if taskErr == nil {
		t.Fatal("expected unreadable reference video to be rejected")
	}
	if taskErr.Code != "invalid_reference_video_duration" {
		t.Fatalf("error code = %q, want invalid_reference_video_duration", taskErr.Code)
	}
}

func TestSeedance2BillingRequiresExplicitOutputDuration(t *testing.T) {
	c := newSeedance2BillingContext(t, `{
		"model":"seedance-2",
		"prompt":"test",
		"duration":0
	}`)
	adaptor := &TaskAdaptor{}
	info := &relaycommon.RelayInfo{
		OriginModelName: "seedance-2",
		TaskRelayInfo:   &relaycommon.TaskRelayInfo{},
	}

	if taskErr := adaptor.ValidateRequestAndSetAction(c, info); taskErr != nil {
		t.Fatalf("ValidateRequestAndSetAction() error = %v", taskErr)
	}
	_, taskErr := adaptor.EstimateBillingChecked(c, info)
	if taskErr == nil {
		t.Fatal("expected automatic output duration to be rejected")
	}
	if taskErr.Code != "invalid_duration" {
		t.Fatalf("error code = %q, want invalid_duration", taskErr.Code)
	}
}

func TestSeedance2BillingDoesNotAffectOtherModels(t *testing.T) {
	c := newSeedance2BillingContext(t, `{
		"model":"kling-v2-6",
		"prompt":"test",
		"duration":5,
		"reference_videos":["https://cdn.example/ref.mp4"]
	}`)
	adaptor := &TaskAdaptor{
		videoDurationProbe: func(_ *gin.Context, _ string) (float64, error) {
			t.Fatal("non-Seedance model must not probe input video duration")
			return 0, nil
		},
	}
	info := &relaycommon.RelayInfo{
		OriginModelName: "kling-v2-6",
		TaskRelayInfo:   &relaycommon.TaskRelayInfo{},
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "kling-v2-6",
		},
	}

	if taskErr := adaptor.ValidateRequestAndSetAction(c, info); taskErr != nil {
		t.Fatalf("ValidateRequestAndSetAction() error = %v", taskErr)
	}
	ratios, taskErr := adaptor.EstimateBillingChecked(c, info)
	if taskErr != nil {
		t.Fatalf("EstimateBillingChecked() error = %v", taskErr)
	}
	if ratios != nil {
		t.Fatalf("EstimateBillingChecked() = %v, want nil", ratios)
	}
}
