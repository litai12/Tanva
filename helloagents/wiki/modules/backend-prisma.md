# 后端模块：Prisma（backend-prisma）

## 作用
- 提供 Prisma Client 与数据库连接管理，作为各业务模块的数据访问层。

## 关键文件
- `backend/src/prisma/prisma.module.ts`
- `backend/src/prisma/prisma.service.ts`
- `backend/prisma/schema.prisma`

## 数据库
- PostgreSQL（连接字符串：`DATABASE_URL`）
- 提示词库使用 `UserPromptLibraryItem` 保存当前用户的标题、描述、提示词、媒体类型和可选远程封面 URL，使用 `UserPromptLibraryFavorite` 保存 `official/custom + promptId` 常用关系；两者都以用户外键级联删除。迁移：`202608260001_add_user_prompt_library`。
