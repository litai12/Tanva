# Audio Model Spec + Dynamic Rendering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** Make `audioStudio` model-driven and spec-rendered: a backend-defined, admin-configurable model registry (6 audio models) where each model declares an `audioSpec` (input fields + edge inputs + outputs + mode), and the frontend renders the node form dynamically from it.

**Architecture:** Reuse the managedRoutes registry (`model_provider_mapping_v2` SystemSetting) + pricing engine (`managedRoutePricing.ts`); add an `audioSpec` field-schema in each model's metadata + a generic `AudioSpecForm` renderer replacing the 5 hardcoded mode branches. Billing unchanged (seed-audio single-track via gateway header; minimax/tencent fixed).

**Tech Stack:** NestJS (node-config + registry JSON), React/reactflow11, TS. Build: backend `npx tsc -b`, frontend `npx tsc -b` (project refs). Branch: `feat/audio-model-spec` off `main`.

**Spec:** `docs/superpowers/specs/2026-06-26-audio-model-spec-dynamic-rendering-design.md`

---

## File Structure
- Backend: `node-config.service.ts` (extend `normalizeManagedTaskType`; audioStudio metadata; audio model defaults in the registry fallback), `Admin.tsx` modelKey→nodeKey map + DEFAULT_MODEL_CATALOG audio entries.
- Frontend: `nodes/audioSpec.ts` (NEW types + mode→default-model map), `nodes/AudioSpecForm.tsx` (NEW generic renderer), `nodes/AudioStudioNode.tsx` (refactor to model+spec), `FlowOverlay.tsx` (generic run-handler + migration default model), `services/audioService.ts` (unchanged payload, accepts managedModelKey/model).

---

## Task 1: Frontend audioSpec types + mode→model map

**Files:** Create `frontend/src/components/flow/nodes/audioSpec.ts`

- [ ] **Step 1:** Define `AudioSpec`, `AudioSpecField`, `AudioSpecEdgeInput` (exact shapes from spec §3). Add `MODE_DEFAULT_MODEL: Record<AudioStudioMode, string>` = `{ 'seed-audio':'doubao-seed-audio-1-0', 'minimax-speech':'minimax-speech-2.6-hd', 'minimax-music':'minimax-music-2.5+', 'tencent-dub':'tencent-dub', 'upload':'' }`. Add `getAudioSpecFromManagedRoute(route): AudioSpec | undefined` reading `vendor.metadata.audioSpec` (or model metadata).
- [ ] **Step 2:** `cd frontend && npx tsc -b` → clean. **Step 3: Commit** `feat(audio): audioSpec types + mode→model map`.

## Task 2: Generic AudioSpecForm renderer

**Files:** Create `frontend/src/components/flow/nodes/AudioSpecForm.tsx`

- [ ] **Step 1:** Component `AudioSpecForm({ spec, data, isDark, onChange })` renders `spec.fields` in order: `text`/`textarea`→input/textarea; `select`→`<select>` from `options`; `number`/`slider`→numeric input (slider uses range + value); `checkbox`→checkbox; `multiSelect`→checkbox group; `voicePicker`→text input + preset `<select>`; `tencentVoicePicker`→reuse the searchable `TENCENT_SYSTEM_VOICES` picker (lift from `AudioStudioNode`/`TencentSpeechNode`). Honor `visibleWhen` (hide field when `data[field]!==equals`) and `group` headings. Use `flowNodeDarkTheme.ts`.
- [ ] **Step 2:** `npx tsc -b` → clean. **Step 3: Commit** `feat(audio): generic AudioSpecForm renderer`.

## Task 3: Refactor AudioStudioNode to model + spec

**Files:** Modify `frontend/src/components/flow/nodes/AudioStudioNode.tsx`, `nodes/audioStudioModes.ts`

- [ ] **Step 1:** Read enriched `managedRoutes` from node metadata (`getManagedRoutesMetadata` from `managedRoutePricing.ts`); build the **model `<select>`** from its vendors/models + append the `upload` special item. On change → `updateNodeData({ managedModelKey, mode: spec.mode })`.
- [ ] **Step 2:** Resolve `selectedSpec = getAudioSpecFromManagedRoute(selectedRoute)`; render `<AudioSpecForm spec={selectedSpec} data={data} onChange={updateNodeData} />` (for non-upload). Keep the `upload` branch (OSS upload) and `<AudioResultPanel>`.
- [ ] **Step 3:** Dynamic handles from `selectedSpec.inputs/outputs` (replace the static handle JSX). Pricing display via `resolveManagedRoutePricing` + `useBackendCreditsPreview`; for seed-audio show "≈2积分/秒，按实际时长结算".
- [ ] **Step 4:** Delete the 5 hardcoded mode-branch JSX blocks.
- [ ] **Step 5:** `npx tsc -b` → clean. **Step 6: Commit** `feat(audio): AudioStudioNode model dropdown + spec-driven form`.

## Task 4: Generic run-handler + migration default model

**Files:** Modify `frontend/src/components/flow/FlowOverlay.tsx`

- [ ] **Step 1:** Replace the per-mode payload branches in the `audioStudio` run-handler with a generic builder: resolve spec from `data.managedModelKey`; `payload = { mode: spec.mode, managedModelKey: data.managedModelKey }`; if `spec.modelField` set `payload[spec.modelField]=spec.modelValue`; copy each `spec.fields[].key` from `data`; for each `spec.inputs[]` collect edge value(s) into `dtoField` (text/referenceAudioUrls[max3]/referenceImageUrl/inputVideoUrl) using the existing edge-walk logic. `upload` returns early.
- [ ] **Step 2:** In the migration (`migrateAudioStudioData`), if `!data.managedModelKey` set it from `MODE_DEFAULT_MODEL[data.mode]`.
- [ ] **Step 3:** `npx tsc -b` → clean. **Step 4: Commit** `feat(audio): spec-driven run-handler + managedModelKey migration`.

## Task 5: Backend — taskType audio + audioStudio managed metadata

**Files:** Modify `backend/src/admin/services/node-config.service.ts`

- [ ] **Step 1:** Extend `normalizeManagedTaskType` (~:166) to map `'audio'`→`'audio'` (add to the allowed set; widen the return type if needed to `text|image|video|audio`).
- [ ] **Step 2:** Give the `audioStudio` default config (both lists) `metadata: { type:'audioStudio', routeStrategy:'model_management_v2', nodeKind:'ai_audio_generation', modelKeys:[6 audio modelKeys], managedModelKey:'doubao-seed-audio-1-0', defaultData:{ managedModelKey:'doubao-seed-audio-1-0', mode:'seed-audio' } }`.
- [ ] **Step 3:** Verify `normalizeManagedNodeMetadata` passes arbitrary `metadata.audioSpec` (on each model/vendor) through to the frontend untouched; if it strips unknown keys, add an `audioStudio`/audio branch that preserves `audioSpec`.
- [ ] **Step 4:** `cd backend && npx tsc -b` → clean. **Step 5: Commit** `feat(audio): backend audio taskType + audioStudio managed metadata`.

## Task 6: Backend/Admin — register 6 audio models + specs

**Files:** Modify `frontend/src/pages/Admin.tsx` (DEFAULT_MODEL_CATALOG + modelKey→nodeKey), and the backend registry default fallback (wherever `model_provider_mapping_v2` defaults are seeded).

- [ ] **Step 1:** Add the 6 audio models (spec §4) to `DEFAULT_MODEL_CATALOG` with `taskType:'audio'`, a `vendors[]` entry carrying the pricing book (seed-audio: `linear` 2积分/秒 via `evaluators`; minimax/tencent: `defaults` fixed 10/30/10), and `metadata.audioSpec` (the field schema per spec §4).
- [ ] **Step 2:** Add the 6 modelKey→`audioStudio` entries to the admin map (`Admin.tsx:~2197`).
- [ ] **Step 3:** Seed the same 6 into the backend registry default (so a fresh `model_provider_mapping_v2` includes them; admin `POST /admin/settings` triggers `syncAllConfigs`).
- [ ] **Step 4:** `npx tsc -b` (both) → clean. **Step 5: Commit** `feat(audio): register 6 audio models + audioSpec in registry defaults`.

## Task 7: End-to-end verification

- [ ] Backend boot: `audioStudio` node-config returns `managedRoutes` with 6 audio models, each carrying `audioSpec`. (`curl /ai-public/node-configs`.)
- [ ] Frontend: node shows a **model dropdown**; switching models re-renders fields + handles; seed-audio shows duration estimate; minimax/tencent show fixed credits.
- [ ] Run each model once (after new-api X-Api-Key配置) — payload hits `/api/ai/audio/generate` with correct `mode`+`model`; seed-audio charged via header, others fixed.
- [ ] Old saved `audioStudio`/legacy nodes load with a defaulted `managedModelKey`.
- [ ] Both `tsc -b` clean.

---

## Notes
- Billing mechanism unchanged (single-track seed-audio + fixed minimax/tencent) — this plan only changes model selection + field rendering + price *display*.
- `upload` is not a registry model; it's a special selector item handled client-side.
- Prereq for actual generation still: volcengine channel speech `X-Api-Key` + new-api redeploy (from the prior feature).
