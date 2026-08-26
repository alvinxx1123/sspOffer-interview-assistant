// 渲染层 API 适配器:桌面环境(Electron preload)走 IPC,否则走 fetch(Spring Boot,作为 web fallback)
//
// 桌面应用完全独立运行 — 不需要 Spring Boot 后端也能用。
// 所有模型配置 / 文件解析 / LLM 调用都通过 Electron 主进程内的服务完成,
// 直接消费 Electron 设置页里配的 apiKey / visionKey。
//
// 仅当用户在浏览器里访问 (无 Electron) 时,才回退到 Spring Boot HTTP。
import { api as httpApi } from './client'
import { ipcApi } from './ipc'

const isDesktop = () => Boolean(window.electronAPI?.ipc)

// 所有已接通 IPC 的方法名(桌面优先,回退 fetch)
const IPC_METHODS = new Set(Object.keys(ipcApi).filter((k) => k !== 'isAvailable'))

const handler = {
  get(target, prop) {
    if (isDesktop() && IPC_METHODS.has(prop) && typeof ipcApi[prop] === 'function') {
      return ipcApi[prop]
    }
    const fn = target[prop]
    if (typeof fn === 'function') return fn.bind(target)
    return fn
  },
}

export const api = new Proxy(httpApi, handler)
export { isDesktop }
