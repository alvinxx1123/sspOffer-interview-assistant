package com.interview.assistant.service;

import com.interview.assistant.entity.InterviewExperience;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.store.embedding.EmbeddingMatch;
import dev.langchain4j.store.embedding.EmbeddingStore;
import jakarta.annotation.PostConstruct;
import dev.langchain4j.data.document.Metadata;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

@Service
public class RagService {

    private static final Logger log = LoggerFactory.getLogger(RagService.class);

    private final EmbeddingModel embeddingModel;
    private final EmbeddingStore<TextSegment> embeddingStore;

    public RagService(EmbeddingModel embeddingModel, EmbeddingStore<TextSegment> embeddingStore) {
        this.embeddingModel = embeddingModel;
        this.embeddingStore = embeddingStore;
    }

    @PostConstruct
    public void init() {
        log.info("RAG Service initialized with embedding store");
    }

    public void indexExperiences(List<InterviewExperience> experiences) {
        for (InterviewExperience exp : experiences) {
            indexExperience(exp);
        }
    }

    /** 异步索引，避免上传接口超时 502 */
    @Async
    public void indexExperiencesAsync(List<InterviewExperience> experiences) {
        try {
            indexExperiences(experiences);
            log.info("RAG 异步索引完成: {} 条", experiences.size());
        } catch (Exception e) {
            log.error("RAG 异步索引失败", e);
        }
    }

    public void indexExperience(InterviewExperience exp) {
        String text = buildSearchableText(exp);
        TextSegment segment = TextSegment.from(text, toMetadata(exp));
        var embedding = embeddingModel.embed(text).content();
        embeddingStore.add(embedding, segment);
    }

    public List<String> search(String query, String company, String department, int maxResults) {
        var queryEmbedding = embeddingModel.embed(query).content();
        List<EmbeddingMatch<TextSegment>> matches = embeddingStore.findRelevant(queryEmbedding, maxResults * 2, 0.5);

        return matches.stream()
                .map(m -> m.embedded().text())
                .filter(text -> {
                    if (company != null && !company.isEmpty() && !text.contains("公司: " + company)) return false;
                    if (department != null && !department.isEmpty() && !text.contains("部门: " + department)) return false;
                    return true;
                })
                .limit(maxResults)
                .collect(Collectors.toList());
    }

    public List<String> search(String query, int maxResults) {
        return search(query, null, null, maxResults);
    }

    private String buildSearchableText(InterviewExperience exp) {
        StringBuilder sb = new StringBuilder();
        sb.append("公司: ").append(exp.getCompany()).append("\n");
        if (exp.getDepartment() != null) sb.append("部门: ").append(exp.getDepartment()).append("\n");
        sb.append("岗位: ").append(exp.getPosition()).append("\n");
        sb.append("内容: ").append(exp.getContent());
        if (exp.getInternshipExperiences() != null) sb.append("\n实习经历: ").append(exp.getInternshipExperiences());
        if (exp.getProjectExperiences() != null) sb.append("\n项目经历: ").append(exp.getProjectExperiences());
        if (exp.getProjectExperience() != null) sb.append("\n项目经历: ").append(exp.getProjectExperience());
        if (exp.getBaguQuestions() != null) sb.append("\n八股: ").append(exp.getBaguQuestions());
        if (exp.getLlmQuestions() != null) sb.append("\n大模型八股: ").append(exp.getLlmQuestions());
        if (exp.getAlgorithmQuestions() != null) sb.append("\n算法题: ").append(exp.getAlgorithmQuestions());
        if (exp.getAlgorithmLink() != null) sb.append("\n算法原题链接: ").append(exp.getAlgorithmLink());
        return sb.toString();
    }

    private Metadata toMetadata(InterviewExperience exp) {
        var map = new java.util.HashMap<String, String>();
        map.put("company", exp.getCompany());
        if (exp.getDepartment() != null) map.put("department", exp.getDepartment());
        map.put("position", exp.getPosition());
        return Metadata.from(map);
    }
}
