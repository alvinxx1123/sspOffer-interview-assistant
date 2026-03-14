package com.interview.assistant.config;

import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.store.embedding.EmbeddingMatch;
import dev.langchain4j.store.embedding.EmbeddingStore;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.stream.Collectors;

/**
 * 支持按 experienceId 移除和 clear 的 In-Memory EmbeddingStore，用于面经按字段分块后的索引。
 */
public class InterviewEmbeddingStore implements EmbeddingStore<TextSegment> {

    private static final String META_EXPERIENCE_ID = "experienceId";

    private final List<Entry> entries = new CopyOnWriteArrayList<>();

    private static class Entry {
        final String id;
        final float[] vector;
        final TextSegment segment;

        Entry(String id, float[] vector, TextSegment segment) {
            this.id = id;
            this.vector = vector;
            this.segment = segment;
        }
    }

    @Override
    public String add(Embedding embedding) {
        String id = UUID.randomUUID().toString();
        entries.add(new Entry(id, embedding.vector(), null));
        return id;
    }

    @Override
    public String add(Embedding embedding, TextSegment segment) {
        String id = UUID.randomUUID().toString();
        entries.add(new Entry(id, embedding.vector(), segment));
        return id;
    }

    @Override
    public void add(String id, Embedding embedding) {
        entries.add(new Entry(id, embedding.vector(), null));
    }

    @Override
    public List<String> addAll(List<Embedding> embeddings) {
        List<String> ids = new ArrayList<>(embeddings.size());
        for (Embedding e : embeddings) {
            ids.add(add(e));
        }
        return ids;
    }

    @Override
    public List<String> addAll(List<Embedding> embeddings, List<TextSegment> segments) {
        if (embeddings.size() != segments.size()) {
            throw new IllegalArgumentException("embeddings and segments size must match");
        }
        List<String> ids = new ArrayList<>(embeddings.size());
        for (int i = 0; i < embeddings.size(); i++) {
            ids.add(add(embeddings.get(i), segments.get(i)));
        }
        return ids;
    }

    @Override
    public void remove(String id) {
        entries.removeIf(e -> e.id.equals(id));
    }

    /** 移除某条面经的所有块，用于该面经重新索引前清理 */
    public void removeByExperienceId(Long experienceId) {
        if (experienceId == null) return;
        String sid = experienceId.toString();
        entries.removeIf(e -> {
            if (e.segment == null || e.segment.metadata() == null) return false;
            Object v = e.segment.metadata().get(META_EXPERIENCE_ID);
            return sid.equals(v != null ? v.toString() : null);
        });
    }

    /** 清空所有向量，用于全量重建索引前 */
    public void clear() {
        entries.clear();
    }

    @Override
    public List<EmbeddingMatch<TextSegment>> findRelevant(Embedding referenceEmbedding, int maxResults, double minScore) {
        float[] ref = referenceEmbedding.vector();
        return entries.stream()
                .map(e -> {
                    double score = cosineScore(ref, e.vector);
                    Embedding emb = new Embedding(e.vector);
                    return new EmbeddingMatch<>(score, e.id, emb, e.segment);
                })
                .filter(m -> m.score() >= minScore)
                .sorted((a, b) -> Double.compare(b.score(), a.score()))
                .limit(maxResults)
                .collect(Collectors.toList());
    }

    private static double cosineScore(float[] a, float[] b) {
        if (a == null || b == null || a.length != b.length) return 0;
        double dot = 0, na = 0, nb = 0;
        for (int i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            na += a[i] * a[i];
            nb += b[i] * b[i];
        }
        if (na == 0 || nb == 0) return 0;
        return dot / (Math.sqrt(na) * Math.sqrt(nb));
    }
}
