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
