const LABEL_MAP: Record<string, string> = {
  model: '模型',
  imageSize: '尺寸档位',
  duration: '时长',
  seedanceModel: 'Seedance型号',
  resolution: '分辨率',
  aspectRatio: '画幅',
  mode: '模式',
  videoMode: '视频模式',
  sound: '音效',
  generateAudio: '生成音频',
  channel: '渠道',
  pricing: '计价',
  volcVersion: '版本',
  volcResolutionTier: '分辨率档位',
  volcFpsBand: 'FPS档位',
  volcFactor: '换算系数',
  volcUnitPriceYuan: '换算后单价(元)',
  volcPlatformPrice: '平台价',
};

const normalizeValue = (key: string, value: string): string => {
  const normalized = value.trim();
  if (!normalized) return normalized;
  if (key === 'sound') {
    return normalized === 'on' ? '开启' : normalized === 'off' ? '关闭' : normalized;
  }
  if (key === 'generateAudio') {
    return normalized === 'yes' ? '是' : normalized === 'no' ? '否' : normalized;
  }
  if (key === 'channel') {
    if (normalized === 'tencent') return '尊享路线';
    if (normalized === 'apimart') return '普通路线';
    if (normalized === '147') return '官方路线';
    if (normalized === 'beqlee') return '极速路线';
  }
  if (key === 'volcVersion') {
    if (normalized === 'professional') return '专业版';
    if (normalized === 'standard') return '标准版';
  }
  if (key === 'volcFpsBand') {
    if (normalized === '>30') return '大于 30';
    if (normalized === '<=30') return '不高于 30';
  }
  if (key === 'volcFactor') {
    return `${normalized}x`;
  }
  if (key === 'volcUnitPriceYuan') {
    return `¥${normalized}`;
  }
  if (key === 'volcPlatformPrice') {
    return `${normalized} 积分`;
  }
  return normalized;
};

export const formatCreditBillingRemark = (remark?: string | null): string | null => {
  if (typeof remark !== 'string') return null;
  const trimmed = remark.trim();
  if (!trimmed) return null;

  const parts = trimmed
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((part) => {
      const separatorIndex = part.indexOf(':');
      if (separatorIndex < 0) return part;
      const rawKey = part.slice(0, separatorIndex).trim();
      const rawValue = part.slice(separatorIndex + 1).trim();
      const displayKey = LABEL_MAP[rawKey] || rawKey;
      const displayValue = normalizeValue(rawKey, rawValue);
      return `${displayKey}: ${displayValue}`;
    });

  return parts.length > 0 ? parts.join(' | ') : trimmed;
};
