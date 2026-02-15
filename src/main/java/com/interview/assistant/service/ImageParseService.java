package com.interview.assistant.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

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

    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();

    private static final String PARSE_PROMPT = """
        这是一张面经图片，请从中提取并返回 JSON 格式，包含以下字段（若无则填空字符串）：
        {
          "company": "公司名",
          "department": "部门",
          "position": "岗位",
          "type": "校招/社招/实习",
          "internshipExperiences": ["实习经历1", "实习经历2"],
          "projectExperiences": ["项目经历1", "项目经历2"],
          "baguQuestions": "八股题目及内容",
          "llmQuestions": "大模型相关八股（若无则空）",
          "algorithmQuestions": "算法题描述",
          "algorithmLink": "力扣或原题链接（若无则空）",
          "content": "面经整体概要"
        }
        只返回 JSON，不要其他说明。
        """;

    public Map<String, Object> parseImage(MultipartFile image) {
        String key = (apiKey != null && !apiKey.isEmpty()) ? apiKey : System.getenv("ZHIPU_API_KEY");
        if (key == null || key.isEmpty()) {
            throw new IllegalStateException("智谱 API Key 未配置，无法解析图片");
        }
        try {
            String base64 = Base64.getEncoder().encodeToString(image.getBytes());
            String mime = image.getContentType();
            if (mime == null) mime = "image/jpeg";
            String dataUrl = "data:" + mime + ";base64," + base64;

            Map<String, Object> body = new HashMap<>();
            body.put("model", visionModel);
            body.put("max_tokens", 2048);
            body.put("temperature", 0.3);
            body.put("messages", java.util.List.of(
                Map.of(
                    "role", "user",
                    "content", java.util.List.of(
                        Map.of("type", "image_url", "image_url", Map.of("url", dataUrl)),
                        Map.of("type", "text", "text", PARSE_PROMPT)
                    )
                )
            ));

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.setBearerAuth(key);

            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);
            ResponseEntity<String> resp;
            try {
                resp = restTemplate.exchange(
                    ZHIPU_VISION_URL,
                    HttpMethod.POST,
                    entity,
                    String.class
                );
            } catch (org.springframework.web.client.HttpClientErrorException ex) {
                String errBody = ex.getResponseBodyAsString();
                String detail = "";
                try {
                    JsonNode err = objectMapper.readTree(errBody);
                    if (err.has("error") && err.get("error").has("message")) {
                        detail = err.get("error").path("message").asText();
                    } else if (err.has("error")) {
                        detail = err.get("error").toString();
                    }
                } catch (Exception ignored) { detail = errBody != null ? errBody : ex.getMessage(); }
                throw new RuntimeException("智谱 API 调用失败: " + ex.getStatusCode() + (detail.isEmpty() ? "" : " " + detail));
            }

            if (resp.getStatusCode().isError()) {
                throw new RuntimeException("智谱 API 调用失败: " + resp.getStatusCode());
            }

            JsonNode root = objectMapper.readTree(resp.getBody());
            String content = root.path("choices").get(0).path("message").path("content").asText();
            content = content.trim();
            if (content.startsWith("```")) {
                int start = content.indexOf("{");
                int end = content.lastIndexOf("}");
                if (start >= 0 && end > start) content = content.substring(start, end + 1);
            }

            @SuppressWarnings("unchecked")
            Map<String, Object> parsed = objectMapper.readValue(content, Map.class);
            return parsed;
        } catch (Exception e) {
            log.error("图片解析失败", e);
            throw new RuntimeException("图片解析失败: " + e.getMessage());
        }
    }
}
