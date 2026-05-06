UPDATE "NodeConfig"
SET
  "nameZh" = 'Image Chat',
  "nameEn" = 'Image Chat',
  "description" = '图像对话与提示词提取',
  "updatedAt" = NOW()
WHERE "nodeKey" = 'analysis';
