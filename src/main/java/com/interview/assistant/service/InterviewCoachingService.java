package com.interview.assistant.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.interview.assistant.entity.InterviewChatMessage;
import com.interview.assistant.entity.InterviewChatSession;
import com.interview.assistant.repository.InterviewChatMessageRepository;
import com.interview.assistant.repository.InterviewChatSessionRepository;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.service.AiServices;
import dev.langchain4j.service.SystemMessage;
import dev.langchain4j.service.UserMessage;
import dev.langchain4j.service.V;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 多 Agent 分工：
 * - 出题：已由 InterviewAgentService 负责（深挖题生成）
 * - 答疑 Agent：给某题参考答案
 * - 教练 Agent：对回答打分、给反馈、给追问与补强计划
 */
@Service
public class InterviewCoachingService {

    private static final Logger log = LoggerFactory.getLogger(InterviewCoachingService.class);

    private final ChatLanguageModel coachModel;
    private final RagService ragService;
    private final InterviewChatSessionRepository sessionRepository;
    private final InterviewChatMessageRepository messageRepository;
    private final SkillPackService skillPackService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    public InterviewCoachingService(@Qualifier("interviewChatModel") ChatLanguageModel coachModel,
                                   RagService ragService,
                                   InterviewChatSessionRepository sessionRepository,
                                   InterviewChatMessageRepository messageRepository,
                                   SkillPackService skillPackService) {
        this.coachModel = coachModel;
        this.ragService = ragService;
        this.sessionRepository = sessionRepository;
        this.messageRepository = messageRepository;
        this.skillPackService = skillPackService;
    }

    public interface AnswerAgent {
        @SystemMessage("""
            角色：你是资深面试答疑教练。
            任务：给出某道面试题的参考答案要点，面向候选人复习。
            要求：只给核心要点，尽量结构化（1)(2)(3)），控制在 250 字以内；不要长篇大论；不要开场白。
            格式：禁止使用 markdown 符号，例如 *、**、#、-；直接使用普通中文分点。
            """)
        @UserMessage("""
            题目：{{question}}

            候选人简历要点：
            {{resume}}

            相关面经参考（可能为空）：
            {{rag}}

            【答题点评补充规则】
            {{evaluation_skill}}

            请给参考答案要点：
            """)
        String answer(@V("question") String question, @V("resume") String resume, @V("rag") String rag,
                      @V("evaluation_skill") String evaluation_skill);
    }

    public interface FollowupAgent {
        @SystemMessage("""
            角色：你是大厂面试官。
            任务：根据题目与候选人回答，生成 2-4 个更狠的追问（Why/How/边界/故障）。
            要求：每条追问 40 字以内；只输出编号列表；不要开场白。
            """)
        @UserMessage("""
            题目：{{question}}

            候选人回答：
            {{answer}}

            相关面经参考（可能为空）：
            {{rag}}

            【面试流程补充规则】
            {{flow_skill}}

            输出追问：
            """)
        String followups(@V("question") String question, @V("answer") String answer, @V("rag") String rag,
                         @V("flow_skill") String flow_skill);
    }

    public interface EvaluationAgent {
        @SystemMessage("""
            角色：你是面试教练，负责对候选人的回答打分并给建议。
            任务：对主观/场景题回答进行维度评分，并给出改进建议、短板与补强方向。
            语言要求：所有内容必须使用中文。JSON 的键名保持英文，但 summary、strengths、weaknesses、improvements、keyPointsMissing、studyTopics 的值必须全部是中文，禁止输出英文句子。
            输出：严格输出 JSON（不要 markdown），字段如下：
            {
              "scores": {
                "correctness": 0-5,
                "depth": 0-5,
                "structure": 0-5,
                "communication": 0-5,
                "risk": 0-5
              },
              "overall": 0-100,
              "strengths": ["..."],
              "weaknesses": ["..."],
              "improvements": ["..."],
              "keyPointsMissing": ["..."],
              "studyTopics": ["..."],
              "summary": "一句话总结"
            }
            评分准则：60 分=覆盖部分关键点但偏浅；100 分=关键点全、理解深、有权衡、有落地。
            """)
        @UserMessage("""
            题目：{{question}}

            候选人回答：
            {{answer}}

            候选人简历要点：
            {{resume}}

            相关面经参考（可能为空）：
            {{rag}}

            【评分补充规则】
            {{evaluation_skill}}

            请按要求输出 JSON：
            """)
        String evaluate(@V("question") String question, @V("answer") String answer, @V("resume") String resume, @V("rag") String rag,
                        @V("evaluation_skill") String evaluation_skill);
    }

    public interface ChineseRewriteAgent {
        @SystemMessage("""
            角色：你是中文面试点评整理助手。
            任务：把输入的面试评分 JSON 改写为全中文内容。
            要求：
            1. 只把 JSON 的值翻译/改写成自然中文，保留原有 JSON 键名和整体结构。
            2. summary、strengths、weaknesses、improvements、keyPointsMissing、studyTopics 的值必须全部是中文。
            3. 不要新增字段，不要删除字段，不要输出 markdown。
            4. 直接输出合法 JSON。
            """)
        @UserMessage("""
            请把下面这份面试评分结果改写为全中文 JSON，保留键名不变：

            {{json}}
            """)
        String rewrite(@V("json") String json);
    }

    public interface HistoryComparisonAdviceAgent {
        @SystemMessage("""
            角色：你是面试成长分析师。
            任务：根据本场完整面试评分结果与历史维度差值，输出中文 JSON，说明哪里进步、哪里退步、哪里稳定，以及优先加强建议。
            要求：只输出 JSON，不要 markdown，不要英文句子。
            输出格式：
            {
              "summary": "中文总结",
              "improvedAreas": ["..."],
              "weakerAreas": ["..."],
              "stableAreas": ["..."],
              "reinforcementSuggestions": ["..."]
            }
            """)
        @UserMessage("""
            本场评分结果：
            {{current_report}}

            历史对比维度差值：
            {{dimension_delta}}

            历史平均总分：{{history_mean}}
            本场总分：{{current_overall}}

            【历史对比补充规则】
            {{history_skill}}

            请按要求输出 JSON：
            """)
        String analyze(@V("current_report") String current_report,
                       @V("dimension_delta") String dimension_delta,
                       @V("history_mean") String history_mean,
                       @V("current_overall") String current_overall,
                       @V("history_skill") String history_skill);
    }

    private volatile AnswerAgent answerAgent;
    private volatile FollowupAgent followupAgent;
    private volatile EvaluationAgent evaluationAgent;
    private volatile ChineseRewriteAgent chineseRewriteAgent;
    private volatile HistoryComparisonAdviceAgent historyComparisonAdviceAgent;

    private AnswerAgent answerAgent() {
        if (answerAgent == null) {
            synchronized (this) {
                if (answerAgent == null) {
                    answerAgent = AiServices.builder(AnswerAgent.class).chatLanguageModel(coachModel).build();
                }
            }
        }
        return answerAgent;
    }

    private FollowupAgent followupAgent() {
        if (followupAgent == null) {
            synchronized (this) {
                if (followupAgent == null) {
                    followupAgent = AiServices.builder(FollowupAgent.class).chatLanguageModel(coachModel).build();
                }
            }
        }
        return followupAgent;
    }

    private EvaluationAgent evaluationAgent() {
        if (evaluationAgent == null) {
            synchronized (this) {
                if (evaluationAgent == null) {
                    evaluationAgent = AiServices.builder(EvaluationAgent.class).chatLanguageModel(coachModel).build();
                }
            }
        }
        return evaluationAgent;
    }

    private ChineseRewriteAgent chineseRewriteAgent() {
        if (chineseRewriteAgent == null) {
            synchronized (this) {
                if (chineseRewriteAgent == null) {
                    chineseRewriteAgent = AiServices.builder(ChineseRewriteAgent.class).chatLanguageModel(coachModel).build();
                }
            }
        }
        return chineseRewriteAgent;
    }

    private HistoryComparisonAdviceAgent historyComparisonAdviceAgent() {
        if (historyComparisonAdviceAgent == null) {
            synchronized (this) {
                if (historyComparisonAdviceAgent == null) {
                    historyComparisonAdviceAgent = AiServices.builder(HistoryComparisonAdviceAgent.class)
                            .chatLanguageModel(coachModel)
                            .build();
                }
            }
        }
        return historyComparisonAdviceAgent;
    }

    public String answerQuestion(String question, String resume, String company, String department) {
        String rag = buildRag(question, company, department);
        String r = resume != null ? resume : "";
        String evaluationSkill = skillPackService.getPromptAddendum("interview-evaluation-skill");
        return answerAgent().answer(question, truncate(r, 1500), rag, evaluationSkill);
    }

    public String generateFollowups(String question, String answer, String company, String department) {
        String rag = buildRag(question + " " + answer, company, department);
        String flowSkill = skillPackService.getPromptAddendum("interview-flow-skill");
        return followupAgent().followups(question, truncate(answer, 1500), rag, flowSkill);
    }

    public JsonNode evaluateAnswer(String question, String answer, String resume, String company, String department) {
        String rag = buildRag(question + " " + answer, company, department);
        String evaluationSkill = skillPackService.getPromptAddendum("interview-evaluation-skill");
        String json = evaluationAgent().evaluate(question, truncate(answer, 2000), truncate(resume, 1500), rag, evaluationSkill);
        JsonNode parsed = safeParseJson(json);
        return normalizeEvaluationToChinese(parsed);
    }

    /** 生成本场面试报告（结束后异步调用）：总评 + 历史对比（进步/退步数值化） */
    @Async
    public void generateSessionReportAsync(String sessionId) {
        try {
            generateSessionReport(sessionId);
        } catch (Exception e) {
            log.error("generateSessionReportAsync failed sessionId={}", sessionId, e);
        }
    }

    public void generateSessionReport(String sessionId) {
        InterviewChatSession s = sessionRepository.findBySessionId(sessionId).orElse(null);
        if (s == null) return;

        List<InterviewChatMessage> msgs = messageRepository.findBySession_IdOrderBySortOrderAscIdAsc(s.getId());
        if (msgs == null || msgs.isEmpty()) return;

        String transcript = buildSessionTranscript(msgs);
        if (transcript.isBlank()) return;

        String pseudoQuestion = "请基于本场完整模拟面试的所有题目与候选人回答，对整场面试表现进行综合评估";
        JsonNode eval = evaluateAnswer(pseudoQuestion, transcript, s.getResume(), s.getCompany(), s.getDepartment());

        int overall = eval.path("overall").asInt(0);
        String summary = zh(eval.path("summary").asText(""));

        // 历史对比：取同公司同部门最近 20 场有 endedAt 的平均分
        List<InterviewChatSession> history;
        if (s.getCompany() != null && s.getDepartment() != null) {
            history = sessionRepository.findTop20ByCompanyAndDepartmentAndEndedAtNotNullOrderByEndedAtDesc(s.getCompany(), s.getDepartment());
        } else {
            history = sessionRepository.findTop20ByEndedAtNotNullOrderByEndedAtDesc();
        }
        int avg = 0;
        int n = 0;
        for (InterviewChatSession hs : history) {
            if (hs.getSessionId().equals(sessionId)) continue;
            if (hs.getOverallScore() != null) {
                avg += hs.getOverallScore();
                n++;
            }
        }
        int mean = n > 0 ? Math.round((float) avg / n) : overall;
        int delta = overall - mean;

        ObjectNode reportNode = normalizeEvaluationToChinese(eval);
        reportNode.set("comparison", buildHistoryComparison(reportNode, history, sessionId, mean, delta, n));
        String reportJson = toJson(reportNode);

        s.setOverallScore(overall);
        s.setImprovementDelta(delta);
        s.setReportJson(reportJson);
        s.setReportSummary(summary);
        sessionRepository.save(s);
    }

    /** 兼容旧数据：若历史会话 reportJson 中缺少 comparison，则在读取时补齐并回写。 */
    public InterviewChatSession ensureComparisonInReport(InterviewChatSession session) {
        if (session == null || session.getSessionId() == null || session.getReportJson() == null || session.getReportJson().isBlank()) {
            return session;
        }
        JsonNode parsed = safeParseJson(session.getReportJson());
        if (!parsed.isObject()) return session;
        ObjectNode report = (ObjectNode) parsed;
        if (report.has("comparison")) {
            return session;
        }

        List<InterviewChatSession> history;
        if (session.getCompany() != null && session.getDepartment() != null) {
            history = sessionRepository.findTop20ByCompanyAndDepartmentAndEndedAtNotNullOrderByEndedAtDesc(session.getCompany(), session.getDepartment());
        } else {
            history = sessionRepository.findTop20ByEndedAtNotNullOrderByEndedAtDesc();
        }

        int avg = 0;
        int n = 0;
        for (InterviewChatSession hs : history) {
            if (hs.getSessionId().equals(session.getSessionId())) continue;
            if (hs.getOverallScore() != null) {
                avg += hs.getOverallScore();
                n++;
            }
        }
        int mean = n > 0 ? Math.round((float) avg / n) : report.path("overall").asInt(0);
        int delta = report.path("overall").asInt(0) - mean;
        report.set("comparison", buildHistoryComparison(report, history, session.getSessionId(), mean, delta, n));

        session.setReportJson(toJson(report));
        if ((session.getReportSummary() == null || session.getReportSummary().isBlank()) && report.has("summary")) {
            session.setReportSummary(report.path("summary").asText(""));
        }
        sessionRepository.save(session);
        return session;
    }

    private String buildRag(String query, String company, String department) {
        String c = (company != null && !company.isBlank()) ? company.trim() : null;
        String d = (department != null && !department.isBlank()) ? department.trim() : null;
        List<String> relevant = ragService.search(query, c, d, 5);
        if (relevant.isEmpty()) return "";
        return String.join("\n\n---\n\n", relevant.stream().map(t -> t.length() > 500 ? t.substring(0, 500) + "..." : t).toList());
    }

    private JsonNode safeParseJson(String s) {
        if (s == null) return objectMapper.createObjectNode();
        String text = s.trim();
        int start = text.indexOf('{');
        int end = text.lastIndexOf('}');
        if (start >= 0 && end > start) {
            text = text.substring(start, end + 1);
        }
        try {
            return objectMapper.readTree(text);
        } catch (Exception e) {
            return objectMapper.createObjectNode().put("overall", 0).put("summary", "解析失败").put("raw", s);
        }
    }

    private String buildSessionTranscript(List<InterviewChatMessage> msgs) {
        StringBuilder sb = new StringBuilder();
        int round = 1;
        boolean hasUserAnswer = false;
        for (InterviewChatMessage msg : msgs) {
            if ("assistant".equals(msg.getRole())) {
                sb.append("第").append(round).append("轮面试官：").append(truncate(msg.getContent(), 1200)).append("\n");
            } else if ("user".equals(msg.getRole())) {
                hasUserAnswer = true;
                sb.append("第").append(round).append("轮候选人：").append(truncate(msg.getContent(), 1600)).append("\n\n");
                round++;
            }
        }
        return hasUserAnswer ? sb.toString().trim() : "";
    }

    private ObjectNode normalizeEvaluationToChinese(JsonNode eval) {
        JsonNode localized = localizeEvaluationIfNeeded(eval);
        ObjectNode node = objectMapper.createObjectNode();
        JsonNode scores = localized.path("scores");
        ObjectNode scoreNode = objectMapper.createObjectNode();
        scoreNode.put("correctness", scores.path("correctness").asInt(0));
        scoreNode.put("depth", scores.path("depth").asInt(0));
        scoreNode.put("structure", scores.path("structure").asInt(0));
        scoreNode.put("communication", scores.path("communication").asInt(0));
        scoreNode.put("risk", scores.path("risk").asInt(0));
        node.set("scores", scoreNode);
        node.put("overall", localized.path("overall").asInt(0));
        node.set("strengths", toChineseArray(localized.path("strengths")));
        node.set("weaknesses", toChineseArray(localized.path("weaknesses")));
        node.set("improvements", toChineseArray(localized.path("improvements")));
        node.set("keyPointsMissing", toChineseArray(localized.path("keyPointsMissing")));
        node.set("studyTopics", toChineseArray(localized.path("studyTopics")));
        node.put("summary", zh(localized.path("summary").asText("")));
        return node;
    }

    private JsonNode localizeEvaluationIfNeeded(JsonNode eval) {
        if (eval == null || !eval.isObject()) return objectMapper.createObjectNode();
        if (!containsEnglishNarrative(eval)) {
            return eval;
        }
        try {
            String rewritten = chineseRewriteAgent().rewrite(toJson(eval));
            JsonNode parsed = safeParseJson(rewritten);
            if (parsed != null && parsed.isObject()) {
                return parsed;
            }
        } catch (Exception e) {
            log.warn("中文化评分结果失败，继续使用原始结果", e);
        }
        return eval;
    }

    private boolean containsEnglishNarrative(JsonNode eval) {
        return hasEnglish(eval.path("summary").asText(""))
                || arrayContainsEnglish(eval.path("strengths"))
                || arrayContainsEnglish(eval.path("weaknesses"))
                || arrayContainsEnglish(eval.path("improvements"))
                || arrayContainsEnglish(eval.path("keyPointsMissing"))
                || arrayContainsEnglish(eval.path("studyTopics"));
    }

    private boolean arrayContainsEnglish(JsonNode array) {
        if (array == null || !array.isArray()) return false;
        for (JsonNode item : array) {
            if (hasEnglish(item.asText(""))) return true;
        }
        return false;
    }

    private boolean hasEnglish(String text) {
        return text != null && text.matches(".*[A-Za-z]{3,}.*");
    }

    private ArrayNode toChineseArray(JsonNode source) {
        ArrayNode arr = objectMapper.createArrayNode();
        if (source != null && source.isArray()) {
            for (JsonNode item : source) {
                String text = zh(item.asText(""));
                if (text.isBlank() || "...".equals(text)) continue;
                arr.add(text);
            }
        }
        return arr;
    }

    private ObjectNode buildHistoryComparison(ObjectNode currentReport,
                                              List<InterviewChatSession> history,
                                              String currentSessionId,
                                              int meanOverall,
                                              int deltaOverall,
                                              int historyCount) {
        ObjectNode comparison = objectMapper.createObjectNode();
        comparison.put("historySampleSize", historyCount);
        comparison.put("previousAverageOverall", meanOverall);
        comparison.put("currentOverall", currentReport.path("overall").asInt(0));
        comparison.put("overallDelta", deltaOverall);

        ObjectNode dimensionDelta = objectMapper.createObjectNode();
        ArrayNode improvedAreas = objectMapper.createArrayNode();
        ArrayNode weakerAreas = objectMapper.createArrayNode();
        ArrayNode stableAreas = objectMapper.createArrayNode();

        String[] keys = {"correctness", "depth", "structure", "communication", "risk"};
        String[] names = {"正确性", "技术深度", "回答结构", "表达沟通", "风险意识"};

        for (int i = 0; i < keys.length; i++) {
            double avg = averageHistoricalDimension(history, currentSessionId, keys[i]);
            int current = currentReport.path("scores").path(keys[i]).asInt(0);
            double diff = roundOneDecimal(current - avg);
            dimensionDelta.put(keys[i], diff);
            if (diff >= 0.6) {
                improvedAreas.add(names[i] + "较历史平均提升 " + diff + " 分");
            } else if (diff <= -0.6) {
                weakerAreas.add(names[i] + "较历史平均下降 " + Math.abs(diff) + " 分");
            } else {
                stableAreas.add(names[i] + "与历史平均基本持平");
            }
        }

        comparison.set("dimensionDelta", dimensionDelta);

        JsonNode advice = buildHistoryAdvice(currentReport, dimensionDelta, meanOverall, deltaOverall);
        comparison.set("improvedAreas", preferChineseArray(advice.path("improvedAreas"), improvedAreas));
        comparison.set("weakerAreas", preferChineseArray(advice.path("weakerAreas"), weakerAreas));
        comparison.set("stableAreas", preferChineseArray(advice.path("stableAreas"), stableAreas));
        comparison.set("reinforcementSuggestions", preferChineseArray(advice.path("reinforcementSuggestions"), buildDefaultReinforcementSuggestions(weakerAreas)));
        comparison.put("summary", zh(advice.path("summary").asText(buildComparisonSummary(deltaOverall, improvedAreas, weakerAreas, historyCount))));
        return comparison;
    }

    private JsonNode buildHistoryAdvice(ObjectNode currentReport, ObjectNode dimensionDelta, int meanOverall, int deltaOverall) {
        try {
            String historySkill = skillPackService.getPromptAddendum("history-comparison-skill");
            String json = historyComparisonAdviceAgent().analyze(
                    toJson(currentReport),
                    toJson(dimensionDelta),
                    String.valueOf(meanOverall),
                    String.valueOf(currentReport.path("overall").asInt(0)),
                    historySkill
            );
            return safeParseJson(json);
        } catch (Exception e) {
            log.warn("生成历史对比建议失败，使用规则兜底", e);
            return objectMapper.createObjectNode().put("summary", buildComparisonSummary(deltaOverall, objectMapper.createArrayNode(), objectMapper.createArrayNode(), 0));
        }
    }

    private ArrayNode preferChineseArray(JsonNode candidate, ArrayNode fallback) {
        ArrayNode localized = toChineseArray(candidate);
        return localized.size() > 0 ? localized : toChineseArray(fallback);
    }

    private ArrayNode buildDefaultReinforcementSuggestions(ArrayNode weakerAreas) {
        ArrayNode suggestions = objectMapper.createArrayNode();
        if (weakerAreas != null) {
            for (JsonNode item : weakerAreas) {
                String text = zh(item.asText(""));
                if (text.contains("正确性")) {
                    suggestions.add("优先补齐核心知识点与关键结论，先确保回答准确，再展开细节。");
                } else if (text.contains("技术深度")) {
                    suggestions.add("补充底层原理、实现细节和方案权衡，避免只停留在概念层。");
                } else if (text.contains("回答结构")) {
                    suggestions.add("按背景、方案、结果、风险的顺序组织答案，让表达更完整。");
                } else if (text.contains("表达沟通")) {
                    suggestions.add("多做口头模拟面试，训练更清晰的表述与总结能力。");
                } else if (text.contains("风险意识")) {
                    suggestions.add("回答时主动补充异常场景、边界条件和降级兜底方案。");
                }
            }
        }
        if (suggestions.size() == 0) {
            suggestions.add("继续保持当前表现，并针对薄弱维度做专项训练。");
        }
        return suggestions;
    }

    private double averageHistoricalDimension(List<InterviewChatSession> history, String currentSessionId, String key) {
        double sum = 0;
        int count = 0;
        for (InterviewChatSession session : history) {
            if (session == null || session.getSessionId() == null || session.getSessionId().equals(currentSessionId)) continue;
            JsonNode report = safeParseJson(session.getReportJson());
            JsonNode scores = report.path("scores");
            if (scores.has(key) && scores.get(key).isNumber()) {
                sum += scores.get(key).asDouble();
                count++;
            }
        }
        return count > 0 ? sum / count : 0;
    }

    private double roundOneDecimal(double value) {
        return Math.round(value * 10.0) / 10.0;
    }

    private String buildComparisonSummary(int deltaOverall, ArrayNode improvedAreas, ArrayNode weakerAreas, int historyCount) {
        if (historyCount <= 0) {
            return "这是你的首场有效历史样本，后续完成更多模拟面试后可查看更稳定的历史对比结果。";
        }
        if (deltaOverall >= 5) {
            return "与历史表现相比，本场整体有明显进步，重点提升体现在：" + firstArea(improvedAreas) + "。";
        }
        if (deltaOverall <= -5) {
            return "与历史表现相比，本场整体有所回落，当前最需要补强的是：" + firstArea(weakerAreas) + "。";
        }
        if (improvedAreas.size() > 0 && weakerAreas.size() > 0) {
            return "本场整体与历史平均接近，部分维度有提升，但仍有短板需要继续打磨。";
        }
        return "本场整体与历史平均基本持平，建议继续保持并针对薄弱环节做专项训练。";
    }

    private String firstArea(ArrayNode array) {
        return array != null && array.size() > 0 ? array.get(0).asText("") : "核心表达与技术细节";
    }

    private String zh(String text) {
        if (text == null) return "";
        return text.trim()
                .replace("correctness", "正确性")
                .replace("depth", "技术深度")
                .replace("structure", "回答结构")
                .replace("communication", "表达沟通")
                .replace("risk", "风险意识")
                .replace("Correctness", "正确性")
                .replace("Depth", "技术深度")
                .replace("Structure", "回答结构")
                .replace("Communication", "表达沟通")
                .replace("Risk", "风险意识")
                .replace("Candidate", "候选人")
                .replace("candidate", "候选人")
                .replace("Detailed problem analysis", "问题分析比较细致")
                .replace("Clear explanation of optimization steps", "优化步骤说明较清晰")
                .replace("Good understanding of Kafka and thread pool management", "对 Kafka 与线程池管理理解较好")
                .replace("Effective use of monitoring and alerting", "体现了监控与告警意识")
                .replace("Could provide more context on the specific Kafka version and configuration used", "对具体 Kafka 版本和配置背景说明不足")
                .replace("Lack of mention of potential risks or trade-offs in optimizations", "较少提到优化方案的风险和权衡")
                .replace("Limited explanation of how the batch processing and caching optimizations were implemented", "对批处理和缓存优化的实现细节说明不足")
                .replace("No mention of error handling or fallback strategies", "没有提到错误处理或降级兜底策略")
                .replace("No discussion on how the optimizations were tested and validated", "没有说明优化结果如何测试和验证");
    }

    private String toJson(JsonNode node) {
        try {
            return objectMapper.writeValueAsString(node);
        } catch (JsonProcessingException e) {
            return "{}";
        }
    }

    private String truncate(String s, int max) {
        if (s == null) return "";
        String t = s.trim();
        if (t.length() <= max) return t;
        return t.substring(0, max) + "...";
    }
}
