package com.interview.assistant.service;

import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.model.output.Response;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Random;

/**
 * 纯 Java 的 EmbeddingModel 测试替身,用于在不依赖 ai.djl.huggingface:tokenizers native
 * 库的前提下跑 RAG 单测。
 *
 * <p>核心特性:
 * <ul>
 *   <li>完全确定性:同一段文本 → 同一向量(基于 SHA-256 种子 + 固定维度 PRNG)</li>
 *   <li>维度 384,与原 AllMiniLM-L6-v2 一致,保持余弦相似度检索行为可对比</li>
 *   <li>词项级 hashing:每个 token 映射到固定伪随机方向并累加,使**词集越相似、向量越接近**,
 *       满足 {@link com.interview.assistant.service.RagService} 内「query 命中已索引段」的语义</li>
 *   <li>无网络、无文件 IO、无 native — Windows / Linux / macOS(Intel 与 Apple Silicon)通用</li>
 * </ul>
 *
 * <p>注意:这不是生产级 embedding 模型,语义精度无法对齐真实模型;它只保证
 * <ol>
 *   <li>{@code embed("相同文本")} 永远返回同一向量 → 索引阶段可重复</li>
 *   <li>词项重叠度越高的两段文本,余弦相似度越高 → 检索阶段 query 能命中索引中含相同关键词的段</li>
 * </ol>
 * 满足 RagServiceTest 当前 2 个用例(field-based chunk + 公司/部门过滤)的语义需求。
 */
public class DeterministicEmbeddingModel implements EmbeddingModel {

    /** 与原 AllMiniLM-L6-v2 输出维度一致,便于保持 RagService 行为可比。 */
    static final int DIMENSION = 384;

    @Override
    public Response<Embedding> embed(String text) {
        return new Response<>(new Embedding(embedToFloats(text)));
    }

    @Override
    public Response<List<Embedding>> embedAll(List<TextSegment> segments) {
        if (segments == null || segments.isEmpty()) {
            return new Response<>(List.of());
        }
        List<Embedding> out = new ArrayList<>(segments.size());
        for (TextSegment seg : segments) {
            String text = seg == null ? "" : seg.text();
            out.add(new Embedding(embedToFloats(text)));
        }
        return new Response<>(out);
    }

    /**
     * 将文本转为 384 维单位向量。
     * <p>算法:对文本做小写化、英文/数字词与连续中文字符分别切词(粗粒度),
     * 每个 token 用 SHA-256 当种子生成一个伪随机方向,累加后做 L2 归一化。
     * 词集相同的两段文本 → 累加方向几乎一致 → 余弦相似度 ≈ 1;词集差异越大,夹角越大。
     */
    static float[] embedToFloats(String text) {
        float[] sum = new float[DIMENSION];
        if (text == null || text.isEmpty()) {
            // 空文本返回零向量
            return sum;
        }
        for (String token : tokenize(text)) {
            float[] dir = pseudoRandomDirection(token);
            for (int i = 0; i < DIMENSION; i++) {
                sum[i] += dir[i];
            }
        }
        // L2 归一化:避免长文本向量范数爆炸
        double norm = 0.0;
        for (float v : sum) {
            norm += (double) v * v;
        }
        norm = Math.sqrt(norm);
        if (norm > 0.0) {
            for (int i = 0; i < DIMENSION; i++) {
                sum[i] = (float) (sum[i] / norm);
            }
        }
        return sum;
    }

    /**
     * 用 token 字符串的 SHA-256 前 8 字节作 long 种子,生成 [-1, 1) 区间的伪随机方向。
     * 同 token 永远同方向,保证累加的稳定性。
     */
    private static float[] pseudoRandomDirection(String token) {
        long seed = stableSeed(token);
        Random r = new Random(seed);
        float[] v = new float[DIMENSION];
        for (int i = 0; i < DIMENSION; i++) {
            v[i] = r.nextFloat() * 2.0f - 1.0f;
        }
        // 归一化单个方向到单位球面,避免长 token 主导
        double n = 0.0;
        for (float f : v) {
            n += (double) f * f;
        }
        n = Math.sqrt(n);
        if (n > 0.0) {
            for (int i = 0; i < DIMENSION; i++) {
                v[i] = (float) (v[i] / n);
            }
        }
        return v;
    }

    /** 基于 SHA-256(token) 前 8 字节构造稳定 long 种子,跨 JVM 跨平台一致。 */
    private static long stableSeed(String token) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(token.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            long seed = 0L;
            for (int i = 0; i < 8; i++) {
                seed = (seed << 8) | (digest[i] & 0xFFL);
            }
            return seed;
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 在标准 JDK 永远可用,理论上不会发生;若发生,降级为 hashCode 保证不抛错
            return (long) token.hashCode();
        }
    }

    /**
     * 粗粒度切词:小写化后,英文/数字串与连续中文字符分别切为 token。
     * 复杂度足够覆盖 RagServiceTest 的中英文混排面经文本,且保证稳定性。
     */
    private static List<String> tokenize(String text) {
        String lower = text.toLowerCase(Locale.ROOT);
        List<String> out = new ArrayList<>();
        StringBuilder buf = new StringBuilder();
        for (int i = 0; i < lower.length(); ) {
            int cp = lower.codePointAt(i);
            int charCount = Character.charCount(cp);
            if (Character.isLetterOrDigit(cp)) {
                buf.appendCodePoint(cp);
            } else {
                if (buf.length() > 0) {
                    out.add(buf.toString());
                    buf.setLength(0);
                }
            }
            i += charCount;
        }
        if (buf.length() > 0) {
            out.add(buf.toString());
        }
        return out;
    }
}
