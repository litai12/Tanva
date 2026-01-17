# Tanva — Agent Instructions

## Repo overview

- Frontend: `frontend/` (React + TypeScript + Vite + Tailwind)
- Backend: `backend/` (NestJS)
- Docs: `frontend/docs/` (primary), plus top-level `*.md`

## Default workflow (helloagents)

- All tasks default to the helloagents workflow: Analyze → Design → Develop.
- Use `helloagents/project.md` as SSOT for technical conventions, and keep `helloagents/wiki/` (and `helloagents/CHANGELOG.md` when relevant) in sync with code/doc changes.

## Common commands

- Frontend dev: `cd frontend && npm i && npm run dev`
- Frontend checks: `cd frontend && npm run lint && npm run build`
- Backend dev: `cd backend && npm i && npm run dev`
- Backend build: `cd backend && npm run build`

## Editing guidelines

- Prefer the docs in `frontend/docs/` as the source of truth for conventions.
- Keep changes focused; avoid drive-by refactors.
- Use `rg` for searching and keep diffs minimal.

## Design JSON (重要)

- `Project.contentJson` / `PublicTemplate.templateData` 属于「设计 JSON」：**只允许保存远程 URL/路径引用**。
- 禁止把 `imageData`/`thumbnail` 等字段写成 `data:`、`blob:`、裸 base64（例如 `iVBORw0...`）并落库/落 OSS；后端会在写入前做清洗（见 `backend/src/utils/designJsonSanitizer.ts`），必要时可运行 `backend/scripts/sanitize-design-json.ts` 清理历史数据。
- Frontend 统一原则：图片“展示”优先用 `canvas`/`drawImage` 或 `blob:`（objectURL）渲染，**避免直接用 `data:`/base64 做渲染**；“持久化”只存远程 URL/OSS key + 裁剪参数；`data:`/`blob:`/`flow-asset:`/裸 base64 仅允许作为运行时临时态，保存前必须上传并替换为远程引用，否则应阻止保存。
- 画板/图层/缩略图等所有 UI 展示：若输入是 `data:image/*` 或裸 base64，需先转 Blob（objectURL）或走 `canvas` 渲染；并确保“源图片对象”是可持久化的远程 URL/OSS key（而不是 base64/blob）。
- 图片分割（ImageSplit）生成的图片节点：**优先保存“上游同类型”的图片引用 + 裁剪参数**，展示走 `canvas`/`drawImage`；非必要不做图片格式/类型转化（尤其不要把切片重编码成新的 base64/blob 再落库/外发）。
