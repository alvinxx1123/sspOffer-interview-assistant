package com.interview.assistant.service;

import com.interview.assistant.entity.AlgorithmQuestion;
import com.interview.assistant.repository.AlgorithmQuestionRepository;
import dev.langchain4j.agent.tool.Tool;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Random;
import java.util.stream.Collectors;

/**
 * 面经助手可被大模型调用的工具（Function Calling）。
 * 与 InterviewAgentWithToolsService 配合使用，模型根据用户意图选择调用。
 */
@Component
public class InterviewAssistantTools {

    @Value("${app.base-url:}")
    private String appBaseUrl;

    private final RagService ragService;
    private final AlgorithmQuestionRepository algorithmQuestionRepository;
    private final CodeExecutionService codeExecutionService;
    private final AlgorithmProblemSearchService algorithmProblemSearchService;

    public InterviewAssistantTools(RagService ragService,
                                  AlgorithmQuestionRepository algorithmQuestionRepository,
                                  CodeExecutionService codeExecutionService,
                                  AlgorithmProblemSearchService algorithmProblemSearchService) {
        this.ragService = ragService;
        this.algorithmQuestionRepository = algorithmQuestionRepository;
        this.codeExecutionService = codeExecutionService;
        this.algorithmProblemSearchService = algorithmProblemSearchService;
    }

    @Tool("按公司或部门检索面经内容。当用户想查某公司/部门的面经、面试题、八股时调用。company 和 department 可为空表示不限定。")
    public String searchInterviews(String query, String company, String department) {
        if (query == null || query.isBlank()) {
            query = (company != null ? company : "") + " " + (department != null ? department : "") + " 面试 面经";
        }
        String c = (company != null && !company.isBlank()) ? company.trim() : null;
        String d = (department != null && !department.isBlank()) ? department.trim() : null;
        List<String> results = ragService.search(query, c, d, 5);
        if (results.isEmpty()) {
            return "未找到相关面经。可提醒用户先录入面经或换一个公司/部门再试。";
        }
        return results.stream()
                .map(t -> t.length() > 600 ? t.substring(0, 600) + "..." : t)
                .collect(Collectors.joining("\n\n---\n\n"));
    }

    @Tool("获取题库中的算法题列表。可选按难度筛选：easy / medium / hard。当用户要「一道算法题」「来道题」时调用；若未指定难度则从题库随机抽取一道并返回可跳转的本站在线 IDE 链接。")
    public String listAlgorithmQuestions(String difficulty) {
        List<AlgorithmQuestion> list;
        boolean wantOne = (difficulty == null || difficulty.isBlank() || difficulty.contains("算法题") || difficulty.contains("来道题"));
        if (wantOne) {
            list = algorithmQuestionRepository.findAll();
            if (!list.isEmpty()) {
                AlgorithmQuestion one = list.get(new Random().nextInt(list.size()));
                return "已从本地题库随机抽取一道题（仅此一道，请原样输出本站在线 IDE 链接）：\n" + formatQuestionWithLinks(one);
            }
        }
        if (difficulty != null && !difficulty.isBlank()) {
            list = algorithmQuestionRepository.findByDifficulty(difficulty.trim().toLowerCase());
        } else {
            list = algorithmQuestionRepository.findAll();
        }
        if (list.isEmpty()) {
            return "当前题库暂无题目。可提醒用户到在线 IDE 添加题目。";
        }
        return list.stream()
                .map(q -> String.format("ID:%d 标题:%s 难度:%s", q.getId(), q.getTitle(), q.getDifficulty() != null ? q.getDifficulty() : "-"))
                .collect(Collectors.joining("\n"));
    }

    @Tool("根据题目标题或标题关键词查找一道算法题。若在本站题库中存在则仅返回题目详情与本站在线IDE做题链接（一条URL）；若不存在则返回力扣/牛客等原题链接或力扣搜索链接（一条URL）。用户说「我要搜索插入位置」「给我反转链表」等具体题名时必须调用此工具。注意：找到链接时请直接输出原始 URL（如 https://leetcode.cn/problems/xxx 或本站在线 ide?questionId=），严禁将链接放入 HTML 标签、严禁添加 target='_blank' 或 rel 等属性、严禁输出两遍 URL。")
    public String findAlgorithmQuestionByTitle(String title) {
        if (title == null || title.isBlank()) {
            return "请提供题目标题或关键词，例如：搜索插入位置、反转链表、LRU缓存。";
        }
        String keyword = title.trim();
        List<AlgorithmQuestion> list = algorithmQuestionRepository.findByTitleContainingIgnoreCase(keyword);
        if (list.isEmpty()) {
            // 1) 优先联网搜索：任意不存在的题都通过搜索找原题链接
            String link = algorithmProblemSearchService.searchProblemLink(keyword).orElse(null);
            if (link != null) {
                link = stripLeetcodeQueryParams(link);
                return "该题不在本站题库中。已联网查到原题链接（仅此一条，请原样输出以下 URL）：" + link;
            }
            // 2) 补充：本地 slug 映射（无网络或搜索未命中时仍可返回常见题）
            link = LeetcodeSlugMapping.resolveSlug(keyword)
                    .map(LeetcodeSlugMapping::problemUrl)
                    .orElse(null);
            if (link != null) {
                link = stripLeetcodeQueryParams(link);
                return "该题不在本站题库中。力扣原题链接（仅此一条，请原样输出以下 URL）：" + link;
            }
            // 3) 退回力扣搜索页
            String encoded = URLEncoder.encode(keyword, StandardCharsets.UTF_8);
            String leetcodeSearch = "https://leetcode.cn/problemset/all/?search=" + encoded;
            if (algorithmProblemSearchService.isEnabled()) {
                return "该题不在本站题库中，联网搜索未找到原题页。可点击下方链接在力扣站内搜索（仅此一条，请原样输出该 URL 勿改）：" + leetcodeSearch;
            }
            return "该题不在本站题库中。可点击下方链接在力扣搜索（仅此一条，请原样输出该 URL 勿改）。若需自动联网查任意题目的原题链接，请在配置中设置 app.algorithm-search.enabled=true 并配置 api-key（如 SearchCans），无需逐个添加映射：" + leetcodeSearch;
        }
        AlgorithmQuestion q = list.get(0);
        return formatQuestionWithLinks(q);
    }

    @Tool("根据题目 ID 获取一道算法题的详情（标题、描述、难度、本站在线IDE做题链接）。仅当用户明确说「第几题」「ID 为 x 的题」时调用，否则优先用 findAlgorithmQuestionByTitle 按题名查找。注意：返回链接时只输出原始 URL，严禁 HTML 标签、target/rel、严禁输出两遍 URL。")
    public String getAlgorithmQuestionById(long questionId) {
        return algorithmQuestionRepository.findById(questionId)
                .map(this::formatQuestionWithLinks)
                .orElse("未找到 ID 为 " + questionId + " 的题目。");
    }

    @Tool("运行一段代码并返回执行结果摘要。当用户希望「跑一下代码」「执行这段 Java」时调用。language 支持：java, python, go, javascript, cpp。code 为源代码字符串。返回执行成功时的 stdout 或失败时的错误信息。")
    public String runCode(String language, String code) {
        if (code == null || code.isBlank()) {
            return "代码为空，无法执行。";
        }
        if (language == null || language.isBlank()) {
            language = "java";
        }
        CodeExecutionService.ExecutionResult result = codeExecutionService.execute(language.trim(), code, "", true);
        if (result.exitCode() == 0) {
            String out = result.stdout();
            return out != null && !out.isBlank() ? "执行成功。输出：\n" + (out.length() > 500 ? out.substring(0, 500) + "..." : out) : "执行成功，无标准输出。";
        }
        String err = result.stderr();
        return "执行失败（退出码 " + result.exitCode() + "）：" + (err != null ? err : "未知错误");
    }

    /** 力扣/原题链接去掉 ?envType= 等统计参数，只保留纯净路径。 */
    private static String stripLeetcodeQueryParams(String url) {
        if (url == null || !url.contains("?")) return url;
        return url.split("\\?")[0];
    }

    /** 格式化题目详情。本站题库有题时只返回本站在线 IDE 链接（不返回力扣链接）。 */
    private String formatQuestionWithLinks(AlgorithmQuestion q) {
        StringBuilder sb = new StringBuilder();
        sb.append("题目ID：").append(q.getId()).append("\n");
        sb.append("标题：").append(q.getTitle()).append("\n");
        sb.append("难度：").append(q.getDifficulty() != null ? q.getDifficulty() : "-").append("\n");
        if (q.getDescription() != null && !q.getDescription().isBlank()) {
            String desc = q.getDescription().length() > 400 ? q.getDescription().substring(0, 400) + "..." : q.getDescription();
            sb.append("描述：").append(desc).append("\n");
        }
        if (appBaseUrl != null && !appBaseUrl.isBlank()) {
            String ideUrl = appBaseUrl.replaceAll("/$", "") + "/ide?questionId=" + q.getId();
            sb.append("本站在线IDE做题链接（仅此一条，请原样输出该 URL 勿改）：").append(ideUrl);
        } else {
            sb.append("本站在线IDE：请在配置中设置 app.base-url 后生成链接。");
        }
        return sb.toString();
    }
}
