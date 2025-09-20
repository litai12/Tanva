import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// 🧪 开发环境：导入双击事件冲突测试工具
if (process.env.NODE_ENV === 'development') {
  import('./utils/doubleClickTest').then(module => {
    console.log('🧪 双击事件冲突测试工具已加载');
    console.log('📖 使用方法: window.doubleClickTester.getTestReport()');
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
