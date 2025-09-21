import React from 'react';
import { Handle, Position, NodeResizer, useReactFlow } from 'reactflow';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import usePromptOptimization from '@/hooks/usePromptOptimization';
import type { PromptOptimizationRequest } from '@/services/promptOptimizationService';

export interface PromptExpandSettings {
  language: '中文' | 'English';
  tone: string;
  focus: string;
  lengthPreference: 'concise' | 'balanced' | 'detailed';
  autoOptimize: boolean;
}

type Props = {
  id: string;
  data: {
    text?: string;
    expandedText?: string;
    settings?: PromptExpandSettings;
    boxW?: number;
    boxH?: number;
  };
  selected?: boolean;
};

export default function PromptExpandNode({ id, data, selected }: Props) {
  const rf = useReactFlow();
  const [inputValue, setInputValue] = React.useState<string>(data.text || '');
  const [settings, setSettings] = React.useState<PromptExpandSettings>(data.settings || {
    language: '中文',
    tone: '',
    focus: '',
    lengthPreference: 'balanced',
    autoOptimize: false
  });
  const [hover, setHover] = React.useState<string | null>(null);
  const [expandedText, setExpandedText] = React.useState<string>(data.expandedText || '');

  const { optimize, loading, result, error, reset } = usePromptOptimization();

  React.useEffect(() => {
    if ((data.text || '') !== inputValue) setInputValue(data.text || '');
  }, [data.text]);

  React.useEffect(() => {
    if ((data.expandedText || '') !== expandedText) setExpandedText(data.expandedText || '');
  }, [data.expandedText]);

  React.useEffect(() => {
    if (result?.optimizedPrompt) {
      setExpandedText(result.optimizedPrompt);
      updateNodeData({ expandedText: result.optimizedPrompt });
    }
  }, [result]);

  const updateNodeData = (patch: Record<string, any>) => {
    const ev = new CustomEvent('flow:updateNodeData', { detail: { id, patch } });
    window.dispatchEvent(ev);
  };

  const handleInputChange = (value: string) => {
    setInputValue(value);
    updateNodeData({ text: value });

    // 自动扩写
    if (settings.autoOptimize && value.trim()) {
      handleOptimize(value.trim());
    }
  };

  const handleSettingsChange = <K extends keyof PromptExpandSettings>(
    key: K,
    value: PromptExpandSettings[K]
  ) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    updateNodeData({ settings: newSettings });
  };

  const handleOptimize = async (inputText?: string) => {
    const text = inputText || inputValue.trim();
    if (!text) return;

    reset();
    await optimize({
      input: text,
      language: settings.language,
      tone: settings.tone || undefined,
      focus: settings.focus || undefined,
      lengthPreference: settings.lengthPreference
    } satisfies PromptOptimizationRequest);
  };

  const handleApply = () => {
    if (!expandedText) return;
    setInputValue(expandedText);
    updateNodeData({ text: expandedText });
  };

  const handleSend = () => {
    if (!expandedText) return;
    // 发送扩写结果到输出端口
    updateNodeData({ expandedText });
  };

  return (
    <div style={{
      width: data.boxW || 380,
      height: data.boxH || 520,
      padding: 12,
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      fontSize: 13
    }}>
      <NodeResizer
        isVisible
        minWidth={340}
        minHeight={480}
        color="transparent"
        lineStyle={{ display: 'none' }}
        handleStyle={{ background: 'transparent', border: 'none', width: 12, height: 12, opacity: 0, cursor: 'nwse-resize' }}
        onResize={(evt, params) => {
          rf.setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, boxW: params.width, boxH: params.height } } : n));
        }}
        onResizeEnd={(evt, params) => {
          rf.setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, boxW: params.width, boxH: params.height } } : n));
        }}
      />

      {/* 标题栏 */}
      <div style={{ 
        fontWeight: 600, 
        marginBottom: 12, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between' 
      }}>
        <span>提示词扩写</span>
        {settings.autoOptimize && (
          <span style={{ 
            fontSize: 11, 
            background: '#e0f2fe', 
            color: '#0369a1', 
            padding: '2px 6px', 
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 4
          }}>
            <span style={{ 
              width: 6, 
              height: 6, 
              borderRadius: '50%', 
              background: '#0369a1',
              animation: 'pulse 1.5s infinite'
            }} />
            自动扩写
          </span>
        )}
      </div>

      {/* 输入文本 */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, display: 'block' }}>
          原始提示词
        </label>
        <textarea
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder="输入需要扩写的提示词"
          style={{
            width: '100%',
            height: 80,
            resize: 'none',
            fontSize: 12,
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            padding: 8,
            outline: 'none'
          }}
        />
      </div>

      {/* 设置面板 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <div>
            <label style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, display: 'block' }}>
              输出语言
            </label>
            <select
              value={settings.language}
              onChange={(e) => handleSettingsChange('language', e.target.value as PromptExpandSettings['language'])}
              style={{
                width: '100%',
                fontSize: 11,
                border: '1px solid #e5e7eb',
                borderRadius: 6,
                padding: '6px 8px',
                background: '#fff'
              }}
            >
              <option value="中文">中文</option>
              <option value="English">English</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, display: 'block' }}>
              长度倾向
            </label>
            <select
              value={settings.lengthPreference}
              onChange={(e) => handleSettingsChange('lengthPreference', e.target.value as PromptExpandSettings['lengthPreference'])}
              style={{
                width: '100%',
                fontSize: 11,
                border: '1px solid #e5e7eb',
                borderRadius: 6,
                padding: '6px 8px',
                background: '#fff'
              }}
            >
              <option value="concise">简洁</option>
              <option value="balanced">均衡</option>
              <option value="detailed">详细</option>
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, display: 'block' }}>
            语气 / 风格
          </label>
          <input
            value={settings.tone}
            onChange={(e) => handleSettingsChange('tone', e.target.value)}
            placeholder="例如：沉浸式、叙事感强"
            style={{
              width: '100%',
              fontSize: 11,
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              padding: '6px 8px'
            }}
          />
        </div>

        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, display: 'block' }}>
            重点补充方向
          </label>
          <input
            value={settings.focus}
            onChange={(e) => handleSettingsChange('focus', e.target.value)}
            placeholder="例如：目标受众、光影、镜头语言"
            style={{
              width: '100%',
              fontSize: 11,
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              padding: '6px 8px'
            }}
          />
        </div>

        <div>
          <label style={{ fontSize: 11, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={settings.autoOptimize}
              onChange={(e) => handleSettingsChange('autoOptimize', e.target.checked)}
            />
            自动扩写开启
          </label>
        </div>
      </div>

      {/* 预览输出 */}
      <div style={{ marginBottom: 12, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <label style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, display: 'block' }}>
          扩写预览
        </label>
        <div style={{ position: 'relative', flex: 1 }}>
          <textarea
            readOnly
            value={loading ? '' : expandedText}
            placeholder={loading ? '' : '生成预览后将在此处展示扩写结果'}
            style={{
              width: '100%',
              height: '100%',
              minHeight: 100,
              resize: 'none',
              fontSize: 12,
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              padding: 8,
              background: '#f8fafc',
              outline: 'none'
            }}
          />
          {loading && (
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.8)',
              borderRadius: 6
            }}>
              <LoadingSpinner size="md" />
            </div>
          )}
        </div>
      </div>

      {/* 错误显示 */}
      {error && (
        <div style={{
          fontSize: 11,
          color: '#dc2626',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 6,
          padding: 8,
          marginBottom: 12
        }}>
          {error.message}
        </div>
      )}

      {/* 操作按钮 */}
      <div style={{ 
        display: 'flex', 
        gap: 8, 
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 8,
        borderTop: '1px solid #f1f5f9'
      }}>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleOptimize()}
          disabled={loading || !inputValue.trim()}
          style={{ fontSize: 11 }}
        >
          {loading ? '生成中...' : '生成扩写'}
        </Button>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button
            variant="outline"
            size="sm"
            onClick={handleApply}
            disabled={!expandedText || loading}
            style={{ fontSize: 11 }}
          >
            回填输入框
          </Button>
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!expandedText || loading}
            style={{ fontSize: 11 }}
          >
            应用并生成
          </Button>
        </div>
      </div>

      {/* 输入和输出端点 */}
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        onMouseEnter={() => setHover('text-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="text"
        onMouseEnter={() => setHover('text-out')}
        onMouseLeave={() => setHover(null)}
      />

      {/* 工具提示 */}
      {hover === 'text-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '50%', transform: 'translate(-100%, -50%)' }}>
          text input
        </div>
      )}
      {hover === 'text-out' && (
        <div className="flow-tooltip" style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>
          expanded text
        </div>
      )}
    </div>
  );
}