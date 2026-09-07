package ali

import (
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"strings"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

func TestConvertToAliRequestPreservesHappyHorseMedia(t *testing.T) {
	t.Parallel()

	modelName := "happyhorse-1.0-video-edit"
	adaptor := &TaskAdaptor{}
	info := &relaycommon.RelayInfo{
		OriginModelName: modelName,
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: modelName,
		},
	}
	req := relaycommon.TaskSubmitReq{
		Model:  modelName,
		Prompt: "fallback prompt",
		Metadata: map[string]interface{}{
			"input": map[string]interface{}{
				"prompt": "replace the jacket",
				"media": []map[string]interface{}{
					{"type": "video", "url": "https://assets.example/source.mp4"},
					{"type": "reference_image", "url": "https://assets.example/jacket.png"},
				},
			},
			"parameters": map[string]interface{}{
				"resolution": "720P",
				"ratio":      "16:9",
				"duration":   5,
				"watermark":  false,
			},
		},
	}

	got, err := adaptor.convertToAliRequest(info, req)
	if err != nil {
		t.Fatalf("convertToAliRequest returned error: %v", err)
	}
	if got.Model != modelName {
		t.Fatalf("model = %q, want %q", got.Model, modelName)
	}
	if got.Input.Prompt != "replace the jacket" {
		t.Fatalf("prompt = %q", got.Input.Prompt)
	}
	if len(got.Input.Media) != 2 {
		t.Fatalf("media length = %d, want 2", len(got.Input.Media))
	}
	if got.Input.Media[0].Type != "video" || got.Input.Media[0].URL != "https://assets.example/source.mp4" {
		t.Fatalf("unexpected first media item: %+v", got.Input.Media[0])
	}
	if got.Parameters.Resolution != "720P" || got.Parameters.Ratio != "16:9" || got.Parameters.Duration != 5 {
		t.Fatalf("unexpected parameters: %+v", got.Parameters)
	}
}

func TestConvertToAliRequestPreservesWanReferenceVideos(t *testing.T) {
	t.Parallel()

	modelName := "wan2.6-r2v"
	adaptor := &TaskAdaptor{}
	info := &relaycommon.RelayInfo{
		OriginModelName: modelName,
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: modelName,
		},
	}
	req := relaycommon.TaskSubmitReq{
		Model: modelName,
		Metadata: map[string]interface{}{
			"input": map[string]interface{}{
				"prompt": "continue the action",
				"reference_video_urls": []string{
					"https://assets.example/a.mp4",
					"https://assets.example/b.mp4",
				},
			},
			"parameters": map[string]interface{}{
				"size":      "1280*720",
				"duration":  10,
				"shot_type": "multi",
			},
		},
	}

	got, err := adaptor.convertToAliRequest(info, req)
	if err != nil {
		t.Fatalf("convertToAliRequest returned error: %v", err)
	}
	if len(got.Input.ReferenceVideoURLs) != 2 {
		t.Fatalf("reference video length = %d, want 2", len(got.Input.ReferenceVideoURLs))
	}
	if got.Parameters.Size != "1280*720" || got.Parameters.Duration != 10 || got.Parameters.ShotType != "multi" {
		t.Fatalf("unexpected parameters: %+v", got.Parameters)
	}
}

func TestWan30RequestAndResolutionBilling(t *testing.T) {
	for resolution, multiplier := range map[string]float64{"480P": 1, "720P": 2, "1080P": 4} {
		t.Run(resolution, func(t *testing.T) {
			adaptor := &TaskAdaptor{}
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}
			req := relaycommon.TaskSubmitReq{Model: "wan3.0-video", Prompt: "a cat running",
				Metadata: map[string]interface{}{"parameters": map[string]interface{}{"resolution": resolution, "ratio": "adaptive", "duration": 5}}}
			got, err := adaptor.convertToAliRequest(info, req)
			if err != nil {
				t.Fatal(err)
			}
			if got.Model != "wan3.0-video" || got.Parameters.Resolution != resolution || got.Parameters.Duration != 5 || got.Parameters.Ratio != "adaptive" || got.Parameters.PromptExtend {
				t.Fatalf("incorrect Wan3.0 request: %+v", got)
			}
			ratios, err := ProcessAliOtherRatios(got)
			if err != nil || ratios["resolution-"+resolution] != multiplier {
				t.Fatalf("billing ratios: %v, %v", ratios, err)
			}
			req.Metadata["parameters"].(map[string]interface{})["resolution"] = "4K"
			if _, err := adaptor.convertToAliRequest(info, req); err == nil {
				t.Fatal("expected unsupported resolution error")
			}
		})
	}
}

func TestWan30MediaPreserved(t *testing.T) {
	for _, media := range [][]AliVideoMedia{
		{{Type: "first_frame", URL: "https://assets.example.com/start.png"}},
		{{Type: "first_frame", URL: "https://assets.example.com/start.png"}, {Type: "last_frame", URL: "https://assets.example.com/end.png"}},
		{{Type: "reference_image", URL: "https://assets.example.com/ref.png"}, {Type: "reference_video", URL: "https://assets.example.com/ref.mp4"}},
	} {
		adaptor := &TaskAdaptor{}
		info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}
		req := relaycommon.TaskSubmitReq{Model: "wan3.0-video", Metadata: map[string]interface{}{"input": map[string]interface{}{"media": media}}}
		got, err := adaptor.convertToAliRequest(info, req)
		if err != nil {
			t.Fatal(err)
		}
		if len(got.Input.Media) != len(media) {
			t.Fatalf("media lost: %+v", got.Input)
		}
		for i := range media {
			if got.Input.Media[i] != media[i] {
				t.Fatalf("media changed: %+v", got.Input.Media)
			}
		}
	}
}

func TestWan30MediaOnlySubmissionValidation(t *testing.T) {
	for _, tc := range []struct {
		body  string
		valid bool
	}{
		{`{"model":"wan3.0-video","metadata":{"input":{"media":[{"type":"first_frame","url":"https://assets.example.com/a.png"}]}}}`, true},
		{`{"model":"wan3.0-video","metadata":{"input":{"media":[]}}}`, false},
		{`{"model":"wan2.7-i2v","metadata":{"input":{"media":[{"type":"first_frame","url":"https://assets.example.com/a.png"}]}}}`, false},
	} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/v1/videos", strings.NewReader(tc.body))
		c.Request.Header.Set("Content-Type", "application/json")
		adaptor := &TaskAdaptor{}
		info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}, TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
		err := adaptor.ValidateRequestAndSetAction(c, info)
		if (err == nil) != tc.valid {
			t.Fatalf("validation = %v, expected valid=%v", err, tc.valid)
		}
	}
}
