import { contextBridge, ipcRenderer } from 'electron'
import { Channels } from '../shared/ipc/channels'

// 渲染层通过 window.electronAPI.ipc(channel, ...args) 调主进程
const electronAPI = {
  platform: process.platform,
  isElectron: true,
  ipc: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  // 监听主进程推送的流式事件(返回取消订阅函数)
  on: (channel: string, listener: (...args: unknown[]) => void) => {
    const wrapped = (_event: unknown, ...args: unknown[]) => listener(...args)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electronAPI', electronAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electronAPI = electronAPI
}

export type ElectronAPI = typeof electronAPI
export { Channels }
// 追加:AI/RAG 通道通过统一 ipc() 已可用(channel 名透传)
// renderer 侧 api/ipc.js 用同名 channel 调用
