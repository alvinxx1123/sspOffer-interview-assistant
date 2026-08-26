package com.interview.assistant.capability;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * 概念图谱确定性逻辑：解析 conceptGraphJson / masteryMapJson，
 * 统计概念数量、提取诊断题清单、汇总薄弱概念，供 prompt 注入与前端展示。
 */
@Component
public class MasteryConceptCapability {

    private final ObjectMapper objectMapper = new ObjectMapper();

    /** 统计概念图谱中的概念总数 */
    public int countConcepts(String conceptGraphJson) {
        JsonNode root = safeParse(conceptGraphJson);
        if (root == null) return 0;
        int count = 0;
        for (JsonNode entry : root.path("conceptGraph")) {
            count += entry.path("concepts").size();
        }
        return count;
    }

    /** 从概念图谱中抽出所有诊断题，供前端逐题作答 */
    public List<ProbeItem> extractProbes(String conceptGraphJson) {
        List<ProbeItem> probes = new ArrayList<>();
        JsonNode root = safeParse(conceptGraphJson);
        if (root == null) return probes;
        for (JsonNode entry : root.path("conceptGraph")) {
            String experienceRef = entry.path("experienceRef").asText("");
            for (JsonNode concept : entry.path("concepts")) {
                probes.add(new ProbeItem(
                        concept.path("name").asText(""),
                        concept.path("category").asText(""),
                        concept.path("depthLevel").asText(""),
                        concept.path("whyItMatters").asText(""),
                        concept.path("probeQuestion").asText(""),
                        experienceRef
                ));
            }
        }
        return probes;
    }

    /** 从掌握地图中提取薄弱（shallow+unknown）概念清单，用于后续施压演练 */
    public List<String> extractWeakFocus(String masteryMapJson) {
        List<String> weak = new ArrayList<>();
        JsonNode root = safeParse(masteryMapJson);
        if (root == null) return weak;
        JsonNode focus = root.path("weakFocus");
        if (focus.isArray()) {
            for (JsonNode f : focus) weak.add(f.asText(""));
        }
        if (weak.isEmpty()) {
            for (JsonNode a : root.path("assessments")) {
                String level = a.path("level").asText("");
                if ("shallow".equalsIgnoreCase(level) || "unknown".equalsIgnoreCase(level)) {
                    weak.add(a.path("concept").asText(""));
                }
            }
        }
        return weak;
    }

    /** 把概念图谱压成简短文本，注入到诊断 prompt 里，避免超长 */
    public String summarizeGraph(String conceptGraphJson) {
        StringBuilder sb = new StringBuilder();
        JsonNode root = safeParse(conceptGraphJson);
        if (root == null) return "（概念图谱为空）";
        int idx = 0;
        for (JsonNode entry : root.path("conceptGraph")) {
            String ref = entry.path("experienceRef").asText("");
            for (JsonNode concept : entry.path("concepts")) {
                idx++;
                sb.append(idx).append(". [").append(concept.path("name").asText("")).append("]")
                        .append("(").append(concept.path("category").asText("")).append("/")
                        .append(concept.path("depthLevel").asText("")).append(") ")
                        .append("诊断题: ").append(concept.path("probeQuestion").asText(""));
                if (!ref.isEmpty()) sb.append("  (关联: ").append(truncate(ref, 40)).append(")");
                sb.append('\n');
            }
        }
        return sb.length() == 0 ? "（无概念）" : sb.toString().trim();
    }

    private JsonNode safeParse(String json) {
        if (json == null || json.isBlank()) return null;
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }

    private String truncate(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max) + "...";
    }

    public record ProbeItem(String concept, String category, String depthLevel,
                            String whyItMatters, String probeQuestion, String experienceRef) {}
}
