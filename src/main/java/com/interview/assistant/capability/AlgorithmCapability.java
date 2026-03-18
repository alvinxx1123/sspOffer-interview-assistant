package com.interview.assistant.capability;

import com.interview.assistant.entity.AlgorithmQuestion;
import com.interview.assistant.repository.AlgorithmQuestionRepository;
import com.interview.assistant.service.AlgorithmProblemSearchService;
import com.interview.assistant.service.LeetcodeSlugMapping;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Random;

@Component
public class AlgorithmCapability {

    private final AlgorithmQuestionRepository algorithmQuestionRepository;
    private final AlgorithmProblemSearchService algorithmProblemSearchService;

    @Value("${app.base-url:}")
    private String appBaseUrl;

    public AlgorithmCapability(AlgorithmQuestionRepository algorithmQuestionRepository,
                               AlgorithmProblemSearchService algorithmProblemSearchService) {
        this.algorithmQuestionRepository = algorithmQuestionRepository;
        this.algorithmProblemSearchService = algorithmProblemSearchService;
    }

    public String list(String difficulty) {
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
        StringBuilder sb = new StringBuilder();
        for (AlgorithmQuestion q : list) {
            sb.append(String.format("ID:%d 标题:%s 难度:%s", q.getId(), q.getTitle(), q.getDifficulty() != null ? q.getDifficulty() : "-"));
            sb.append("\n");
        }
        return sb.toString().trim();
    }

    public String findByTitle(String title) {
        if (title == null || title.isBlank()) {
            return "请提供题目标题或关键词，例如：搜索插入位置、反转链表、LRU缓存。";
        }
        String keyword = title.trim();
        List<AlgorithmQuestion> list = algorithmQuestionRepository.findByTitleContainingIgnoreCase(keyword);
        if (list.isEmpty()) {
            String link = algorithmProblemSearchService.searchProblemLink(keyword).orElse(null);
            if (link != null) {
                link = stripQueryParams(link);
                return "该题不在本站题库中。已联网查到原题链接（仅此一条，请原样输出以下 URL）：" + link;
            }
            link = LeetcodeSlugMapping.resolveSlug(keyword)
                    .map(LeetcodeSlugMapping::problemUrl)
                    .orElse(null);
            if (link != null) {
                link = stripQueryParams(link);
                return "该题不在本站题库中。力扣原题链接（仅此一条，请原样输出以下 URL）：" + link;
            }
            String encoded = URLEncoder.encode(keyword, StandardCharsets.UTF_8);
            String leetcodeSearch = "https://leetcode.cn/problemset/all/?search=" + encoded;
            if (algorithmProblemSearchService.isEnabled()) {
                return "该题不在本站题库中，联网搜索未找到原题页。可点击下方链接在力扣站内搜索（仅此一条，请原样输出该 URL 勿改）：" + leetcodeSearch;
            }
            return "该题不在本站题库中。可点击下方链接在力扣搜索（仅此一条，请原样输出该 URL 勿改）。若需自动联网查任意题目的原题链接，请在配置中设置 app.algorithm-search.enabled=true 并配置 api-key（如 SearchCans）：" + leetcodeSearch;
        }
        return formatQuestionWithLinks(list.get(0));
    }

    public String getById(long questionId) {
        return algorithmQuestionRepository.findById(questionId)
                .map(this::formatQuestionWithLinks)
                .orElse("未找到 ID 为 " + questionId + " 的题目。");
    }

    private static String stripQueryParams(String url) {
        if (url == null || !url.contains("?")) return url;
        return url.split("\\?")[0];
    }

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
