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

import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

/**
 * 简历解析：支持 PDF 和图片（jpg/png），提取文本用于 AI 面试
 */
@Service
public class ResumeParseService {

    private static final Logger log = LoggerFactory.getLogger(ResumeParseService.class);
    private static final String ZHIPU_VISION_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

    @Value("${zhipu.apiKey:}")
    private String apiKey;

    @Value("${zhipu.visionModel:glm-4v-plus}")
    private String visionModel;

    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();

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
        if (ext.matches("\\.(jpg|jpeg|png|gif|webp)")) {
            return parseImage(file);
        }
        throw new IllegalArgumentException("仅支持 PDF 或图片格式（jpg/png/gif/webp）");
    }

    private String parsePdf(MultipartFile file) {
        try {
            try (PDDocument doc = Loader.loadPDF(file.getBytes())) {
                PDFTextStripper stripper = new PDFTextStripper();
                String text = stripper.getText(doc);
                return text != null ? text.trim() : "";
            }
        } catch (Exception e) {
            log.error("PDF 解析失败", e);
            throw new RuntimeException("PDF 解析失败: " + e.getMessage());
        }
    }

    private String parseImage(MultipartFile file) {
        String key = (apiKey != null && !apiKey.isEmpty()) ? apiKey : System.getenv("ZHIPU_API_KEY");
        if (key == null || key.isEmpty()) {
            throw new IllegalStateException("智谱 API Key 未配置，无法解析图片");
        }
        try {
            String base64 = Base64.getEncoder().encodeToString(file.getBytes());
            String mime = file.getContentType();
            if (mime == null) mime = "image/jpeg";
            String dataUrl = "data:" + mime + ";base64," + base64;

            Map<String, Object> body = new HashMap<>();
            body.put("model", visionModel);
            body.put("max_tokens", 4096);
            body.put("temperature", 0.2);
            body.put("messages", java.util.List.of(
                Map.of(
                    "role", "user",
                    "content", java.util.List.of(
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
                ZHIPU_VISION_URL,
                HttpMethod.POST,
                entity,
                String.class
            );

            if (resp.getStatusCode().isError()) {
                throw new RuntimeException("智谱 API 调用失败: " + resp.getStatusCode());
            }

            JsonNode root = objectMapper.readTree(resp.getBody());
            String content = root.path("choices").get(0).path("message").path("content").asText();
            return content != null ? content.trim() : "";
        } catch (Exception e) {
            log.error("简历图片解析失败", e);
            throw new RuntimeException("简历图片解析失败: " + e.getMessage());
        }
    }
}
