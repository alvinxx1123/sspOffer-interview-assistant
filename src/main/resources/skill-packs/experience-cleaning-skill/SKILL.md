---
name: experience-cleaning-skill
description: Clean OCR and manually entered interview experiences before storage so the RAG corpus has less noise, fewer duplicates, and more consistent company, department, and question fields.
---

# experience-cleaning-skill

## Purpose
清洗图片 OCR 或手动录入后的面经内容，减少噪音、重复、错别字和字段不规范问题，提升 RAG 质量。

## When to Use
- 图片解析完成后
- 面经写入数据库前
- 需要重建或优化 RAG 索引前

## Workflow
1. 统一公司、部门、岗位、来源等基础字段的空白与常见别名。
2. 清洗八股、算法、AI 问题中的 OCR 噪音与重复行。
3. 合并内容块中的多余空格、无意义符号与重复题目。
4. 输出更适合检索和展示的结构化文本。

## Resources
- 面经清洗规范：`references/cleaning-rules.md`
- 清洗后字段结构模板：`templates/cleaned-experience.md`

## Prompt Addendum
- 去掉无意义竖线、异常空格、重复编号和重复题目。
- 保留题目原意，不做主观改写。
- 对多行问题去重，保持每题单独占一行。
- 公司、部门、岗位字段为空时返回空字符串，不要填造假的默认值。
