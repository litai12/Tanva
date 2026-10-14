import React from 'react'
import { Handle, NodeResizeControl, Position, useStore } from '@xyflow/react'
import type { Node, NodeProps, ResizeParams, ReactFlowState } from '@xyflow/react'
import {
  IconArrowsDiff,
  IconColumns2,
  IconEye,
  IconEyeOff,
  IconFocusCentered,
  IconHandFinger,
  IconStack2,
} from '@tabler/icons-react'
import SmartImage from '../../ui/SmartImage';
import { useImagePreviewResource } from '@/hooks/useImagePreviewResource';
import { useLocaleText } from '@/utils/localeText';
import { useFlowNodeDarkTheme } from './flowNodeDarkTheme';
import { resolveImageCompareInputs } from './imageCompareSources';
import type { ImageCompareSource } from './imageCompareSources';
import {
  IMAGE_COMPARE_DEFAULT_SIZE, IMAGE_COMPARE_MAX_SIZE, IMAGE_COMPARE_MIN_SIZE,
  IMAGE_COMPARE_TARGET_HANDLE_ID,
} from './imageCompareNodeData';
import type { ImageCompareMode, ImageCompareNodeData } from './imageCompareNodeData';
import './ImageCompareNode.css';

type ImageCompareCanvasNode = Node<ImageCompareNodeData, 'imageCompare'>

const MODES: ReadonlyArray<{ mode: ImageCompareMode; label: string; Icon: typeof IconColumns2 }> = [
  { mode: 'side', label: '并排', Icon: IconColumns2 },
  { mode: 'slider', label: '滑动', Icon: IconStack2 },
  { mode: 'overlay', label: '叠加', Icon: IconEye },
  { mode: 'toggle', label: '点按', Icon: IconHandFinger },
]

const KEYBOARD_STEP_PERCENT = 2

function clampPercent(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(100, Math.max(0, numeric))
}

function clampSize(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, Math.round(numeric)))
}

function readMode(value: unknown): ImageCompareMode {
  return MODES.some((entry) => entry.mode === value) ? (value as ImageCompareMode) : 'side'
}

// 只订阅「入边上游的图片」这一份派生值：序列化成字符串让无关的画布变化不触发重渲染。
function useImageCompareInputs(nodeId: string): ImageCompareSource[] {
  // Viewport/selection updates keep the same graph arrays; skip parsing them again.
  const selector = React.useMemo(() => {
    let previousNodes: ReactFlowState['nodes'] | undefined;
    let previousEdges: ReactFlowState['edges'] | undefined;
    let previousKey = '[]';
    return (state: ReactFlowState) => {
      if (state.nodes !== previousNodes || state.edges !== previousEdges) {
        previousNodes = state.nodes;
        previousEdges = state.edges;
        previousKey = JSON.stringify(resolveImageCompareInputs(state.nodes, state.edges, nodeId));
      }
      return previousKey;
    };
  }, [nodeId]);
  const inputsKey = useStore(selector);
  return React.useMemo(() => JSON.parse(inputsKey) as ImageCompareSource[], [inputsKey]);
}

function CompareImage({
  source,
  className,
  style,
}: {
  source: ImageCompareSource
  className?: string
  style?: React.CSSProperties
}): React.JSX.Element {
  const preview = useImagePreviewResource(source.src, source.crop);
  const { lt } = useLocaleText();
  return (
    <SmartImage
      className={`tanva-image-compare-node__image${className ? ` ${className}` : ''}`}
      style={style}
      src={preview.src}
      alt={source.label}
      loading="eager"
      disableLowDetailFallback
      draggable={false}
      placeholder={<div className={`tanva-image-compare-node__loading${className ? ` ${className}` : ''}`} style={style}>{preview.error ? lt('图片加载失败', 'Image failed to load') : lt('加载图片…', 'Loading image…')}</div>}
    />
  );
}

function IndexBadge({ index, className }: { index: number; className?: string }): React.JSX.Element {
  return (
    <span className={`tanva-image-compare-node__badge${className ? ` ${className}` : ''}`}>{index + 1}</span>
  )
}

/**
 * 画布上的图片对比节点。
 *
 * 把图片节点连到左侧输入端即可对比，四种方式：并排 / 滑动分割 / 叠加透明度 / 点按切换。
 * 全部交互都在节点内完成（画布优先），聚焦按钮只是把视图缩放到本节点，不开全屏浮层。
 */
export function ImageCompareNode({ id, data, width, height, selected }: NodeProps<ImageCompareCanvasNode>) {
  const { lt } = useLocaleText();
  const isDark = useFlowNodeDarkTheme();
  const readOnly = data.readOnly === true
  const inputs = useImageCompareInputs(id)
  const [first, second] = inputs
  const label = typeof data.label === 'string' && data.label.trim() ? data.label.trim() : lt('图片对比', 'Image compare')

  const [mode, setMode] = React.useState<ImageCompareMode>(() => readMode(data.compareMode))
  React.useEffect(() => setMode(readMode(data.compareMode)), [data.compareMode])

  const [splitPercent, setSplitPercent] = React.useState(() => clampPercent(data.splitPercent, 50))
  const [opacityPercent, setOpacityPercent] = React.useState(() => clampPercent(data.overlayOpacity, 50))
  const [draggingSplit, setDraggingSplit] = React.useState(false)
  const [togglePinned, setTogglePinned] = React.useState(false)
  const [togglePressed, setTogglePressed] = React.useState(false)
  const stageRef = React.useRef<HTMLDivElement>(null)
  const splitRef = React.useRef(splitPercent)
  const draggingSplitRef = React.useRef(false)
  const opacityRef = React.useRef(opacityPercent)
  const draggingOpacityRef = React.useRef(false)

  React.useEffect(() => {
    // A disconnected input or mode change can unmount the captured stage.
    draggingSplitRef.current = false;
    draggingOpacityRef.current = false;
    setDraggingSplit(false);
    setTogglePressed(false);
  }, [mode, first?.inputId, second?.inputId]);

  React.useEffect(() => {
    if (!draggingSplitRef.current) {
      splitRef.current = clampPercent(data.splitPercent, 50)
      setSplitPercent(splitRef.current)
    }
  }, [data.splitPercent])
  React.useEffect(() => {
    if (!draggingOpacityRef.current) {
      opacityRef.current = clampPercent(data.overlayOpacity, 50)
      setOpacityPercent(opacityRef.current)
    }
  }, [data.overlayOpacity])

  const persist = React.useCallback((patch: Partial<ImageCompareNodeData>) => {
    if (!readOnly) window.dispatchEvent(new CustomEvent('flow:updateNodeData', { detail: { id, patch, historyLabel: 'flow-image-compare-settings' } }))
  }, [id, readOnly])

  const selectMode = (next: ImageCompareMode) => {
    setMode(next)
    setTogglePinned(false)
    if (next !== readMode(data.compareMode)) persist({ compareMode: next })
  }

  const updateSplitFromClientX = (clientX: number) => {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    splitRef.current = clampPercent(((clientX - rect.left) / rect.width) * 100, 50)
    setSplitPercent(splitRef.current)
  }

  const handleSplitPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    draggingSplitRef.current = true
    setDraggingSplit(true)
    updateSplitFromClientX(event.clientX)
  }

  const handleSplitPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (draggingSplitRef.current) updateSplitFromClientX(event.clientX)
  }

  const endSplitDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!draggingSplitRef.current) return
    draggingSplitRef.current = false
    setDraggingSplit(false)
    persist({ splitPercent: Math.round(splitRef.current * 10) / 10 })
  }

  const handleSplitKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEYBOARD_STEP_PERCENT * 5 : KEYBOARD_STEP_PERCENT
    let next: number
    if (event.key === 'ArrowLeft') next = clampPercent(splitPercent - step, 50)
    else if (event.key === 'ArrowRight') next = clampPercent(splitPercent + step, 50)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = 100
    else return
    event.preventDefault()
    event.stopPropagation()
    splitRef.current = next
    setSplitPercent(next)
    persist({ splitPercent: next })
  }

  const handleResizeEnd = (_event: unknown, params: ResizeParams) => {
    persist({
      boxW: clampSize(params.width, IMAGE_COMPARE_MIN_SIZE.width, IMAGE_COMPARE_MAX_SIZE.width, IMAGE_COMPARE_DEFAULT_SIZE.width),
      boxH: clampSize(params.height, IMAGE_COMPARE_MIN_SIZE.height, IMAGE_COMPARE_MAX_SIZE.height, IMAGE_COMPARE_DEFAULT_SIZE.height),
    })
  }

  const focusNode = () => {
    window.dispatchEvent(new CustomEvent('flow:focus-node', { detail: { id } }))
  }

  const rootStyle = {
    '--compare-text': isDark ? '#e5e7eb' : '#111827',
    '--compare-muted': isDark ? '#9ca3af' : '#6b7280',
    '--compare-bg': isDark ? '#1c1c1c' : '#ffffff',
    '--compare-border': selected ? '#2563eb' : isDark ? '#333333' : '#e5e7eb',
    '--compare-toolbar': isDark ? '#161616' : '#f9fafb',
    '--compare-well': isDark ? '#161616' : '#f3f4f6',
    '--compare-active': isDark ? '#333333' : '#e5e7eb',
    width: typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : clampSize(data.boxW, IMAGE_COMPARE_MIN_SIZE.width, IMAGE_COMPARE_MAX_SIZE.width, IMAGE_COMPARE_DEFAULT_SIZE.width),
    height: typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : clampSize(data.boxH, IMAGE_COMPARE_MIN_SIZE.height, IMAGE_COMPARE_MAX_SIZE.height, IMAGE_COMPARE_DEFAULT_SIZE.height),
  } as React.CSSProperties

  const renderStage = (): React.JSX.Element => {
    if (!first) {
      return (
        <div className="tanva-image-compare-node__empty">
          <IconArrowsDiff size={22} aria-hidden="true" />
          <span>{lt('把图片连到左侧输入端开始对比', 'Connect images to the left input to compare')}</span>
        </div>
      )
    }

    if (mode === 'side' || !second) {
      const sources = mode === 'side' ? inputs : [first]
      return (
        <div
          className="tanva-image-compare-node__side"
          style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(sources.length, 2), 4)}, minmax(0, 1fr))` }}
        >
          {sources.map((source, index) => (
            <div className="tanva-image-compare-node__cell" key={source.inputId} title={source.label}>
              <IndexBadge index={index} />
              <CompareImage source={source} />
            </div>
          ))}
          {!second ? (
            <div className="tanva-image-compare-node__cell tanva-image-compare-node__cell--placeholder">
              <IndexBadge index={1} />
              <span>{lt('再连一张图片', 'Connect another image')}</span>
            </div>
          ) : null}
        </div>
      )
    }

    if (mode === 'slider') {
      return (
        <div
          ref={stageRef}
          className={`tanva-image-compare-node__stage tanva-image-compare-node__stage--slider nodrag nopan${draggingSplit ? ' tanva-image-compare-node__stage--dragging' : ''}`}
          style={{ '--tanva-image-compare-node-split': `${splitPercent}%` } as React.CSSProperties}
          onPointerDown={handleSplitPointerDown}
          onPointerMove={handleSplitPointerMove}
          onPointerUp={endSplitDrag}
          onPointerCancel={endSplitDrag}
          onLostPointerCapture={endSplitDrag}
        >
          <CompareImage source={first} className="tanva-image-compare-node__image--layer" />
          <div className="tanva-image-compare-node__clip" aria-hidden="true">
            <CompareImage source={second} className="tanva-image-compare-node__image--layer" />
          </div>
          <IndexBadge index={0} className="tanva-image-compare-node__badge--start" />
          <IndexBadge index={1} className="tanva-image-compare-node__badge--end" />
          <div
            className="tanva-image-compare-node__divider"
            role="slider"
            tabIndex={0}
            aria-label={lt('分割位置', 'Split position')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(splitPercent)}
            onKeyDown={handleSplitKeyDown}
            onDoubleClick={(event) => {
              event.stopPropagation();
              splitRef.current = 50
              setSplitPercent(50)
              persist({ splitPercent: 50 })
            }}
          >
            <span className="tanva-image-compare-node__divider-line" />
            <span className="tanva-image-compare-node__divider-handle">
              <IconArrowsDiff size={14} aria-hidden="true" />
            </span>
          </div>
        </div>
      )
    }

    if (mode === 'overlay') {
      return (
        <div className="tanva-image-compare-node__stage">
          <CompareImage source={first} className="tanva-image-compare-node__image--layer" />
          <CompareImage
            source={second}
           
            className="tanva-image-compare-node__image--layer"
            style={{ opacity: opacityPercent / 100 }}
          />
          <div className="tanva-image-compare-node__opacity nodrag nopan">
            <input
              className="tanva-image-compare-node__opacity-input"
              type="range"
              min={0}
              max={100}
              value={Math.round(opacityPercent)}
              aria-label={lt('图 2 不透明度', 'Image 2 opacity')}
              style={{ '--tanva-image-compare-node-opacity': `${opacityPercent}%` } as React.CSSProperties}
              onPointerDown={(event) => {
                event.stopPropagation()
                event.currentTarget.setPointerCapture(event.pointerId)
                draggingOpacityRef.current = true
              }}
              onChange={(event) => {
                opacityRef.current = clampPercent(Number(event.currentTarget.value), 50)
                setOpacityPercent(opacityRef.current)
              }}
              onPointerUp={() => {
                draggingOpacityRef.current = false
                persist({ overlayOpacity: opacityRef.current })
              }}
              onPointerCancel={() => {
                draggingOpacityRef.current = false
                persist({ overlayOpacity: opacityRef.current })
              }}
              onBlur={() => persist({ overlayOpacity: opacityRef.current })}
              onKeyUp={(event) => {
                event.stopPropagation()
                persist({ overlayOpacity: opacityRef.current })
              }}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
        </div>
      )
    }

    const showingSecond = togglePinned !== togglePressed
    return (
      <div
        className="tanva-image-compare-node__stage tanva-image-compare-node__stage--toggle nodrag nopan"
        title={lt('按住查看另一张，松开还原', 'Hold to view the other image, release to restore')}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.stopPropagation()
          event.currentTarget.setPointerCapture(event.pointerId)
          setTogglePressed(true)
        }}
        onPointerUp={() => setTogglePressed(false)}
        onPointerCancel={() => setTogglePressed(false)}
        onLostPointerCapture={() => setTogglePressed(false)}
      >
        <CompareImage
          source={first}
         
          className="tanva-image-compare-node__image--layer"
          style={{ visibility: showingSecond ? 'hidden' : 'visible' }}
        />
        <CompareImage
          source={second}
         
          className="tanva-image-compare-node__image--layer"
          style={{ visibility: showingSecond ? 'visible' : 'hidden' }}
        />
        <IndexBadge index={showingSecond ? 1 : 0} className="tanva-image-compare-node__badge--start" />
        <button
          type="button"
          className="tanva-image-compare-node__pin"
          title={togglePinned ? lt('切回图 1', 'Show image 1') : lt('固定显示图 2', 'Pin image 2')}
          aria-label={togglePinned ? lt('切回图 1', 'Show image 1') : lt('固定显示图 2', 'Pin image 2')}
          aria-pressed={togglePinned}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            setTogglePinned((value) => !value)
          }}
        >
          {togglePinned ? <IconEye size={14} /> : <IconEyeOff size={14} />}
        </button>
      </div>
    )
  }

  return (
    <div className={`tanva-image-compare-node${selected ? ' tanva-image-compare-node--selected' : ''}`} style={rootStyle}>
      <div className="tanva-image-compare-node__title">
        <IconArrowsDiff size={14} aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className="tanva-image-compare-node__card">
        <div className="tanva-image-compare-node__toolbar nodrag nopan" role="tablist" aria-label={lt('对比方式', 'Compare mode')}>
          {MODES.map(({ mode: entryMode, label: entryLabel, Icon }) => (
            <button
              key={entryMode}
              type="button"
              role="tab"
              aria-selected={mode === entryMode}
              className={`tanva-image-compare-node__mode${mode === entryMode ? ' tanva-image-compare-node__mode--active' : ''}`}
              title={lt(entryLabel, { side: 'Side by side', slider: 'Slide', overlay: 'Overlay', toggle: 'Toggle' }[entryMode])}
              aria-label={lt(entryLabel, { side: 'Side by side', slider: 'Slide', overlay: 'Overlay', toggle: 'Toggle' }[entryMode])}
              onClick={(event) => {
                event.stopPropagation()
                selectMode(entryMode)
              }}
            >
              <Icon size={15} aria-hidden="true" />
            </button>
          ))}
          <button
            type="button"
            className="tanva-image-compare-node__focus"
            title={lt('聚焦到此节点', 'Focus this node')}
            aria-label={lt('聚焦到此节点', 'Focus this node')}
            onClick={(event) => {
              event.stopPropagation()
              focusNode()
            }}
          >
            <IconFocusCentered size={15} aria-hidden="true" />
          </button>
        </div>
        <div className="tanva-image-compare-node__body">{renderStage()}</div>
      </div>
      <div className="tanva-image-compare-node__handles">
        <Handle
          id={IMAGE_COMPARE_TARGET_HANDLE_ID}
          className="tanva-image-compare-node__handle"
          type="target"
          position={Position.Left}
          style={{ position: 'absolute', pointerEvents: 'auto', left: 0, top: '50%' }}
          data-handle-type="image"
          data-handle-position="left"
          title={lt('输入: 图片', 'Input: images')}
          aria-label={lt('输入: 图片', 'Input: images')}
        />
      </div>
      {selected && !readOnly ? (
        <NodeResizeControl
          className="tanva-image-compare-node__resize nodrag"
          position="bottom-right"
          minWidth={IMAGE_COMPARE_MIN_SIZE.width}
          minHeight={IMAGE_COMPARE_MIN_SIZE.height}
          maxWidth={IMAGE_COMPARE_MAX_SIZE.width}
          maxHeight={IMAGE_COMPARE_MAX_SIZE.height}
          onResizeEnd={handleResizeEnd}
        >
          <div className="tanva-image-compare-node__resize-handle" />
        </NodeResizeControl>
      ) : null}
    </div>
  )
}

export default React.memo(ImageCompareNode)
