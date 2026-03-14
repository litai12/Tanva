import React from 'react';
import { ChevronDown, ChevronRight, Play } from 'lucide-react';
import { Handle, Position } from 'reactflow';
import { useLocaleText } from '@/utils/localeText';
import SmartImage from '@/components/ui/SmartImage';

type NodeGroupData = {
  groupName?: string;
  groupColor?: string;
  childNodeIds?: string[];
  onRenameGroup?: (groupId: string) => void;
  onUpdateGroupName?: (groupId: string, nextName: string) => void;
  onChangeGroupColor?: (groupId: string, color: string) => void;
  onUngroup?: (groupId: string) => void;
  onRunGroup?: (groupId: string) => void;
  groupRunning?: boolean;
  onToggleCollapse?: (groupId: string, nextCollapsed?: boolean) => void;
  groupCollapsed?: boolean;
  groupChildCount?: number;
  groupPreviewImages?: string[];
};

type Props = {
  id: string;
  data: NodeGroupData;
  selected?: boolean;
};

const DEFAULT_GROUP_COLOR = '#3b82f6';

const toRgba = (hexColor: string, alpha: number): string => {
  const hex = (hexColor || '').trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return `rgba(59,130,246,${alpha})`;
  }
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

export default function NodeGroupNode({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const [isEditingName, setIsEditingName] = React.useState(false);
  const defaultGroupName = lt('新建分组', 'New Group');
  const color =
    typeof data?.groupColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(data.groupColor)
      ? data.groupColor
      : DEFAULT_GROUP_COLOR;
  const name =
    typeof data?.groupName === 'string' && data.groupName.trim().length > 0
      ? data.groupName.trim()
      : defaultGroupName;
  const running = data?.groupRunning === true;
  const collapsed = data?.groupCollapsed === true;
  const childCount = Number.isFinite(Number(data?.groupChildCount))
    ? Number(data?.groupChildCount)
    : Array.isArray(data?.childNodeIds)
    ? data.childNodeIds.length
    : 0;
  const previewImages = React.useMemo(
    () =>
      Array.isArray(data?.groupPreviewImages)
        ? data.groupPreviewImages
            .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            .slice(0, 3)
        : [],
    [data?.groupPreviewImages]
  );
  const [editingName, setEditingName] = React.useState(name);

  React.useEffect(() => {
    if (!isEditingName) {
      setEditingName(name);
    }
  }, [name, isEditingName]);

  const commitName = React.useCallback(() => {
    const nextName = editingName.trim();
    setIsEditingName(false);
    if (!nextName || nextName === name) {
      setEditingName(name);
      return;
    }
    if (typeof data?.onUpdateGroupName === 'function') {
      data.onUpdateGroupName(id, nextName);
      return;
    }
    data?.onRenameGroup?.(id);
  }, [data, editingName, id, name]);

  return (
    <div
      className='tanva-node-group'
      style={{
        width: '100%',
        height: '100%',
        border: `2px ${collapsed ? 'solid' : 'dashed'} ${toRgba(color, selected ? 0.7 : 0.45)}`,
        background: toRgba(color, collapsed ? (selected ? 0.16 : 0.12) : selected ? 0.12 : 0.08),
        borderRadius: collapsed ? 12 : 16,
        boxShadow: selected ? `0 0 0 1px ${toRgba(color, 0.45)}` : 'none',
        position: 'relative',
        overflow: 'visible',
      }}
    >
      <Handle
        id='group-proxy-target'
        type='target'
        position={Position.Left}
        isConnectable={false}
        style={{
          width: 8,
          height: 8,
          background: 'transparent',
          border: 'none',
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
      <Handle
        id='group-proxy-source'
        type='source'
        position={Position.Right}
        isConnectable={false}
        style={{
          width: 8,
          height: 8,
          background: 'transparent',
          border: 'none',
          opacity: 0,
          pointerEvents: 'none',
        }}
      />

      <div
        className='tanva-node-group-header'
        style={{
          position: 'absolute',
          left: 0,
          top: -34,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'transparent',
          border: 'none',
          borderRadius: 0,
          padding: 0,
          boxShadow: 'none',
        }}
      >
        {isEditingName ? (
          <div
            className='nodrag nopan'
            onMouseDown={(event) => event.stopPropagation()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <input
              className='tanva-node-group-title-input'
              value={editingName}
              onChange={(event) => setEditingName(event.target.value)}
              onBlur={commitName}
              onMouseDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitName();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setEditingName(name);
                  setIsEditingName(false);
                }
              }}
              autoFocus
              spellCheck={false}
              style={{
                width: Math.max(72, editingName.length * 8 + 20),
                border: 'none',
                borderBottom: `1px solid ${toRgba(color, 0.55)}`,
                borderRadius: 0,
                background: 'transparent',
                fontSize: 12,
                fontWeight: 600,
                color: '#111827',
                lineHeight: '20px',
                height: 20,
                padding: '0 2px',
                outline: 'none',
              }}
            />
          </div>
        ) : (
          <button
            type='button'
            className='nodrag nopan'
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => {
              event.stopPropagation();
              setIsEditingName(true);
            }}
            title={lt('双击修改分组名称', 'Double click to rename group')}
            style={{
              border: 'none',
              background: 'transparent',
              fontSize: 12,
              fontWeight: 600,
              color: '#111827',
              cursor: 'text',
              padding: 0,
            }}
          >
            {name}
          </button>
        )}

        <button
          type='button'
          className='nodrag nopan'
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            data?.onToggleCollapse?.(id, !collapsed);
          }}
          title={collapsed ? lt('展开组内容', 'Expand group') : lt('折叠组内容', 'Collapse group')}
          style={{
            border: '1px solid rgba(148, 163, 184, 0.4)',
            background: 'rgba(255, 255, 255, 0.88)',
            color: '#334155',
            borderRadius: 999,
            transition: 'all 0.15s ease',
            cursor: 'pointer',
            padding: '1px 6px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 24,
            height: 20,
          }}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
        <label
          className='nodrag nopan tanva-node-group-color-control'
          onMouseDown={(event) => event.stopPropagation()}
          title={lt('修改分组颜色', 'Change group color')}
          style={{
            width: 16,
            height: 16,
            borderRadius: 999,
            border: '1px solid rgba(255, 255, 255, 0.8)',
            background: color,
            cursor: 'pointer',
            overflow: 'hidden',
            display: 'inline-flex',
          }}
        >
          <input
            type='color'
            value={color}
            onChange={(event) => {
              event.stopPropagation();
              data?.onChangeGroupColor?.(id, event.target.value);
            }}
            style={{
              width: 20,
              height: 20,
              border: 'none',
              padding: 0,
              opacity: 0,
              cursor: 'pointer',
            }}
          />
        </label>
        <button
          type='button'
          className='nodrag nopan tanva-node-group-ungroup-button'
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            data?.onUngroup?.(id);
          }}
          title={lt('解组', 'Ungroup')}
          style={{
            border: '1px solid rgba(239, 68, 68, 0.35)',
            background: 'rgba(239, 68, 68, 0.08)',
            color: '#dc2626',
            borderRadius: 999,
            transition: 'opacity 0.15s ease, background-color 0.15s ease, border-color 0.15s ease',
            cursor: 'pointer',
            padding: '1px 7px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 600,
            lineHeight: '14px',
            whiteSpace: 'nowrap',
          }}
        >
          {lt('解组', 'Ungroup')}
        </button>
      </div>

      {collapsed ? (
        <div
          className='nodrag nopan'
          onMouseDown={(event) => event.stopPropagation()}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 220,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
              padding: '0 12px',
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#334155',
                background: 'rgba(255, 255, 255, 0.9)',
                border: `1px solid ${toRgba(color, 0.3)}`,
                borderRadius: 999,
                padding: '3px 9px',
                lineHeight: 1,
              }}
            >
              {childCount}Node
            </span>
            {previewImages.length > 0 ? (
              <div
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                {previewImages.map((src, index) => (
                  <div
                    key={`${src}-${index}`}
                    style={{
                      width: 46,
                      height: 46,
                      borderRadius: 8,
                      overflow: 'hidden',
                      border: `1px solid ${toRgba(color, 0.26)}`,
                      background: 'rgba(255,255,255,0.82)',
                    }}
                  >
                    <SmartImage
                      src={src}
                      alt={`group-preview-${index + 1}`}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        className={`tanva-node-group-footer nodrag nopan${running ? ' is-running' : ''}`}
        style={{
          position: 'absolute',
          left: '50%',
          top: 'calc(100% + 10px)',
          transform: 'translateX(-50%)',
          opacity: selected || running ? 1 : 0,
          pointerEvents: selected || running ? 'auto' : 'none',
          transition: 'opacity 0.15s ease',
        }}
      >
        <button
          type='button'
          className='nodrag nopan'
          disabled={running}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (running) return;
            data?.onRunGroup?.(id);
          }}
          title={lt('依次运行组内节点', 'Run nodes in this group in order')}
          style={{
            width: 32,
            height: 32,
            border: running ? '1px solid #e5e7eb' : '1px solid #d1d5db',
            background: running ? '#f3f4f6' : 'rgba(255, 255, 255, 0.5)',
            color: running ? '#9ca3af' : '#4b5563',
            borderRadius: 9999,
            padding: 0,
            fontSize: 12,
            fontWeight: 600,
            cursor: running ? 'not-allowed' : 'pointer',
            boxShadow: running ? 'none' : '0 1px 2px rgba(15, 23, 42, 0.08)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
            opacity: running ? 0.7 : 1,
          }}
          onMouseEnter={(event) => {
            if (running) return;
            event.currentTarget.style.borderColor = '#9ca3af';
            event.currentTarget.style.color = '#374151';
            event.currentTarget.style.background = 'rgba(31, 41, 55, 0.08)';
          }}
          onMouseLeave={(event) => {
            if (running) return;
            event.currentTarget.style.borderColor = '#d1d5db';
            event.currentTarget.style.color = '#4b5563';
            event.currentTarget.style.background = 'rgba(255, 255, 255, 0.5)';
          }}
        >
          <Play size={14} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}
