package com.interview.assistant.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.interview.assistant.capability.ExperienceCleaningCapability;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;

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
import java.util.Map;
import java.util.ArrayList;
import java.util.List;

/**
 * 图片面经解析：上传图片，调用智谱 GLM-4V 视觉模型提取 实习经历、项目经历、八股、算法 等
 */
@Service
public class ImageParseService {

    private static final Logger log = LoggerFactory.getLogger(ImageParseService.class);
    private static final String ZHIPU_VISION_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

    @Value("${zhipu.apiKey:}")
    private String apiKey;

    @Value("${zhipu.visionModel:glm-4v-plus}")
    private String visionModel;

    @Value("${zhipu.visionFallbackModels:glm-4.6v}")
    private String visionFallbackModels;

    private final ExperienceCleaningCapability experienceCleaningCapability;
    private final SkillPackService skillPackService;
    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();

    private static final String PARSE_PROMPT = """
        这是一张面经图片，请从中完整提取并返回 JSON 格式，包含以下字段（若无则填空字符串）：
        {
          "company": "公司名",
          "department": "部门",
          "position": "岗位",
          "type": "校招/社招/实习",
          "internshipExperiences": ["实习经历1", "实习经历2"],
          "projectExperiences": ["项目经历1", "项目经历2"],
          "baguQuestions": "八股题目及内容（见下方格式要求）",
          "llmQuestions": "大模型相关八股（若无则空）",
          "algorithmQuestions": "算法题描述",
          "algorithmLink": "力扣或原题链接（若无则空）",
          "content": "面经整体概要"
        }
        重要：
        1. baguQuestions、llmQuestions、algorithmQuestions 为字符串：每道题单独占一行，题目与题目之间用换行符\\n分隔。若原文有编号（如 1. 2.）或括号内备注（如“答的不好”“忘了”），请完整保留。
        2. 文字不要在多字词中间插入空格（如“介绍”不要写成“介 绍”），不要输出无意义的竖线等符号。
        3. 尽量完整识别每条八股题，避免漏提。
        只返回 JSON，不要其他说明。
        """;

    public ImageParseService(ExperienceCleaningCapability experienceCleaningCapability,
                             SkillPackService skillPackService) {
        this.experienceCleaningCapability = experienceCleaningCapability;
        this.skillPackService = skillPackService;
    }

    public Map<String, Object> parseImage(MultipartFile image) {
        String key = (apiKey != null && !apiKey.isEmpty()) ? apiKey : System.getenv("ZHIPU_API_KEY");
        if (key == null || key.isEmpty()) {
            throw new IllegalStateException("智谱 API Key 未配置，无法解析图片");
        }
        try {
            PreparedImage preparedImage = prepareImageForVision(image);
            String dataUrl = "data:" + preparedImage.mimeType() + ";base64," +
                    Base64.getEncoder().encodeToString(preparedImage.bytes());

            String content = null;
            RuntimeException lastError = null;
            for (String modelName : buildVisionModelCandidates()) {
                try {
                    Map<String, Object> body = new HashMap<>();
                    body.put("model", modelName);
                    body.put("max_tokens", 2048);
                    body.put("temperature", 0.3);
                    body.put("messages", java.util.List.of(
                            Map.of(
                                    "role", "user",
                                    "content", java.util.List.of(
                                            Map.of("type", "image_url", "image_url", Map.of("url", dataUrl)),
                                            Map.of("type", "text", "text", buildParsePrompt())
                                    )
                            )
                    ));

                    HttpHeaders headers = new HttpHeaders();
                    headers.setContentType(MediaType.APPLICATION_JSON);
                    headers.setBearerAuth(key);

                    HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);
                    ResponseEntity<String> resp = restTemplate.exchange(
                            ZHIPU_VISION_URL,
                            HttpMethod.POST,
                            entity,
                            String.class
                    );

                    if (resp.getStatusCode().isError()) {
                        throw new RuntimeException("智谱 API 调用失败: " + resp.getStatusCode());
                    }

                    JsonNode root = objectMapper.readTree(resp.getBody());
                    content = root.path("choices").get(0).path("message").path("content").asText();
                    break;
                } catch (org.springframework.web.client.HttpClientErrorException ex) {
                    String detail = extractErrorDetail(ex.getResponseBodyAsString(), ex.getMessage());
                    lastError = new RuntimeException("模型 " + modelName + " 解析失败: " + detail, ex);
                    log.warn("图片面经解析调用失败, model={}, detail={}", modelName, detail);
                }
            }
            if (content == null) {
                if (lastError != null) {
                    throw new RuntimeException(lastError.getMessage(), lastError);
                }
                throw new RuntimeException("未能成功调用视觉模型解析图片");
            }
            content = content.trim();
            if (content.startsWith("```")) {
                int start = content.indexOf("{");
                int end = content.lastIndexOf("}");
                if (start >= 0 && end > start) content = content.substring(start, end + 1);
            }

            @SuppressWarnings("unchecked")
            Map<String, Object> parsed = objectMapper.readValue(content, Map.class);
            normalizeParsedBaguAndAlgo(parsed);
            experienceCleaningCapability.cleanParsedPayload(parsed);
            return parsed;
        } catch (Exception e) {
            log.error("图片解析失败", e);
            throw new RuntimeException("图片解析失败: " + e.getMessage());
        }
    }

    /** 八股/算法字段后处理：修正常见 OCR 错误，并保证题目之间换行 */
    private void normalizeParsedBaguAndAlgo(Map<String, Object> parsed) {
        for (String key : new String[]{"baguQuestions", "llmQuestions", "algorithmQuestions"}) {
            Object val = parsed.get(key);
            if (val == null) continue;
            String s = val instanceof String ? (String) val : String.valueOf(val);
            if (s.isBlank()) continue;
            s = normalizeQuestionBlock(s);
            parsed.put(key, s);
        }
    }

    private String normalizeQuestionBlock(String raw) {
        if (raw == null || raw.isBlank()) return raw;
        String s = raw;
        s = s.replace("介 绍", "介绍");
        s = s.replace("|", " ").replace("  ", " ").trim();
        boolean hasNewline = s.contains("\n");
        String[] parts = hasNewline ? s.split("\\r?\\n") : s.split("[,，]");
        List<String> lines = new ArrayList<>();
        for (String p : parts) {
            String line = p.trim();
            if (!line.isEmpty()) lines.add(line);
        }
        return String.join("\n", lines);
    }

    private String buildParsePrompt() {
        String addendum = skillPackService.getPromptAddendum("experience-cleaning-skill");
        if (addendum == null || addendum.isBlank()) return PARSE_PROMPT;
        return PARSE_PROMPT + "\n\n【清洗补充规则】\n" + addendum;
    }

    private List<String> buildVisionModelCandidates() {
        List<String> models = new ArrayList<>();
        if (visionModel != null && !visionModel.isBlank()) {
            models.add(visionModel.trim());
        }
        if (visionFallbackModels != null && !visionFallbackModels.isBlank()) {
            for (String model : visionFallbackModels.split(",")) {
                String trimmed = model.trim();
                if (!trimmed.isEmpty() && !models.contains(trimmed)) {
                    models.add(trimmed);
                }
            }
        }
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

    private record PreparedImage(byte[] bytes, String mimeType) {}
}
