// 自包含的轻量提示（无外部依赖）：挂到 body 的瞬时浮层。
type ToastKind = 'success' | 'error' | 'warning' | 'info'

const COLORS: Record<ToastKind, string> = {
  success: '#16a34a',
  error: '#dc2626',
  warning: '#d97706',
  info: '#2563eb',
}

export function toast(message: string, kind: ToastKind = 'info'): void {
  if (typeof document === 'undefined') return
  try {
    const el = document.createElement('div')
    el.textContent = message
    el.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:48px',
      'transform:translateX(-50%)',
      'z-index:9999',
      'padding:10px 18px',
      'border-radius:8px',
      'font-size:13px',
      'color:#fff',
      `background:${COLORS[kind]}`,
      'box-shadow:0 6px 20px rgba(0,0,0,0.35)',
      'opacity:0',
      'transition:opacity .18s ease',
      'pointer-events:none',
    ].join(';')
    document.body.appendChild(el)
    requestAnimationFrame(() => { el.style.opacity = '1' })
    window.setTimeout(() => {
      el.style.opacity = '0'
      window.setTimeout(() => { try { document.body.removeChild(el) } catch { /* ignore */ } }, 220)
    }, 2400)
  } catch {
    /* ignore */
  }
}
