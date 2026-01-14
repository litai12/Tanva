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
