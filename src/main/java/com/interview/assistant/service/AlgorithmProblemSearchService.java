package com.interview.assistant.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Optional;

/**
 * 可选：联网搜索算法题原题链接（力扣、牛客等）。
 * 支持 searchcans（推荐，注册送 100 次且可选 Bing）、bing（Azure）、serper（Google）。
 */
@Service
public class AlgorithmProblemSearchService {

    private static final String BING_ENDPOINT = "https://api.bing.microsoft.com/v7.0/search";
    private static final String SEARCHCANS_ENDPOINT = "https://www.searchcans.com/api/search";

    private final WebClient webClient;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final boolean enabled;
    private final String provider;
    private final String apiKey;
    private final String serperApiUrl;

    public AlgorithmProblemSearchService(WebClient.Builder webClientBuilder,
                                         @Value("${app.algorithm-search.enabled:false}") boolean enabled,
                                         @Value("${app.algorithm-search.provider:searchcans}") String provider,
                                         @Value("${app.algorithm-search.api-key:}") String apiKey,
                                         @Value("${app.algorithm-search.serper-api-url:https://google.serper.dev/search}") String serperApiUrl) {
        this.webClient = webClientBuilder.build();
        this.enabled = enabled && apiKey != null && !apiKey.isBlank();
        String p = (provider != null) ? provider.trim().toLowerCase() : "";
        this.provider = ("serper".equals(p) || "bing".equals(p)) ? p : "searchcans";
        this.apiKey = apiKey != null ? apiKey.trim() : "";
        this.serperApiUrl = serperApiUrl != null ? serperApiUrl.trim() : "https://google.serper.dev/search";
    }

    /** 是否已启用联网搜索（enabled 且已配置 api-key）。 */
    public boolean isEnabled() {
        return enabled;
    }

    /**
     * 根据题名/关键词联网搜索，返回尽量匹配该题名的力扣/牛客题目页链接。
     * 优先使用 site:leetcode.cn/problems/ 限定到题目路径，并结合标题包含关系，减少误命中（例如「不同路径」命中 3Sum）。
     */
    public Optional<String> searchProblemLink(String keyword) {
        if (!enabled || keyword == null || keyword.isBlank()) return Optional.empty();
        String k = keyword.trim();
        try {
            // 先限定到力扣题目路径，再兜底普通查询；每次都把原始 keyword 传下去，用于结果标题过滤
            Optional<String> link = searchOnce("site:leetcode.cn/problems/ " + k, k);
            if (link.isEmpty()) link = searchOnce("力扣 " + k, k);
            if (link.isEmpty()) link = searchOnce("leetcode " + k, k);
            if (link.isEmpty()) link = searchOnce("leetcode.cn " + k, k);
            return link;
        } catch (WebClientResponseException e) {
            return Optional.empty();
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    private Optional<String> searchOnce(String query, String keyword) {
        if ("serper".equals(provider)) return searchWithSerper(query, keyword);
        if ("bing".equals(provider)) return searchWithBing(query, keyword);
        return searchWithSearchCans(query, keyword);
    }

    private Optional<String> searchWithSearchCans(String query, String keyword) {
        String body = "{\"s\":\"" + escapeJson(query) + "\",\"t\":\"bing\",\"p\":1}";
        String response = webClient.post()
                .uri(SEARCHCANS_ENDPOINT)
                .header("Authorization", "Bearer " + apiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(String.class)
                .block();
        return parseSearchCansLinks(response, keyword);
    }

    /** 解析 searchcans 返回的结果：仅在「标题包含 keyword 且 URL 为题目页」时返回；否则认为未命中。 */
    private Optional<String> parseSearchCansLinks(String json, String keyword) {
        if (json == null || json.isBlank()) return Optional.empty();
        try {
            JsonNode root = objectMapper.readTree(json);
            if (root.has("code") && root.get("code").asInt() != 0) return Optional.empty();
            JsonNode data = root.get("data");
            if (data == null || !data.isArray()) return Optional.empty();
            String k = keyword != null ? keyword.trim() : "";

            // 标题中包含 keyword 且 URL 为题目页 时才认为命中
            for (JsonNode item : data) {
                JsonNode urlNode = item.get("url");
                if (urlNode == null || !urlNode.isTextual()) continue;
                String link = urlNode.asText().split("\\s")[0].trim();
                if (!isProblemLink(link)) continue; // 不是题目页，跳过
                if (k.isEmpty()) return Optional.of(link); // 无关键词时直接返回
                String title = item.hasNonNull("title") ? item.get("title").asText("") : "";
                if (!title.isEmpty() && title.contains(k)) {
                    return Optional.of(link);
                }
            }
            // 没有任何标题匹配 keyword 的题目页，视为未命中
            return Optional.empty();
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    private Optional<String> searchWithSerper(String query, String keyword) {
        String body = webClient.post()
                .uri(serperApiUrl)
                .header("X-API-KEY", apiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"q\":\"" + escapeJson(query) + "\",\"num\":20}")
                .retrieve()
                .bodyToMono(String.class)
                .block();
        return parseSerperLinks(body, keyword);
    }

    private Optional<String> searchWithBing(String query, String keyword) {
        URI uri = UriComponentsBuilder.fromHttpUrl(BING_ENDPOINT)
                .queryParam("q", query)
                .queryParam("count", 20)
                .encode(StandardCharsets.UTF_8)
                .build()
                .toUri();
        String body = webClient.get()
                .uri(uri)
                .header("Ocp-Apim-Subscription-Key", apiKey)
                .retrieve()
                .bodyToMono(String.class)
                .block();
        return parseBingLinks(body, keyword);
    }

    private static String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r");
    }

    /** 解析 serper 返回的结果：仅在标题包含 keyword 且 URL 为题目页 时返回。 */
    private Optional<String> parseSerperLinks(String json, String keyword) {
        if (json == null || json.isBlank()) return Optional.empty();
        try {
            JsonNode root = objectMapper.readTree(json);
            JsonNode organic = root.get("organic");
            if (organic == null || !organic.isArray()) return Optional.empty();
            String k = keyword != null ? keyword.trim() : "";

            // 标题包含 keyword 且 URL 为题目页 时才认为命中
            for (JsonNode item : organic) {
                JsonNode linkNode = item.get("link");
                if (linkNode == null || !linkNode.isTextual()) continue;
                String link = linkNode.asText().split("\\s")[0].trim();
                if (!isProblemLink(link)) continue;
                if (k.isEmpty()) return Optional.of(link);
                String title = item.hasNonNull("title") ? item.get("title").asText("") : "";
                if (!title.isEmpty() && title.contains(k)) {
                    return Optional.of(link);
                }
            }
            return Optional.empty();
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    /** 解析 Bing 返回的结果：仅在标题包含 keyword 且 URL 为题目页 时返回。 */
    private Optional<String> parseBingLinks(String json, String keyword) {
        if (json == null || json.isBlank()) return Optional.empty();
        try {
            JsonNode root = objectMapper.readTree(json);
            JsonNode webPages = root.get("webPages");
            if (webPages == null) return Optional.empty();
            JsonNode value = webPages.get("value");
            if (value == null || !value.isArray()) return Optional.empty();
            String k = keyword != null ? keyword.trim() : "";

            // 标题包含 keyword 且 URL 为题目页 时才认为命中
            for (JsonNode item : value) {
                JsonNode urlNode = item.get("url");
                if (urlNode == null || !urlNode.isTextual()) continue;
                String link = urlNode.asText().split("\\s")[0].trim();
                if (!isProblemLink(link)) continue;
                if (k.isEmpty()) return Optional.of(link);
                String title = item.hasNonNull("name") ? item.get("name").asText("") : "";
                if (!title.isEmpty() && title.contains(k)) {
                    return Optional.of(link);
                }
            }
            return Optional.empty();
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    private static boolean isProblemLink(String link) {
        if (link == null || link.isBlank()) return false;
        // 排除列表页（problemset、tag 等），只认具体题目页 .../problems/xxx/
        if (link.contains("leetcode.cn/problemset") || link.contains("leetcode.com/problemset")) return false;
        if (link.contains("leetcode.cn/problems/") || link.contains("leetcode.com/problems/")) return true;
        if (link.contains("nowcoder.com") && (link.contains("/practice/") || link.contains("/problem") || link.contains("/question"))) return true;
        return false;
    }
}
