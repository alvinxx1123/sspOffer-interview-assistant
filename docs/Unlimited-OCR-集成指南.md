# Unlimited-OCR 集成指南（baidu/PaddlePaddle 视觉-语言 OCR）

> 把实习项目里的"图片 / 扫描型 PDF"从「丢给多模态 LLM」升级到「本地 VLM OCR 服务」，准确率更高、token 费用为 0。

## 0. 现状与升级动机

| | 现状 | 升级后 |
| --- | --- | --- |
| 图片 | 走 DeepSeek-V4 多模态（按图计 token、3-10s/张、对中文小字和表格一般） | 走 Unlimited-OCR（本地 GPU，~2s/张，对中文 + 表格 + 公式都更好） |
| 文字型 PDF | 走 Apache PDFBox 抽文字（免费、准确） | 不变 |
| 扫描型 PDF | PDFBox 抽到 0 字符 → 错误提示 | 转图片走 Unlimited-OCR |
| Markdown / TXT | 之前不支持，现已支持直读 | 不变 |

下游「STAR 经历 + 概念图谱」仍然由 LLM 生成，但输入从"低质量多模态 prompt"升级到"高质量结构化文本"。

## 1. Unlimited-OCR 项目信息（2026-07 调研）

- 仓库：https://github.com/baidu/Unlimited-OCR
- License：**MIT**（可商用）
- Stars：20k+（不到一个月）
- 模型：`baidu/Unlimited-OCR` on Hugging Face（已下载 270 万次）
- 论文：arXiv 2606.23050
- 强依赖：**NVIDIA GPU**，建议 16GB+ 显存（bfloat16）

⚠️ 它是 VLM（视觉-语言模型），不是轻量 OCR；CPU 跑非常慢（30s+/页），生产用建议上 GPU。

## 2. 部署（推荐 vLLM/SGLang）

### 2.1 一行命令起服务（vLLM 官方 Docker）

```bash
# 拉镜像（CUDA 13.0）
docker pull vllm/vllm-openai:unlimited-ocr

# 启动
docker run -d \
  --gpus all \
  --name unlimited-ocr \
  -p 10000:10000 \
  vllm/vllm-openai:unlimited-ocr
```

启动完成后，HTTP 服务监听在 `http://127.0.0.1:10000/v1/chat/completions`，兼容 OpenAI 协议。

### 2.2 验证服务

```bash
# 测连通（不需要真发图，只看返回）
curl -s -X POST http://127.0.0.1:10000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Unlimited-OCR",
    "messages": [{"role": "user", "content": "ping"}],
    "max_tokens": 16
  }'
```

如果返回 JSON 包含 `choices`，说明服务正常。

### 2.3 真实 OCR 测试（发一张图）

```bash
# 把任意图片 base64 后塞进 data URL
curl -s -X POST http://127.0.0.1:10000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"Unlimited-OCR\",
    \"messages\": [{
      \"role\": \"user\",
      \"content\": [
        {\"type\": \"text\", \"text\": \"<image>document parsing.\"},
        {\"type\": \"image_url\", \"image_url\": {\"url\": \"data:image/png;base64,$(base64 -i test.png)\"}}
      ]
    }],
    \"max_tokens\": 4096
  }"
```

返回的 `choices[0].message.content` 就是 OCR 结果，会带 `<|det|>type<|/det|>` 标记，Java 端会自动剥掉。

## 3. 启用本项目

### 3.1 编辑 `src/main/resources/application.yml`

```yaml
unlimited-ocr:
  enabled: true                          # 默认是 false，改 true
  base-url: "http://127.0.0.1:10000"     # 你的 vLLM/SGLang 地址
  api-key: ""                            # vLLM 默认不需要；SGLang 启用鉴权时填
  model: "Unlimited-OCR"
  timeout-seconds: 120
  prompt: "<image>document parsing."
```

### 3.2 重启 Spring Boot

```bash
mvn spring-boot:run
```

启动日志会打印：
```
模型配置就绪: ..., unlimitedOcr=on(http://127.0.0.1:****)
```

### 3.3 上传图片验证

在「实习经历掌握度」页上传任意图片，展开"查看每个文件走了哪条解析路径"，应该看到 `Unlimited-OCR 视觉-语言 OCR` 标签。

## 4. 失败自动回退

如果 Unlimited-OCR 服务**没起**、**超时**或**返回空**，Java 后端会**自动**改用多模态 LLM（DeepSeek-V4 等），不影响上传流程。

parseStatusJson 的 `parser` 字段会显示具体走的是哪条：

| parser 值 | 含义 |
| --- | --- |
| `pdfbox_text` | 文字型 PDF，PDFBox 抽出来 |
| `markdown_plain` | MD 文件直读 |
| `plain_text` | TXT 文件直读 |
| `unlimited_ocr` | Unlimited-OCR 成功 |
| `llm_vision` | 多模态 LLM（Unlimited-OCR 没启用时的默认） |
| `llm_vision_fallback` | Unlimited-OCR 挂了，自动回退到 LLM |

## 5. 性能与硬件建议

| 场景 | 单页耗时 | 显存占用 |
| --- | --- | --- |
| 单图 gundam 配置（base_size=1024, image_size=640, crop） | ~1-2s | ~10GB |
| 多页/扫描 PDF base 配置（image_size=1024） | ~2-4s/页 | ~14GB |

推荐配置：**NVIDIA RTX 4090 / A100 / 3090 × 1**，CUDA ≥12.9。

如果机器没 GPU，可以：
1. 用**云 GPU**（AutoDL、恒源云、AWS g5 等）起 vLLM 服务
2. 直接走 DeepSeek-V4（不需要 Unlimited-OCR）
3. 用**PaddleOCR-v4** 做替代（轻量、CPU 也能跑、中文 SOTA，但**不是 VLM**，只能做文字识别不做版面）

## 6. 与 PDF/MD 上传的关系

**没有冲突，三种格式是互补的，按文件实际情况选**：

- 文件是 .md / .txt → 直接读，零依赖
- 文件是 .pdf 且是文字型（可复制粘贴） → PDFBox
- 文件是 .pdf 但抽不到字（扫描件） → 转图后走 Unlimited-OCR（OCR 失败回退 LLM）
- 文件是 .png / .jpg / .webp → 优先 Unlimited-OCR，没启用就 LLM

## 7. 进一步优化（未来）

- 接 **PaddleOCR-VL**（Baidu 较新 VLM，对中文场景更准）作为 Unlimited-OCR 的替代
- 加**版面分析**前端可视化（让用户看到原图被识别出的标题/表格/代码块边界）
- **缓存** 已 OCR 过的图片（按 hash），避免重复推理
