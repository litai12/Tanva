package apimart

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
)

// SubmitResponse must accept both the APIMart {code,data[]} envelope and the
// toapis flat "generation.task" envelope, exposing the right task id, poll path
// and rejection behaviour for each.
func TestSubmitResponseEnvelopes(t *testing.T) {
	t.Run("toapis flat accepted", func(t *testing.T) {
		var s SubmitResponse
		if err := common.UnmarshalJsonStr(`{"id":"tsk_img_01KT12","object":"generation.task","status":"pending","progress":0}`, &s); err != nil {
			t.Fatal(err)
		}
		if !s.IsFlat() {
			t.Error("expected IsFlat=true for toapis envelope")
		}
		if !s.Accepted() {
			t.Error("expected Accepted=true for a pending toapis task")
		}
		if got := s.TaskID(); got != "tsk_img_01KT12" {
			t.Errorf("TaskID=%q, want tsk_img_01KT12", got)
		}
		if got := FlatPollPath(s.TaskID()); got != "/v1/images/generations/tsk_img_01KT12" {
			t.Errorf("FlatPollPath=%q", got)
		}
	})
	t.Run("apimart wrapped accepted", func(t *testing.T) {
		var s SubmitResponse
		if err := common.UnmarshalJsonStr(`{"code":200,"data":[{"status":"submitted","task_id":"task_abc"}]}`, &s); err != nil {
			t.Fatal(err)
		}
		if s.IsFlat() {
			t.Error("expected IsFlat=false for APIMart envelope")
		}
		if !s.Accepted() || s.TaskID() != "task_abc" {
			t.Errorf("Accepted=%v TaskID=%q", s.Accepted(), s.TaskID())
		}
		if got := PollPath(s.TaskID()); got != "/v1/tasks/task_abc" {
			t.Errorf("PollPath=%q", got)
		}
	})
	t.Run("apimart error rejected", func(t *testing.T) {
		var s SubmitResponse
		if err := common.UnmarshalJsonStr(`{"code":400,"error":{"message":"bad request"}}`, &s); err != nil {
			t.Fatal(err)
		}
		if s.Accepted() {
			t.Error("expected Accepted=false for an error envelope")
		}
	})
}

// DetailResponse must parse both envelopes for status, terminal detection,
// result URLs and failure reason.
func TestDetailResponseEnvelopes(t *testing.T) {
	t.Run("toapis completed", func(t *testing.T) {
		var d DetailResponse
		if err := common.UnmarshalJsonStr(`{"id":"tsk_img_1","object":"generation.task","status":"completed","progress":100,"result":{"type":"image","data":[{"url":"https://files/a.jpg"}]}}`, &d); err != nil {
			t.Fatal(err)
		}
		if !d.Ready() {
			t.Fatal("expected Ready=true")
		}
		if !IsTerminal(d.EffectiveStatus()) {
			t.Errorf("expected terminal, status=%q", d.EffectiveStatus())
		}
		urls := d.AllURLs()
		if len(urls) != 1 || urls[0] != "https://files/a.jpg" {
			t.Errorf("AllURLs=%v", urls)
		}
	})
	t.Run("toapis queued non-terminal", func(t *testing.T) {
		var d DetailResponse
		if err := common.UnmarshalJsonStr(`{"object":"generation.task","status":"queued","progress":0}`, &d); err != nil {
			t.Fatal(err)
		}
		if !d.Ready() {
			t.Error("expected Ready=true for a queued task (keep polling)")
		}
		if IsTerminal(d.EffectiveStatus()) {
			t.Error("queued must not be terminal")
		}
	})
	t.Run("toapis failed surfaces error", func(t *testing.T) {
		var d DetailResponse
		if err := common.UnmarshalJsonStr(`{"object":"generation.task","status":"failed","progress":0,"error":{"code":"generation_failed","message":"upstream returned status 422"}}`, &d); err != nil {
			t.Fatal(err)
		}
		if d.EffectiveStatus() != StatusFailed {
			t.Errorf("status=%q", d.EffectiveStatus())
		}
		if got := d.FailureReason(); got != "upstream returned status 422" {
			t.Errorf("FailureReason=%q", got)
		}
	})
	t.Run("apimart completed regression", func(t *testing.T) {
		var d DetailResponse
		if err := common.UnmarshalJsonStr(`{"code":200,"data":{"status":"completed","progress":100,"result":{"images":[{"url":["https://files/b.png"]}]}}}`, &d); err != nil {
			t.Fatal(err)
		}
		if !d.Ready() || d.EffectiveStatus() != StatusCompleted {
			t.Errorf("Ready=%v status=%q", d.Ready(), d.EffectiveStatus())
		}
		urls := d.AllURLs()
		if len(urls) != 1 || urls[0] != "https://files/b.png" {
			t.Errorf("AllURLs=%v", urls)
		}
	})
}
