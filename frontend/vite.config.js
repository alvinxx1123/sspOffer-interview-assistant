import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        timeout: 180000,  // 3 分钟，复盘用 glm-4-flash 一般 1-2 分钟内完成
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, req) => {
            if (proxyRes.statusCode >= 400) {
              console.log('[Proxy]', req.method, req.url, '->', proxyRes.statusCode)
            }
          })
        }
      }
    }
  }
})
