-- 更新 Kling O3 节点配置
UPDATE "NodeConfig" 
SET 
  "nameZh" = 'Kling O3视频生成',
  "nameEn" = 'Kling O3',
  "serviceType" = 'kling-o3-video',
  "creditsPerCall" = 600,
  "priceYuan" = 6,
  "status" = 'normal',
  "statusMessage" = NULL
WHERE "nodeKey" = 'klingO1Video';
