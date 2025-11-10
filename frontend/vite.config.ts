import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 在本地开发时监听所有网络接口 (0.0.0.0)
    // 这样其他PC可以通过 http://192.168.2.115:5173 访问
    host: '0.0.0.0',
    
    // 允许 Cloudflare Tunnel 和其他内网穿透工具的域名访问
    // 允许所有 trycloudflare.com 的子域名（用于 Cloudflare Tunnel）
    allowedHosts: [
      '.trycloudflare.com',  // 允许所有 trycloudflare.com 的子域名
      '.tanvas.cn',          // 允许所有 tanvas.cn 的子域名（Cloudflare Tunnel）
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
    ],

    proxy: {
      '/api': {
        // 后端服务器地址
        // 本地开发时使用 localhost, 其他PC访问时自动转发到 0.0.0.0:4000
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
