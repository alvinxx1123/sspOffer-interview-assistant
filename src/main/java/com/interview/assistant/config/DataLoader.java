package com.interview.assistant.config;

import com.interview.assistant.entity.AlgorithmQuestion;
import com.interview.assistant.entity.InterviewExperience;
import com.interview.assistant.repository.AlgorithmQuestionRepository;
import com.interview.assistant.repository.InterviewExperienceRepository;
import com.interview.assistant.service.RagService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
@Profile("!test")
public class DataLoader implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(DataLoader.class);

    private final InterviewExperienceRepository experienceRepository;
    private final AlgorithmQuestionRepository algorithmRepository;
    private final RagService ragService;

    public DataLoader(InterviewExperienceRepository experienceRepository,
                      AlgorithmQuestionRepository algorithmRepository,
                      RagService ragService) {
        this.experienceRepository = experienceRepository;
        this.algorithmRepository = algorithmRepository;
        this.ragService = ragService;
    }

    @Override
    public void run(String... args) {
        loadSampleData();
        reindexRagFromDb();
    }

    /** 启动时从数据库重建 RAG 向量索引（向量在内存，重启后需重新索引） */
    private void reindexRagFromDb() {
        List<InterviewExperience> all = experienceRepository.findAll();
        if (all.isEmpty()) return;
        ragService.indexExperiencesAsync(all);
        log.info("RAG 启动索引: {} 条面经（后台执行中）", all.size());
    }

    private void loadSampleData() {
        if (experienceRepository.count() > 0) return;

        List<InterviewExperience> experiences = List.of(
                createExperience("牛客", "字节跳动", "后端", "校招", "基础架构部",
                        "一面问了项目，Redis缓存设计，MySQL索引优化。二面算法题：两数之和、LRU缓存。三面系统设计：设计短链服务。",
                        "微服务项目，使用Spring Cloud，Redis缓存热点数据", "Redis持久化、MySQL事务隔离级别、JVM内存模型",
                        "Transformer结构、RAG原理、大模型微调方法", "两数之和、LRU缓存、反转链表"),
                createExperience("牛客", "阿里巴巴", "Java开发", "校招", "淘宝",
                        "项目深挖，问了很多细节。算法：手写单例、生产者消费者。八股：HashMap、ConcurrentHashMap、线程池。",
                        "电商秒杀系统设计", "HashMap原理、线程池参数、锁优化",
                        null, "手写单例、生产者消费者"),
                createExperience("小红书", "腾讯", "后端", "实习", "WXG",
                        "一面基础+算法，二面项目，三面HR。算法：二叉树遍历、链表相交。问了很多Go和Java的区别。",
                        "高并发系统开发", "Go协程、Java多线程对比、Redis集群",
                        null, "二叉树中序遍历、链表相交"),
                createExperience("牛客", "美团", "后端", "校招", "到家",
                        "项目问得很细，问到了具体的技术选型原因。算法：快速排序、二分查找变种。八股：Kafka、分布式事务。",
                        "消息队列系统", "Kafka原理、分布式事务、限流熔断",
                        null, "快速排序、二分查找")
        );

        experienceRepository.saveAll(experiences);
        ragService.indexExperiences(experiences);
        log.info("Loaded {} sample interview experiences", experiences.size());

        if (algorithmRepository.count() > 0) return;

        List<AlgorithmQuestion> algorithms = List.of(
                createAlgorithm("两数之和", "给定一个整数数组 nums 和一个整数目标值 target，请你在该数组中找出和为目标值 target 的那两个整数。", "easy", "字节跳动", "后端", 1, "two-sum",
                        "", ""),
                createAlgorithm("LRU 缓存", "请你设计并实现一个满足 LRU (最近最少使用) 缓存约束的数据结构。", "medium", "字节跳动", "后端", 146, "lru-cache",
                        "", null),
                createAlgorithm("反转链表", "给你单链表的头节点 head ，请你反转链表，并返回反转后的链表。", "easy", "腾讯", "后端", 206, "reverse-linked-list",
                        "", null),
                createAlgorithm("二叉树中序遍历", "给定一个二叉树的根节点 root ，返回它的中序遍历结果。", "easy", "腾讯", "后端", 94, "binary-tree-inorder-traversal",
                        "", null)
        );

        algorithmRepository.saveAll(algorithms);
        log.info("Loaded {} sample algorithm questions", algorithms.size());
    }

    private InterviewExperience createExperience(String source, String company, String position, String type, String department,
                                                 String content, String project, String bagu, String llm, String algo) {
        var e = new InterviewExperience();
        e.setSource(source);
        e.setCompany(company);
        e.setDepartment(department);
        e.setPosition(position);
        e.setType(type);
        e.setContent(content);
        e.setProjectExperience(project);
        e.setBaguQuestions(bagu);
        e.setLlmQuestions(llm);
        e.setAlgorithmQuestions(algo);
        return e;
    }

    private AlgorithmQuestion createAlgorithm(String title, String desc, String difficulty, String company, String dept,
                                              Integer leetcodeId, String slug, String defaultCode, String testCases) {
        var a = new AlgorithmQuestion();
        a.setTitle(title);
        a.setDescription(desc);
        a.setDifficulty(difficulty);
        a.setCompany(company);
        a.setDepartment(dept);
        a.setLeetcodeProblemId(leetcodeId);
        a.setLeetcodeSlug(slug);
        a.setDefaultCode(defaultCode);
        a.setTestCases(testCases);
        return a;
    }
}
