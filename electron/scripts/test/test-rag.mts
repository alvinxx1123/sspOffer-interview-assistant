// 端到端实测:reindex + chat-with-tools(直接调迁移后的核心代码)
// 用法: npx tsx --import ./scripts/test/register-stub.mjs scripts/test/test-rag.mts

import { db, initSchema, closeDb } from '../../src/core/store/db'
import { interviewExperienceRepo, algorithmRepo } from '../../src/core/store/repositories'
import { indexExperiences, storeSize, search } from '../../src/core/rag/indexer'
import { chatWithTools } from '../../src/core/ai/agent'
import { apiConfig } from '../../src/core/api-config'

async function main() {
  // 1. 建库 + 种子数据
  initSchema()
  console.log('✅ schema 建表完成')

  const expRepo = interviewExperienceRepo
  const seeded = expRepo.findAll()
  if (!seeded.length) {
    expRepo.create({
      source: '手动', company: '字节跳动', department: '基础架构', position: '后端',
      content: '一面项目深挖+Redis缓存+MySQL索引;二面算法两数之和、LRU;三面系统设计短链服务',
      internshipExperiences: '在字节基础架构部实习,做缓存优化,解决缓存穿透/击穿/雪崩',
      projectExperiences: '订单服务缓存优化,用 Redis 做热点数据缓存,引入布隆过滤器',
      baguQuestions: 'Redis持久化RDB与AOF区别;MySQL事务隔离级别RR/RC;JVM内存模型与GC',
      llmQuestions: 'Transformer结构;RAG原理;大模型微调方法',
      algorithmQuestions: '两数之和;LRU缓存;反转链表',
      algorithmLink: 'https://leetcode.cn/problems/lru-cache/',
      type: null, internshipAnswers: null, projectAnswers: null, projectExperience: null,
      baguAnswers: null, algorithmQuestions_text: null, algorithmLinks: null,
    } as any)
    console.log('✅ 种子:1 条字节后端面经写入 SQLite')
  }

  const all = expRepo.findAll()
  console.log(`   库里面经数: ${all.length}`)

  // 2. reindex(调智谱 embedding-3 建向量库)
  console.log('\n🔄 reindex 中(调智谱 embedding-3)...')
  clearAll()
  await indexExperiences(all)
  console.log(`✅ reindex 完成,向量库 size=${storeSize()}`)

  // 3. 检索测试
  console.log('\n🔍 检索测试: "字节 Redis 缓存"')
  const hits = await search('字节 Redis 缓存', '字节跳动', null, 3)
  console.log(`   命中 ${hits.length} 段:`)
  hits.forEach((h, i) => console.log(`   [${i + 1}] ${h.slice(0, 60)}...`))

  // 4. chat-with-tools 测试(调 DeepSeek + 工具循环)
  console.log('\n🤖 chat-with-tools 中(调 DeepSeek deepseek-chat + 工具循环)...')
  const reply = await chatWithTools('查一下字节后端的面经')
  console.log('✅ 助手回复:\n')
  console.log(reply)

  closeDb()
  console.log('\n🎉 AI/RAG 端到端实测通过')
}

// reindex 需要的 clearAll(从 indexer 导出)
import { clearAll } from '../../src/core/rag/indexer'

main().catch((e) => { console.error('\n❌ 测试失败:', e); process.exit(1) })
