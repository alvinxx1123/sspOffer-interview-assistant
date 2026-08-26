import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { interviewExperienceRepo, algorithmRepo } from '../store/repositories'
import { search } from '../rag/indexer'
import { executeCodeRemote } from './code-exec'

const APP_BASE_URL = '' // 桌面端用 hash 路由,链接形如 #/ide?questionId=N

// 1. searchInterviews — 按公司/部门/关键词检索面经
export const searchInterviewsTool = tool(
  async ({ query, company, department }) => {
    const results = await search(query, company || null, department || null, 8)
    if (!results.length) return '未检索到相关面经。'
    return results.map((r, i) => `[片段${i + 1}]\n${r}`).join('\n\n')
  },
  {
    name: 'searchInterviews',
    description: '按公司或部门检索面经内容。当用户想查某公司/部门的面经、面试题、八股时调用。company 和 department 可为空表示不限定。',
    schema: z.object({
      query: z.string().describe('检索关键词'),
      company: z.string().optional().describe('公司名,可空'),
      department: z.string().optional().describe('部门名,可空'),
    }),
  }
)

// 2. interviewHotTopics — 高频考点统计
export const interviewHotTopicsTool = tool(
  async ({ company, department }) => {
    let exps
    if (company && department) exps = interviewExperienceRepo.findByCompanyAndDepartment(company, department)
    else if (company) exps = interviewExperienceRepo.findByCompany(company)
    else exps = interviewExperienceRepo.findAll()

    if (!exps.length) return '暂无该公司的面经数据。'
    const topicCount = new Map<string, number>()
    for (const e of exps) {
      for (const f of [e.baguQuestions, e.llmQuestions, e.algorithmQuestions]) {
        if (!f) continue
        for (const line of f.split('\n')) {
          const t = line.replace(/^[•\-\d.]+\s*/, '').split(/[:：]/)[0].trim()
          if (t) topicCount.set(t, (topicCount.get(t) ?? 0) + 1)
        }
      }
    }
    const sorted = [...topicCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    if (!sorted.length) return '暂未提取到高频考点。'
    return sorted.map(([t, n]) => `${t}(${n}次)`).join('、')
  },
  {
    name: 'interviewHotTopics',
    description: '生成面经高频考点统计。当用户问「这个公司高频考什么」「八股高频」时调用。company/department 可空。',
    schema: z.object({
      company: z.string().optional(),
      department: z.string().optional(),
    }),
  }
)

// 3. listAlgorithmQuestions — 列出/随机抽题
export const listAlgorithmQuestionsTool = tool(
  async ({ difficulty }) => {
    let list
    if (difficulty) list = algorithmRepo.findByDifficulty(difficulty)
    else list = algorithmRepo.findAll()
    if (!list.length) return '题库暂无题目。'
    const q = list[Math.floor(Math.random() * list.length)]
    const url = `${APP_BASE_URL}/#/ide?questionId=${q.id}`
    return `已随机抽取: ${q.title}(${q.difficulty ?? 'medium'})\n做题链接: ${url}`
  },
  {
    name: 'listAlgorithmQuestions',
    description: '获取题库中的算法题列表。可选按难度筛选:easy/medium/hard。当用户要「一道算法题」「来道题」时调用;未指定难度则随机抽取一道并返回本站在线 IDE 链接。',
    schema: z.object({
      difficulty: z.string().optional().describe('easy/medium/hard,可空'),
    }),
  }
)

// 4. findAlgorithmQuestionByTitle — 按题名查找
export const findAlgorithmQuestionByTitleTool = tool(
  async ({ title }) => {
    const list = algorithmRepo.findByTitleContainingIgnoreCase(title)
    if (list.length) {
      const q = list[0]
      const url = `${APP_BASE_URL}/#/ide?questionId=${q.id}`
      return `已查到: ${q.title}(${q.difficulty ?? 'medium'})\n做题链接: ${url}`
    }
    return `本站题库无「${title}」。力扣搜索: https://leetcode.cn/problemset/all/?search=${encodeURIComponent(title)}`
  },
  {
    name: 'findAlgorithmQuestionByTitle',
    description: '根据题目标题或关键词查找一道算法题。本站有则返回题目详情与本站 IDE 链接(一条 URL);无则返回力扣搜索链接。用户说具体题名时必须调用。链接只输出原始 URL,严禁 HTML 标签、target/rel、严禁输出两遍。',
    schema: z.object({
      title: z.string().describe('题目标题或关键词'),
    }),
  }
)

// 5. getAlgorithmQuestionById — 按 ID 查
export const getAlgorithmQuestionByIdTool = tool(
  async ({ questionId }) => {
    const q = algorithmRepo.findById(questionId)
    if (!q) return `未找到 ID 为 ${questionId} 的题目。`
    const url = `${APP_BASE_URL}/#/ide?questionId=${q.id}`
    return `第${questionId}题: ${q.title}(${q.difficulty ?? 'medium'})\n做题链接: ${url}`
  },
  {
    name: 'getAlgorithmQuestionById',
    description: '根据题目 ID 获取一道算法题详情。仅当用户明确说「第几题」「ID 为 x」时调用。链接只输出原始 URL。',
    schema: z.object({
      questionId: z.number().describe('题目 ID'),
    }),
  }
)

// 6. runCode — 运行代码(调 Piston)
export const runCodeTool = tool(
  async ({ language, code }) => {
    const result = await executeCodeRemote(language, code, '', false)
    return result.success ? `运行成功:\n${result.output}` : `运行失败:\n${result.error ?? result.output}`
  },
  {
    name: 'runCode',
    description: '运行一段代码并返回执行结果。language 支持:java,python,go,javascript,cpp。code 为源代码字符串。',
    schema: z.object({
      language: z.string().describe('java/python/go/javascript/cpp'),
      code: z.string().describe('源代码'),
    }),
  }
)

export const allTools = [
  searchInterviewsTool,
  interviewHotTopicsTool,
  listAlgorithmQuestionsTool,
  findAlgorithmQuestionByTitleTool,
  getAlgorithmQuestionByIdTool,
  runCodeTool,
]
