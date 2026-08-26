// 主进程 ↔ 渲染进程 共享类型定义
// 后续 IPC channel 名称 + 参数/返回值 schema 在此定义

export type ChannelMap = {
  // 数据层(阶段2迁移)
  // 'db:applications:list': { args: void; result: ApplicationRecord[] }
  // AI/RAG(阶段3迁移)
  // 'ai:chat': { args: ChatRequest; result: ChatResponse }
}

export type ChannelName = keyof ChannelMap
