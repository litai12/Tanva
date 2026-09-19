import { AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, Group } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SelectionAlignment } from '@/utils/flowSelectionAlignment';

const actions = [
  ['left', '左对齐', 'Align left', AlignHorizontalJustifyStart],
  ['center', '水平居中', 'Align horizontal centers', AlignHorizontalJustifyCenter],
  ['right', '右对齐', 'Align right', AlignHorizontalJustifyEnd],
  ['top', '顶部对齐', 'Align top', AlignVerticalJustifyStart],
  ['middle', '垂直居中', 'Align vertical centers', AlignVerticalJustifyCenter],
  ['bottom', '底部对齐', 'Align bottom', AlignVerticalJustifyEnd],
] as const;

export default function FlowSelectionToolbar({ count, onAlign, onGroup }: {
  count: number;
  onAlign: (alignment: SelectionAlignment) => void;
  onGroup?: () => void;
}) {
  const { i18n } = useTranslation();
  const zh = (i18n.resolvedLanguage || i18n.language).startsWith('zh');
  if (count < 2) return null;
  return (
    <div className="nodrag nopan nowheel absolute bottom-6 left-1/2 z-30 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-full border border-white/15 bg-slate-900/95 px-3 py-2 text-white shadow-xl backdrop-blur"
      style={{ pointerEvents: 'auto' }} role="toolbar" aria-label={zh ? '节点布局对齐' : 'Node alignment'}
      onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
      <span className="shrink-0 whitespace-nowrap px-2 text-xs">{zh ? `已选 ${count} 项` : `${count} selected`}</span>
      {actions.map(([alignment, label, en, Icon]) => (
        <button key={alignment} type="button" title={zh ? label : en} aria-label={zh ? label : en}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
          onClick={() => onAlign(alignment)}><Icon size={18} /></button>
      ))}
      {onGroup && <button type="button" onClick={onGroup} className="ml-1 flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-3 py-2 text-xs hover:bg-white/20">
        <Group size={16} />{zh ? '打组' : 'Group'}
      </button>}
    </div>
  );
}
