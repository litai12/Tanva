# 后端模块：公开 AI API（backend-ai-public）

## 作用
- 为无需登录或特定场景提供公开 AI API（路由前缀 `/public/ai`）。

## 关键文件
- `backend/src/ai-public/ai-public.controller.ts`
- `backend/src/ai-public/ai-public.service.ts`

## API（前缀 `/api/public/ai`，节选）
- `POST generate` / `edit` / `blend` / `analyze` / `chat`
- `GET providers`
- `POST remove-background`
- `GET background-removal-info` / `GET test-background-removal`
- `GET veo/models` / `POST veo/generate`

