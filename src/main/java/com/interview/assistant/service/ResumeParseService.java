package com.interview.assistant.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;
import com.interview.assistant.config.ModelConfigHolder;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageOutputStream;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.ArrayList;

/**
 * 简历解析：支持 PDF 和图片（jpg/png），提取文本用于 AI 面试
 */
@Service
public class ResumeParseService {

    private static final Logger log = LoggerFactory.getLogger(ResumeParseService.class);

    private final ModelConfigHolder modelConfigHolder;
    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();


    public ResumeParseService(ModelConfigHolder modelConfigHolder) {
        this.modelConfigHolder = modelConfigHolder;
    }

    private static final String RESUME_IMAGE_PROMPT = """
        这是一份简历的图片，请识别并提取其中的全部文字内容。
        保持原有的格式和结构（如教育经历、项目经历、技能等分段）。
        只返回提取的文本内容，不要添加任何说明或解释。
        """;

    /**
     * 解析简历文件，支持 PDF、jpg、jpeg、png
     * @return 提取的简历文本
     */
    public String parseResume(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("请选择文件");
        }
        String name = file.getOriginalFilename();
        if (name == null) name = "";
        String ext = name.contains(".") ? name.substring(name.lastIndexOf('.')).toLowerCase() : "";

        if (".pdf".equals(ext)) {
            return parsePdf(file);
        }
        // 纯文本/Markdown 直接读字节（零依赖，最便宜、最准确，LLM 对 MD 结构理解最好）
        if (ext.matches("\\.(md|markdown|markdown\\.txt)")) {
            return parseMarkdown(file);
        }
        if (ext.matches("\\.(txt|text)")) {
            return parsePlainText(file);
        }
        if (ext.matches("\\.(jpg|jpeg|png|gif|webp)")) {
            return parseImage(file);
        }
        throw new IllegalArgumentException(
                "暂不支持的格式：" + (ext.isEmpty() ? "(无后缀)" : ext) +
                "。当前支持 PDF / Markdown / TXT / 图片（jpg/png/gif/webp）。" +
                "文档类（.docx / .pptx）可先另存为 PDF/MD 再上传。");
    }

    /** 读取 Markdown 源文件作为输入：保持原始结构（标题、列表、表格、代码块原样） */
    public String parseMarkdown(MultipartFile file) {
        try {
            String text = new String(file.getBytes(), java.nio.charset.StandardCharsets.UTF_8);
            return text.replaceAll("\\r\\n?", "\\n").trim();
        } catch (Exception e) {
            throw new RuntimeException("读取 Markdown 失败: " + e.getMessage(), e);
        }
    }

    /** 读取纯文本文件 */
    public String parsePlainText(MultipartFile file) {
        try {
            String text = new String(file.getBytes(), java.nio.charset.StandardCharsets.UTF_8);
            return text.replaceAll("\\r\\n?", "\\n").trim();
        } catch (Exception e) {
            throw new RuntimeException("读取文本失败: " + e.getMessage(), e);
        }
    }

    private String parsePdf(MultipartFile file) {
        try {
            try (PDDocument doc = Loader.loadPDF(file.getBytes())) {
                int pages = doc.getNumberOfPages();
                PDFTextStripper stripper = new PDFTextStripper();
                String text = stripper.getText(doc);
                String trimmed = text != null ? text.trim() : "";
                // 扫描型 PDF：没抽出可读文字或文字极少 → 明确告知用户处理路径
                // 「每页至少 20 字符」是经验阈值：纯文字型 PDF 单页至少几百字符
                int charsPerPage = pages > 0 ? trimmed.length() / pages : trimmed.length();
                if (trimmed.isEmpty()) {
                    throw new IllegalStateException(
                            "PDF 没有可提取的文字（疑似扫描型 PDF）。请将扫描件另存为图片（jpg/png），再上传；" +
                                    "或先 OCR 后以 .md 文本上传。");
                }
                if (charsPerPage < 20) {
                    throw new IllegalStateException(
                            "PDF 平均每页仅抽取到 " + charsPerPage + " 个字符（疑似扫描型 PDF）。" +
                                    "请将扫描件另存为图片再上传，或先 OCR 后以 .md 文本上传。");
                }
                return trimmed;
            }
        } catch (IllegalStateException e) {
            throw new RuntimeException("PDF 解析: " + e.getMessage(), e);
        } catch (Exception e) {
            log.error("PDF 解析失败", e);
            throw new RuntimeException("PDF 解析失败: " + e.getMessage());
        }
    }

    /**
     * 解析图片：优先用 Unlimited-OCR（VLM OCR + 版面分析），失败/未配置时回退到 LLM 多模态。
     * - Unlimited-OCR 命中时输出纯结构化文本（去 <|det|> 标记）
     * - 回退 LLM 时输出原 LLM 文本
     * - 解析结果会通过 throw 的异常或正常 return 暴露；上层 MasteryService 会把走了哪条路径写进 parseStatusJson
     */
    private String parseImage(MultipartFile file) {
        // 1) 优先 Unlimited-OCR（本地 GPU 服务，免费、准确）
        if (modelConfigHolder.isUnlimitedOcrEnabled()) {
            try {
                String text = parseImageViaUnlimitedOcr(file);
                if (text != null && !text.isBlank()) return text;
                log.warn("Unlimited-OCR 返回空文本，回退到多模态 LLM");
            } catch (Exception e) {
                log.warn("Unlimited-OCR 调用失败，回退到多模态 LLM: {}", e.getMessage());
            }
        }
        // 2) 回退：走用户配置的「多模态/视觉」模型（独立于 LLM，可不同 provider，例如 Vision 用豆包 Ark）
        String key = modelConfigHolder.getVisionApiKey();
        String visionBaseUrl = modelConfigHolder.getVisionBaseUrl();
        String visionModel = modelConfigHolder.getVisionModel();
        if (key == null || key.isEmpty()) {
            throw new IllegalStateException("多模态/视觉模型 API Key 未配置，无法解析图片（且 Unlimited-OCR 未启用或不可用）。请到设置页配置多模态大模型。");
        }
        try {
            PreparedImage preparedImage = prepareImageForVision(file);
            String dataUrl = "data:" + preparedImage.mimeType() + ";base64," +
                    Base64.getEncoder().encodeToString(preparedImage.bytes());

            RuntimeException lastError = null;
            for (String modelName : buildVisionModelCandidates()) {
                try {
                    Map<String, Object> body = new HashMap<>();
                    body.put("model", modelName != null && !modelName.isBlank() ? modelName : visionModel);
                    body.put("max_tokens", 4096);
                    body.put("temperature", 0.2);
                    body.put("messages", List.of(
                            Map.of(
                                    "role", "user",
                                    "content", List.of(
                                            Map.of("type", "image_url", "image_url", Map.of("url", dataUrl)),
                                            Map.of("type", "text", "text", RESUME_IMAGE_PROMPT)
                                    )
                            )
                    ));

                    HttpHeaders headers = new HttpHeaders();
                    headers.setContentType(MediaType.APPLICATION_JSON);
                    headers.setBearerAuth(key);

                    HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);
                    ResponseEntity<String> resp = restTemplate.exchange(
                            visionBaseUrl + "/chat/completions",
                            HttpMethod.POST,
                            entity,
                            String.class
                    );

                    if (resp.getStatusCode().isError()) {
                        throw new RuntimeException("DeepSeek API 调用失败: " + resp.getStatusCode());
                    }

                    JsonNode root = objectMapper.readTree(resp.getBody());
                    String content = root.path("choices").get(0).path("message").path("content").asText();
                    return content != null ? content.trim() : "";
                } catch (org.springframework.web.client.HttpClientErrorException ex) {
                    String detail = extractErrorDetail(ex.getResponseBodyAsString(), ex.getMessage());
                    lastError = new RuntimeException("模型 " + modelName + " 解析失败: " + detail, ex);
                    log.warn("简历图片解析调用失败, model={}, detail={}", modelName, detail);
                }
            }

            if (lastError != null) {
                throw new RuntimeException(lastError.getMessage());
            }
            throw new RuntimeException("未能成功调用视觉模型解析图片");
        } catch (Exception e) {
            log.error("简历图片解析失败", e);
            throw new RuntimeException("简历图片解析失败: " + e.getMessage());
        }
    }

    private List<String> buildVisionModelCandidates() {
        List<String> models = new ArrayList<>();
        models.add(modelConfigHolder.getVisionModel());
        return models;
    }

    private String extractErrorDetail(String errBody, String fallback) {
        try {
            JsonNode err = objectMapper.readTree(errBody);
            if (err.has("error") && err.get("error").has("message")) {
                return err.get("error").path("message").asText();
            }
            if (err.has("error")) {
                return err.get("error").toString();
            }
        } catch (Exception ignored) {}
        return fallback != null ? fallback : "未知错误";
    }

    private PreparedImage prepareImageForVision(MultipartFile file) {
        try {
            byte[] original = file.getBytes();
            BufferedImage source = ImageIO.read(new ByteArrayInputStream(original));
            if (source == null) {
                return new PreparedImage(original, "image/jpeg");
            }
            BufferedImage normalized = resizeIfNeeded(source, 1800);
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
            try (ImageOutputStream ios = ImageIO.createImageOutputStream(baos)) {
                writer.setOutput(ios);
                ImageWriteParam param = writer.getDefaultWriteParam();
                if (param.canWriteCompressed()) {
                    param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
                    param.setCompressionQuality(0.82f);
                }
                writer.write(null, new IIOImage(normalized, null, null), param);
            } finally {
                writer.dispose();
            }
            return new PreparedImage(baos.toByteArray(), "image/jpeg");
        } catch (Exception e) {
            log.warn("图片预处理失败，回退原图上传: {}", e.getMessage());
            try {
                return new PreparedImage(file.getBytes(), "image/jpeg");
            } catch (Exception ex) {
                throw new RuntimeException("读取图片失败: " + ex.getMessage(), ex);
            }
        }
    }

    private BufferedImage resizeIfNeeded(BufferedImage source, int maxWidth) {
        int width = source.getWidth();
        int height = source.getHeight();
        if (width <= maxWidth) {
            return toJpegSafeImage(source, width, height);
        }
        int targetWidth = maxWidth;
        int targetHeight = Math.max(1, (int) Math.round(height * (maxWidth / (double) width)));
        Image scaled = source.getScaledInstance(targetWidth, targetHeight, Image.SCALE_SMOOTH);
        BufferedImage output = new BufferedImage(targetWidth, targetHeight, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = output.createGraphics();
        try {
            g.setColor(Color.WHITE);
            g.fillRect(0, 0, targetWidth, targetHeight);
            g.drawImage(scaled, 0, 0, null);
        } finally {
            g.dispose();
        }
        return output;
    }

    private BufferedImage toJpegSafeImage(BufferedImage source, int width, int height) {
        if (source.getType() == BufferedImage.TYPE_INT_RGB) {
            return source;
        }
        BufferedImage output = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = output.createGraphics();
        try {
            g.setColor(Color.WHITE);
            g.fillRect(0, 0, width, height);
            g.drawImage(source, 0, 0, null);
        } finally {
            g.dispose();
        }
        return output;
    }

    /**
     * 通过 HTTP 调用本地 Unlimited-OCR 服务（SGLang/vLLM OpenAI 兼容接口），把图片转成结构化文本。
     * 返回去掉 <|det|> 标记后的纯文本，便于 LLM 下游消费。
     */
    private String parseImageViaUnlimitedOcr(MultipartFile file) throws Exception {
        PreparedImage prepared = prepareImageForVision(file);
        String dataUrl = "data:" + prepared.mimeType() + ";base64,"
                + Base64.getEncoder().encodeToString(prepared.bytes());
        String baseUrl = modelConfigHolder.getUnlimitedOcrBaseUrl();
        if (baseUrl.endsWith("/")) baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
        String url = baseUrl + "/v1/chat/completions";
        Map<String, Object> body = new HashMap<>();
        body.put("model", modelConfigHolder.getUnlimitedOcrModel());
        body.put("stream", false);
        body.put("temperature", 0);
        body.put("max_tokens", 32768);
        body.put("messages", List.of(
                Map.of("role", "user", "content", List.of(
                        Map.of("type", "text", "text", modelConfigHolder.getUnlimitedOcrPrompt()),
                        Map.of("type", "image_url", "image_url", Map.of("url", dataUrl))
                ))
        ));
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        String apiKey = modelConfigHolder.getUnlimitedOcrApiKey();
        if (apiKey != null && !apiKey.isBlank()) headers.setBearerAuth(apiKey);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);
        int timeout = modelConfigHolder.getUnlimitedOcrTimeoutSeconds() * 1000;
        org.springframework.web.client.RestTemplate rt = new org.springframework.web.client.RestTemplate();
        rt.getMessageConverters().stream()
                .filter(c -> c instanceof org.springframework.http.converter.StringHttpMessageConverter)
                .findFirst()
                .ifPresent(c -> ((org.springframework.http.converter.StringHttpMessageConverter) c)
                        .setDefaultCharset(java.nio.charset.StandardCharsets.UTF_8));
        org.springframework.http.client.ClientHttpRequestFactory reqFactory = new org.springframework.http.client.SimpleClientHttpRequestFactory();
        ((org.springframework.http.client.SimpleClientHttpRequestFactory) reqFactory).setConnectTimeout(10_000);
        ((org.springframework.http.client.SimpleClientHttpRequestFactory) reqFactory).setReadTimeout(timeout);
        rt.setRequestFactory(reqFactory);
        try {
            ResponseEntity<String> resp = rt.exchange(url, HttpMethod.POST, entity, String.class);
            if (resp.getStatusCode().isError()) {
                throw new RuntimeException("Unlimited-OCR HTTP " + resp.getStatusCode() + ": " + truncate(resp.getBody(), 200));
            }
            JsonNode root = objectMapper.readTree(resp.getBody());
            String content = root.path("choices").path(0).path("message").path("content").asText("");
            return stripUnlimitedOcrDetTags(content).trim();
        } catch (org.springframework.web.client.ResourceAccessException e) {
            throw new RuntimeException("Unlimited-OCR 连接/超时失败: " + e.getMessage(), e);
        }
    }

    /**
     * 把 Unlimited-OCR 输出的 <|det|>type<|/det|>content 行格式剥成纯文本。
     * - 跳过 image 类型的块（OCR 标记为图片占位的，本项目不需要）
     * - 同块多行用 \n 合并；不同块用 \n\n 分段
     */
    private String stripUnlimitedOcrDetTags(String raw) {
        if (raw == null || raw.isEmpty()) return "";
        java.util.regex.Pattern DET = java.util.regex.Pattern.compile("<\\|det\\|>([^<\\s]+)(?:\\s*\\[[^\\]]*\\])?\\s*<\\|/det\\|>(.*)");
        java.util.List<String> blocks = new java.util.ArrayList<>();
        java.util.List<String> cur = null;
        for (String line : raw.split("\\r?\\n")) {
            String l = line.stripTrailing();
            if (l.isEmpty()) continue;
            java.util.regex.Matcher m = DET.matcher(l);
            if (m.find()) {
                if (cur != null) blocks.add(String.join("\\n", cur));
                String cat = m.group(1);
                String content = m.group(2);
                if ("image".equals(cat) || content.isEmpty()) { cur = null; continue; }
                cur = new java.util.ArrayList<>();
                if (!content.isEmpty()) cur.add(content);
            } else {
                if (cur == null) cur = new java.util.ArrayList<>();
                cur.add(l);
            }
        }
        if (cur != null) blocks.add(String.join("\\n", cur));
        return String.join("\\n\\n", blocks).trim();
    }

    private String truncate(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max) + "...";
    }

    private record PreparedImage(byte[] bytes, String mimeType) {}
}
