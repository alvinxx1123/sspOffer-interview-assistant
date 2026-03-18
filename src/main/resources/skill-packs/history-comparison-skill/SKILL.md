---
name: history-comparison-skill
description: Compare the current interview against historical sessions at the dimension level, highlight progress and regressions, and turn weak areas into concrete reinforcement advice.
---

# history-comparison-skill

## Purpose
把本场面试与历史会话进行维度级对比，告诉用户哪里进步了、哪里退步了、下一步应该重点补什么。

## When to Use
- 整场面试结束并已得到本场完整评分后
- 查看历史会话详情时
- 需要把成长趋势解释给用户时

## Workflow
1. 读取同公司/同方向的历史面试评分结果。
2. 按正确性、深度、结构、表达、风险意识与本场做差异对比。
3. 识别提升项、退步项、稳定项。
4. 输出一段中文总结，并给出优先加强建议。

## Resources
- 历史对比结论生成规则：`references/comparison-rules.md`
- 历史对比输出模板：`templates/comparison-json.md`

## Prompt Addendum
- 历史对比不是只比较总分，要按评分维度拆开分析。
- 对比结论要包含：提升项、退步项、保持稳定项。
- 建议优先加强内容要与当前短板和 studyTopics 对齐。
- 若历史样本不足，要明确说明样本不足，不要强行下结论。
