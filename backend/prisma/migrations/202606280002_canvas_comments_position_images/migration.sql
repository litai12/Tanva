-- 画布评论：从「锚定节点」升级为「锚定画布坐标(x/y)」+ 评论图片附件。
-- nodeId 改为可空（历史/未来扩展保留）；新增 x/y 浮点坐标；评论新增 imageUrls 数组。

ALTER TABLE "CanvasCommentThread" ALTER COLUMN "nodeId" DROP NOT NULL;
ALTER TABLE "CanvasCommentThread" ADD COLUMN IF NOT EXISTS "x" DOUBLE PRECISION;
ALTER TABLE "CanvasCommentThread" ADD COLUMN IF NOT EXISTS "y" DOUBLE PRECISION;

ALTER TABLE "CanvasComment"
  ADD COLUMN IF NOT EXISTS "imageUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
