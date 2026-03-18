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
    private static final String ZHIPU_VISION_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

    @Value("${zhipu.apiKey:}")
    private String apiKey;

    @Value("${zhipu.visionModel:glm-4v-plus}")
    private String visionModel;

    @Value("${zhipu.visionFallbackModels:glm-4.6v}")
    private String visionFallbackModels;

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
            PreparedImage preparedImage = prepareImageForVision(file);
            String dataUrl = "data:" + preparedImage.mimeType() + ";base64," +
                    Base64.getEncoder().encodeToString(preparedImage.bytes());

            RuntimeException lastError = null;
            for (String modelName : buildVisionModelCandidates()) {
                try {
                    Map<String, Object> body = new HashMap<>();
                    body.put("model", modelName);
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
