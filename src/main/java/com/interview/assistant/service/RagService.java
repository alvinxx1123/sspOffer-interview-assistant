package com.interview.assistant.service;

import com.interview.assistant.config.InterviewEmbeddingStore;
import com.interview.assistant.entity.InterviewExperience;
import dev.langchain4j.data.document.Metadata;
import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.store.embedding.EmbeddingMatch;
import dev.langchain4j.store.embedding.EmbeddingStore;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import java.util.regex.Pattern;

/**
 * 面经 RAG：按字段分块（Field-based Chunk）索引，支持按 experienceId 限流与按类型聚合。
 */
@Service
public class RagService {

    private static final Logger log = LoggerFactory.getLogger(RagService.class);
    private static final int MAX_CHARS_PER_CHUNK = 800;
    private static final int MAX_CHUNKS_PER_EXPERIENCE = 2;
    private static final String TYPE_OVERVIEW = "总述";
    private static final String TYPE_INTERNSHIP = "实习";
    private static final String TYPE_PROJECT = "项目";
    private static final String TYPE_BAGU_JAVA = "八股_Java";
    private static final String TYPE_BAGU_AI = "八股_AI";
    private static final String TYPE_ALGORITHM = "算法";

    private final EmbeddingModel embeddingModel;
    private final EmbeddingStore<TextSegment> embeddingStore;

    public RagService(EmbeddingModel embeddingModel, EmbeddingStore<TextSegment> embeddingStore) {
        this.embeddingModel = embeddingModel;
        this.embeddingStore = embeddingStore;
    }

    @PostConstruct
    public void init() {
        log.info("RAG Service initialized (field-based chunk)");
    }

    public void indexExperiences(List<InterviewExperience> experiences) {
        for (InterviewExperience exp : experiences) {
            indexExperience(exp);
        }
    }

    @Async
    public void indexExperiencesAsync(List<InterviewExperience> experiences) {
        try {
            indexExperiences(experiences);
            log.info("RAG 异步索引完成: {} 条", experiences.size());
        } catch (Exception e) {
            log.error("RAG 异步索引失败", e);
        }
    }

    /** 全量重建前清空向量库（用于启动时 reindex） */
    public void clearAll() {
        if (embeddingStore instanceof InterviewEmbeddingStore) {
            ((InterviewEmbeddingStore) embeddingStore).clear();
        }
    }

    public void indexExperience(InterviewExperience exp) {
        if (exp.getId() != null && embeddingStore instanceof InterviewEmbeddingStore) {
            ((InterviewEmbeddingStore) embeddingStore).removeByExperienceId(exp.getId());
        }
        List<ChunkMeta> chunks = buildChunks(exp);
        for (ChunkMeta c : chunks) {
            String text = c.text;
            if (text == null || text.isBlank()) continue;
            if (text.length() > MAX_CHARS_PER_CHUNK) {
                text = text.substring(0, MAX_CHARS_PER_CHUNK) + "...";
            }
            Map<String, String> metaMap = new HashMap<>();
            metaMap.put("experienceId", exp.getId() != null ? exp.getId().toString() : "");
            metaMap.put("company", exp.getCompany() != null ? exp.getCompany() : "");
            if (exp.getDepartment() != null) metaMap.put("department", exp.getDepartment());
            metaMap.put("position", exp.getPosition() != null ? exp.getPosition() : "");
            metaMap.put("type", c.type);
            TextSegment segment = TextSegment.from(text, Metadata.from(metaMap));
            Embedding embedding = embeddingModel.embed(text).content();
            embeddingStore.add(embedding, segment);
        }
    }

    /** 检索：按 company/department 过滤，同一 experienceId 最多取 MAX_CHUNKS_PER_EXPERIENCE 块，再取 top maxResults */
    public List<String> search(String query, String company, String department, int maxResults) {
        java.util.List<String> tokens = tokenize(query);

        // 1) 向量召回（语义）
        Embedding queryEmbedding = embeddingModel.embed(query).content();
        int fetch = Math.max(maxResults * 3, 20);
        java.util.List<EmbeddingMatch<TextSegment>> vecMatches = embeddingStore.findRelevant(queryEmbedding, fetch, 0.4);

        // 2) 关键词召回（补召回，避免纯向量漏掉关键术语）
        java.util.List<TextSegment> all;
        if (embeddingStore instanceof InterviewEmbeddingStore) {
            all = ((InterviewEmbeddingStore) embeddingStore).allSegments();
        } else {
            all = java.util.List.of();
        }
        java.util.List<Hit> keywordHits = new java.util.ArrayList<>();
        if (!tokens.isEmpty() && !all.isEmpty()) {
            for (TextSegment seg : all) {
                double ks = keywordScore(tokens, seg);
                if (ks <= 0) continue;
                // 基础分 + 关键词命中分：让 keyword-only 也能参与候选池
                double score = 0.35 + ks * 0.25;
                keywordHits.add(new Hit(score, seg));
            }
        }

        // 3) 融合与简单 rerank：向量分 + 关键词分
        java.util.Map<TextSegment, Double> merged = new java.util.IdentityHashMap<>();
        for (EmbeddingMatch<TextSegment> m : vecMatches) {
            TextSegment seg = m.embedded();
            if (seg == null) continue;
            double score = m.score() + keywordScore(tokens, seg) * 0.25;
            merged.put(seg, Math.max(merged.getOrDefault(seg, 0.0), score));
        }
        for (Hit h : keywordHits) {
            TextSegment seg = h.seg();
            if (seg == null) continue;
            merged.put(seg, Math.max(merged.getOrDefault(seg, 0.0), h.score()));
        }

        java.util.List<java.util.Map.Entry<TextSegment, Double>> candidates = new java.util.ArrayList<>(merged.entrySet());
        candidates.sort((a, b) -> Double.compare(b.getValue(), a.getValue()));

        // 4) 过滤（公司/部门）+ 同一面经限流
        java.util.Map<Long, Integer> expCount = new java.util.LinkedHashMap<>();
        java.util.List<String> result = new java.util.ArrayList<>();
        for (var e : candidates) {
            TextSegment seg = e.getKey();
            if (seg == null || seg.metadata() == null) continue;
            if (company != null && !company.isEmpty()) {
                Object c = seg.metadata().get("company");
                if (c == null || !company.equals(c.toString())) continue;
            }
            if (department != null && !department.isEmpty()) {
                Object d = seg.metadata().get("department");
                if (d == null || !department.equals(d.toString())) continue;
            }
            String eid = seg.metadata().get("experienceId") != null ? seg.metadata().get("experienceId").toString() : null;
            Long expId = (eid != null && !eid.isEmpty()) ? Long.parseLong(eid) : 0L;
            int cnt = expCount.getOrDefault(expId, 0);
            if (cnt >= MAX_CHUNKS_PER_EXPERIENCE) continue;
            expCount.put(expId, cnt + 1);
            result.add(seg.text());
            if (result.size() >= maxResults) break;
        }
        return result;
    }

    public List<String> search(String query, int maxResults) {
        return search(query, null, null, maxResults);
    }

    /**
     * 结构化检索：按类型分组，用于深挖问题生成时拼【参考面经-实习】等。
     * 同一 experienceId 最多 2 块，再按 type 聚合为 Map<type, List<text>>。
     */
    public Map<String, String> searchStructuredForDeepQuestions(String query, String company, String department) {
        java.util.List<String> tokens = tokenize(query);
        Embedding queryEmbedding = embeddingModel.embed(query).content();
        java.util.List<EmbeddingMatch<TextSegment>> vecMatches = embeddingStore.findRelevant(queryEmbedding, 25, 0.4);

        java.util.List<TextSegment> all;
        if (embeddingStore instanceof InterviewEmbeddingStore) {
            all = ((InterviewEmbeddingStore) embeddingStore).allSegments();
        } else {
            all = java.util.List.of();
        }
        java.util.List<Hit> keywordHits = new java.util.ArrayList<>();
        if (!tokens.isEmpty() && !all.isEmpty()) {
            for (TextSegment seg : all) {
                double ks = keywordScore(tokens, seg);
                if (ks <= 0) continue;
                keywordHits.add(new Hit(0.35 + ks * 0.25, seg));
            }
        }

        java.util.Map<TextSegment, Double> merged = new java.util.IdentityHashMap<>();
        for (EmbeddingMatch<TextSegment> m2 : vecMatches) {
            TextSegment seg = m2.embedded();
            if (seg == null) continue;
            merged.put(seg, Math.max(merged.getOrDefault(seg, 0.0), m2.score() + keywordScore(tokens, seg) * 0.25));
        }
        for (Hit h : keywordHits) {
            TextSegment seg = h.seg();
            if (seg == null) continue;
            merged.put(seg, Math.max(merged.getOrDefault(seg, 0.0), h.score()));
        }

        java.util.List<java.util.Map.Entry<TextSegment, Double>> candidates = new java.util.ArrayList<>(merged.entrySet());
        candidates.sort((a, b) -> Double.compare(b.getValue(), a.getValue()));

        java.util.Map<Long, java.util.List<Hit>> byExp = new java.util.LinkedHashMap<>();
        for (var e : candidates) {
            TextSegment seg = e.getKey();
            if (seg == null || seg.metadata() == null) continue;
            if (company != null && !company.isEmpty()) {
                Object c = seg.metadata().get("company");
                if (c == null || !company.equals(c.toString())) continue;
            }
            if (department != null && !department.isEmpty()) {
                Object d = seg.metadata().get("department");
                if (d == null || !department.equals(d.toString())) continue;
            }
            String eid = seg.metadata().get("experienceId") != null ? seg.metadata().get("experienceId").toString() : null;
            Long expId = eid != null && !eid.isEmpty() ? Long.parseLong(eid) : 0L;
            byExp.computeIfAbsent(expId, k -> new java.util.ArrayList<>()).add(new Hit(e.getValue(), seg));
        }

        java.util.Map<String, java.util.List<String>> byType = new java.util.LinkedHashMap<>();
        for (java.util.List<Hit> list : byExp.values()) {
            list.stream()
                    .sorted((a, b) -> Double.compare(b.score(), a.score()))
                    .limit(MAX_CHUNKS_PER_EXPERIENCE)
                    .forEach(h -> {
                        TextSegment seg = h.seg();
                        String type = seg.metadata().get("type") != null ? seg.metadata().get("type").toString() : TYPE_OVERVIEW;
                        byType.computeIfAbsent(type, k -> new java.util.ArrayList<>()).add(seg.text());
                    });
        }
        Map<String, String> out = new LinkedHashMap<>();
        for (String type : java.util.List.of(TYPE_INTERNSHIP, TYPE_PROJECT, TYPE_BAGU_JAVA, TYPE_BAGU_AI, TYPE_ALGORITHM, TYPE_OVERVIEW)) {
            java.util.List<String> texts = byType.get(type);
            if (texts != null && !texts.isEmpty()) {
                String joined = String.join("\n\n---\n\n", texts.stream().map(t -> t.length() > 600 ? t.substring(0, 600) + "..." : t).toList());
                out.put(type, joined);
            }
        }
        return out;
    }

    private List<ChunkMeta> buildChunks(InterviewExperience exp) {
        List<ChunkMeta> list = new ArrayList<>();
        String company = exp.getCompany() != null ? exp.getCompany() : "";
        String dept = exp.getDepartment() != null ? exp.getDepartment() : "";
        String pos = exp.getPosition() != null ? exp.getPosition() : "";

        String overview = "公司: " + company + "\n部门: " + dept + "\n岗位: " + pos + "\n内容: " + (exp.getContent() != null ? exp.getContent() : "");
        if (!overview.isBlank()) list.add(new ChunkMeta(overview, TYPE_OVERVIEW));

        if (exp.getInternshipExperiences() != null && !exp.getInternshipExperiences().isBlank())
            list.add(new ChunkMeta("公司: " + company + "\n部门: " + dept + "\n实习经历: " + exp.getInternshipExperiences(), TYPE_INTERNSHIP));
        if (exp.getProjectExperiences() != null && !exp.getProjectExperiences().isBlank())
            list.add(new ChunkMeta("公司: " + company + "\n部门: " + dept + "\n项目经历: " + exp.getProjectExperiences(), TYPE_PROJECT));
        if (exp.getProjectExperience() != null && !exp.getProjectExperience().isBlank())
            list.add(new ChunkMeta("公司: " + company + "\n部门: " + dept + "\n项目经历: " + exp.getProjectExperience(), TYPE_PROJECT));
        if (exp.getBaguQuestions() != null && !exp.getBaguQuestions().isBlank())
            list.add(new ChunkMeta("公司: " + company + "\n部门: " + dept + "\n八股: " + exp.getBaguQuestions(), TYPE_BAGU_JAVA));
        if (exp.getLlmQuestions() != null && !exp.getLlmQuestions().isBlank())
            list.add(new ChunkMeta("公司: " + company + "\n部门: " + dept + "\n大模型八股: " + exp.getLlmQuestions(), TYPE_BAGU_AI));
        if (exp.getAlgorithmQuestions() != null && !exp.getAlgorithmQuestions().isBlank()) {
            String algo = "公司: " + company + "\n部门: " + dept + "\n算法题: " + exp.getAlgorithmQuestions();
            if (exp.getAlgorithmLink() != null && !exp.getAlgorithmLink().isBlank()) algo += "\n算法原题链接: " + exp.getAlgorithmLink();
            list.add(new ChunkMeta(algo, TYPE_ALGORITHM));
        }
        return list;
    }



    // --------- 多路召回 + 简单 rerank（向量 + 关键词） ---------

    private List<String> tokenize(String q) {
        if (q == null) return java.util.List.of();
        String cleaned = q.replaceAll("\\s+", " ").trim();
        if (cleaned.isEmpty()) return java.util.List.of();
        // 简单切分：按空白和常见符号切；中文保留为整体词块（更高级可做分词）
        String[] parts = cleaned.split("[\\s,，;；/|]+");
        java.util.List<String> out = new java.util.ArrayList<>();
        for (String p : parts) {
            String t = p.trim();
            if (t.length() >= 2) out.add(t);
        }
        return out;
    }

    private double keywordScore(java.util.List<String> tokens, TextSegment seg) {
        if (tokens == null || tokens.isEmpty() || seg == null) return 0;
        String text = seg.text() != null ? seg.text() : "";
        String company = seg.metadata() != null && seg.metadata().get("company") != null ? seg.metadata().get("company").toString() : "";
        String dept = seg.metadata() != null && seg.metadata().get("department") != null ? seg.metadata().get("department").toString() : "";
        String type = seg.metadata() != null && seg.metadata().get("type") != null ? seg.metadata().get("type").toString() : "";
        String hay = (company + " " + dept + " " + type + " " + text).toLowerCase();
        int hit = 0;
        for (String t : tokens) {
            if (t == null || t.isBlank()) continue;
            String k = t.toLowerCase();
            if (hay.contains(k)) hit++;
        }
        // 0~1 的简单归一化
        return tokens.isEmpty() ? 0 : (double) hit / (double) tokens.size();
    }

    private record Hit(double score, TextSegment seg) {}
    private static class ChunkMeta {
        final String text;
        final String type;

        ChunkMeta(String text, String type) {
            this.text = text;
            this.type = type;
        }
    }
}
