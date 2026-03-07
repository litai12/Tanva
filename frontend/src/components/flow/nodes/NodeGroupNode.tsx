import React from 'react';

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
};

type Props = {
  id: string;
  data: NodeGroupData;
  selected?: boolean;
};

const DEFAULT_GROUP_NAME = '新建分组';
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
  const [isHoveringGroup, setIsHoveringGroup] = React.useState(false);
  const [isEditingName, setIsEditingName] = React.useState(false);
  const color =
    typeof data?.groupColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(data.groupColor)
      ? data.groupColor
      : DEFAULT_GROUP_COLOR;
  const name =
    typeof data?.groupName === 'string' && data.groupName.trim().length > 0
      ? data.groupName.trim()
      : DEFAULT_GROUP_NAME;
  const running = data?.groupRunning === true;
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
      onMouseEnter={() => setIsHoveringGroup(true)}
      onMouseLeave={() => setIsHoveringGroup(false)}
      style={{
        width: '100%',
        height: '100%',
        border: `2px dashed ${toRgba(color, selected ? 0.7 : 0.45)}`,
        background: toRgba(color, selected ? 0.12 : 0.08),
        borderRadius: 16,
        boxShadow: selected ? `0 0 0 1px ${toRgba(color, 0.45)}` : 'none',
        position: 'relative',
        overflow: 'visible',
      }}
    >
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
            title='双击修改分组名称'
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

        <label
          className='nodrag nopan'
          onMouseDown={(event) => event.stopPropagation()}
          title='修改分组颜色'
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
          title='解组'
          style={{
            border: '1px solid rgba(239, 68, 68, 0.35)',
            background: 'rgba(239, 68, 68, 0.08)',
            color: '#dc2626',
            borderRadius: 999,
            opacity: isHoveringGroup ? 1 : 0,
            pointerEvents: isHoveringGroup ? 'auto' : 'none',
            transition: 'opacity 0.15s ease, background-color 0.15s ease',
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
          解组
        </button>
      </div>

      <div
        className='tanva-node-group-footer nodrag nopan'
        style={{
          position: 'absolute',
          left: '50%',
          top: 'calc(100% + 10px)',
          transform: 'translateX(-50%)',
          pointerEvents: 'auto',
        }}
      >
        <button
          type='button'
          className='nodrag nopan'
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (running) return;
            data?.onRunGroup?.(id);
          }}
          title='依次运行组内节点'
          style={{
            border: `1px solid ${toRgba(color, 0.4)}`,
            background: running ? 'rgba(243, 244, 246, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            color: running ? '#9ca3af' : '#111827',
            borderRadius: 999,
            padding: '2px 12px',
            fontSize: 11,
            fontWeight: 600,
            lineHeight: '16px',
            cursor: running ? 'not-allowed' : 'pointer',
            boxShadow: '0 6px 18px rgba(15, 23, 42, 0.12)',
          }}
        >
          {running ? '运行中…' : '运行'}
        </button>
      </div>
    </div>
  );
}
