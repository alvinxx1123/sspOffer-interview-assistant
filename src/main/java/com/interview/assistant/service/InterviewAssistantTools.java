package com.interview.assistant.service;

import com.interview.assistant.capability.AlgorithmCapability;
import com.interview.assistant.capability.CodeExecutionCapability;
import com.interview.assistant.capability.InterviewInsightsCapability;
import com.interview.assistant.capability.InterviewSearchCapability;
import dev.langchain4j.agent.tool.Tool;
import org.springframework.stereotype.Component;

/**
 * 面经助手可被大模型调用的工具（Function Calling）。
 *
 * 说明：这里仍然是 Tool（Function Calling 的入口），但具体业务实现下沉到 Capability 中，
 * 避免与 Codex/OpenAI 风格的 .md skill 包概念混淆，也更便于复用、测试与扩展。
 */
@Component
public class InterviewAssistantTools {

    private final InterviewSearchCapability interviewSearchCapability;
    private final AlgorithmCapability algorithmCapability;
    private final CodeExecutionCapability codeExecutionCapability;
    private final InterviewInsightsCapability interviewInsightsCapability;

    public InterviewAssistantTools(InterviewSearchCapability interviewSearchCapability,
                                   AlgorithmCapability algorithmCapability,
                                   CodeExecutionCapability codeExecutionCapability,
                                   InterviewInsightsCapability interviewInsightsCapability) {
        this.interviewSearchCapability = interviewSearchCapability;
        this.algorithmCapability = algorithmCapability;
        this.codeExecutionCapability = codeExecutionCapability;
        this.interviewInsightsCapability = interviewInsightsCapability;
    }

    @Tool("按公司或部门检索面经内容。当用户想查某公司/部门的面经、面试题、八股时调用。company 和 department 可为空表示不限定。")
    public String searchInterviews(String query, String company, String department) {
        return interviewSearchCapability.search(query, company, department, 5);
    }

    @Tool("获取题库中的算法题列表。可选按难度筛选：easy / medium / hard。当用户要「一道算法题」「来道题」时调用；若未指定难度则从题库随机抽取一道并返回可跳转的本站在线 IDE 链接。")
    public String listAlgorithmQuestions(String difficulty) {
        return algorithmCapability.list(difficulty);
    }

    @Tool("根据题目标题或标题关键词查找一道算法题。若在本站题库中存在则仅返回题目详情与本站在线IDE做题链接（一条URL）；若不存在则返回力扣/牛客等原题链接或力扣搜索链接（一条URL）。用户说「我要搜索插入位置」「给我反转链表」等具体题名时必须调用此工具。注意：找到链接时请直接输出原始 URL，严禁将链接放入 HTML 标签、严禁添加 target='_blank' 或 rel 等属性、严禁输出两遍 URL。")
    public String findAlgorithmQuestionByTitle(String title) {
        return algorithmCapability.findByTitle(title);
    }

    @Tool("根据题目 ID 获取一道算法题的详情（标题、描述、难度、本站在线IDE做题链接）。仅当用户明确说「第几题」「ID 为 x 的题」时调用，否则优先用 findAlgorithmQuestionByTitle 按题名查找。注意：返回链接时只输出原始 URL，严禁 HTML 标签、target/rel、严禁输出两遍 URL。")
    public String getAlgorithmQuestionById(long questionId) {
        return algorithmCapability.getById(questionId);
    }

    @Tool("运行一段代码并返回执行结果摘要。当用户希望「跑一下代码」「执行这段 Java」时调用。language 支持：java, python, go, javascript, cpp。code 为源代码字符串。返回执行成功时的 stdout 或失败时的错误信息。")
    public String runCode(String language, String code) {
        return codeExecutionCapability.run(language, code);
    }

    @Tool("生成面经高频考点统计。当用户问「这个公司高频考什么」「八股高频」时调用。company/department 可空。")
    public String interviewHotTopics(String company, String department) {
        return interviewInsightsCapability.hotTopics(company, department, 12);
    }
}
