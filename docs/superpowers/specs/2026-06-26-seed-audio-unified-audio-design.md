# Design: doubao-seed-audio-1-0 + Unified Audio (single-track billing)

**Date:** 2026-06-26
**Status:** Approved design, pending spec review → implementation plan
**Scope:** 3 layers — new-api (Go gateway), backend (NestJS), frontend (React flow node)

---

## 1. Goal

Add Volcengine **`doubao-seed-audio-1-0`** — a rich audio-generation model (TTS + music + SFX + multi-speaker dialogue, optional reference audio/image) — to the stack, and in the process unify all audio across three layers:

1. **new-api** — register the model + an adapter on the **existing** ark/volcengine channel (type 45). **No new channel.**
2. **backend** — introduce a unified audio provider abstraction that 收编 (absorbs) seed-audio + minimax-speech + minimax-music + tencent-dub behind one interface and one route.
3. **frontend** — merge the 4 audio nodes (`audioUpload` / `minimaxSpeech` / `tencentSpeech` / `minimaxMusic`) into ONE `audioStudio` node with a mode selector.

**Hard constraint (user):** audio pricing + 积分 deduction for seed-audio must be **single-track through new-api** — one source of truth, no duplicated hardcoded backend price. Avoid the dual-track drift bug previously hit on team seats (see memory `project_team_seat_capacity_single_track`).

---

## 2. The model's real API (official doc 6561/2550782, 6561/2528925 family)

- **Endpoint:** `POST https://openspeech.bytedance.com/api/v3/tts/create` — plain HTTP, non-streaming.
  - NOT the Ark `/api/v3/chat` surface; NOT the existing `volcano_tts` WebSocket (`wss://openspeech.bytedance.com/api/v1/tts/ws_binary`).
- **Auth:** single header `X-Api-Key: <speech-console API key>` (new console). Optional `X-Api-Request-Id` trace id. NOT Bearer, NOT `appid|token`.
- **Request body:**
  - `model` (required): `"seed-audio-1.0"`.
  - `text_prompt` (required, ≤2048): prompt or text to synthesize. Supports `@音频N` references to `references[N-1]`.
  - `references` (array, optional): reference resources; up to 3 audio (≤30s, ≤10MB, wav/mp3/pcm/ogg_opus) OR 1 image (≤10MB, jpeg/png/webp). Audio and image references cannot be mixed.
  - `speaker` (string, optional): 音色 ID (豆包语音合成模型2.0 音色 or 声音复刻音色). Mutually exclusive with `audio_data`/`audio_url`.
  - `audio_data` (base64) / `audio_url` (remote URL): reference audio; mutually exclusive with `speaker`.
  - `image_data` (base64) / `image_url`: reference image; cannot be combined with any audio reference.
  - `audio_config` (object): `format` (wav/mp3/pcm/ogg_opus, default wav), `sample_rate` (default 24000; one of 8000/16000/24000/32000/44100/48000), `speech_rate` ([-50,100], default 0), `loudness_rate` ([-50,100], default 0), `pitch_rate` ([-12,12], default 0).
  - `watermark` (object, optional): `aigc_watermark` (bool), `aigc_metadata{enable, content_producer, produce_id, content_propagator, propagate_id}`.
- **Response body (JSON):** `code` (int), `message` (string), `audio` (base64 audio bytes), `duration` (float, post-processed sec), `original_duration` (float, model output sec — **billing basis**, ≤120s), `url` (string, 2h-expiry audio URL). Response header `X-Tt-Logid`.

---

## 3. Current state (verified)

### new-api
- `relay/channel/volcengine/adaptor.go`: audio path handles only `RelayModeAudioSpeech` and assumes volcano_tts WebSocket + `appid|token` key (splits key on `|`, sets `Authorization: Bearer;<token>`). `GetRequestURL` audio case → WS for default base, else `{base}/v1/audio/speech`. **Seedream models already special-cased in the same file** (precedent for model-conditional branching).
- OpenAI audio relay: `POST /v1/audio/speech` → `RelayModeAudioSpeech` → `relay/audio_handler.go AudioHelper`. DTO `dto/audio.go AudioRequest{ input, voice, response_format, speed, metadata json.RawMessage, ... }`. Response = raw audio bytes (no JSON). Billing: `audio_handler.go` calls `PostAudioConsumeQuota` only if usage has audio tokens, else `PostTextConsumeQuota`.
- Volcengine channel type = **45** (`ChannelTypeVolcEngine`), maps to `APITypeVolcEngine` → `volcengine.Adaptor`. Models register via `GetModelList()` → `constants.go ModelList`. Pricing in `setting/ratio_setting/model_ratio.go`.

### Billing (DUAL-TRACK today)
- backend `credits/credits.config.ts`: fixed per-call prices (`minimax-speech=10`, `minimax-music=30`, `tencent-speech=10`). `withCredits` (`ai/ai.controller.ts:1719`) **pre-deducts** a fixed 积分 from config; **never** reads new-api cost.
- new-api quota is a **separate ledger** on one shared gateway token; it does **not** return consumed quota to callers (no quota response header anywhere).
- Current MiniMax/music audio uses a **raw proxy** (`controller/special_proxy.go ProxyKaponSpeech`/`ProxyMinimaxMusic`) that **bypasses new-api billing entirely** (bills 0). So today minimax audio is single-track on the *backend* side.
- **No bridge** returning new-api cost to backend exists. **No per-user new-api token** (`ai.controller.ts:5831` comment: 后端只持网关 token，计费仍由后端扣积分).

### frontend
- 4 nodes, each with inline `fetchWithAuth` run-handlers in `FlowOverlay.tsx` (no `audioService`). Registries to touch (~14): `NodeKind` (`types.ts:3`, **missing `minimaxMusic`** — pre-existing gap), `nodeTypes` (~1074–1084), `NODE_DEFS` menu (1812–1815), `nodeConfigService.ts` (181–185, has `serviceType`), credits map (1748), category (1930), default sizes (1992), output handles (2334), input handles (2388), async-run set (1305), output-handle decls (1656), legacy alias map (2505), default-data factory (10919+), run dispatch (20805+), connection allow-lists (12054+).
- Shared: `flowNodeDarkTheme.ts` (audio player/history helpers), `tencentSystemVoices.ts` (81KB voice catalog, tencent-only). Duplicated across the 3 generators: `<audio>` player, history list, `handleDownload`.
- `AudioNode` (`audioUpload`) is a no-AI OSS uploader; `tencentSpeech` is video-dubbing (video in/out), structurally different from pure TTS.

---

## 4. Design

### 4.1 Layer 1 — new-api seed-audio adapter (volcengine channel, no new channel)

1. **Register model:** add `"doubao-seed-audio-1-0"` to `relay/channel/volcengine/constants.go` `ModelList`.
2. **Adapter branch** in `relay/channel/volcengine/adaptor.go`, add `isSeedAudioModel(model)` parallel to `isSeedreamModel`. When true, in the `RelayModeAudioSpeech` flow:
   - `GetRequestURL` → `https://openspeech.bytedance.com/api/v3/tts/create` (allow `{base}` override for self-host/test).
   - `SetupRequestHeader` → `X-Api-Key: <channel key, as-is>` (no `|` split, no Bearer), `Content-Type: application/json`, optional `X-Api-Request-Id`.
   - `ConvertAudioRequest` → build the seed-audio body:
     - `model: "seed-audio-1.0"`, `text_prompt: req.Input`.
     - `speaker: req.Voice` (only when no audio/image reference is supplied).
     - `audio_config`: `format ← req.ResponseFormat || "wav"`, `speech_rate ← fromSpeed(req.Speed)`; `sample_rate`/`loudness_rate`/`pitch_rate` from metadata.
     - Rich fields (`references`/`audio_url`/`image_url`/`audio_data`/`image_data`/`sample_rate`/`loudness_rate`/`pitch_rate`/`watermark`) merged from `req.Metadata` (metadata overrides defaults).
   - `DoRequest` → normal HTTP POST (not the WS no-op path).
   - `DoResponse` → parse JSON; on a non-success `code` (per the 错误码 doc 6561/2534853 — success is `code == 0`; confirm during impl) return upstream error (message + `X-Tt-Logid`). On success: base64-decode `audio` → write raw bytes to the client with `Content-Type` per `format` (preserves the `/v1/audio/speech` byte contract). Populate `usage` with the audio duration so billing prices by `original_duration` (see 4.3).
3. **Channel-key caveat (ops):** one volcengine channel key cannot serve both volcano_tts (`appid|token`) and seed-audio (`X-Api-Key`). The channel used for seed-audio must hold a **new-console speech `X-Api-Key`**. Routing is per-model so this is configuration, not code, but the key must be present on whichever volcengine channel serves `doubao-seed-audio-1-0`.

### 4.2 Layer 2 — backend unified audio abstraction (`src/ai/audio/`)

Mirror the image `IAIProvider` pattern (`src/ai/providers/`):

- `audio-provider.interface.ts` — `IAudioProvider { generate(req): Promise<AudioResult>; readonly mode; capability descriptor }`.
- Providers:
  - `seed-audio.provider.ts` (NEW): calls new-api `POST /v1/audio/speech` with `model: "doubao-seed-audio-1-0"`, maps unified fields → `input`/`voice`/`metadata`, receives audio bytes, **uploads to OSS** (`OssService`) for a permanent URL, returns `{ audioUrl, durationSec }` (durationSec from `X-NewApi-Audio-Duration`).
  - `minimax-speech.provider.ts`, `minimax-music.provider.ts`, `tencent-dub.provider.ts`: thin wrappers delegating to the existing services (no rewrite of their internals now).
- `audio-routing.service.ts` — selects provider by `mode`.
- DTO `audio-generate.dto.ts` — `AudioGenerateDto { mode: 'seed-audio'|'minimax-speech'|'minimax-music'|'tencent-dub'|'upload', ...mode-specific fields }` (discriminated). Result `AudioResult { audioUrl, videoUrl?, durationSec?, mode, provider, requestId }`.
- Controller routes (in `ai.controller.ts` or a new `audio.controller.ts`):
  - `POST /api/ai/audio/generate` (sync), `POST /api/ai/audio/generate/async`, `GET /api/ai/audio/task/:taskId` (tencent async).
  - Legacy `POST /api/ai/minimax-speech`, `/tencent-speech`, `/minimax-music` → thin **deprecated shims** delegating to the unified service (kept for back-compat with any non-migrated callers).
- Module wiring in `ai.module.ts`.

### 4.3 Billing — single-track through new-api (seed-audio only)

The novel bridge. **Price for `doubao-seed-audio-1-0` lives ONLY in new-api.**

1. **new-api is the price authority.** Add `doubao-seed-audio-1-0` to `setting/ratio_setting/model_ratio.go` (+ audio ratio maps if needed). In the seed-audio `DoResponse`, set `usage` so `PostAudioConsumeQuota` (`service/quota.go:259`) prices by `original_duration`. Tune model_ratio + group ratio so the **consumed quota output equals the intended 积分** for a given duration (quota unit == 积分 for this model, by construction → conversion ratio = 1).
2. **Bridge:** in the new-api audio handler (`relay/audio_handler.go`) — or a thin response middleware — after billing, set response header `X-NewApi-Consumed-Credits: <quota>` and `X-NewApi-Audio-Duration: <original_duration>`. This header is the bridge that does not exist today.
3. **backend deducts the actual reported cost post-call.** seed-audio has **no** `credits.config.ts` entry. Add a `withCreditsFromGateway` variant (sibling to `withCredits`):
   - **Pre-call:** balance **check only** (estimate worst-case = max 120s price) to refuse a call the user can't afford. Do NOT pre-deduct a fixed price.
   - **Run** the operation; read `X-NewApi-Consumed-Credits` from the new-api response (threaded back through `SeedAudioProvider`).
   - **Post-call:** deduct exactly the reported 积分 on success; deduct nothing on failure. Single global quota→积分 ratio (= 1 by construction).
   - Concurrency/refund: rely on the existing credit-account transactional deduct (`credits.service.ts`); the worst-case pre-check bounds over-spend on parallel calls; no pre-deduct means no refund path needed on failure.

**Scope:** only seed-audio is single-track-via-new-api. minimax/tencent keep their current single backend deduction (they bypass new-api billing, so no double-charge exists). Migrating them onto the bridge is explicitly **out of scope** for this work.

### 4.4 Layer 3 — frontend unified `audioStudio` node

- New node type `audioStudio`, component `AudioStudioNode.tsx`, with a top **mode selector**:
  - **生成** (`seed-audio`, default): `text_prompt` (from upstream `text` edge or local textarea), speaker picker (豆包2.0 音色 + 声音复刻), optional **reference audio** (via `audio` input edges → mapped to `@音频N`), optional **reference image** (via `image` input edge), `audio_config` controls (format/sample_rate/speech_rate/loudness_rate/pitch_rate). Output: `audio`.
  - **语音** (`minimax-speech`): voice, emotion, sound effects, format. Input `text`. Output `audio`.
  - **音乐** (`minimax-music`): prompt, lyrics, instrumental, optimizer. Output `audio`.
  - **配音** (`tencent-dub`): video input + text/speaker/lang/subtitle controls. Output `audio` + `video`.
  - **导入** (`upload`): OSS file upload, no AI. Output `audio`.
- Conditional handles per mode (tencent: `video` in + `audio`/`video` out; upload: `audio` in/out; others: `text` in + `audio` out; seed-audio additionally accepts `audio`/`image` inputs as references).
- New `services/audioService.ts` — lifts the run-handler logic out of `FlowOverlay.tsx` and calls `/api/ai/audio/generate`; the 3 legacy inline handlers are removed.
- Extract shared `<AudioResultPanel>` (player + history + download) from the 3 duplicated implementations; keep using `flowNodeDarkTheme.ts` helpers.
- Register `audioStudio` across all ~14 parallel registries (§3). Fix the pre-existing `minimaxMusic` gap in `NodeKind` while here.

### 4.5 Migration of saved canvases (auto-migrate)

Existing saved flows contain `audioUpload` / `minimaxSpeech` / `tencentSpeech` / `minimaxMusic` nodes. On load:
- Extend the legacy alias map (`FlowOverlay.tsx:2505`) so all 4 old type strings → `audioStudio`.
- Add a **data mapper** that, per old type, sets `mode` and remaps the old `data` fields onto the unified `AudioStudioData` shape (voice/emotion/format → seed/minimax fields; tencent video fields; upload audioUrl). Old `history[]` is preserved.
- Old node components are removed once the mapper covers their data (full merge, not read-only fallback).

---

## 5. Risks & open points

1. **Billing bridge is novel** — no existing example. The pre-check-then-post-deduct flow and the `X-NewApi-Consumed-Credits` header must be implemented carefully; concurrent calls bounded by the worst-case pre-check. **Pending `codex` design review** (codex was unauthenticated at design time — re-run `codex login` then review before/with implementation).
2. **Channel key** — seed-audio needs a speech-console `X-Api-Key` on the volcengine channel; can't share a key with volcano_tts. Ops prerequisite.
3. **seed-audio on the OpenAI byte contract** — rich fields ride via `metadata`; the model is richer than TTS (references/image/120s). Confirm metadata passthrough covers everything; the 2h `url` is discarded in favor of OSS re-upload (permanent).
4. **Node merge complexity** — folding the video-centric `tencent-dub` and no-AI `upload` into one node adds conditional UI/handles. Accepted by user. Migration mapper must cover every old data field to avoid breaking saved flows.
5. **new-api quota unit == 积分 tuning** — model_ratio/group_ratio must be set so consumed quota equals desired 积分; document the exact ratio math in the implementation plan.

---

## 6. Out of scope

- Migrating minimax/tencent billing onto the single-track bridge.
- Rewriting the internals of the existing minimax/tencent services (wrapped, not rewritten).
- Streaming/WebSocket seed-audio (model API used here is non-streaming HTTP).
- Voice-clone (声音复刻) training UI — only consuming existing 音色 IDs.
