/**
 * 单位转换工具模块
 * 支持像素与实际单位(mm/cm/m/km)之间的转换
 * 集成缩放维度，实现单位与缩放的协同工作
 */

// 支持的单位类型
export type Unit = 'mm' | 'cm' | 'm' | 'km';

// 单位到米的转换系数
const UNIT_TO_METERS: Record<Unit, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  km: 1000,
};

// 单位显示名称
const UNIT_NAMES: Record<Unit, string> = {
  mm: '毫米',
  cm: '厘米', 
  m: '米',
  km: '千米',
};

/**
 * 将像素转换为米
 * @param pixels 像素值
 * @param scaleRatio 比例尺系数（1像素对应多少米）
 * @returns 米数
 */
export function pixelsToMeters(pixels: number, scaleRatio: number): number {
  return pixels * scaleRatio;
}

/**
 * 将米转换为像素
 * @param meters 米数
 * @param scaleRatio 比例尺系数（1像素对应多少米）
 * @returns 像素值
 */
export function metersToPixels(meters: number, scaleRatio: number): number {
  return meters / scaleRatio;
}

/**
 * 将像素转换为指定单位
 * @param pixels 像素值
 * @param scaleRatio 比例尺系数
 * @param unit 目标单位
 * @returns 指定单位的数值
 */
export function pixelsToUnit(pixels: number, scaleRatio: number, unit: Unit): number {
  const meters = pixelsToMeters(pixels, scaleRatio);
  return meters / UNIT_TO_METERS[unit];
}

/**
 * 将指定单位转换为像素
 * @param value 单位数值
 * @param unit 源单位
 * @param scaleRatio 比例尺系数
 * @returns 像素值
 */
export function unitToPixels(value: number, unit: Unit, scaleRatio: number): number {
  const meters = value * UNIT_TO_METERS[unit];
  return metersToPixels(meters, scaleRatio);
}

/**
 * 格式化显示单位值
 * @param pixels 像素值
 * @param scaleRatio 比例尺系数
 * @param targetUnit 目标显示单位
 * @param precision 小数精度，默认为2
 * @returns 格式化的字符串，如 "10.50 cm"
 */
export function formatDisplayUnit(
  pixels: number, 
  scaleRatio: number, 
  targetUnit: Unit, 
  precision: number = 2
): string {
  const value = pixelsToUnit(pixels, scaleRatio, targetUnit);
  return `${value.toFixed(precision)} ${targetUnit}`;
}

/**
 * 智能格式化显示单位（自动选择最合适的单位）
 * @param pixels 像素值
 * @param scaleRatio 比例尺系数
 * @param precision 小数精度，默认为2
 * @returns 格式化的字符串
 */
export function formatSmartDisplayUnit(
  pixels: number, 
  scaleRatio: number, 
  precision: number = 2
): string {
  const meters = pixelsToMeters(pixels, scaleRatio);
  
  // 自动选择最合适的单位
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(precision)} km`;
  } else if (meters >= 1) {
    return `${meters.toFixed(precision)} m`;
  } else if (meters >= 0.01) {
    return `${(meters * 100).toFixed(precision)} cm`;
  } else {
    return `${(meters * 1000).toFixed(precision)} mm`;
  }
}

/**
 * 计算有效比例尺（考虑缩放）
 * @param baseScaleRatio 基础比例尺系数
 * @param zoom 当前缩放级别
 * @returns 有效比例尺系数
 */
export function calculateEffectiveScale(baseScaleRatio: number, zoom: number): number {
  return baseScaleRatio / zoom;
}

/**
 * 生成比例尺文本表示
 * @param scaleRatio 比例尺系数
 * @param zoom 当前缩放级别
 * @returns 比例尺文本，如 "1:100"
 */
export function getScaleRatioText(scaleRatio: number, zoom: number): string {
  const effectiveScale = calculateEffectiveScale(scaleRatio, zoom);
  const ratio = Math.round(1 / effectiveScale);
  return `1:${ratio}`;
}

/**
 * 计算比例尺标尺的合适长度
 * @param canvasWidth 画布宽度（像素）
 * @param scaleRatio 比例尺系数
 * @param zoom 当前缩放级别
 * @param targetUnit 目标单位
 * @returns 标尺的像素长度和对应的单位值
 */
export function calculateScaleBarLength(
  canvasWidth: number,
  scaleRatio: number,
  zoom: number,
  targetUnit: Unit
): { pixelLength: number; unitValue: number; displayText: string } {
  const effectiveScale = calculateEffectiveScale(scaleRatio, zoom);
  
  // 目标是比例尺长度约为画布宽度的 1/8 到 1/4
  const targetPixelLength = canvasWidth / 6;
  
  // 转换为目标单位
  const targetUnitValue = pixelsToUnit(targetPixelLength, effectiveScale, targetUnit);
  
  // 找到一个"圆整"的数值
  const magnitude = Math.pow(10, Math.floor(Math.log10(targetUnitValue)));
  let roundedValue: number;
  
  if (targetUnitValue / magnitude < 2) {
    roundedValue = magnitude;
  } else if (targetUnitValue / magnitude < 5) {
    roundedValue = 2 * magnitude;
  } else {
    roundedValue = 5 * magnitude;
  }
  
  // 转换回像素
  const pixelLength = unitToPixels(roundedValue, targetUnit, effectiveScale);
  
  return {
    pixelLength,
    unitValue: roundedValue,
    displayText: `${roundedValue} ${targetUnit}`,
  };
}

/**
 * 获取单位的显示名称
 * @param unit 单位
 * @returns 中文显示名称
 */
export function getUnitDisplayName(unit: Unit): string {
  return UNIT_NAMES[unit];
}

/**
 * 获取所有支持的单位列表
 * @returns 单位数组
 */
export function getAllUnits(): Unit[] {
  return Object.keys(UNIT_TO_METERS) as Unit[];
}

/**
 * 验证单位是否有效
 * @param unit 待验证的单位
 * @returns 是否为有效单位
 */
export function isValidUnit(unit: string): unit is Unit {
  return unit in UNIT_TO_METERS;
}