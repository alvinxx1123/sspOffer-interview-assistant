package com.interview.assistant.config;

import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.model.output.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 智谱 Embedding API（embedding-2）适配 LangChain4j EmbeddingModel。
 * 配置 zhipu.apiKey 后生效；可与 AllMiniLM 通过 AppConfig 条件 Bean 切换。
 */
public class ZhipuEmbeddingModel implements EmbeddingModel {

    private static final Logger log = LoggerFactory.getLogger(ZhipuEmbeddingModel.class);
    private static final String DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
    private static final String DEFAULT_MODEL = "embedding-2";

    private final String apiKey;
    private final String baseUrl;
    private final String model;
    private final WebClient webClient;

    public ZhipuEmbeddingModel(
            @Value("${zhipu.apiKey:}") String apiKey,
            @Value("${zhipu.embedding.base-url:}") String baseUrl,
            @Value("${zhipu.embedding.model:embedding-2}") String model,
            WebClient.Builder webClientBuilder) {
        this.apiKey = apiKey != null && !apiKey.isBlank() ? apiKey : System.getenv("ZHIPU_API_KEY");
        this.baseUrl = (baseUrl != null && !baseUrl.isBlank()) ? baseUrl : DEFAULT_BASE_URL;
        this.model = (model != null && !model.isBlank()) ? model : DEFAULT_MODEL;
        this.webClient = webClientBuilder
                .baseUrl(this.baseUrl)
                .build();
    }

    @Override
    public Response<Embedding> embed(String text) {
        List<Embedding> list = embedStrings(List.of(text));
        return new Response<>(list.isEmpty() ? null : list.get(0));
    }

    @Override
    public Response<List<Embedding>> embedAll(List<TextSegment> segments) {
        if (segments == null || segments.isEmpty()) {
            return new Response<>(List.of());
        }
        List<String> texts = segments.stream()
                .map(TextSegment::text)
                .toList();
        List<Embedding> embeddings = embedStrings(texts);
        return new Response<>(embeddings);
    }

    private List<Embedding> embedStrings(List<String> texts) {
        if (apiKey == null || apiKey.isBlank()) {
            throw new IllegalStateException("智谱 API Key 未配置，无法调用 Embedding。请设置 ZHIPU_API_KEY 或 zhipu.apiKey");
        }
        if (texts == null || texts.isEmpty()) {
            return List.of();
        }
        Map<String, Object> body = Map.of(
                "model", model,
                "input", texts.size() == 1 ? texts.get(0) : texts
        );
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> res = webClient.post()
                    .uri("/embeddings")
                    .header("Authorization", "Bearer " + apiKey)
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block(Duration.ofSeconds(30));
            if (res == null || !res.containsKey("data")) return List.of();
            List<Map<String, Object>> data = (List<Map<String, Object>>) res.get("data");
            if (data == null) return List.of();
            return data.stream()
                    .sorted((a, b) -> Integer.compare(getIndex(a), getIndex(b)))
                    .map(m -> {
                        @SuppressWarnings("unchecked")
                        List<Double> vec = (List<Double>) m.get("embedding");
                        if (vec == null) return null;
                        float[] floats = new float[vec.size()];
                        for (int i = 0; i < vec.size(); i++) floats[i] = vec.get(i).floatValue();
                        return new Embedding(floats);
                    })
                    .filter(e -> e != null)
                    .collect(Collectors.toList());
        } catch (Exception e) {
            log.error("Zhipu Embedding 调用失败", e);
            throw new RuntimeException("Embedding 调用失败: " + e.getMessage());
        }
    }

    private static int getIndex(Map<String, Object> item) {
        Object idx = item.get("index");
        if (idx instanceof Number) return ((Number) idx).intValue();
        return 0;
    }
}
