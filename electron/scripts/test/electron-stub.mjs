// Electron 模块 stub:让核心 TS 在纯 Node 下运行(测试用)
// resolve hook:把 import 'electron' 重定向到本地 stub 实现
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: new URL('./electron-stub-impl.mjs', import.meta.url).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
