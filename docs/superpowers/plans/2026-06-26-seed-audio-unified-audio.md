# Seed-Audio + Unified Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Volcengine `doubao-seed-audio-1-0` via the existing ark/volcengine channel, unify backend audio behind one provider abstraction, merge the 4 frontend audio nodes into one `audioStudio` node, with single-track billing through new-api.

**Architecture:** new-api gets a model-conditional seed-audio branch on the volcengine adaptor calling `openspeech.bytedance.com/api/v3/tts/create` and emits an `X-NewApi-Consumed-Credits` header so backend can post-deduct the exact 积分 new-api priced. Backend introduces `src/ai/audio/` (interface + 4 providers + routing + one route). Frontend collapses 4 nodes into `audioStudio` with a mode selector + auto-migration of saved nodes.

**Tech Stack:** Go (new-api relay adaptor), NestJS (backend, Prisma credits), React + reactflow11 (frontend). Frontend type-check: `tsc -b` (NOT `tsc --noEmit`). new-api build: `cd new-api && go build ./...`.

**Spec:** `docs/superpowers/specs/2026-06-26-seed-audio-unified-audio-design.md`

**Branch:** `feat/seed-audio-unified` (branch off `main`; do not commit to `main`).

---

## File Structure

**new-api (Go):**
- Modify `relay/channel/volcengine/constants.go` — register model in `ModelList`.
- Create `relay/channel/volcengine/seed_audio.go` — seed-audio request/response structs + build/parse helpers + `isSeedAudioModel`.
- Modify `relay/channel/volcengine/adaptor.go` — branch into seed-audio for URL/header/convert/do/response.
- Modify `relay/audio_handler.go` — set `X-NewApi-Consumed-Credits` / `X-NewApi-Audio-Duration` response headers after billing.
- Modify `setting/ratio_setting/model_ratio.go` — price entry for the model.
- Test: `relay/channel/volcengine/seed_audio_test.go`.

**backend (NestJS):**
- Create `src/ai/audio/audio-provider.interface.ts`, `audio-generate.dto.ts`, `audio-routing.service.ts`.
- Create `src/ai/audio/providers/seed-audio.provider.ts`, `minimax-speech.provider.ts`, `minimax-music.provider.ts`, `tencent-dub.provider.ts`.
- Modify `src/ai/ai.controller.ts` — add `POST /api/ai/audio/generate` (+ async + task), add `withCreditsFromGateway`, convert legacy routes to shims.
- Modify `src/ai/ai.module.ts` — register providers + routing service.
- Modify `src/credits/credits.service.ts` — support gateway-reported post-deduct.
- (No new `credits.config.ts` entry for seed-audio — price lives in new-api.)

**frontend (React):**
- Create `src/components/flow/nodes/AudioStudioNode.tsx`, `src/components/flow/nodes/audioStudioModes.ts`, `src/components/flow/nodes/AudioResultPanel.tsx`.
- Create `src/services/audioService.ts`.
- Modify `src/components/flow/types.ts` — `NodeKind` + `AudioStudioData` + `AnyNodeData`.
- Modify `src/components/flow/FlowOverlay.tsx` — all ~14 registries + run dispatch + legacy alias/migration.
- Modify `src/services/nodeConfigService.ts` — node config entry.
- Delete (after migration verified): `AudioNode.tsx`, `MinimaxSpeechNode.tsx`, `TencentSpeechNode.tsx`, `MinimaxMusicNode.tsx`.

---

## LAYER 1 — new-api seed-audio adapter

### Task 1: Register the model

**Files:** Modify `new-api/relay/channel/volcengine/constants.go`

- [ ] **Step 1:** Add `"doubao-seed-audio-1-0"` to the `ModelList` slice (lines 3–30).
- [ ] **Step 2:** Build: `cd new-api && go build ./relay/...` → expect success.
- [ ] **Step 3:** Commit: `git commit -am "feat(newapi): register doubao-seed-audio-1-0 on volcengine channel"`

### Task 2: Seed-audio request/response model + detector (TDD)

**Files:** Create `new-api/relay/channel/volcengine/seed_audio.go`, `seed_audio_test.go`

- [ ] **Step 1: Write failing test** in `seed_audio_test.go`:

```go
package volcengine

import "testing"

func TestIsSeedAudioModel(t *testing.T) {
	if !isSeedAudioModel("doubao-seed-audio-1-0") {
		t.Fatal("expected seed-audio match")
	}
	if isSeedAudioModel("doubao-seedance-1-0") {
		t.Fatal("seedance must not match seed-audio")
	}
}

func TestBuildSeedAudioBody(t *testing.T) {
	body := buildSeedAudioRequest("你好", "zh_female_x", "mp3", nil)
	if body.Model != "seed-audio-1.0" || body.TextPrompt != "你好" {
		t.Fatalf("bad body: %+v", body)
	}
	if body.Speaker != "zh_female_x" || body.AudioConfig.Format != "mp3" {
		t.Fatalf("bad mapping: %+v", body)
	}
}
```

- [ ] **Step 2: Run, expect FAIL** (undefined): `cd new-api && go test ./relay/channel/volcengine/ -run SeedAudio`
- [ ] **Step 3: Implement** `seed_audio.go`:

```go
package volcengine

import (
	"encoding/json"
	"strings"
)

const seedAudioModelName = "seed-audio-1.0"
const seedAudioCreateURL = "https://openspeech.bytedance.com/api/v3/tts/create"

func isSeedAudioModel(model string) bool {
	return strings.HasPrefix(strings.ToLower(model), "doubao-seed-audio")
}

type SeedAudioConfig struct {
	Format       string `json:"format,omitempty"`
	SampleRate   int    `json:"sample_rate,omitempty"`
	SpeechRate   int    `json:"speech_rate,omitempty"`
	LoudnessRate int    `json:"loudness_rate,omitempty"`
	PitchRate    int    `json:"pitch_rate,omitempty"`
}

type SeedAudioRequest struct {
	Model       string          `json:"model"`
	TextPrompt  string          `json:"text_prompt"`
	Speaker     string          `json:"speaker,omitempty"`
	AudioURL    string          `json:"audio_url,omitempty"`
	AudioData   string          `json:"audio_data,omitempty"`
	ImageURL    string          `json:"image_url,omitempty"`
	ImageData   string          `json:"image_data,omitempty"`
	References  json.RawMessage `json:"references,omitempty"`
	AudioConfig SeedAudioConfig `json:"audio_config"`
	Watermark   json.RawMessage `json:"watermark,omitempty"`
}

type SeedAudioResponse struct {
	Code             int     `json:"code"`
	Message          string  `json:"message"`
	Audio            string  `json:"audio"`
	Duration         float64 `json:"duration"`
	OriginalDuration float64 `json:"original_duration"`
	URL              string  `json:"url"`
}

// meta carries seed-audio extras forwarded from AudioRequest.Metadata.
type seedAudioMeta struct {
	SampleRate   int             `json:"sample_rate,omitempty"`
	LoudnessRate int             `json:"loudness_rate,omitempty"`
	PitchRate    int             `json:"pitch_rate,omitempty"`
	AudioURL     string          `json:"audio_url,omitempty"`
	AudioData    string          `json:"audio_data,omitempty"`
	ImageURL     string          `json:"image_url,omitempty"`
	ImageData    string          `json:"image_data,omitempty"`
	References   json.RawMessage `json:"references,omitempty"`
	Watermark    json.RawMessage `json:"watermark,omitempty"`
}

func buildSeedAudioRequest(input, voice, format string, metadata json.RawMessage) SeedAudioRequest {
	if format == "" {
		format = "wav"
	}
	req := SeedAudioRequest{
		Model:       seedAudioModelName,
		TextPrompt:  input,
		Speaker:     voice,
		AudioConfig: SeedAudioConfig{Format: format},
	}
	if len(metadata) > 0 {
		var m seedAudioMeta
		if err := json.Unmarshal(metadata, &m); err == nil {
			req.AudioConfig.SampleRate = m.SampleRate
			req.AudioConfig.LoudnessRate = m.LoudnessRate
			req.AudioConfig.PitchRate = m.PitchRate
			req.AudioURL, req.AudioData = m.AudioURL, m.AudioData
			req.ImageURL, req.ImageData = m.ImageURL, m.ImageData
			req.References, req.Watermark = m.References, m.Watermark
			// when a reference is supplied, speaker must be cleared (API is 三选一)
			if m.AudioURL != "" || m.AudioData != "" || m.ImageURL != "" || m.ImageData != "" {
				req.Speaker = ""
			}
		}
	}
	return req
}
```

- [ ] **Step 4: Run, expect PASS.** **Step 5: Commit** `feat(newapi): seed-audio request model + detector`.

### Task 3: Wire seed-audio into the volcengine adaptor

**Files:** Modify `new-api/relay/channel/volcengine/adaptor.go`

- [ ] **Step 1:** In `GetRequestURL` `RelayModeAudioSpeech` case (~line 417): if `isSeedAudioModel(info.OriginModelName)` return `seedAudioCreateURL` (allow `{base}/api/v3/tts/create` when a non-default base URL is set).
- [ ] **Step 2:** In `SetupRequestHeader` audio branch (~line 431): if seed-audio, set `req.Set("X-Api-Key", info.ApiKey)` + `req.Set("Content-Type","application/json")` and SKIP the `|`-split/`Bearer;` logic.
- [ ] **Step 3:** In `ConvertAudioRequest` (~line 50): if seed-audio, `body := buildSeedAudioRequest(request.Input, request.Voice, request.ResponseFormat, request.Metadata)`; map `request.Speed` → `body.AudioConfig.SpeechRate` (clamp [-50,100]); marshal and return it; set `info.IsStream = false` (skip the WS path). Cache nothing in context for the WS handler.
- [ ] **Step 4:** In `DoRequest` (~line 473): seed-audio must follow the normal HTTP POST path (do NOT return `(nil,nil)` like the WS branch).
- [ ] **Step 5:** In `DoResponse` (~line 489): if seed-audio, read body, `json.Unmarshal` into `SeedAudioResponse`; on `code != 0` return an OpenAIError with message + logid; else base64-decode `Audio`, `c.Data(200, contentTypeFor(format), bytes)`; build `usage` with audio duration = `OriginalDuration` so the audio-quota path fires. Stash `OriginalDuration` on `relayInfo` (new field, e.g. `info.AudioDurationSec`) for the header in Task 4.
- [ ] **Step 6:** Build `cd new-api && go build ./...` → success. **Step 7: Commit** `feat(newapi): route doubao-seed-audio via openspeech /api/v3/tts/create`.

### Task 4: Billing header bridge

**Files:** Modify `new-api/relay/audio_handler.go` (+ wherever `relayInfo` is defined to add `AudioDurationSec float64`)

- [ ] **Step 1:** After the consume-quota call in `AudioHelper` (~lines 70–74), compute the quota actually charged (the value passed to `PostAudioConsumeQuota`/`PostTextConsumeQuota`) and set:

```go
c.Writer.Header().Set("X-NewApi-Consumed-Credits", strconv.FormatInt(consumedQuota, 10))
if info.AudioDurationSec > 0 {
    c.Writer.Header().Set("X-NewApi-Audio-Duration", strconv.FormatFloat(info.AudioDurationSec, 'f', 2, 64))
}
```

(Set headers BEFORE the body is flushed; for the seed-audio byte response, set them in `DoResponse` just before `c.Data(...)`.)
- [ ] **Step 2:** Build → success. **Step 3: Commit** `feat(newapi): expose consumed credits + duration via response headers`.

### Task 5: Price the model (single source of truth)

**Files:** Modify `new-api/setting/ratio_setting/model_ratio.go`

- [ ] **Step 1:** Add `"doubao-seed-audio-1-0": <ratio>` near the tts-1 block (~lines 122–125), and an audio-ratio entry if the audio path requires it. **Choose `<ratio>` so consumed quota == intended 积分 per second of `original_duration`** (document the math: `quota = original_duration * modelRatio * groupRatio`; pick modelRatio so 1 quota unit == 1 积分). Record the chosen number and the per-120s worst-case in a comment.
- [ ] **Step 2:** Build → success. **Step 3: Commit** `feat(newapi): price doubao-seed-audio-1-0 (single-track authority)`.

### Task 6: Manual gateway smoke test

- [ ] **Step 1:** With a volcengine channel holding a speech-console `X-Api-Key`, `curl` new-api: `POST /v1/audio/speech` `{"model":"doubao-seed-audio-1-0","input":"你好，世界","voice":"<speaker_id>","response_format":"mp3"}` → expect audio bytes + `X-NewApi-Consumed-Credits` header. Save a transcript to the PR description.

---

## LAYER 2 — backend unified audio abstraction

### Task 7: Audio interface + unified DTO

**Files:** Create `backend/src/ai/audio/audio-provider.interface.ts`, `backend/src/ai/audio/audio-generate.dto.ts`

- [ ] **Step 1:** Define `AudioMode = 'seed-audio'|'minimax-speech'|'minimax-music'|'tencent-dub'|'upload'`, `AudioResult { audioUrl: string; videoUrl?: string; durationSec?: number; mode: AudioMode; provider: string; requestId?: string }`, and `interface IAudioProvider { readonly mode: AudioMode; generate(req, ctx): Promise<AudioResult> }`.
- [ ] **Step 2:** Define `AudioGenerateDto` (class-validator) with `mode` + the union of mode-specific optional fields (text/voice/format/sampleRate/speechRate/pitchRate/loudnessRate/referenceAudioUrls/referenceImageUrl for seed; existing minimax/tencent fields reused from their DTOs).
- [ ] **Step 3:** `cd backend && npx tsc -b` → success. **Step 4: Commit** `feat(backend): audio provider interface + unified DTO`.

### Task 8: SeedAudioProvider (TDD)

**Files:** Create `backend/src/ai/audio/providers/seed-audio.provider.ts`, `backend/src/ai/audio/providers/seed-audio.provider.spec.ts`

- [ ] **Step 1: Write failing spec:** given a mocked `fetch` returning audio bytes + `X-NewApi-Consumed-Credits: 7`, `generate()` uploads bytes to a mocked `OssService` and returns `{ audioUrl, durationSec, mode:'seed-audio', provider:'volcengine', consumedCredits:7 }` (surface consumedCredits on the result for the billing bridge).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement:** POST `${NEW_API_BASE_URL}/v1/audio/speech` with `Authorization: Bearer ${NEW_API_KEY}`, body `{ model:'doubao-seed-audio-1-0', input, voice, response_format, speed, metadata:{ sample_rate, loudness_rate, pitch_rate, audio_url, image_url, references } }`. Read response as bytes; read `X-NewApi-Consumed-Credits` + `X-NewApi-Audio-Duration` headers; upload bytes to OSS (`projects/{projectId}/audios/`); return `AudioResult` + `consumedCredits`.
- [ ] **Step 4: Run, expect PASS. Step 5: Commit** `feat(backend): SeedAudioProvider via new-api /v1/audio/speech`.

### Task 9: Wrap legacy providers + routing

**Files:** Create `minimax-speech.provider.ts`, `minimax-music.provider.ts`, `tencent-dub.provider.ts`, `audio-routing.service.ts`

- [ ] **Step 1:** Each legacy provider injects the existing service and adapts its result to `AudioResult` (no internal rewrite). `tencent-dub` maps `{audioUrl, videoUrl}`.
- [ ] **Step 2:** `AudioRoutingService.resolve(mode)` returns the matching provider; throws `BadRequestException` on unknown mode.
- [ ] **Step 3:** `tsc -b` → success. **Step 4: Commit** `feat(backend): legacy audio providers + routing service`.

### Task 10: Gateway billing — `withCreditsFromGateway`

**Files:** Modify `backend/src/ai/ai.controller.ts`, `backend/src/credits/credits.service.ts`

- [ ] **Step 1:** Add `creditsService.deductExact(userId, teamId, amount, meta)` that performs a single transactional debit of an already-known amount (reuse the existing deduct primitive used by `preDeductCredits`, minus the config price lookup).
- [ ] **Step 2:** Add `withCreditsFromGateway<T>(req, serviceType, op)` to the controller: (a) **pre-check** balance ≥ worst-case (a constant `SEED_AUDIO_MAX_CREDITS` = 120s price; keep this constant in code as a guardrail only, NOT as the charge), (b) run `op()` which returns `{ result, consumedCredits }`, (c) on success `deductExact(consumedCredits)`, (d) on throw deduct nothing. API-key auth path skips deduction (same rule as `withCredits`).
- [ ] **Step 3:** `tsc -b` → success. **Step 4: Commit** `feat(backend): single-track gateway billing for seed-audio`.

### Task 11: Unified route + legacy shims

**Files:** Modify `backend/src/ai/ai.controller.ts`, `backend/src/ai/ai.module.ts`

- [ ] **Step 1:** Register providers + `AudioRoutingService` in `ai.module.ts`.
- [ ] **Step 2:** Add `POST audio/generate`: resolve provider by `dto.mode`; for `seed-audio` use `withCreditsFromGateway`; for `minimax-*`/`tencent-dub` use existing `withCredits(serviceType)`; `upload` is rejected here (handled client-side). Add `POST audio/generate/async` + `GET audio/task/:taskId` delegating to the tencent provider's async methods.
- [ ] **Step 3:** Convert `POST minimax-speech`/`tencent-speech`/`minimax-music` to thin shims that build an `AudioGenerateDto` and call the unified handler (preserve response shape).
- [ ] **Step 4:** `tsc -b` → success. **Step 5: Commit** `feat(backend): unified /api/ai/audio/generate + legacy shims`.

---

## LAYER 3 — frontend unified node

### Task 12: Mode config + shared result panel

**Files:** Create `src/components/flow/nodes/audioStudioModes.ts`, `src/components/flow/nodes/AudioResultPanel.tsx`

- [ ] **Step 1:** `audioStudioModes.ts` exports the mode list `[{key:'seed-audio',zh:'生成',en},{key:'minimax-speech',zh:'语音'},{key:'minimax-music',zh:'音乐'},{key:'tencent-dub',zh:'配音'},{key:'upload',zh:'导入'}]` plus per-mode `inputHandles`/`outputHandles`/`creditsHint`.
- [ ] **Step 2:** `AudioResultPanel.tsx` extracts the shared `<audio>` player + history list + `handleDownload` (consolidate from MinimaxSpeechNode/MinimaxMusicNode/TencentSpeechNode), using `flowNodeDarkTheme.ts` helpers.
- [ ] **Step 3:** `tsc -b` → success. **Step 4: Commit** `feat(frontend): audioStudio mode config + shared result panel`.

### Task 13: audioService

**Files:** Create `src/services/audioService.ts`

- [ ] **Step 1:** `generateAudio(payload): Promise<AudioResult>` POSTs `/api/ai/audio/generate` via `fetchWithAuth`; plus `createAsyncTask`/`queryTask` for tencent; normalize `audioUrl`/`videoUrl`/`durationSec`.
- [ ] **Step 2:** `tsc -b` → success. **Step 3: Commit** `feat(frontend): audioService client`.

### Task 14: AudioStudioNode component

**Files:** Create `src/components/flow/nodes/AudioStudioNode.tsx`; modify `src/components/flow/types.ts`

- [ ] **Step 1:** Add `'audioStudio'` to `NodeKind`, add `'minimaxMusic'` too (fix pre-existing gap), define `AudioStudioData { mode; ...allModeFields; audioUrl?; videoUrl?; history? }`, append to `AnyNodeData`.
- [ ] **Step 2:** Implement `AudioStudioNode.tsx`: top mode `<select>`; conditional controls per mode (seed-audio: text/speaker/audio_config + reference hints; minimax-speech: voice/emotion/sfx/format; minimax-music: prompt/lyrics/instrumental; tencent-dub: video+lang+subtitle; upload: file→OSS). Render `<AudioResultPanel>`. Run button calls `data.onRun(id)`.
- [ ] **Step 3:** `tsc -b` → success. **Step 4: Commit** `feat(frontend): AudioStudioNode component`.

### Task 15: Register node across all FlowOverlay registries + run dispatch

**Files:** Modify `src/components/flow/FlowOverlay.tsx`, `src/services/nodeConfigService.ts`

- [ ] **Step 1:** Add import + `nodeTypes['audioStudio']`, `NODE_DEFS` menu entry (category audio), credits map, category map, default size, output-handle decls, input/output handle-type maps, async-run set, default-data factory branch.
- [ ] **Step 2:** Add the run-handler in the run dispatch (~20805+) that reads `data.mode`, builds the payload, calls `audioService.generateAudio`, writes `audioUrl`/`videoUrl`/history. Remove the 3 old inline handlers.
- [ ] **Step 3:** Add `nodeConfigService.ts` entry (`nodeKey:'audioStudio'`, category audio, `serviceType` per-mode resolved server-side / `creditsPerCall` hint).
- [ ] **Step 4:** Update connection allow-lists (12054+) to include `audioStudio` (replace the old 4 type strings).
- [ ] **Step 5:** `tsc -b` → success. **Step 6: Commit** `feat(frontend): register audioStudio across flow registries`.

### Task 16: Auto-migrate saved nodes + remove old components

**Files:** Modify `src/components/flow/FlowOverlay.tsx`; delete 4 old node files

- [ ] **Step 1:** Extend the legacy alias map (~2505) so `audioUpload`/`minimaxSpeech`/`tencentSpeech`/`minimaxMusic` (+ their legacy string variants) → `audioStudio`.
- [ ] **Step 2:** Add a data-migration in the node-normalization path: for each old type, set `data.mode` (`upload`/`minimax-speech`/`tencent-dub`/`minimax-music`) and remap old fields → `AudioStudioData` (voice/emotion/format, tencent video fields, upload audioUrl, preserve `history`).
- [ ] **Step 3:** Load a saved project containing each old node type; verify it renders as `audioStudio` in the right mode with data intact (manual check; capture screenshots).
- [ ] **Step 4:** Delete `AudioNode.tsx`, `MinimaxSpeechNode.tsx`, `TencentSpeechNode.tsx`, `MinimaxMusicNode.tsx` and their imports.
- [ ] **Step 5:** `tsc -b` → success. **Step 6: Commit** `feat(frontend): auto-migrate legacy audio nodes → audioStudio; remove old nodes`.

---

## Verification (whole feature)

- [ ] new-api: `go build ./...` clean; smoke `curl` (Task 6) returns audio + headers.
- [ ] backend: `tsc -b` clean; `POST /api/ai/audio/generate {mode:'seed-audio'}` returns OSS audioUrl; 积分 deducted == `X-NewApi-Consumed-Credits` (single-track verified by comparing the header value to the ledger delta).
- [ ] frontend: `tsc -b` clean; new `audioStudio` node generates in each mode; a pre-existing saved canvas with all 4 old node types loads correctly post-migration.
- [ ] Confirm seed-audio price exists ONLY in `model_ratio.go` (grep `credits.config.ts` for seed-audio → no match).
- [ ] (Per standing preference) re-run `codex` review on the billing bridge once authenticated.

---

## Notes / prerequisites

- **Channel key:** the volcengine channel serving seed-audio must hold a new-console speech `X-Api-Key` (cannot share the volcano_tts `appid|token` key).
- **No DB migration** — model_ratio is config; no schema change.
- **Out of scope:** migrating minimax/tencent onto the gateway bridge; rewriting their service internals; streaming seed-audio; 声音复刻 training UI.
