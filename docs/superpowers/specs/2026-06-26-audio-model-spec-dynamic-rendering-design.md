# Design: Backend-driven Audio Model Capability Spec + Dynamic Node Rendering

**Date:** 2026-06-26
**Status:** Design for review → plan → implement
**Builds on:** `2026-06-26-seed-audio-unified-audio-design.md` (the unified `audioStudio` node + `/api/ai/audio/generate` + single-track billing already shipped).

---

## 1. Goal

The `audioStudio` node currently hardcodes controls per **mode** (5 fixed JSX branches) and exposes no model picker. We want it **model-driven and spec-rendered**: a **model dropdown** whose options + per-model **input fields ("spec")** + pricing are **backend-defined and admin-configurable**, with the frontend rendering the form dynamically from each model's spec. All 5 audio capability classes become spec-driven.

User decisions: **backend-driven (admin-configurable)**, **finer-grained real models**, **all 5 classes spec-ified**.

---

## 2. What we reuse vs build (from the managedRoutes investigation)

The existing **managedRoutes / managed-model** system gives us the **model registry + selection + pricing** layer — but its dynamic part is **pricing only**; video nodes still render input fields as **hardcoded JSX**. So:

- **REUSE (model + pricing layer):**
  - Registry: `model_provider_mapping_v2` (a `SystemSetting` JSON blob; admin CRUD via `POST /admin/settings` + `Admin.tsx` editor). `{ version, platforms[], models[] }`.
  - Enrichment: `node-config.service.ts normalizeManagedNodeMetadata()` attaches a computed `metadata.managedRoutes` (vendors + pricing books) onto a node-config at read time by matching `metadata.modelKeys` against the registry. Served via `GET /ai-public/node-configs`.
  - Pricing engine: `frontend/src/components/flow/managedRoutePricing.ts` (`getManagedRoutesMetadata` / `getManagedRouteOption` / `resolveManagedRoutePricing`) — already supports `fixed | linear | base_plus_linear | lookup_matrix`, so duration-based audio pricing needs **no engine change**. Authoritative preview via `useBackendCreditsPreview.ts` → `POST /credits/preview`.
- **BUILD NEW (field-spec layer — the actual ask):**
  - An **`audioSpec`** capability schema authored per model (in the registry model's `metadata`), declaring the **input fields** + **edge inputs** + **outputs** + which `/api/ai/audio/generate` `mode` it maps to.
  - A generic **`AudioSpecForm`** renderer in the frontend that builds the form from `audioSpec.fields` (replacing the 5 hardcoded mode branches in `AudioStudioNode`).
  - A **model dropdown** in the node wired to the enriched `managedRoutes`.

---

## 3. The `audioSpec` schema (authored in each registry model's `metadata.audioSpec`)

```ts
interface AudioSpec {
  mode: 'seed-audio' | 'minimax-speech' | 'minimax-music' | 'tencent-dub'; // → /api/ai/audio/generate mode
  modelField?: string;   // which DTO field carries the concrete model id (e.g. 'model' or 'musicModel'); omit for seed-audio
  modelValue?: string;   // value to send in that field (e.g. 'speech-2.6-hd', 'music-2.5+')
  fields: AudioSpecField[];     // form controls, rendered top-to-bottom (optionally grouped)
  inputs: AudioSpecEdgeInput[]; // edge-bound inputs (text/audio/image/video)
  outputs: ('audio' | 'video')[];
}

interface AudioSpecField {
  key: string;            // EXACTLY an AudioGenerateDto field name → renderer output maps 1:1 to payload
  label: { zh: string; en: string };
  type: 'text' | 'textarea' | 'select' | 'number' | 'slider' | 'checkbox' | 'voicePicker' | 'tencentVoicePicker' | 'multiSelect';
  options?: Array<{ value: string; label: { zh: string; en: string } }>; // select/multiSelect
  min?: number; max?: number; step?: number;   // number/slider
  default?: string | number | boolean | string[];
  placeholder?: { zh: string; en: string };
  required?: boolean;
  group?: { zh: string; en: string };           // optional collapsible section heading
  visibleWhen?: { field: string; equals: any };  // simple conditional (e.g. lyrics hidden when isInstrumental)
}

interface AudioSpecEdgeInput {
  handle: 'text' | 'audio' | 'image' | 'video';
  dtoField: 'text' | 'referenceAudioUrls' | 'referenceImageUrl' | 'inputVideoUrl';
  multiple?: boolean;     // audio refs (max 3)
  required?: boolean;
}
```

Notes:
- `key` ≡ `AudioGenerateDto` field name (`audio-generate.dto.ts`), so the generic renderer's collected values map straight to the unified API. No per-field translation code.
- `voicePicker` = MiniMax raw-voice text+presets; `tencentVoicePicker` = the existing `TENCENT_SYSTEM_VOICES` searchable picker (reused).
- `visibleWhen` covers the only conditional we have today (music: `lyrics` hidden when `isInstrumental`). Keep it minimal (single equality) — YAGNI.

---

## 4. Model registry entries (first cut — all 5 classes, finer-grained)

Authored as `model_provider_mapping_v2.models[]` defaults (seeded in code, admin-editable). `taskType: 'audio'`.

| modelKey | mode | modelField/Value | pricing | spec highlights |
|---|---|---|---|---|
| `doubao-seed-audio-1-0` | seed-audio | — (fixed model) | linear 2 积分/秒 (display est.; **charged via gateway header**) | fields: voice(voicePicker), format(select), sampleRate(select), speechRate(slider -50..100), pitchRate(slider -12..12), loudnessRate(slider -50..100); inputs: text(req), audio(ref, max3), image(ref); outputs: [audio] |
| `minimax-speech-2.6-hd` | minimax-speech | model='speech-2.6-hd' | fixed 10 | voice, emotion(select), soundEffects(multiSelect), outputFormat, audioMode; inputs: text(req); outputs: [audio] |
| `minimax-speech-2.5` | minimax-speech | model='speech-2.5' | fixed 10 | same fields as above |
| `minimax-music-2.5+` | minimax-music | musicModel='music-2.5+' | fixed 30 | prompt(textarea), isInstrumental(checkbox), lyricsOptimizer(checkbox), lyrics(textarea, visibleWhen !isInstrumental); inputs: text(prompt opt); outputs: [audio] |
| `minimax-music-2.5` | minimax-music | musicModel='music-2.5' | fixed 30 | same |
| `tencent-dub` | tencent-dub | — | fixed 10 | speakerUrl, voiceId(tencentVoicePicker), speakerGender, srcLang, dstLang, subtitle fields, font/fontSize/marginV; inputs: video(req); outputs: [audio, video] |

`upload` (导入) stays a **non-model special item** in the node's selector (client-side OSS upload, no spec/registry entry, no generate call) — listed in the dropdown but bypasses the spec form.

---

## 5. Backend changes

1. **Registry defaults** — add the 6 audio models above to the `model_provider_mapping_v2` default catalog (wherever video/image defaults are authored, e.g. `Admin.tsx DEFAULT_MODEL_CATALOG` + the backend default the registry falls back to). Each with `taskType:'audio'`, a `vendors[]` entry (pricing book), and `metadata.audioSpec`.
2. **`normalizeManagedTaskType`** (`node-config.service.ts:166`) — extend to recognize `'audio'` (currently only text/image/video).
3. **Enrich `audioStudio` node-config** — give the `audioStudio` default config `metadata.modelKeys = [all 6]`, `managedModelKey = 'doubao-seed-audio-1-0'` (default), so `normalizeManagedNodeMetadata` attaches `managedRoutes` (and the `audioSpec` per model rides along in vendor/model metadata). Add an `audioStudio` branch in `normalizeManagedNodeMetadata` if needed so each model's `audioSpec` is exposed to the frontend.
4. **Admin `modelKey→nodeKey` map** (`Admin.tsx:2197`) — add the 6 audio modelKeys → `audioStudio`.
5. **`/api/ai/audio/generate`** — already routes by `mode`; ensure the concrete `model`/`musicModel` from the spec's `modelField` is forwarded (already supported by the DTO + providers). No new endpoint.
6. **Pricing** — seed-audio: vendor pricing book `linear` (2/sec) is **display estimate only**; the real charge stays single-track via the new-api `X-NewApi-Consumed-Credits` header (`withCreditsFromGateway`, already shipped). minimax/tencent: fixed vendor `creditsPerCall`, charged by existing `withCredits`.

---

## 6. Frontend changes

1. **`AudioSpecForm.tsx`** (new) — generic renderer: takes `audioSpec.fields` + current `data` + `onChange`, renders each field by `type` (text/textarea/select/number/slider/checkbox/voicePicker/tencentVoicePicker/multiSelect), honoring `visibleWhen`/`group`. Reuses `flowNodeDarkTheme.ts` + `TENCENT_SYSTEM_VOICES`.
2. **`AudioStudioNode.tsx`** (refactor) — replace the 5 hardcoded mode branches with: a **model `<select>`** (options from enriched `managedRoutes` + the `upload` special item) → on change set `managedModelKey` (+ derived `mode`); render `<AudioSpecForm spec={selectedModel.audioSpec} />`; dynamic handles from `audioSpec.inputs/outputs`; keep `<AudioResultPanel>`. Wire pricing via `managedRoutePricing.ts` + `useBackendCreditsPreview` (display; seed-audio shows "≈ X/秒" estimate).
3. **Run-handler** (`FlowOverlay.tsx`) — build payload generically: `{ mode: spec.mode, managedModelKey, [spec.modelField]: spec.modelValue, ...formFields, ...edgeInputs(text/refAudio/refImage/video) }` → `audioService.generateAudio`. Removes the per-mode payload branches.
4. **Spec source** — frontend reads `audioSpec` from the node-config `managedRoutes` payload (backend-driven). A small frontend type mirror (`audioSpec.ts`) for typing only; no hardcoded model list.
5. **Migration** — existing `audioStudio` nodes (and the just-migrated legacy ones) get a `managedModelKey` defaulted from their `mode` if missing (mode→default model map), so saved canvases keep working.

---

## 7. Pricing reconciliation (important)

- **seed-audio is single-track** (already shipped): displayed price = managedRoutes `linear` estimate (2/sec × estimated duration); **actual charge = new-api `X-NewApi-Consumed-Credits`** post-deduct. The node shows it as an estimate (e.g. "≈2积分/秒，按实际时长结算").
- **minimax/tencent**: fixed vendor `creditsPerCall` (10/30/10), charged by existing `withCredits`. Display = managedRoutes fixed credits.

---

## 8. Risks / open points

1. **managedRoutes was built for pricing, not field specs** — we're extending its model `metadata` with `audioSpec` and adding a generic renderer. Confirm the enrichment (`normalizeManagedNodeMetadata`) passes arbitrary `metadata.audioSpec` through to the frontend untouched.
2. **`normalizeManagedTaskType` lacks `audio`** — must extend or audio models get mis-typed.
3. **Generic renderer breadth** — must cover every control the 5 current modes use (incl. the tencent searchable voice picker + multiSelect sound effects). Field-type set in §3 is sized to cover them; verify during implementation.
4. **upload special-case** — not a registry model; the node selector must blend registry models + the `upload` pseudo-item without breaking pricing/handles.
5. **Admin authoring** — the 6 models + their `audioSpec` JSON are verbose; provide them as code defaults so a fresh DB/registry is seeded, admin can then tweak.
6. **Migration default model** — `mode → default managedModelKey` map must cover all old nodes.

---

## 9. Out of scope

- New audio providers/models beyond the 6 listed.
- Admin UI form-builder for `audioSpec` (admins edit the JSON; a visual spec editor is later).
- Changing the single-track billing mechanism (reused as-is).
- Voice-clone (声音复刻) training.
