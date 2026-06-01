package volcmediakit

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

// TestEnhanceCreditsMatchesBackendTable verifies every cell reproduces the
// backend VOLC_ENHANCE_VIDEO_PRICING table exactly (credits.service.ts).
func TestEnhanceCreditsMatchesBackendTable(t *testing.T) {
	cases := []struct {
		version    string
		resolution string
		limit      int
		fps        int
		want       int
	}{
		{"standard", "720p", 0, 0, 90},
		{"standard", "720p", 0, 60, 180},
		{"standard", "1080p", 0, 0, 180},
		{"standard", "1080p", 0, 60, 360},
		{"standard", "4k", 0, 0, 720},
		{"standard", "4k", 0, 60, 1440},
		{"professional", "720p", 0, 0, 750},
		{"professional", "720p", 0, 60, 1500},
		{"professional", "1080p", 0, 0, 1500},
		{"professional", "4k", 0, 60, 12000},
		// 2K tier only reachable via resolution_limit (1080 < limit <= 1440).
		{"standard", "", 1440, 0, 360},
		{"professional", "", 1440, 60, 6000},
		// resolution_limit short-edge mapping.
		{"standard", "", 720, 0, 90},
		{"standard", "", 1080, 0, 180},
		{"standard", "", 2000, 0, 720},
		// Defaults: unknown version → standard; no resolution → 1080P; fps<=30 → lte30.
		{"", "", 0, 0, 180},
		{"weird", "", 0, 30, 180},
	}
	for _, tc := range cases {
		got := EnhanceCredits(tc.version, tc.resolution, tc.limit, tc.fps)
		if got != tc.want {
			t.Errorf("EnhanceCredits(%q,%q,limit=%d,fps=%d) = %d, want %d",
				tc.version, tc.resolution, tc.limit, tc.fps, got, tc.want)
		}
	}
}

func TestEnhanceRatioIsCreditsOverBaseline(t *testing.T) {
	// standard/720P/lte30 is the base cell → ratio 1.0 (skipped by the relay).
	if r := EnhanceRatio("standard", "720p", 0, 0); r != 1.0 {
		t.Errorf("base ratio = %v, want 1.0", r)
	}
	// professional/4K/gt30 = 12000 credits → 12000/90.
	if r := EnhanceRatio("professional", "4k", 0, 60); r != float64(12000)/90.0 {
		t.Errorf("pro/4k/gt30 ratio = %v, want %v", r, float64(12000)/90.0)
	}
}

func metaReq(meta map[string]any) *relaycommon.TaskSubmitReq {
	return &relaycommon.TaskSubmitReq{Metadata: meta}
}

func TestBuildSubmitPayload(t *testing.T) {
	t.Run("missing video_url is rejected", func(t *testing.T) {
		if _, err := BuildSubmitPayload(metaReq(map[string]any{"tool_version": "standard"})); err == nil {
			t.Fatal("expected error for missing video_url")
		}
	})

	t.Run("resolution and resolution_limit mutually exclusive", func(t *testing.T) {
		_, err := BuildSubmitPayload(metaReq(map[string]any{
			"video_url":        "https://x/v.mp4",
			"resolution":       "1080p",
			"resolution_limit": float64(720),
		}))
		if err == nil {
			t.Fatal("expected mutual-exclusion error")
		}
	})

	t.Run("builds full body from metadata", func(t *testing.T) {
		p, err := BuildSubmitPayload(metaReq(map[string]any{
			"video_url":    "https://x/v.mp4",
			"tool_version": "professional",
			"scene":        "old_film",
			"resolution":   "4K", // upstream wants lowercase
			"fps":          float64(60),
		}))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p.VideoURL != "https://x/v.mp4" || p.ToolVersion != "professional" ||
			p.Scene != "old_film" || p.Resolution != "4k" || p.FPS != 60 {
			t.Fatalf("unexpected payload: %+v", p)
		}
	})

	t.Run("accepts camelCase params_def keys (toolVersion / resolutionLimit / videoUrl)", func(t *testing.T) {
		p, err := BuildSubmitPayload(metaReq(map[string]any{
			"videoUrl":        "https://x/v.mp4",
			"toolVersion":     "professional",
			"resolutionLimit": float64(1440),
		}))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p.VideoURL != "https://x/v.mp4" || p.ToolVersion != "professional" || p.ResolutionLimit != 1440 {
			t.Fatalf("camelCase keys not honored: %+v", p)
		}
	})

	t.Run("video_url falls back to InputReference", func(t *testing.T) {
		req := &relaycommon.TaskSubmitReq{InputReference: "https://x/ref.mp4"}
		p, err := BuildSubmitPayload(req)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p.VideoURL != "https://x/ref.mp4" || p.ToolVersion != "standard" {
			t.Fatalf("unexpected payload: %+v", p)
		}
	})
}

func TestParseTaskResult(t *testing.T) {
	a := &TaskAdaptor{}

	t.Run("completed yields success + url", func(t *testing.T) {
		info, err := a.ParseTaskResult([]byte(`{"success":true,"status":"completed","result":{"duration":5.9,"video_url":"https://x/out.mp4"}}`))
		if err != nil {
			t.Fatal(err)
		}
		if info.Status != model.TaskStatusSuccess || info.Url != "https://x/out.mp4" {
			t.Fatalf("unexpected: %+v", info)
		}
	})

	t.Run("failed yields failure + reason", func(t *testing.T) {
		info, err := a.ParseTaskResult([]byte(`{"success":false,"status":"failed","error":"boom"}`))
		if err != nil {
			t.Fatal(err)
		}
		if info.Status != model.TaskStatusFailure || info.Reason != "boom" {
			t.Fatalf("unexpected: %+v", info)
		}
	})

	t.Run("submitted yields queued", func(t *testing.T) {
		info, err := a.ParseTaskResult([]byte(`{"success":true,"status":"submitted"}`))
		if err != nil {
			t.Fatal(err)
		}
		if info.Status != model.TaskStatusQueued {
			t.Fatalf("unexpected: %+v", info)
		}
	})

	t.Run("unknown in-flight status yields in-progress", func(t *testing.T) {
		info, err := a.ParseTaskResult([]byte(`{"success":true,"status":"processing","result":{}}`))
		if err != nil {
			t.Fatal(err)
		}
		if info.Status != model.TaskStatusInProgress {
			t.Fatalf("unexpected: %+v", info)
		}
	})

	t.Run("result url without terminal status still completes", func(t *testing.T) {
		info, err := a.ParseTaskResult([]byte(`{"success":true,"result":{"video_url":"https://x/out.mp4"}}`))
		if err != nil {
			t.Fatal(err)
		}
		if info.Status != model.TaskStatusSuccess || info.Url != "https://x/out.mp4" {
			t.Fatalf("unexpected: %+v", info)
		}
	})
}
