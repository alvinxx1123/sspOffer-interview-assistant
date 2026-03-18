package com.interview.assistant.service;

import dev.langchain4j.memory.chat.MessageWindowChatMemory;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.model.chat.StreamingChatLanguageModel;
import dev.langchain4j.model.StreamingResponseHandler;
import dev.langchain4j.service.AiServices;
import dev.langchain4j.service.SystemMessage;
import dev.langchain4j.service.UserMessage;
import dev.langchain4j.service.V;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.ArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Collectors;

import com.interview.assistant.config.PromptTemplates;
import com.interview.assistant.capability.ResumeGroundingCapability;

@Service
public class InterviewAgentService {

    private final ChatLanguageModel chatModel;
    private final ChatLanguageModel questionChatModel;
    private final StreamingChatLanguageModel questionStreamingChatModel;
    private final ChatLanguageModel replayChatModel;
    private final RagService ragService;
    private final ResumeGroundingCapability resumeGroundingCapability;
    private final SkillPackService skillPackService;

    private static final String INTERVIEW_COACH_SYSTEM_PROMPT = """
            你是一位资深互联网大厂（阿里、腾讯、字节、美团、华为等）的技术面试官，有多年校招/社招面试经验。
            你的提问风格真实模拟一线大厂面试官：会深挖简历、追问细节、考察真实水平，而非泛泛而谈。
            你的提问特点：1. 实习经历：追问具体做了什么、承担的角色、遇到的难点、如何解决、数据/效果如何；2. 项目经历：深挖技术选型原因、架构设计、性能优化、并发/高可用处理、踩过的坑；3. 专业技术：针对简历提到的技术栈追问原理、源码、对比、最佳实践；4. 整体考察：综合能力、技术深度、解决问题的能力、项目落地的真实性。提问要具体、有递进性，能区分「背答案」和「真懂」的候选人。
            输出规则：直接以编号 1. 2. 3. 开头，禁止任何开场白、称呼、总结；每题控制在 50 字以内。顺序与数量：实习 2 题、项目 2-3 题、八股 2-3 题、大模型/算法 1-2 题，题目总数不少于 9 题、建议 9-12 题，覆盖实习、项目、八股、大模型/算法四类，不要只出 5-6 题。不要问简历中未涉及的方向。
            用中文回答。
            """;

    private static final String INTERVIEW_COACH_USER_PROMPT = """
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

            【候选人画像摘要】
            {{resume_profile}}

            【出题补充规则】
            {{question_skill}}

            请针对简历中的经历和技术栈出题，不要问简历未涉及的方向。严格按顺序输出：实习 2 题、项目 2-3 题、八股 2-3 题、大模型/算法 1-2 题，总题数不少于 9 题、建议 9-12 题，确保四类都有覆盖，不要只出 5-6 题。
            重要：即使【参考面经-八股】或【参考面经-大模型】为「暂无相关面经数据」，也必须根据简历中的技术栈（如 Java、Redis、MySQL、RAG、LangChain 等）至少出 2 道八股题和 1 道大模型/算法相关题，保证题目类型全面。
            """;

    public InterviewAgentService(ChatLanguageModel chatModel,
                                @Qualifier("questionChatModel") ChatLanguageModel questionChatModel,
                                @Qualifier("questionStreamingChatModel") StreamingChatLanguageModel questionStreamingChatModel,
                                @Qualifier("replayChatModel") ChatLanguageModel replayChatModel,
                                RagService ragService,
                                ResumeGroundingCapability resumeGroundingCapability,
                                SkillPackService skillPackService) {
        this.chatModel = chatModel;
        this.questionChatModel = questionChatModel;
        this.questionStreamingChatModel = questionStreamingChatModel;
        this.replayChatModel = replayChatModel;
        this.ragService = ragService;
        this.resumeGroundingCapability = resumeGroundingCapability;
        this.skillPackService = skillPackService;
    }

    public interface InterviewCoach {
        @SystemMessage(INTERVIEW_COACH_SYSTEM_PROMPT)
        @UserMessage(INTERVIEW_COACH_USER_PROMPT)
        String generateDeepQuestions(@V("company") String company, @V("department") String department,
                                     @V("context_internship") String context_internship, @V("context_project") String context_project,
                                     @V("context_bagu") String context_bagu, @V("context_llm") String context_llm,
                                     @V("context_algorithm") String context_algorithm, @V("resume") String resume,
                                     @V("resume_profile") String resume_profile, @V("question_skill") String question_skill);
    }

    public interface ReplayCoach {
        @SystemMessage(PromptTemplates.REPLAY_SYSTEM)
        @UserMessage(PromptTemplates.REPLAY_USER)
        String replay(@V("company") String company, @V("department") String department, @V("content") String content);
    }

    public String generateInterviewQuestions(String company, String department, String resume) {
        String c = company != null && !company.trim().isEmpty() ? company.trim() : null;
        String d = department != null && !department.trim().isEmpty() ? department.trim() : null;
        String resumeProfile = resumeGroundingCapability.buildCandidateProfile(resume);
        String resumeTerms = resumeGroundingCapability.buildSearchTerms(resume);
        String questionSkill = skillPackService.getPromptAddendum("resume-grounding-skill");
        String query = (c != null ? c + " " : "") + (d != null ? d + " " : "") + "互联网技术面试 八股 项目 实习 大模型 算法 " + resumeTerms;
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

        return coach.generateDeepQuestions(co, de, ctxInternship, ctxProject, ctxBagu, ctxLlm, ctxAlgo, resumeText, resumeProfile, questionSkill);
    }

    private static final String EMPTY_HINT = "暂无相关面经数据。请结合互联网公司常见技术面试知识：八股（Java、Spring、Redis、MySQL、网络、OS、分布式等）、大模型八股（Transformer、RAG、微调、Prompt 等）、项目深挖、系统设计，以及候选人简历生成针对性的深挖问题。";

    public record QuestionGenerationStep(String stage, String title, String detail, String status) {}

    public record QuestionStreamCallbacks(
            java.util.function.Consumer<QuestionGenerationStep> onStep,
            java.util.function.Consumer<String> onDelta
    ) {}

    /** 带步骤回调的深挖问题生成，用于 SSE 流式展示「链式思考」过程 */
    public String generateInterviewQuestionsWithSteps(String company, String department, String resume,
                                                      java.util.function.Consumer<String> stepCallback) {
        return generateInterviewQuestionsStreaming(company, department, resume,
                new QuestionStreamCallbacks(
                        step -> {
                            if (stepCallback != null) {
                                stepCallback.accept(step.title() + "：" + step.detail());
                            }
                        },
                        null
                ));
    }

    public String generateInterviewQuestionsStreaming(String company, String department, String resume, QuestionStreamCallbacks callbacks) {
        String c = company != null && !company.trim().isEmpty() ? company.trim() : null;
        String d = department != null && !department.trim().isEmpty() ? department.trim() : null;
        emitStep(callbacks, "prepare", "in_progress", "初始化上下文", "正在整理目标公司、部门与简历信息。");
        String resumeProfile = resumeGroundingCapability.buildCandidateProfile(resume);
        String resumeTerms = resumeGroundingCapability.buildSearchTerms(resume);
        String questionSkill = skillPackService.getPromptAddendum("resume-grounding-skill");
        emitStep(callbacks, "resume", "completed", "简历画像提取", summarizeResumeProfile(resumeProfile, resumeTerms));

        String query = (c != null ? c + " " : "") + (d != null ? d + " " : "") + "互联网技术面试 八股 项目 实习 大模型 算法 " + resumeTerms;
        emitStep(callbacks, "retrieval", "in_progress", "构建检索查询", "已组合公司/部门、岗位方向与简历技术关键词，准备召回相关面经。");
        Map<String, String> structured = ragService.searchStructuredForDeepQuestions(query, c, d);
        String emptyHint = EMPTY_HINT;
        String ctxInternship = structured.getOrDefault("实习", emptyHint);
        String ctxProject = structured.getOrDefault("项目", emptyHint);
        String ctxBagu = structured.getOrDefault("八股_Java", emptyHint);
        String ctxLlm = structured.getOrDefault("八股_AI", emptyHint);
        String ctxAlgo = structured.getOrDefault("算法", emptyHint);
        emitRetrievalSteps(callbacks, ctxInternship, ctxProject, ctxBagu, ctxLlm, ctxAlgo, emptyHint);
        emitStep(callbacks, "planning", "completed", "题型规划", "将按“实习 → 项目 → Java 八股 → AI/Agent/LLM/算法”顺序平衡题量，优先围绕简历中出现的技术栈深挖。");

        String co = c != null ? c : "通用";
        String de = d != null ? d : "技术";
        String resumeText = resume != null && !resume.isBlank() ? resume : "（未提供简历）";
        List<ChatMessage> messages = new ArrayList<>();
        messages.add(dev.langchain4j.data.message.SystemMessage.from(INTERVIEW_COACH_SYSTEM_PROMPT));
        messages.add(dev.langchain4j.data.message.UserMessage.from(buildDeepQuestionUserPrompt(
                co, de, ctxInternship, ctxProject, ctxBagu, ctxLlm, ctxAlgo, resumeText, resumeProfile, questionSkill
        )));

        emitStep(callbacks, "generation", "in_progress", "流式生成题单", "题单正在生成中，下面会逐段展示最新内容。");
        StringBuilder result = new StringBuilder();
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<Throwable> errorRef = new AtomicReference<>();

        questionStreamingChatModel.generate(messages, new StreamingResponseHandler<>() {
            @Override
            public void onNext(String token) {
                if (token == null || token.isEmpty()) return;
                result.append(token);
                if (callbacks != null && callbacks.onDelta() != null) {
                    callbacks.onDelta().accept(token);
                }
            }

            @Override
            public void onError(Throwable error) {
                errorRef.set(error);
                latch.countDown();
            }

            @Override
            public void onComplete(dev.langchain4j.model.output.Response<dev.langchain4j.data.message.AiMessage> response) {
                latch.countDown();
            }
        });

        try {
            boolean completed = latch.await(150, TimeUnit.SECONDS);
            if (!completed) {
                throw new IllegalStateException("题单流式生成超时，请稍后重试");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("题单流式生成被中断", e);
        }
        if (errorRef.get() != null) {
            throw new IllegalStateException(errorRef.get().getMessage() != null ? errorRef.get().getMessage() : "题单流式生成失败", errorRef.get());
        }
        emitStep(callbacks, "generation", "completed", "题单生成完成", "已完成所有问题生成，你可以开始按题号作答。");
        return result.toString();
    }

    private String buildRetrievalSummary(String ctxInternship, String ctxProject, String ctxBagu, String ctxLlm, String ctxAlgo, String emptyHint) {
        String i = (ctxInternship == null || ctxInternship.equals(emptyHint)) ? "暂无" : "有参考";
        String p = (ctxProject == null || ctxProject.equals(emptyHint)) ? "暂无" : "有参考";
        String b = (ctxBagu == null || ctxBagu.equals(emptyHint)) ? "暂无" : "有参考";
        String l = (ctxLlm == null || ctxLlm.equals(emptyHint)) ? "暂无" : "有参考";
        String a = (ctxAlgo == null || ctxAlgo.equals(emptyHint)) ? "暂无" : "有参考";
        return "检索结果：实习 " + i + "、项目 " + p + "、八股 " + b + "、大模型 " + l + "、算法 " + a + "。（暂无时将结合通用考点与简历出题）";
    }

    private void emitRetrievalSteps(QuestionStreamCallbacks callbacks, String ctxInternship, String ctxProject,
                                    String ctxBagu, String ctxLlm, String ctxAlgo, String emptyHint) {
        emitRetrievalStep(callbacks, "实习面经召回", ctxInternship, emptyHint);
        emitRetrievalStep(callbacks, "项目面经召回", ctxProject, emptyHint);
        emitRetrievalStep(callbacks, "Java 八股召回", ctxBagu, emptyHint);
        emitRetrievalStep(callbacks, "AI/Agent/LLM 召回", ctxLlm, emptyHint);
        emitRetrievalStep(callbacks, "算法题召回", ctxAlgo, emptyHint);
        emitStep(callbacks, "retrieval", "completed", "检索汇总", buildRetrievalSummary(ctxInternship, ctxProject, ctxBagu, ctxLlm, ctxAlgo, emptyHint));
    }

    private void emitRetrievalStep(QuestionStreamCallbacks callbacks, String title, String context, String emptyHint) {
        boolean hasReference = context != null && !context.equals(emptyHint) && !context.isBlank();
        String detail = hasReference
                ? "已命中相关面经片段，将结合真实题型和简历经历生成问题。"
                : "暂未命中强相关面经，将回退到通用高频考点并结合简历技术栈补足题目。";
        emitStep(callbacks, "retrieval", hasReference ? "completed" : "fallback", title, detail);
    }

    private void emitStep(QuestionStreamCallbacks callbacks, String stage, String status, String title, String detail) {
        if (callbacks == null || callbacks.onStep() == null) return;
        callbacks.onStep().accept(new QuestionGenerationStep(stage, title, detail, status));
    }

    private String summarizeResumeProfile(String resumeProfile, String resumeTerms) {
        String compactProfile = resumeProfile == null ? "" : resumeProfile.replaceAll("\\s+", " ").trim();
        if (compactProfile.length() > 110) {
            compactProfile = compactProfile.substring(0, 110) + "...";
        }
        String compactTerms = resumeTerms == null ? "" : resumeTerms.replaceAll("\\s+", " ").trim();
        if (compactTerms.length() > 80) {
            compactTerms = compactTerms.substring(0, 80) + "...";
        }
        if (compactProfile.isEmpty()) {
            return compactTerms.isEmpty() ? "未识别到明显的简历关键词，将按通用互联网技术面试生成题单。" : "识别到技术关键词：" + compactTerms;
        }
        return compactProfile + (compactTerms.isEmpty() ? "" : "；检索关键词：" + compactTerms);
    }

    private String buildDeepQuestionUserPrompt(String company, String department,
                                               String ctxInternship, String ctxProject, String ctxBagu,
                                               String ctxLlm, String ctxAlgo, String resume,
                                               String resumeProfile, String questionSkill) {
        return INTERVIEW_COACH_USER_PROMPT
                .replace("{{company}}", company)
                .replace("{{department}}", department)
                .replace("{{context_internship}}", ctxInternship)
                .replace("{{context_project}}", ctxProject)
                .replace("{{context_bagu}}", ctxBagu)
                .replace("{{context_llm}}", ctxLlm)
                .replace("{{context_algorithm}}", ctxAlgo)
                .replace("{{resume}}", resume)
                .replace("{{resume_profile}}", resumeProfile)
                .replace("{{question_skill}}", questionSkill);
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
