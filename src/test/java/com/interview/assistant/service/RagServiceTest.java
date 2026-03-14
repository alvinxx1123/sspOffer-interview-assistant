package com.interview.assistant.service;

import com.interview.assistant.config.InterviewEmbeddingStore;
import com.interview.assistant.entity.InterviewExperience;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.embedding.onnx.allminilml6v2.AllMiniLmL6V2EmbeddingModel;
import dev.langchain4j.store.embedding.EmbeddingStore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 验证「按字段分块 + 结构化检索」RAG 流程：索引后能按类型（实习/项目/八股/算法）返回聚合结果。
 * 不依赖智谱 API，使用本地 AllMiniLM + 内存 Store。
 */
class RagServiceTest {

    private RagService ragService;
    private InterviewEmbeddingStore store;

    @BeforeEach
    void setUp() {
        AllMiniLmL6V2EmbeddingModel embeddingModel = new AllMiniLmL6V2EmbeddingModel();
        store = new InterviewEmbeddingStore();
        ragService = new RagService(embeddingModel, store);
    }

    @Test
    void fieldBasedChunk_and_structuredSearch_returnsByType() {
        InterviewExperience exp1 = new InterviewExperience();
        exp1.setId(1L);
        exp1.setCompany("字节跳动");
        exp1.setDepartment("基础架构");
        exp1.setPosition("后端开发");
        exp1.setContent("基础架构一面，问了很多存储和 Redis。");
        exp1.setSource("牛客");
        exp1.setInternshipExperiences("KV 存储引擎，RocksDB compaction 策略、LSM 读放大优化。");
        exp1.setProjectExperiences("Redis 项目：持久化 RDB/AOF、集群模式。");
        exp1.setBaguQuestions("HashMap、ConcurrentHashMap、线程池、MySQL 索引、TCP。");
        exp1.setLlmQuestions("Transformer 自注意力、RAG 和微调区别。");
        exp1.setAlgorithmQuestions("链表双指针 mid 题。");

        InterviewExperience exp2 = new InterviewExperience();
        exp2.setId(2L);
        exp2.setCompany("字节跳动");
        exp2.setDepartment("基础架构");
        exp2.setPosition("后端");
        exp2.setContent("二面项目深挖+八股。");
        exp2.setSource("牛客");
        exp2.setProjectExperiences("大模型 RAG 检索项目，LangChain。");
        exp2.setBaguQuestions("Redis 和 Memcached 区别、CAP、Raft。");

        ragService.indexExperience(exp1);
        ragService.indexExperience(exp2);

        String query = "字节跳动 基础架构 实习 项目 八股 Java 大模型 算法 面试";
        Map<String, String> structured = ragService.searchStructuredForDeepQuestions(query, "字节跳动", "基础架构");

        assertNotNull(structured);
        assertFalse(structured.isEmpty(), "应返回至少一类面经");

        if (structured.containsKey("实习")) {
            assertTrue(structured.get("实习").contains("RocksDB") || structured.get("实习").contains("实习"),
                    "实习块应包含实习相关内容");
        }
        if (structured.containsKey("项目")) {
            assertTrue(structured.get("项目").contains("Redis") || structured.get("项目").contains("项目") || structured.get("项目").contains("RAG"),
                    "项目块应包含项目相关内容");
        }
        if (structured.containsKey("八股_Java")) {
            assertTrue(structured.get("八股_Java").length() > 0, "八股_Java 应有内容");
        }
        if (structured.containsKey("八股_AI")) {
            assertTrue(structured.get("八股_AI").length() > 0, "八股_AI 应有内容");
        }
        if (structured.containsKey("算法")) {
            assertTrue(structured.get("算法").length() > 0, "算法块应有内容");
        }

        assertTrue(
                structured.containsKey("实习") || structured.containsKey("项目") || structured.containsKey("八股_Java")
                        || structured.containsKey("八股_AI") || structured.containsKey("算法"),
                "至少应命中实习/项目/八股/算法之一"
        );
    }

    @Test
    void search_withCompanyDepartmentFilter_onlyReturnsMatching() {
        InterviewExperience exp = new InterviewExperience();
        exp.setId(10L);
        exp.setCompany("字节跳动");
        exp.setDepartment("基础架构");
        exp.setPosition("后端");
        exp.setContent("字节基础架构面经。");
        exp.setSource("牛客");
        exp.setBaguQuestions("Java HashMap、Redis 持久化。");

        ragService.indexExperience(exp);

        java.util.List<String> bytedance = ragService.search("Java Redis 八股", "字节跳动", "基础架构", 5);
        java.util.List<String> other = ragService.search("Java Redis 八股", "阿里巴巴", "中间件", 5);

        assertFalse(bytedance.isEmpty(), "字节跳动/基础架构 应能检索到");
        assertTrue(other.stream().noneMatch(s -> s.contains("字节")),
                "指定阿里/中间件时不应返回字节的面经（或返回空）");
    }
}
