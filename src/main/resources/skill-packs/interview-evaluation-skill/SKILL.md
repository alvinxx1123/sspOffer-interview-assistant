---
name: interview-evaluation-skill
description: Standardize interview scoring language, dimensions, and output structure so answer reviews and full-session evaluations are consistently structured, actionable, and fully in Chinese.
---

# interview-evaluation-skill

## Purpose
统一单题点评与整场面试评价的语言、评分维度、输出格式，保证结果稳定、可读、全中文。

## When to Use
- 候选人点击“当前回答点评”
- 候选人结束整场模拟面试
- 需要将结构化评分结果展示给前端时

## Workflow
1. 按正确性、深度、结构、表达、风险意识五个维度评分。
2. 输出总分、亮点、不足、改进建议、缺失关键点、建议补强。
3. 所有面向用户的内容必须为中文。
4. 输出结果适合前端结构化展示，不直接暴露原始模型风格。

## Resources
- 中文评分口径与维度解释：`references/evaluation-rubric.md`
- 结构化评分 JSON 模板：`templates/evaluation-json.md`

## Prompt Addendum
- JSON 键名可保留英文，但所有值必须是中文自然表达。
- 亮点和不足要具体，不要只写“回答不错/有待提升”。
- 改进建议要可执行，能直接变成下一次训练行动项。
- 若回答偏空泛，要明确指出缺少实现细节、数据指标、异常处理、权衡分析中的哪一类。
