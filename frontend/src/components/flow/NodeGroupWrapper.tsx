import React from 'react';
import { type Node } from 'reactflow';
import { Send as SendIcon, Play, Plus, X, Ungroup } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NodeGroup } from './types';

// 长宽比图标
const AspectRatioIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <rect x="2" y="4" width="12" height="8" stroke="currentColor" strokeWidth="1.5" fill="none" rx="1" />
  </svg>
);

interface NodeGroupWrapperProps {
  group: NodeGroup;
  nodes: Node[];
  onUpdatePrompts: (groupId: string, prompts: string[]) => void;
  onUpdateAspectRatio: (groupId: string, aspectRatio: string) => void;
  onRun: (groupId: string) => void;
  onSend: (groupId: string) => void;
  onDissolve: (groupId: string) => void;
}

const PADDING = 24; // 组边框到节点的间距

export default function NodeGroupWrapper({
  group,
  nodes,
  onUpdatePrompts,
  onUpdateAspectRatio,
  onRun,
  onSend,
  onDissolve,
}: NodeGroupWrapperProps) {
  const [isTextFocused, setIsTextFocused] = React.useState(false);
  const [isAspectMenuOpen, setIsAspectMenuOpen] = React.useState(false);
  const aspectMenuRef = React.useRef<HTMLDivElement>(null);

  // 计算包围盒 (Flow 坐标系)
  const bounds = React.useMemo(() => {
    if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    nodes.forEach((node) => {
      const nodeWidth = node.width || 320;
      const nodeHeight = node.height || 260; // GeneratePro 节点的大致高度

      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + nodeWidth);
      maxY = Math.max(maxY, node.position.y + nodeHeight);
    });

    return {
      x: minX - PADDING,
      y: minY - PADDING,
      width: maxX - minX + PADDING * 2,
      height: maxY - minY + PADDING * 2,
    };
  }, [nodes]);

  // 提示词数组
  const prompts = React.useMemo(() => {
    const p = group.prompts || [''];
    return p.length > 0 ? p : [''];
  }, [group.prompts]);

  // 更新单个提示词
  const updatePrompt = React.useCallback(
    (index: number, value: string) => {
      const newPrompts = [...prompts];
      newPrompts[index] = value;
      onUpdatePrompts(group.id, newPrompts);
    },
    [group.id, prompts, onUpdatePrompts]
  );

  // 添加新提示词
  const addPrompt = React.useCallback(() => {
    const newPrompts = [...prompts, ''];
    onUpdatePrompts(group.id, newPrompts);
  }, [group.id, prompts, onUpdatePrompts]);

  // 删除提示词
  const removePrompt = React.useCallback(
    (index: number) => {
      if (prompts.length <= 1) return;
      const newPrompts = prompts.filter((_, i) => i !== index);
      onUpdatePrompts(group.id, newPrompts);
    },
    [group.id, prompts, onUpdatePrompts]
  );

  // 长宽比选项
  const aspectOptions = React.useMemo(
    () => [
      { label: '自动', value: '' },
      { label: '1:1', value: '1:1' },
      { label: '3:4', value: '3:4' },
      { label: '4:3', value: '4:3' },
      { label: '2:3', value: '2:3' },
      { label: '3:2', value: '3:2' },
      { label: '4:5', value: '4:5' },
      { label: '5:4', value: '5:4' },
      { label: '9:16', value: '9:16' },
      { label: '16:9', value: '16:9' },
      { label: '21:9', value: '21:9' },
    ],
    []
  );

  const aspectRatioValue = group.aspectRatio ?? '';

  // 点击外部关闭长宽比菜单
  React.useEffect(() => {
    if (!isAspectMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (aspectMenuRef.current && !aspectMenuRef.current.contains(e.target as HTMLElement)) {
        setIsAspectMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isAspectMenuOpen]);

  // 阻止事件冒泡，避免触发节点拖拽
  const stopPropagation = React.useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
  }, []);

  if (nodes.length === 0) return null;

  return (
    <div
      className="node-group-wrapper nodrag nopan"
      style={{
        position: 'absolute',
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height + 160, // 为底部控制区留出空间
        pointerEvents: 'none',
        zIndex: -1,
      }}
    >
      {/* 圆角底色背景 */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: bounds.width,
          height: bounds.height,
          backgroundColor: 'rgba(59, 130, 246, 0.06)',
          borderRadius: 20,
          border: '2px dashed rgba(59, 130, 246, 0.25)',
          pointerEvents: 'none',
        }}
      />

      {/* 组标题和解组按钮 */}
      <div
        className="nodrag"
        style={{
          position: 'absolute',
          top: 6,
          left: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          pointerEvents: 'auto',
        }}
        onPointerDown={stopPropagation}
        onMouseDown={stopPropagation}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: 'rgba(59, 130, 246, 0.9)',
            background: 'rgba(255, 255, 255, 0.95)',
            padding: '3px 10px',
            borderRadius: 6,
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          组 ({group.nodeIds.length}个节点)
        </span>
        <button
          onClick={() => onDissolve(group.id)}
          className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
          title="解散组 (Ctrl/Cmd + Shift + G)"
          style={{ background: 'rgba(255, 255, 255, 0.95)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
        >
          <Ungroup style={{ width: 12, height: 12 }} />
        </button>
      </div>

      {/* 底部控制区 */}
      <div
        className="nodrag nopan"
        style={{
          position: 'absolute',
          top: bounds.height + 8,
          left: 0,
          width: bounds.width,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          pointerEvents: 'auto',
        }}
        onPointerDown={stopPropagation}
        onMouseDown={stopPropagation}
      >
        {/* 提示词输入框 */}
        <div style={{ width: '100%', maxWidth: Math.min(bounds.width - 20, 400), padding: '0 10px' }}>
          {prompts.map((prompt, index) => (
            <div key={index} style={{ position: 'relative', marginBottom: index < prompts.length - 1 ? 8 : 0 }}>
              <div
                className="group"
                style={{
                  background: '#fff',
                  borderRadius: 14,
                  border: '1px solid #e5e7eb',
                  padding: '10px 14px',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
                  position: 'relative',
                }}
              >
                <textarea
                  value={prompt}
                  onChange={(e) => updatePrompt(index, e.target.value)}
                  placeholder={index === 0 ? '输入组的统一提示词...' : '输入额外提示词...'}
                  rows={2}
                  style={{
                    width: '100%',
                    fontSize: 13,
                    lineHeight: 1.5,
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    resize: 'none',
                    color: '#374151',
                    paddingRight: prompts.length > 1 ? 24 : 0,
                  }}
                  onFocus={() => setIsTextFocused(true)}
                  onBlur={() => setIsTextFocused(false)}
                />
                {/* 删除按钮 */}
                {prompts.length > 1 && (
                  <button
                    onClick={() => removePrompt(index)}
                    className="absolute top-2 right-2 w-5 h-5 rounded-full bg-gray-100 hover:bg-red-100 text-gray-400 hover:text-red-500 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                    title="删除此提示词"
                  >
                    <X style={{ width: 12, height: 12 }} />
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* 添加提示词按钮 */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
            <button
              onClick={addPrompt}
              className="text-gray-400 hover:text-gray-600 flex items-center justify-center transition-colors cursor-pointer"
              title="添加提示词"
              style={{ padding: 0, background: 'transparent', border: 'none' }}
            >
              <Plus style={{ width: 12, height: 12 }} />
            </button>
          </div>
        </div>

        {/* 按钮组 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div className="inline-flex items-center gap-2 px-2 py-2 rounded-[999px] bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass">
            {/* 长宽比选择按钮 */}
            <div className="relative" ref={aspectMenuRef}>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsAspectMenuOpen(!isAspectMenuOpen);
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                className={cn(
                  'p-0 h-8 w-8 rounded-full bg-white/50 border border-gray-300 text-gray-700 transition-all duration-200 hover:bg-blue-50 hover:border-blue-300 flex items-center justify-center',
                  aspectRatioValue ? 'bg-blue-50 border-blue-300 text-blue-600' : ''
                )}
                title={aspectRatioValue ? `长宽比: ${aspectRatioValue}` : '选择长宽比'}
              >
                <AspectRatioIcon style={{ width: 14, height: 14 }} />
              </button>
            </div>

            {/* Run 按钮 */}
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRun(group.id);
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              className="p-0 h-8 w-8 rounded-full bg-white/50 border border-gray-300 text-gray-700 transition-all duration-200 hover:bg-blue-50 hover:border-blue-300 flex items-center justify-center"
              title="运行组内所有节点生成"
            >
              <Play style={{ width: 14, height: 14 }} />
            </button>

            {/* 发送按钮 */}
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSend(group.id);
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              className="p-0 h-8 w-8 rounded-full bg-white/50 border border-gray-300 text-gray-700 transition-all duration-200 hover:bg-blue-50 hover:border-blue-300 flex items-center justify-center"
              title="发送组内所有图像到画布"
            >
              <SendIcon style={{ width: 14, height: 14 }} />
            </button>
          </div>

          {/* 长宽比选择栏 */}
          {isAspectMenuOpen && (
            <div className="bg-white rounded-full shadow-lg border border-gray-200 px-2 py-1.5 flex items-center gap-1">
              {aspectOptions.map((opt) => (
                <button
                  key={opt.value || 'auto'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateAspectRatio(group.id, opt.value);
                    setIsAspectMenuOpen(false);
                  }}
                  className={cn(
                    'px-2 py-1 text-xs rounded-md transition-colors whitespace-nowrap',
                    aspectRatioValue === opt.value || (!aspectRatioValue && opt.value === '')
                      ? 'bg-blue-500 text-white font-medium'
                      : 'text-gray-700 hover:bg-gray-100'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
