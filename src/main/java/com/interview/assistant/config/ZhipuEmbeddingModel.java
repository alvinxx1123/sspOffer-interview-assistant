package com.interview.assistant.config;

import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.model.output.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 智谱/OpenAI 兼容 Embedding 适配 LangChain4j EmbeddingModel。
 * 通过 ModelConfigHolder 读取 apiKey/baseUrl/model，支持运行时切换。
 * baseUrl 默认智谱，也可指向其他 OpenAI 兼容 embedding 端点。
 */
public class ZhipuEmbeddingModel implements EmbeddingModel {

    private static final Logger log = LoggerFactory.getLogger(ZhipuEmbeddingModel.class);
    private static final int MAX_RETRY = 3;

    private final ModelConfigHolder holder;
    private final WebClient.Builder webClientBuilder;

    private volatile WebClient webClient;
    private volatile String webClientBaseUrl = "";

    public ZhipuEmbeddingModel(ModelConfigHolder holder, WebClient.Builder webClientBuilder) {
        this.holder = holder;
        this.webClientBuilder = webClientBuilder;
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
        List<String> texts = segments.stream().map(TextSegment::text).toList();
        return new Response<>(embedStrings(texts));
    }

    private List<Embedding> embedStrings(List<String> texts) {
        if (!holder.isEmbeddingConfigured()) {
            throw new IllegalStateException("Embedding API Key 未配置。请设置环境变量 EMBEDDING_API_KEY（或 ZHIPU_API_KEY），或在前端「设置」页填入。");
        }
        if (texts == null || texts.isEmpty()) return List.of();
        Exception last = null;
        for (int attempt = 0; attempt <= MAX_RETRY; attempt++) {
            try {
                return doRequest(texts);
            } catch (WebClientResponseException.TooManyRequests e) {
                last = e;
                if (attempt == MAX_RETRY) break;
                sleepBackoff(attempt, "429 限流");
            } catch (WebClientResponseException e) {
                int status = e.getStatusCode().value();
                if (status >= 500 && attempt < MAX_RETRY) {
                    last = e;
                    sleepBackoff(attempt, status + " 服务端错误");
                } else {
                    log.error("Embedding 调用失败 (status={})", status, e);
                    throw new RuntimeException("Embedding 调用失败: " + e.getMessage(), e);
                }
            } catch (Exception e) {
                log.error("Embedding 调用失败", e);
                throw new RuntimeException("Embedding 调用失败: " + e.getMessage(), e);
            }
        }
        throw new RuntimeException("Embedding 调用失败(重试耗尽): " + (last != null ? last.getMessage() : "unknown"), last);
    }

    @SuppressWarnings("unchecked")
    private List<Embedding> doRequest(List<String> texts) {
        String baseUrl = holder.getEmbeddingBaseUrl();
        if (!baseUrl.equals(webClientBaseUrl)) {
            webClient = webClientBuilder.baseUrl(baseUrl).build();
            webClientBaseUrl = baseUrl;
        }
        String model = holder.getEmbeddingModel();
        Map<String, Object> body = Map.of("model", model, "input", texts.size() == 1 ? texts.get(0) : texts);
        Map<String, Object> res = webClient.post()
                .uri("/embeddings")
                .header("Authorization", "Bearer " + holder.getEmbeddingApiKey())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(Map.class)
                .block();
        if (res == null) throw new RuntimeException("Embedding 返回为空");
        List<Map<String, Object>> data = (List<Map<String, Object>>) res.get("data");
        if (data == null || data.isEmpty()) throw new RuntimeException("Embedding 返回无 data");
        if (texts.size() > 1 && data.size() != texts.size()) {
            throw new IllegalStateException("批量返回数量不匹配: input=" + texts.size() + ", data=" + data.size());
        }
        return data.stream()
                .sorted((a, b) -> Integer.compare(getIndex(a), getIndex(b)))
                .map(m -> {
                    List<Double> vec = (List<Double>) m.get("embedding");
                    if (vec == null) return null;
                    float[] floats = new float[vec.size()];
                    for (int i = 0; i < vec.size(); i++) floats[i] = vec.get(i).floatValue();
                    return new Embedding(floats);
                })
                .filter(e -> e != null)
                .collect(Collectors.toList());
    }

    private void sleepBackoff(int attempt, String reason) {
        long backoff = (long) (1000L * Math.pow(2, attempt));
        log.warn("Embedding {}，{}ms 后重试（第{}次）", reason, backoff, attempt + 1);
        try { Thread.sleep(backoff); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
    }

    private static int getIndex(Map<String, Object> item) {
        Object idx = item.get("index");
        return idx instanceof Number ? ((Number) idx).intValue() : 0;
    }
}
