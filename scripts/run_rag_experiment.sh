#!/usr/bin/env bash
# 对比实验：调用本系统「深挖问题」接口，将结果保存到 docs/experiment_output_rag.txt
# 使用前请先启动后端：./mvn spring-boot:run（需配置 ZHIPU_API_KEY）
# 用法：./scripts/run_rag_experiment.sh

set -e
BASE_URL="${1:-http://localhost:8080/api}"
OUTPUT_FILE="docs/experiment_output_rag.txt"

# 与 docs/对比实验-面经RAG与通用大模型.md 中统一的简历样本
RESUME='教育：某 985 计算机本科，2025 届。
实习：字节跳动 基础架构 实习 6 个月，参与 KV 存储引擎开发，使用 RocksDB，做过 compaction 优化与监控告警。
项目：基于 Redis 的分布式缓存课程设计；大模型 RAG 检索小项目，使用 LangChain + 智谱 API。
技能：Java、Spring、Redis、MySQL、RAG/大模型基础。'

echo "==> 调用深挖问题接口 (POST ${BASE_URL}/interviews/questions) ..."
echo "    公司=字节跳动, 部门=基础架构"

# 使用 Python 生成 JSON（简历通过临时文件传入，避免转义问题）
TMP_RESUME=$(mktemp)
TMP_JSON=$(mktemp)
printf '%s' "$RESUME" > "$TMP_RESUME"
python3 -c "
import json, sys
with open('$TMP_RESUME') as f:
    resume = f.read()
print(json.dumps({'company': '字节跳动', 'department': '基础架构', 'resume': resume}, ensure_ascii=False))
" > "$TMP_JSON"
BODY=$(cat "$TMP_JSON")
rm -f "$TMP_RESUME" "$TMP_JSON"
URL="${BASE_URL}/interviews/questions"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$OUTPUT_FILE" -X POST "$URL" -H "Content-Type: application/json" -d "$BODY")

if [ "$HTTP_CODE" != "200" ]; then
  echo "请求失败 HTTP $HTTP_CODE，请检查后端是否启动、智谱 API 是否配置。"
  echo "响应内容见: $OUTPUT_FILE"
  exit 1
fi

echo "==> 结果已写入: $OUTPUT_FILE"
echo ""
echo "--- 生成内容预览 ---"
head -50 "$OUTPUT_FILE"
echo ""
echo "--- 可与 docs/对比实验-面经RAG与通用大模型.md 中「通用模型」输出对比 ---"
