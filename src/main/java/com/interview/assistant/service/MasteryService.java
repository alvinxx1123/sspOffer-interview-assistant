package com.interview.assistant.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.interview.assistant.capability.MasteryConceptCapability;
import com.interview.assistant.config.ModelConfigHolder;
import com.interview.assistant.entity.InternshipProject;
import com.interview.assistant.repository.InternshipProjectRepository;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.data.message.SystemMessage;
import dev.langchain4j.data.message.UserMessage;
import dev.langchain4j.model.StreamingResponseHandler;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.model.chat.StreamingChatLanguageModel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

/**
 * 实习掌握度闭环编排服务。
 * - 文档解析：复用 ResumeParseService（PDF/图片→文本），多文件拼接
 * - 经历生成：流式产出 STAR 经历（SSE delta）
 * - 概念图谱：基于经历+文档，产出 conceptGraphJson
 * - 诊断：概念图谱 + 用户答题 → masteryMapJson
 * 全程注入 internship-mastery-skill 的规则与模板。
 */
@Service
public class MasteryService {

    private static final Logger log = LoggerFactory.getLogger(MasteryService.class);

    private final ChatLanguageModel chatModel;
    private final StreamingChatLanguageModel streamingModel;
    private final SkillPackService skillPackService;
    private final MasteryConceptCapability conceptCapability;
    private final ResumeParseService resumeParseService;
    private final InternshipProjectRepository projectRepository;
    private final ModelConfigHolder modelConfigHolder;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public MasteryService(@Qualifier("questionChatModel") ChatLanguageModel chatModel,
                          @Qualifier("questionStreamingChatModel") StreamingChatLanguageModel streamingModel,
                          SkillPackService skillPackService,
                          MasteryConceptCapability conceptCapability,
                          ResumeParseService resumeParseService,
                          InternshipProjectRepository projectRepository,
                          ModelConfigHolder modelConfigHolder) {
        this.chatModel = chatModel;
        this.streamingModel = streamingModel;
        this.skillPackService = skillPackService;
        this.conceptCapability = conceptCapability;
        this.resumeParseService = resumeParseService;
        this.projectRepository = projectRepository;
        this.modelConfigHolder = modelConfigHolder;
    }

    public record StepEvent(String stage, String status, String title, String detail) {}

    public record StreamCallbacks(
            Consumer<StepEvent> onStep,
            Consumer<String> onDelta,
            Consumer<String> onOutline,
            Consumer<String> onGraph
    ) {}

    // ==================== 项目管理 ====================

    public InternshipProject createProject(String name, String company, String role,
                                           String startDate, String endDate,
                                           List<MultipartFile> files) {
        StringBuilder source = new StringBuilder();
        // 收集每个文件的解析状态，让前端能看到哪张图、为什么失败
        List<Map<String, Object>> fileStatus = new ArrayList<>();
        int success = 0, failed = 0;
        for (MultipartFile file : files) {
            Map<String, Object> entry = new LinkedHashMap<>();
            String fname = file != null ? file.getOriginalFilename() : null;
            entry.put("filename", fname != null ? fname : "(未命名文件)");
            if (file == null || file.isEmpty()) {
                entry.put("status", "failed");
                entry.put("error", "文件为空");
                fileStatus.add(entry);
                failed++;
                continue;
            }
            // 让前端能看到每条记录走的是哪种解析路径
            String ext = fname != null && fname.contains(".")
                    ? fname.substring(fname.lastIndexOf(".")).toLowerCase() : "";
            String parser = ext.equals(".pdf") ? "pdfbox_text"
                    : (ext.matches("\\.(md|markdown)") ? "markdown_plain"
                    : (ext.matches("\\.(txt|text)") ? "plain_text"
                    : (ext.matches("\\.(jpg|jpeg|png|gif|webp)")
                            ? (modelConfigHolder.isUnlimitedOcrEnabled() ? "unlimited_ocr" : "llm_vision")
                            : "unknown")));
            entry.put("parser", parser);
            try {
                String text = resumeParseService.parseResume(file);
                if (text != null && !text.isBlank()) {
                    source.append("===== 文件: ").append(fname).append(" =====\n")
                            .append(text).append("\n\n");
                    entry.put("status", "success");
                    entry.put("textLength", text.length());
                    // 如果 Unlimited-OCR 实际抛了异常被 catch，回退到 LLM 时更新 parser 标签
                    if ("unlimited_ocr".equals(parser)) {
                        // 仅作为成功路径上的标签记录，真正解析路径在 ResumeParseService 内部已经决定
                        // 这里保留 unlimited_ocr 表示「优先策略」
                    }
                    fileStatus.add(entry);
                    success++;
                } else {
                    entry.put("status", "failed");
                    String detail;
                    if ("unlimited_ocr".equals(parser)) {
                        detail = "Unlimited-OCR + 多模态 LLM 均返回空文本。检查：1) Unlimited-OCR 服务是否在跑且版本支持图片；2) 视觉 LLM API Key 是否配置；3) 网络/限流；4) 图片是否损坏";
                    } else {
                        detail = "解析结果为空（通常：1) LLM API Key 未配置；2) 当前视觉模型不支持图片；3) 网络/限流失败；4) 图片被损坏或不可读）";
                    }
                    entry.put("error", detail);
                    fileStatus.add(entry);
                    failed++;
                }
            } catch (Exception e) {
                log.warn("文档解析失败 {}: {}", fname, e.getMessage());
                entry.put("status", "failed");
                entry.put("error", rootCauseMessage(e));
                fileStatus.add(entry);
                failed++;
            }
        }
        InternshipProject p = new InternshipProject();
        p.setName(name != null && !name.isBlank() ? name : "混合文档（待识别）");
        p.setCompany(company);
        p.setRole(role);
        p.setStartDate(startDate);
        p.setEndDate(endDate);
        p.setSourceText(source.toString());
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("files", fileStatus);
        summary.put("successCount", success);
        summary.put("failedCount", failed);
        summary.put("totalCount", fileStatus.size());
        try {
            p.setParseStatusJson(objectMapper.writeValueAsString(summary));
        } catch (Exception e) {
            log.warn("保存 parseStatusJson 失败: {}", e.getMessage());
            p.setParseStatusJson("{}");
        }
        p.setUpdatedAt(java.time.LocalDateTime.now());
        // 上传了文件但全部解析失败 → 直接抛错，让前端在上传时就看到，不留到生成时
        if (!fileStatus.isEmpty() && success == 0) {
            String firstError = fileStatus.stream()
                    .filter(m -> "failed".equals(m.get("status")))
                    .findFirst()
                    .map(m -> String.valueOf(m.get("error")))
                    .orElse("未知错误");
            throw new IllegalStateException(
                    "全部 " + failed + " 个文档解析失败，无法生成经历。原因（第一条）：" + firstError
                            + "。请到「设置」页确认 LLM API Key 与视觉模型（visionModel）配置是否正确，或先更换单文件测试。");
        }
        return projectRepository.save(p);
    }

    /** 取最底层的错误描述（剥掉 Spring/包装层） */
    private static String rootCauseMessage(Throwable t) {
        Throwable cur = t;
        while (cur.getCause() != null && cur.getCause() != cur) cur = cur.getCause();
        String msg = cur.getMessage();
        if (msg == null || msg.isBlank()) msg = cur.getClass().getSimpleName();
        if (t != cur) {
            String wrapperMsg = t.getMessage();
            if (wrapperMsg != null && !wrapperMsg.isBlank() && !wrapperMsg.equals(msg)) {
                return wrapperMsg + " → " + msg;
            }
        }
        return msg;
    }

    public InternshipProject getProject(Long id) {
        return projectRepository.findById(id).orElse(null);
    }

    public List<InternshipProject> listProjects() {
        return projectRepository.findAllByOrderByUpdatedAtDesc();
    }

    public void deleteProject(Long id) {
        projectRepository.deleteById(id);
    }

    public InternshipProject updateExperience(Long id, String experienceText) {
        InternshipProject p = projectRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("项目不存在: " + id));
        p.setExperienceText(experienceText);
        p.setUpdatedAt(java.time.LocalDateTime.now());
        return projectRepository.save(p);
    }

    // ==================== 经历 + 概念图谱生成（SSE 流式） ====================

    public String generateExperienceStreaming(Long projectId, StreamCallbacks callbacks) {
        InternshipProject p = projectRepository.findById(projectId)
                .orElseThrow(() -> new IllegalArgumentException("项目不存在: " + projectId));
        emitStep(callbacks, "prepare", "in_progress", "初始化", "正在读取项目文档与背景信息。");
        String source = p.getSourceText();
        if (source == null || source.isBlank()) {
            throw new IllegalStateException(buildEmptySourceMessage(p));
        }
        String skillAddendum = skillPackService.getPromptAddendum("internship-mastery-skill");
        String extractionRules = skillPackService.getReference("internship-mastery-skill", "concept-extraction-rules.md");

        // 阶段1：文档归类与项目识别（骨架），先出结构化 JSON
        emitStep(callbacks, "outline", "in_progress", "文档归类与项目识别", "通读全部文档，识别项目并归类技术方案/优化日报等材料。");
        String outlineJson = generateOutline(source, skillAddendum);
        p.setProjectOutlineJson(outlineJson);
        int projectCount = countOutlineProjects(outlineJson);
        emitStep(callbacks, "outline", "completed", "项目识别完成",
                "共识别 " + projectCount + " 个项目，开始逐项目生成 STAR 经历。");
        if (callbacks != null && callbacks.onOutline() != null) {
            callbacks.onOutline().accept(outlineJson);
        }

        // 阶段2：基于骨架逐项目流式生成 STAR 经历
        emitStep(callbacks, "experience", "in_progress", "生成实习经历", "按项目骨架逐个生成可写进简历的 STAR 经历。");
        String experience = streamExperience(p, source, outlineJson, skillAddendum, callbacks);
        p.setExperienceText(experience);

        // 阶段2：基于经历+文档生成概念图谱 JSON
        emitStep(callbacks, "graph", "in_progress", "提取概念图谱", "正在把经历拆成面试官会深挖的底层概念树。");
        String graphJson = generateConceptGraph(experience, source, extractionRules, skillAddendum);
        p.setConceptGraphJson(graphJson);
        p.setUpdatedAt(java.time.LocalDateTime.now());
        projectRepository.save(p);

        int conceptCount = conceptCapability.countConcepts(graphJson);
        emitStep(callbacks, "graph", "completed", "概念图谱完成",
                "共提取 " + conceptCount + " 个底层概念，可进入诊断阶段逐题作答。");

        if (callbacks != null && callbacks.onGraph() != null) {
            callbacks.onGraph().accept(graphJson);
        }
        emitStep(callbacks, "done", "completed", "全部完成", "经历与概念图谱已生成。");
        return experience;
    }

    /** 第一阶段：通读所有文档，识别项目并归类（技术方案/优化日报等），产出项目骨架 JSON */
    private String generateOutline(String source, String skillAddendum) {
        String system = """
                角色：你是资深技术面试官兼简历顾问。
                任务：通读候选人上传的全部实习/项目文档（可能包含多个项目的技术方案、优化日报、周报、需求文档等混合材料），识别其中包含的项目，并按项目归类整理事实。
                对每个项目输出：
                - name：项目名（从文档内容推断，无明确名称时用「项目1」「项目2」）
                - documentTypes：该项目涉及的文档类型（如 技术方案/优化日报/周报/需求文档，可多个）
                - background：项目背景一句话
                - techStack：涉及的技术栈（逗号分隔）
                - myContributions：候选人在该项目中做的事（从文档提取事实，区分个人贡献与团队成果，用要点列表）
                - achievements：可量化的成果（无数据则留空字符串，禁止编造数字）
                原则：只基于文档真实出现的内容；无法确定归属哪个项目的材料，归到 name 为「未归类材料」的条目里。
                严格输出 JSON（不要 markdown、不要代码块），结构：
                {"projects":[{"name":"","documentTypes":[],"background":"","techStack":"","myContributions":"","achievements":""}]}
                """;
        String user = """
                【全部项目文档】
                %s

                【补充规则】
                %s

                请识别文档中包含的项目，按项目归类整理事实。只输出 JSON。
                """.formatted(truncate(source, 12000), skillAddendum);
        dev.langchain4j.model.output.Response<AiMessage> resp = chatModel.generate(
                List.of(SystemMessage.from(system), UserMessage.from(user)));
        return extractJson(resp.content().text());
    }

    private int countOutlineProjects(String outlineJson) {
        JsonNode root = safeParse(outlineJson);
        if (root == null) return 0;
        return root.path("projects").size();
    }

    private JsonNode safeParse(String json) {
        if (json == null || json.isBlank()) return null;
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }

    private String streamExperience(InternshipProject p, String source, String outlineJson, String skillAddendum, StreamCallbacks callbacks) {
        String system = """
                角色：你是资深大厂技术面试官兼简历顾问。
                任务：从候选人提供的实习/项目文档中，提取可写进简历的实习经历，按 STAR 格式分条输出。
                原则：只基于文档真实出现的内容，不编造量化指标；区分个人贡献与团队成果；无数据时用"参与/支持/覆盖"等可验证措辞，不要捏造数字。
                格式：每条经历以"· "开头，先一句 STAR 概述，再紧跟量化结果；条目之间空行分隔；用中文；不要 markdown 加粗、不要编号列表符号以外的格式。
                """;
        String user = """
                项目信息：%s / %s / %s
                时间：%s ~ %s

                【项目骨架（已识别的项目归类）】
                %s

                【项目文档原文（供补充细节）】
                %s

                【提取规则补充】
                %s

                基于骨架识别出的项目，逐项目提取可写进简历的 STAR 实习经历（每个项目 1-2 条）。各项目经历之间空行分隔，每条经历开头用「【项目：xxx】」标注所属项目。直接输出经历正文，不要任何开场白。
                """.formatted(
                        safe(p.getCompany()), safe(p.getRole()), safe(p.getName()),
                        safe(p.getStartDate()), safe(p.getEndDate()),
                        truncate(outlineJson, 4000),
                        truncate(source, 8000),
                        skillAddendum
                );
        StringBuilder result = new StringBuilder();
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<Throwable> errorRef = new AtomicReference<>();
        List<ChatMessage> messages = new ArrayList<>();
        messages.add(SystemMessage.from(system));
        messages.add(UserMessage.from(user));
        streamingModel.generate(messages, new StreamingResponseHandler<>() {
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
            public void onComplete(dev.langchain4j.model.output.Response<AiMessage> response) {
                latch.countDown();
            }
        });
        try {
            if (!latch.await(150, TimeUnit.SECONDS)) {
                throw new IllegalStateException("经历生成超时，请重试");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("经历生成被中断", e);
        }
        if (errorRef.get() != null) {
            throw new IllegalStateException("经历生成失败: " + errorRef.get().getMessage(), errorRef.get());
        }
        return result.toString().trim();
    }

    private String generateConceptGraph(String experience, String source, String extractionRules, String skillAddendum) {
        String system = """
                角色：你是资深大厂技术面试官。
                任务：基于候选人的实习经历，为每条经历列出面试官最可能深挖的底层概念图谱。
                要求：严格输出 JSON（不要 markdown、不要代码块），结构如下：
                {
                  "conceptGraph": [
                    {
                      "experienceRef": "对应经历的关键描述",
                      "concepts": [
                        {"name":"概念名","category":"原理|故障|一致性|选型|边界","depthLevel":"表层|中层|底层","whyItMatters":"面试官会怎么拷打","probeQuestion":"开放式诊断题"}
                      ]
                    }
                  ]
                }
                """;
        String user = """
                【生成的实习经历】
                %s

                【原始文档片段】
                %s

                【概念提取规则】
                %s

                【补充规则】
                %s

                请为每条经历提取 2-5 个面试官会深挖的底层概念，每个概念给出 whyItMatters 和一道开放式 probeQuestion。只输出 JSON。
                """.formatted(
                        truncate(experience, 3000),
                        truncate(source, 4000),
                        extractionRules,
                        skillAddendum
                );
        dev.langchain4j.model.output.Response<AiMessage> resp = chatModel.generate(List.of(SystemMessage.from(system), UserMessage.from(user)));
        String raw = resp.content().text();
        return extractJson(raw);
    }

    // ==================== 诊断（掌握地图） ====================

    public String diagnose(Long projectId, String answersJson) {
        InternshipProject p = projectRepository.findById(projectId)
                .orElseThrow(() -> new IllegalArgumentException("项目不存在: " + projectId));
        if (p.getConceptGraphJson() == null || p.getConceptGraphJson().isBlank()) {
            throw new IllegalStateException("该项目尚未生成概念图谱，请先生成经历与图谱。");
        }
        String skillAddendum = skillPackService.getPromptAddendum("internship-mastery-skill");
        String diagnosisRubric = skillPackService.getReference("internship-mastery-skill", "diagnosis-rubric.md");
        String graphSummary = conceptCapability.summarizeGraph(p.getConceptGraphJson());

        String system = """
                角色：你是面试教练，对候选人在各概念上的掌握度做诊断。
                任务：根据候选人对每个 probeQuestion 的回答，判定掌握度等级，给出 gap 与针对性 drill 建议。
                等级：solid（扎实，原理+处理+权衡）、shallow（答到一部分，深度或结构不足）、unknown（不懂/空答）。
                要求：严格输出 JSON（不要 markdown），结构如下：
                {
                  "assessments": [{"concept":"概念名","level":"solid|shallow|unknown","gap":"具体缺了哪个点","drillSuggestion":"可执行的练习建议"}],
                  "summary": "一句话整体概括",
                  "weakFocus": ["shallow 或 unknown 的概念名"]
                }
                """;
        String user = """
                【概念图谱摘要】
                %s

                【候选人对各诊断题的回答（JSON）】
                %s

                【诊断评级标准】
                %s

                【补充规则】
                %s

                请逐概念判定掌握度等级，给出 gap 与 drillSuggestion，并汇总 weakFocus。只输出 JSON。
                """.formatted(
                        graphSummary,
                        truncate(answersJson, 8000),
                        diagnosisRubric,
                        skillAddendum
                );
        dev.langchain4j.model.output.Response<AiMessage> resp = chatModel.generate(List.of(SystemMessage.from(system), UserMessage.from(user)));
        String raw = resp.content().text();
        String masteryJson = extractJson(raw);
        p.setMasteryMapJson(masteryJson);
        p.setUpdatedAt(java.time.LocalDateTime.now());
        projectRepository.save(p);
        return masteryJson;
    }

    // ==================== 工具方法 ====================

    private void emitStep(StreamCallbacks callbacks, String stage, String status, String title, String detail) {
        if (callbacks != null && callbacks.onStep() != null) {
            callbacks.onStep().accept(new StepEvent(stage, status, title, detail));
        }
    }

    /** 构造「无文档内容」的诊断信息：带上上次解析的状态摘要 */
    private String buildEmptySourceMessage(InternshipProject p) {
        StringBuilder sb = new StringBuilder("该项目无可用文档内容，无法生成。");
        if (p.getParseStatusJson() == null || p.getParseStatusJson().isBlank()) {
            sb.append("请回到上传页重新上传（至少一个能成功解析的文档）。");
            return sb.toString();
        }
        JsonNode root = safeParse(p.getParseStatusJson());
        if (root == null) {
            sb.append("请重新上传。");
            return sb.toString();
        }
        int total = root.path("totalCount").asInt(0);
        int ok = root.path("successCount").asInt(0);
        int bad = root.path("failedCount").asInt(0);
        sb.append("共上传 ").append(total).append(" 个文档，成功解析 ").append(ok).append(" 个，失败 ").append(bad).append(" 个。");
        JsonNode files = root.path("files");
        if (files.isArray()) {
            int shown = 0;
            for (JsonNode f : files) {
                if ("failed".equals(f.path("status").asText())) {
                    String fname = f.path("filename").asText("(未命名)");
                    String err = f.path("error").asText("(无错误信息)");
                    sb.append("\n  · ").append(fname).append(" → ").append(err);
                    if (++shown >= 3) break;
                }
            }
            if (bad > shown) sb.append("\n  · （其余 ").append(bad - shown).append(" 个失败略）");
        }
        sb.append("\n建议：到「设置」确认 LLM API Key 与视觉模型（visionModel）配置；或先单独上传 1 张图片验证。");
        return sb.toString();
    }

    /** 从可能含前后噪声的模型输出中提取首个 JSON 对象 */
    private String extractJson(String raw) {
        if (raw == null) return "{}";
        String s = raw.trim();
        if (s.startsWith("```")) {
            s = s.replaceAll("^```\\w*\\s*", "").replaceAll("\\s*```$", "").trim();
        }
        int start = s.indexOf('{');
        int end = s.lastIndexOf('}');
        if (start >= 0 && end > start) {
            String candidate = s.substring(start, end + 1);
            try {
                JsonNode node = objectMapper.readTree(candidate);
                if (node != null && node.isObject()) {
                    return candidate;
                }
            } catch (Exception ignored) {
            }
        }
        log.warn("JSON 解析失败，返回原始文本片段: {}", truncate(s, 200));
        return "{}";
    }

    private String truncate(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max) + "...";
    }

    private String safe(String s) {
        return s != null ? s : "";
    }
}
