import React from 'react'

export type AiSceneImportMode = 'insert' | 'overwrite'

type Props = {
  busy: boolean
  sourceUrl?: string
  onClose: () => void
  onUpload: (file: File) => Promise<void>
  onOpenHistory: () => void
  onGenerate: (mode: AiSceneImportMode) => Promise<void>
}

const choice = (active: boolean): React.CSSProperties => ({
  display: 'block', width: '100%', padding: '11px 12px', borderRadius: 8, textAlign: 'left', cursor: 'pointer',
  border: `1px solid ${active ? '#f5f5f5' : '#3a3a3a'}`, background: active ? '#333' : '#242424', color: '#eee',
})

export function AiSceneImportDialog({ busy, sourceUrl, onClose, onUpload, onOpenHistory, onGenerate }: Props) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [mode, setMode] = React.useState<AiSceneImportMode>('insert')
  const [dragging, setDragging] = React.useState(false)
  const accept = (file?: File) => { if (file?.type.startsWith('image/')) void onUpload(file) }

  return <div style={{ position: 'fixed', inset: 0, zIndex: 4300, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.58)' }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div role="dialog" aria-label="AI 识图导入" style={{ width: 520, maxHeight: '88vh', overflowY: 'auto', borderRadius: 14, border: '1px solid #383838', background: '#191919', boxShadow: '0 24px 80px rgba(0,0,0,.55)', color: '#eee' }}>
      <div style={{ height: 48, padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #2b2b2b', fontWeight: 600 }}><span>AI 识图导入</span><button aria-label="关闭" onClick={onClose} style={{ border: 0, background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: 20 }}>×</button></div>
      <div style={{ padding: 16 }}>
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={(event) => { accept(event.target.files?.[0]); event.currentTarget.value = '' }} />
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}><button onClick={() => inputRef.current?.click()} style={{ flex: 1, height: 34, border: '1px solid #3a3a3a', borderRadius: 7, background: '#242424', color: '#ddd', cursor: 'pointer' }}>本地上传</button><button onClick={onOpenHistory} style={{ flex: 1, height: 34, border: '1px solid #3a3a3a', borderRadius: 7, background: '#242424', color: '#ddd', cursor: 'pointer' }}>历史记录</button></div>
        <button onClick={() => inputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); accept(event.dataTransfer.files?.[0]) }} style={{ width: '100%', minHeight: 180, border: `1px dashed ${dragging ? '#fff' : '#555'}`, borderRadius: 10, background: '#202020', color: '#aaa', cursor: 'pointer', overflow: 'hidden', padding: 0 }}>
          {sourceUrl ? <img src={sourceUrl} alt="识图来源" style={{ display: 'block', width: '100%', height: 220, objectFit: 'contain', background: '#111' }} /> : <span>点击上传图片<br />或<br />拖拽本地图片至此上传<br /><small style={{ color: '#666' }}>上传后画布将新建一个图片节点并自动替换当前图源</small></span>}
        </button>
        <div style={{ margin: '18px 0 8px', fontSize: 13 }}>选择是否覆盖场景</div>
        <div style={{ display: 'grid', gap: 8 }}>
          <button style={choice(mode === 'insert')} onClick={() => setMode('insert')}><b>插入当前导演台</b><div style={{ color: '#8a8a8a', fontSize: 11, marginTop: 4 }}>作为站位参考层插入，不覆盖当前全景、角色和机位</div></button>
          <button style={choice(mode === 'overwrite')} onClick={() => setMode('overwrite')}><b>覆盖当前导演台</b><div style={{ color: '#8a8a8a', fontSize: 11, marginTop: 4 }}>作为站位参考层插入，覆盖当前全景、角色和机位</div></button>
        </div>
        <div style={{ color: '#737373', fontSize: 11, margin: '12px 0' }}>关闭不会中断识图任务，生成站位参考后自动导入导演台</div>
        <button disabled={busy || !sourceUrl} onClick={() => void onGenerate(mode)} style={{ width: '100%', height: 38, border: 0, borderRadius: 8, background: '#f5f5f5', color: '#111', opacity: busy || !sourceUrl ? 0.45 : 1, cursor: busy || !sourceUrl ? 'default' : 'pointer', fontWeight: 600 }}>{busy ? '生成中…' : '生成站位参考'}</button>
      </div>
    </div>
  </div>
}
