---
name: internship-mastery-skill
description: Extract STAR internship experiences and a deep-dive concept graph from project documents, then diagnose the candidate's mastery of each underlying concept so they can survive interviewer grilling — not just recite a resume.
---

# internship-mastery-skill

## Purpose
从实习/项目文档中提取可写进简历的 STAR 经历，并为每条经历关联面试官会深挖的底层概念图谱；再通过诊断题评估候选人对每个概念的真实掌握度，产出一张"知识掌握地图"。目标是让求职者从底层真正懂、经得住深挖，而不只是生成一份稿子。

## When to Use
- 候选人上传实习/项目文档，需要生成简历经历时
- 已生成经历，需要把"做了什么"拆成"会被拷打的底层概念"时
- 需要评估候选人对这些概念的真实掌握度、找出薄弱点时
- 为后续"针对薄弱概念的施压演练"准备考纲与薄弱清单时

## Workflow
1. 解析项目文档，提取项目背景、技术栈、个人贡献、难点、成果。
2. 按 STAR + 量化指标整理成简历可用的经历条目（区分个人贡献与团队成果，不夸大、不编造指标）。
3. 为每条经历列出面试官最可能深挖的底层概念（原理/故障/一致性/选型/边界），每个概念给出 whyItMatters 和一道能逼出解释的诊断题 probeQuestion。
4. 让候选人对每个 probeQuestion 作答（或标注"不懂/略知"），按诊断标准判定 solid/shallow/unknown。
5. 产出掌握地图：每概念的等级、gap、针对性 drill 建议，并汇总 weakFocus 供后续施压演练使用。

## Resources
- 概念提取规则：`references/concept-extraction-rules.md`
- 诊断评级标准：`references/diagnosis-rubric.md`
- 经历+概念图谱输出模板：`templates/experience-and-concepts.md`
- 掌握地图输出模板：`templates/mastery-map.md`

## Prompt Addendum
- 只基于文档真实出现的内容，不编造量化指标；无数据时用"参与/支持/覆盖"等可验证措辞。
- 概念必须落在该经历涉及的技术栈上，不要泛泛罗列八股；每条经历 2-5 个概念，宁少而准。
- probeQuestion 要开放式、逼对方解释（为什么/怎么处理/权衡什么），禁止是非题。
- 诊断只看回答实质，不因篇幅长就判 solid；shallow 要具体指出缺哪个点。
- 经历用 STAR，量化优先；概念 depthLevel 标 表层/中层/底层，便于后续按难度递进施压。
- 全程中文；JSON 键名用英文、值用中文；输出纯 JSON，不要 markdown 代码块。
