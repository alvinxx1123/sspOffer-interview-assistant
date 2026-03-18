---
name: resume-grounding-skill
description: Ground question generation and interview follow-up in the candidate's actual resume by extracting internships, projects, tech stack, achievements, and likely deep-dive topics.
---

# resume-grounding-skill

## Purpose
从简历中提取实习、项目、技术栈、成果指标与潜在追问点，让题单更贴近候选人真实经历。

## When to Use
- 生成深挖问题前
- 需要根据简历内容补足题型覆盖时
- 需要让追问落在候选人真正写过的经历上时

## Workflow
1. 从简历中抽取实习经历、项目经历、技术栈、量化结果。
2. 归纳候选人的高频技术主题与最可能被深挖的模块。
3. 把候选人画像注入到出题 prompt 中。
4. 若面经库缺少某类数据，优先根据候选人画像补题。

## Resources
- 简历画像抽取规则：`references/resume-signals.md`
- 候选人画像摘要模板：`templates/candidate-profile.md`

## Prompt Addendum
- 优先围绕简历中明确出现的实习、项目、技术栈出题。
- 若简历中有 AI/Agent/RAG/LangChain4j 相关内容，至少出 1-2 道对应深挖题。
- 若简历中有 Java 后端、缓存、数据库、中间件内容，八股题要紧扣这些技术栈。
- 若候选人写了量化指标、性能优化、系统设计结果，优先深挖“如何做到”和“如何验证”。
