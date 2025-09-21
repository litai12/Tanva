import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2, UploadCloud, Download } from 'lucide-react';
import type { FlowTemplate, TemplateIndexEntry } from '@/types/template';
import { 
  loadBuiltInTemplateIndex, 
  loadBuiltInTemplateByPath, 
  listUserTemplates, 
  getUserTemplate, 
  saveUserTemplate, 
  deleteUserTemplate, 
  generateId 
} from '@/services/templateStore';
// import { useReactFlow } from 'reactflow'; // 暂时注释，因为FloatingHeader不在ReactFlow上下文中

interface TemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInstantiateTemplate?: (template: FlowTemplate) => void;
}

const BUILTIN_TEMPLATE_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: '摄影', label: '摄影' },
  { value: '建筑设计', label: '建筑设计' },
  { value: '室内设计', label: '室内设计' },
  { value: '平面设计', label: '平面设计' },
  { value: '其他', label: '其他' },
];

const BUILTIN_CATEGORY_VALUE_SET = new Set(BUILTIN_TEMPLATE_CATEGORIES.map(c => c.value));

function normalizeBuiltinCategory(category?: string): string {
  if (!category) return '其他';
  return BUILTIN_CATEGORY_VALUE_SET.has(category) ? category : '其他';
}

// 用户模板卡片组件
const UserTemplateCard: React.FC<{
  item: {id:string;name:string;category?:string;tags?:string[];thumbnail?:string;createdAt:string;updatedAt:string};
  onInstantiate: () => Promise<void>;
  onDelete: () => Promise<void>;
}> = ({ item, onInstantiate, onDelete }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 18,
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: '18px 20px',
        background: '#fff',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        position: 'relative',
        minHeight: 160,
        height: 160,
        overflow: 'hidden'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#2563eb';
        e.currentTarget.style.background = '#f1f5ff';
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 16px 32px rgba(37, 99, 235, 0.12)';
        setIsHovered(true);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#e5e7eb';
        e.currentTarget.style.background = '#fff';
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
        setIsHovered(false);
      }}
      onClick={async (e) => {
        if ((e.target as HTMLElement).closest('.delete-btn')) return;
        await onInstantiate();
      }}
    >
      <div
        style={{
          flex: '0 0 50%',
          maxWidth: '50%',
        height: '100%',
        background: item.thumbnail ? 'transparent' : '#f3f4f6',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden'
        }}
      >
        {item.thumbnail ? (
          <img src={item.thumbnail} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ fontSize: 12, color: '#9ca3af' }}>暂无预览</div>
        )}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#111827', marginBottom: 6 }}>{item.name}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>更新于 {new Date(item.updatedAt).toLocaleString()}</div>
        </div>
        {item.category ? <div style={{ fontSize: 12, color: '#9ca3af' }}>分类：{item.category}</div> : null}
        {item.tags?.length ? (
          <div style={{ fontSize: 12, color: '#9ca3af' }}>标签：{item.tags.join(' / ')}</div>
        ) : null}
      </div>
      {isHovered && (
        <button
          className="delete-btn"
          style={{
            position: 'absolute',
            right: 16,
            top: 16,
            width: 28,
            height: 28,
            borderRadius: 6,
            border: '1px solid #fecaca',
            background: '#fff',
            color: '#ef4444',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
          onClick={async (e) => {
            e.stopPropagation();
            await onDelete();
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#fee2e2';
            e.currentTarget.style.borderColor = '#fca5a5';
            e.currentTarget.style.transform = 'scale(1.05)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#fff';
            e.currentTarget.style.borderColor = '#fecaca';
            e.currentTarget.style.transform = 'scale(1)';
          }}
          title="删除模板"
        >
          <Trash2 size={16} strokeWidth={2} />
        </button>
      )}
    </div>
  );
};

const AddTemplateCard: React.FC<{ onAdd: () => Promise<void>; label?: string }> = ({ onAdd, label }) => {
  const [isLoading, setIsLoading] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        if (isLoading) return;
        setIsLoading(true);
        try {
          await onAdd();
        } finally {
          setIsLoading(false);
        }
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px dashed #cbd5f5',
        borderRadius: 12,
        padding: '18px 20px',
        minHeight: 160,
        height: 160,
        background: '#f8fbff',
        color: '#2563eb',
        cursor: isLoading ? 'wait' : 'pointer',
        transition: 'all 0.15s ease',
        gap: 10,
        fontSize: 13,
        fontWeight: 500
      }}
      onMouseEnter={(e) => {
        if (isLoading) return;
        e.currentTarget.style.background = '#eef2ff';
        e.currentTarget.style.borderColor = '#93c5fd';
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 12px 24px rgba(37, 99, 235, 0.12)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = '#f8fbff';
        e.currentTarget.style.borderColor = '#cbd5f5';
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
      }}
      disabled={isLoading}
    >
      <Plus size={24} strokeWidth={2.5} />
      <div>{isLoading ? '保存中…' : label || '保存为模板'}</div>
    </button>
  );
};

const TemplatePlaceholder: React.FC<{ label?: string }> = ({ label }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'stretch',
      gap: 18,
      border: '1px dashed #d1d5db',
      borderRadius: 12,
      padding: '18px 20px',
      minHeight: 160,
      height: 160,
      background: '#f9fafb',
      transition: 'all 0.2s ease'
    }}
  >
    <div
      style={{
        flex: '0 0 50%',
        maxWidth: '50%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f3f4f6',
        borderRadius: 8,
        color: '#94a3b8'
      }}
    >
      <Plus size={28} strokeWidth={2} />
    </div>
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{label || '敬请期待更多模板'}</div>
      <div>我们正在准备更多创意模板</div>
    </div>
  </div>
);

export default function TemplateModal({ isOpen, onClose, onInstantiateTemplate }: TemplateModalProps) {
  // const rf = useReactFlow(); // 暂时注释
  const [templateScope, setTemplateScope] = useState<'public' | 'mine'>('public');
  const [activeBuiltinCategory, setActiveBuiltinCategory] = useState<string>(BUILTIN_TEMPLATE_CATEGORIES[0].value);
  const [tplIndex, setTplIndex] = useState<TemplateIndexEntry[] | null>(null);
  const [userTplList, setUserTplList] = useState<Array<{id:string;name:string;category?:string;tags?:string[];thumbnail?:string;createdAt:string;updatedAt:string}>>([]);
  const [tplLoading, setTplLoading] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const filteredTplIndex = useMemo(() => {
    if (!tplIndex) return [];
    return tplIndex.filter(item => normalizeBuiltinCategory(item.category) === activeBuiltinCategory);
  }, [tplIndex, activeBuiltinCategory]);

  const getPlaceholderCount = useCallback((len: number, opts?: { columns?: number; minVisible?: number }) => {
    const columns = opts?.columns ?? 2;
    const minVisible = opts?.minVisible ?? 0;
    const minFill = len < minVisible ? minVisible - len : 0;
    const remainder = len % columns;
    const columnFill = remainder ? columns - remainder : 0;
    return Math.max(minFill, columnFill);
  }, []);

  // ESC关闭
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // 加载模板数据
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      setTplLoading(true);
      try {
        if (!tplIndex) {
          const idx = await loadBuiltInTemplateIndex();
          const normalizedIdx = idx.map(item => ({ ...item, category: normalizeBuiltinCategory(item.category) }));
          if (!cancelled) {
            setTplIndex(normalizedIdx);
            setActiveBuiltinCategory(prev => {
              const hasPrev = normalizedIdx.some(item => normalizeBuiltinCategory(item.category) === prev);
              if (hasPrev) return prev;
              const fallback = BUILTIN_TEMPLATE_CATEGORIES.find(cat => normalizedIdx.some(item => normalizeBuiltinCategory(item.category) === cat.value));
              return fallback ? fallback.value : BUILTIN_TEMPLATE_CATEGORIES[0].value;
            });
          }
        }
        const list = await listUserTemplates();
        if (!cancelled) setUserTplList(list);
      } finally {
        if (!cancelled) setTplLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, tplIndex]);

  const instantiateTemplateAt = useCallback(async (tpl: FlowTemplate) => {
    if (!tpl?.nodes?.length) return;
    
    // 通过全局事件通知Flow组件实例化模版
    const event = new CustomEvent('flow:instantiateTemplate', {
      detail: { template: tpl }
    });
    window.dispatchEvent(event);
    
    if (onInstantiateTemplate) {
      onInstantiateTemplate(tpl);
    }
    // 不自动关闭，让用户可以继续选择其他模版
    // onClose();
  }, [onInstantiateTemplate, onClose]);

  const saveCurrentAsTemplate = useCallback(async () => {
    // 暂时禁用保存功能，因为不在ReactFlow上下文中
    alert('保存模板功能需要在Flow画布中使用');
  }, []);

  const handleExportTemplates = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('flow:export-template-request'));
  }, []);

  const handleImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => {
      console.error('导入模板失败:', reader.error);
      if (importInputRef.current) {
        importInputRef.current.value = '';
      }
    };
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        window.dispatchEvent(new CustomEvent('flow:import-template-json', { detail: { content: text } }));
      } finally {
        if (importInputRef.current) {
          importInputRef.current.value = '';
        }
      }
    };
    reader.readAsText(file);
  }, []);

  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      {/* 透明遮罩层，用于点击外部关闭 */}
      <div 
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9998,
          background: 'rgba(255, 255, 255, 0.45)'
        }}
        onClick={onClose}
      />
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none'
        }}
      >
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 16,
            boxShadow: '0 18px 45px rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.08)',
            width: 'min(60vw, 900px)',
            maxWidth: 900,
            height: '80vh',
            maxHeight: '80vh',
            position: 'relative',
            pointerEvents: 'auto',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}
        >

        {/* 标题栏 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '20px 24px 12px',
          borderBottom: '1px solid #e5e7eb',
          background: '#f5f7fa',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16
        }}>
          <div style={{ display: 'flex', gap: 2 }}>
            <button
              onClick={() => setTemplateScope('public')}
              style={{
                padding: '10px 18px 14px',
                fontSize: 13,
                fontWeight: templateScope === 'public' ? 600 : 500,
                borderRadius: '8px 8px 0 0',
                border: 'none',
                background: templateScope === 'public' ? '#fff' : 'transparent',
                color: templateScope === 'public' ? '#111827' : '#374151',
                marginBottom: -2,
                transition: 'all 0.15s ease',
                cursor: 'pointer'
              }}
            >
              公共模板
            </button>
            <button
              onClick={() => setTemplateScope('mine')}
              style={{
                padding: '10px 18px 14px',
                fontSize: 13,
                fontWeight: templateScope === 'mine' ? 600 : 500,
                borderRadius: '8px 8px 0 0',
                border: 'none',
                background: templateScope === 'mine' ? '#fff' : 'transparent',
                color: templateScope === 'mine' ? '#111827' : '#374151',
                marginBottom: -2,
                transition: 'all 0.15s ease',
                cursor: 'pointer'
              }}
            >
              我的模板
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleExportTemplates}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 999,
                border: '1px solid #bfdbfe',
                background: '#eff6ff',
                color: '#2563eb',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <Download size={16} strokeWidth={2} /> 导出当前流程
            </button>
            <button
              onClick={handleImportClick}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 999,
                border: '1px solid #c4b5fd',
                background: '#ede9fe',
                color: '#7c3aed',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <UploadCloud size={16} strokeWidth={2} /> 导入模板 JSON
            </button>
          </div>
        </div>

        {/* 内容区域 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 24px', minHeight: 0 }}>
          <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', gap: 12, marginBottom: templateScope === 'public' ? 12 : 18 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>{templateScope === 'public' ? '公共模板' : '我的模板'}</div>
              {tplLoading ? <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>加载中…</div> : null}
            </div>
          </div>

          {templateScope === 'public' && tplIndex ? (
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                {BUILTIN_TEMPLATE_CATEGORIES.map(cat => {
                  const isActive = cat.value === activeBuiltinCategory;
                  return (
                    <button
                      key={cat.value}
                      onClick={() => setActiveBuiltinCategory(cat.value)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 999,
                        border: '1px solid ' + (isActive ? '#2563eb' : '#e5e7eb'),
                        background: isActive ? '#2563eb' : '#fff',
                        color: isActive ? '#fff' : '#374151',
                        fontSize: 12,
                        fontWeight: isActive ? 600 : 500,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        boxShadow: isActive ? '0 10px 18px rgba(37, 99, 235, 0.18)' : 'none'
                      }}
                    >
                      {cat.label}
                    </button>
                  );
                })}
              </div>
              <div style={{ display:'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 20 }}>
                {filteredTplIndex.map(item => (
                  <div 
                    key={item.id} 
                    style={{ 
                      display: 'flex',
                      alignItems: 'stretch',
                      gap: 20,
                      border: '1px solid #e5e7eb',
                      borderRadius: 12,
                      padding: '18px 20px',
                      background: '#fff',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      minHeight: 160,
                      height: 160,
                      overflow: 'hidden'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#2563eb';
                      e.currentTarget.style.background = '#f1f5ff';
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 18px 36px rgba(37, 99, 235, 0.12)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#e5e7eb';
                      e.currentTarget.style.background = '#fff';
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    onClick={async () => {
                      const tpl = await loadBuiltInTemplateByPath(item.path);
                      if (tpl) instantiateTemplateAt(tpl);
                    }}
                  >
                    <div
                      style={{
                        flex: '0 0 50%',
                        maxWidth: '50%',
                        height: '100%',
                        background: item.thumbnail ? 'transparent' : '#f3f4f6',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden'
                      }}
                    >
                      {item.thumbnail ? (
                        <img src={item.thumbnail} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ fontSize: 12, color: '#9ca3af' }}>暂无预览</div>
                      )}
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center' }}>
                      <div style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>{item.name}</div>
                      {item.description ? <div style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.5 }}>{item.description}</div> : null}
                      {item.tags?.length ? <div style={{ fontSize: 12, color: '#9ca3af' }}>标签：{item.tags.join(' / ')}</div> : null}
                    </div>
                  </div>
                ))}
                {Array.from({ length: getPlaceholderCount(filteredTplIndex.length, { minVisible: 4 }) }).map((_, idx) => (
                  <TemplatePlaceholder key={`builtin-placeholder-${idx}`} label="敬请期待更多模板" />
                ))}
              </div>
            </div>
          ) : null}

          {templateScope === 'mine' ? (
            <div style={{ display:'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 20 }}>
              <AddTemplateCard
                onAdd={saveCurrentAsTemplate}
                label={userTplList.length ? '保存当前为新模板' : '创建我的第一个模板'}
              />
              {userTplList.map(item => {
                return (
                  <UserTemplateCard 
                    key={item.id}
                    item={item}
                    onInstantiate={async () => {
                      const tpl = await getUserTemplate(item.id);
                      if (tpl) instantiateTemplateAt(tpl);
                    }}
                    onDelete={async () => {
                      if (confirm(`确定要删除模板 "${item.name}" 吗？此操作无法撤销。`)) {
                        try {
                          await deleteUserTemplate(item.id);
                          const list = await listUserTemplates();
                          setUserTplList(list);
                        } catch (err) {
                          console.error('删除模板失败:', err);
                          alert('删除模板失败');
                        }
                      }
                    }}
                  />
                );
              })}
              {Array.from({ length: userTplList.length === 0 ? 0 : getPlaceholderCount(userTplList.length + 1, { minVisible: 4 }) }).map((_, idx) => (
                <TemplatePlaceholder key={`user-placeholder-${idx}`} />
              ))}
            </div>
          ) : null}
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
        </div>
      </div>
    </>,
    document.body
  );
}
