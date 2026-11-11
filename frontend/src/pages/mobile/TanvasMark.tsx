import { publicAssetUrl } from '@/utils/publicAssetUrl';

/** Tanvas 统一品牌标（与站点 favicon / AI 对话框同一份 Logo.svg）。 */
export default function TanvasMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return <img src={publicAssetUrl('Logo.svg')} alt="Tanvas" draggable={false}
    style={{ height: size, width: 'auto' }} className={`select-none ${className}`} />;
}

/** 深色主题的 Tanvas 文字标（与画布黑色主题顶栏同一份 tanvas_ai.png）。 */
export function TanvasWordmark({ height = 22, className = '' }: { height?: number; className?: string }) {
  return <img src={publicAssetUrl('tanvas_ai.png')} alt="Tanvas" draggable={false}
    style={{ height, width: 'auto' }} className={`select-none ${className}`} />;
}
