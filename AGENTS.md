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
