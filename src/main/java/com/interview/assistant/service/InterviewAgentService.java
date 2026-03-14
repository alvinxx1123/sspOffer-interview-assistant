package com.interview.assistant.service;

import dev.langchain4j.memory.chat.MessageWindowChatMemory;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.service.AiServices;
import dev.langchain4j.service.SystemMessage;
import dev.langchain4j.service.UserMessage;
import dev.langchain4j.service.V;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import com.interview.assistant.config.PromptTemplates;

@Service
public class InterviewAgentService {

    private final ChatLanguageModel chatModel;
    private final ChatLanguageModel questionChatModel;
    private final ChatLanguageModel replayChatModel;
    private final RagService ragService;

    public InterviewAgentService(ChatLanguageModel chatModel,
                                @Qualifier("questionChatModel") ChatLanguageModel questionChatModel,
                                @Qualifier("replayChatModel") ChatLanguageModel replayChatModel,
                                RagService ragService) {
        this.chatModel = chatModel;
        this.questionChatModel = questionChatModel;
        this.replayChatModel = replayChatModel;
        this.ragService = ragService;
    }

    public interface InterviewCoach {
        @SystemMessage("""
            你是一位资深互联网大厂（阿里、腾讯、字节、美团、华为等）的技术面试官，有多年校招/社招面试经验。
            你的提问风格真实模拟一线大厂面试官：会深挖简历、追问细节、考察真实水平，而非泛泛而谈。
            你的提问特点：1. 实习经历：追问具体做了什么、承担的角色、遇到的难点、如何解决、数据/效果如何；2. 项目经历：深挖技术选型原因、架构设计、性能优化、并发/高可用处理、踩过的坑；3. 专业技术：针对简历提到的技术栈追问原理、源码、对比、最佳实践；4. 整体考察：综合能力、技术深度、解决问题的能力、项目落地的真实性。提问要具体、有递进性，能区分「背答案」和「真懂」的候选人。
            输出规则：直接以编号 1. 2. 3. 开头，禁止任何开场白、称呼、总结；每题控制在 50 字以内。顺序与数量：实习 2 题、项目 2-3 题、八股 2-3 题、大模型/算法 1-2 题，题目总数不少于 9 题、建议 9-12 题，覆盖实习、项目、八股、大模型/算法四类，不要只出 5-6 题。不要问简历中未涉及的方向。
            用中文回答。
            """)
        @UserMessage("""
            目标: {{company}} / {{department}}
            
            【参考面经-实习】
            {{context_internship}}
            
            【参考面经-项目】
            {{context_project}}
            
            【参考面经-八股】
            {{context_bagu}}
            
            【参考面经-大模型】
            {{context_llm}}
            
            【参考面经-算法】
            {{context_algorithm}}
            
            【候选人简历】
            {{resume}}
            
            请针对简历中的经历和技术栈出题，不要问简历未涉及的方向。严格按顺序输出：实习 2 题、项目 2-3 题、八股 2-3 题、大模型/算法 1-2 题，总题数不少于 9 题、建议 9-12 题，确保四类都有覆盖，不要只出 5-6 题。
            重要：即使【参考面经-八股】或【参考面经-大模型】为「暂无相关面经数据」，也必须根据简历中的技术栈（如 Java、Redis、MySQL、RAG、LangChain 等）至少出 2 道八股题和 1 道大模型/算法相关题，保证题目类型全面。
            """)
        String generateDeepQuestions(@V("company") String company, @V("department") String department,
                                     @V("context_internship") String context_internship, @V("context_project") String context_project,
                                     @V("context_bagu") String context_bagu, @V("context_llm") String context_llm,
                                     @V("context_algorithm") String context_algorithm, @V("resume") String resume);
    }

    public interface ReplayCoach {
        @SystemMessage(PromptTemplates.REPLAY_SYSTEM)
        @UserMessage(PromptTemplates.REPLAY_USER)
        String replay(@V("company") String company, @V("department") String department, @V("content") String content);
    }

    public String generateInterviewQuestions(String company, String department, String resume) {
        String c = company != null && !company.trim().isEmpty() ? company.trim() : null;
        String d = department != null && !department.trim().isEmpty() ? department.trim() : null;
        String query = (c != null ? c + " " : "") + (d != null ? d + " " : "") + "互联网技术面试 八股 项目 实习 大模型 算法";
        Map<String, String> structured = ragService.searchStructuredForDeepQuestions(query, c, d);
        String emptyHint = EMPTY_HINT;
        String ctxInternship = structured.getOrDefault("实习", emptyHint);
        String ctxProject = structured.getOrDefault("项目", emptyHint);
        String ctxBagu = structured.getOrDefault("八股_Java", emptyHint);
        String ctxLlm = structured.getOrDefault("八股_AI", emptyHint);
        String ctxAlgo = structured.getOrDefault("算法", emptyHint);
        String co = c != null ? c : "通用";
        String de = d != null ? d : "技术";
        String resumeText = resume != null && !resume.isBlank() ? resume : "（未提供简历）";

        InterviewCoach coach = AiServices.builder(InterviewCoach.class)
                .chatLanguageModel(questionChatModel)
                .chatMemory(MessageWindowChatMemory.withMaxMessages(10))
                .build();

        return coach.generateDeepQuestions(co, de, ctxInternship, ctxProject, ctxBagu, ctxLlm, ctxAlgo, resumeText);
    }

    private static final String EMPTY_HINT = "暂无相关面经数据。请结合互联网公司常见技术面试知识：八股（Java、Spring、Redis、MySQL、网络、OS、分布式等）、大模型八股（Transformer、RAG、微调、Prompt 等）、项目深挖、系统设计，以及候选人简历生成针对性的深挖问题。";

    /** 带步骤回调的深挖问题生成，用于 SSE 流式展示「链式思考」过程 */
    public String generateInterviewQuestionsWithSteps(String company, String department, String resume,
                                                      java.util.function.Consumer<String> stepCallback) {
        if (stepCallback == null) return generateInterviewQuestions(company, department, resume);
        String c = company != null && !company.trim().isEmpty() ? company.trim() : null;
        String d = department != null && !department.trim().isEmpty() ? department.trim() : null;
        stepCallback.accept("正在按公司/部门检索面经库（实习、项目、八股、大模型、算法）…");
        String query = (c != null ? c + " " : "") + (d != null ? d + " " : "") + "互联网技术面试 八股 项目 实习 大模型 算法";
        Map<String, String> structured = ragService.searchStructuredForDeepQuestions(query, c, d);
        String emptyHint = EMPTY_HINT;
        String ctxInternship = structured.getOrDefault("实习", emptyHint);
        String ctxProject = structured.getOrDefault("项目", emptyHint);
        String ctxBagu = structured.getOrDefault("八股_Java", emptyHint);
        String ctxLlm = structured.getOrDefault("八股_AI", emptyHint);
        String ctxAlgo = structured.getOrDefault("算法", emptyHint);
        stepCallback.accept(buildRetrievalSummary(ctxInternship, ctxProject, ctxBagu, ctxLlm, ctxAlgo, emptyHint));
        stepCallback.accept("正在按「实习→项目→八股→大模型」顺序生成 7–9 道深挖题（结合简历技术栈）…");
        String co = c != null ? c : "通用";
        String de = d != null ? d : "技术";
        String resumeText = resume != null && !resume.isBlank() ? resume : "（未提供简历）";
        InterviewCoach coach = AiServices.builder(InterviewCoach.class)
                .chatLanguageModel(questionChatModel)
                .chatMemory(MessageWindowChatMemory.withMaxMessages(10))
                .build();
        String result = coach.generateDeepQuestions(co, de, ctxInternship, ctxProject, ctxBagu, ctxLlm, ctxAlgo, resumeText);
        stepCallback.accept("生成完成");
        return result;
    }

    private String buildRetrievalSummary(String ctxInternship, String ctxProject, String ctxBagu, String ctxLlm, String ctxAlgo, String emptyHint) {
        String i = (ctxInternship == null || ctxInternship.equals(emptyHint)) ? "暂无" : "有参考";
        String p = (ctxProject == null || ctxProject.equals(emptyHint)) ? "暂无" : "有参考";
        String b = (ctxBagu == null || ctxBagu.equals(emptyHint)) ? "暂无" : "有参考";
        String l = (ctxLlm == null || ctxLlm.equals(emptyHint)) ? "暂无" : "有参考";
        String a = (ctxAlgo == null || ctxAlgo.equals(emptyHint)) ? "暂无" : "有参考";
        return "检索结果：实习 " + i + "、项目 " + p + "、八股 " + b + "、大模型 " + l + "、算法 " + a + "。（暂无时将结合通用考点与简历出题）";
    }

    public String replayInterview(String company, String department, String content) {
        String c = company != null && !company.trim().isEmpty() ? company.trim() : null;
        String d = department != null && !department.trim().isEmpty() ? department.trim() : null;
        String query = (content != null && content.length() > 100)
                ? content.substring(0, Math.min(400, content.length())) + " 面试复盘 考察 八股 项目"
                : (c != null ? c + " " : "") + (d != null ? d + " " : "") + "面试复盘 技术考察 八股 项目";
        List<String> relevant = ragService.search(query, c, d, 5);
        String ragContext = relevant.isEmpty() ? "" : "\n\n【数据库中相关面经参考】\n" + String.join("\n\n---\n\n", relevant.stream()
                .map(t -> t.length() > 600 ? t.substring(0, 600) + "..." : t)
                .collect(Collectors.toList()));
        String fullContent = content + ragContext;
        ReplayCoach coach = AiServices.builder(ReplayCoach.class)
                .chatLanguageModel(replayChatModel)
                .build();
        return coach.replay(c != null ? c : "未知", d != null ? d : "未知", fullContent);
    }

    public String chatWithContext(String query, String company, String department) {
        List<String> relevant = ragService.search(query, company, department, 5);
        String context = relevant.isEmpty() ? "暂无相关数据" : String.join("\n\n", relevant);

        var assistant = AiServices.builder(ChatAssistant.class)
                .chatLanguageModel(chatModel)
                .build();

        return assistant.answer(query, context);
    }

    public interface ChatAssistant {
        @SystemMessage(PromptTemplates.RAG_ANSWER_SYSTEM)
        @UserMessage(PromptTemplates.RAG_ANSWER_USER)
        String answer(@V("query") String query, @V("context") String context);
    }
}
