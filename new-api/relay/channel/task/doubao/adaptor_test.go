package doubao

import (
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

// findRoles returns, in order, the (type, role) pairs of every content item.
func findRoles(items []ContentItem) [][2]string {
	out := make([][2]string, 0, len(items))
	for _, it := range items {
		out = append(out, [2]string{it.Type, it.Role})
	}
	return out
}

func TestModelListIncludesExactSeedance25ArkID(t *testing.T) {
	for _, modelName := range ModelList {
		if modelName == "doubao-seedance-2-5-260628" {
			return
		}
	}
	t.Fatalf("ModelList does not contain doubao-seedance-2-5-260628: %v", ModelList)
}

// Seedance 2.0 换主体：参考图 + 视频参考同时输入，必须各自带 reference_image /
// reference_video role，且文本在最后。回归 issue：top-level reference_videos 被丢弃。
func TestConvertReferenceImageAndVideoCoexist(t *testing.T) {
	a := &TaskAdaptor{}
	req := &relaycommon.TaskSubmitReq{
		Model:           "doubao-seedance-2-0-260128",
		Prompt:          "把视频中的人物替换成参考图人物",
		ReferenceImages: []string{"asset://img-1"},
		ReferenceVideos: []string{"https://example.com/source.mp4"},
	}

	r, err := a.convertToRequestPayload(req)
	if err != nil {
		t.Fatalf("convertToRequestPayload error: %v", err)
	}

	var img, video, text *ContentItem
	for i := range r.Content {
		switch r.Content[i].Type {
		case "image_url":
			img = &r.Content[i]
		case "video_url":
			video = &r.Content[i]
		case "text":
			text = &r.Content[i]
		}
	}

	if img == nil || img.Role != "reference_image" || img.ImageURL == nil || img.ImageURL.URL != "asset://img-1" {
		t.Fatalf("reference image item missing/wrong: %+v", img)
	}
	if video == nil || video.Role != "reference_video" || video.VideoURL == nil || video.VideoURL.URL != "https://example.com/source.mp4" {
		t.Fatalf("reference video item missing/wrong: %+v (roles=%v)", video, findRoles(r.Content))
	}
	if text == nil || text.Text != req.Prompt {
		t.Fatalf("text item missing/wrong: %+v", text)
	}
	// text must be last.
	if r.Content[len(r.Content)-1].Type != "text" {
		t.Fatalf("text must be the last content item, got %v", findRoles(r.Content))
	}
}

// 仅视频参考(无参考图)但带一张图：该图绝不能被标 first_frame，否则 Ark 400
// "first/last frame content cannot be mixed with reference media content"。
func TestConvertReferenceVideoForcesReferenceOnly(t *testing.T) {
	a := &TaskAdaptor{}
	req := &relaycommon.TaskSubmitReq{
		Model:           "doubao-seedance-2-0-260128",
		Prompt:          "延续视频",
		Images:          []string{"https://example.com/extra.png"},
		ReferenceVideos: []string{"https://example.com/source.mp4"},
	}

	r, err := a.convertToRequestPayload(req)
	if err != nil {
		t.Fatalf("convertToRequestPayload error: %v", err)
	}

	for _, it := range r.Content {
		if it.Role == "first_frame" || it.Role == "last_frame" {
			t.Fatalf("no image may be tagged first/last frame when a reference video is present, got %v", findRoles(r.Content))
		}
	}
	// the video must still be present.
	var hasVideo bool
	for _, it := range r.Content {
		if it.Type == "video_url" && it.Role == "reference_video" {
			hasVideo = true
		}
	}
	if !hasVideo {
		t.Fatalf("reference_video missing, got %v", findRoles(r.Content))
	}
}

// Seedance 2.0 音频参考必须经强类型 audio_urls 下发，且 asset:// URI 不得被网关改写。
func TestConvertReferenceAudioUsesAssetURI(t *testing.T) {
	a := &TaskAdaptor{}
	req := &relaycommon.TaskSubmitReq{
		Model:           "doubao-seedance-2-0-260128",
		Prompt:          "根据参考音频节奏生成画面",
		Images:          []string{"asset://image-1"},
		ReferenceAudios: []string{"asset://audio-1"},
	}

	r, err := a.convertToRequestPayload(req)
	if err != nil {
		t.Fatalf("convertToRequestPayload error: %v", err)
	}

	var audio *ContentItem
	for i := range r.Content {
		if r.Content[i].Type == "audio_url" {
			audio = &r.Content[i]
		}
		if r.Content[i].Role == "first_frame" || r.Content[i].Role == "last_frame" {
			t.Fatalf("audio reference must force reference-only roles, got %v", findRoles(r.Content))
		}
	}
	if audio == nil || audio.Role != "reference_audio" || audio.AudioURL == nil || audio.AudioURL.URL != "asset://audio-1" {
		t.Fatalf("reference audio item missing/wrong: %+v (roles=%v)", audio, findRoles(r.Content))
	}
}

func TestConvertVideoEditingPreservesArkAutoDuration(t *testing.T) {
	a := &TaskAdaptor{}
	req := &relaycommon.TaskSubmitReq{
		Model:           "doubao-seedance-2-5-260628",
		Prompt:          "替换成写实风格",
		Duration:        -1,
		AspectRatio:     "adaptive",
		ReferenceVideos: []string{"asset://video-1"},
		ProviderOptions: map[string]interface{}{"videoMode": "video_editing"},
	}

	r, err := a.convertToRequestPayload(req)
	if err != nil {
		t.Fatalf("convertToRequestPayload error: %v", err)
	}
	if r.Duration == nil || int(*r.Duration) != -1 {
		t.Fatalf("duration = %v, want pointer to -1", r.Duration)
	}
	if r.Ratio != "adaptive" {
		t.Fatalf("ratio = %q, want adaptive", r.Ratio)
	}
}

func TestConvertNormalVideoDoesNotInventNegativeDuration(t *testing.T) {
	a := &TaskAdaptor{}
	req := &relaycommon.TaskSubmitReq{
		Model:           "doubao-seedance-2-5-260628",
		Prompt:          "生成一个视频",
		Duration:        -1,
		ProviderOptions: map[string]interface{}{"videoMode": "text_to_video"},
	}

	r, err := a.convertToRequestPayload(req)
	if err != nil {
		t.Fatalf("convertToRequestPayload error: %v", err)
	}
	if r.Duration != nil {
		t.Fatalf("duration = %v, want omitted for non-editing mode", r.Duration)
	}
}
