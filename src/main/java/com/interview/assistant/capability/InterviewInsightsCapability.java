package com.interview.assistant.capability;

import com.interview.assistant.entity.InterviewExperience;
import com.interview.assistant.repository.InterviewExperienceRepository;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Component
public class InterviewInsightsCapability {

    private static final Set<String> STOP = Set.of(
            "面试", "面经", "问题", "追问", "项目", "实习", "技术", "基础", "介绍", "以及", "如何", "什么",
            "是否", "为什么", "怎么", "一个", "两个", "以上", "相关", "实现", "进行", "自己", "个人"
    );

    private final InterviewExperienceRepository repo;

    public InterviewInsightsCapability(InterviewExperienceRepository repo) {
        this.repo = repo;
    }

    /** 统计某公司/部门的高频考点（简单词频版），用于“面经情报” */
    public String hotTopics(String company, String department, int topN) {
        List<InterviewExperience> list;
        if (company != null && !company.isBlank() && department != null && !department.isBlank()) {
            list = repo.findByCompanyAndDepartment(company.trim(), department.trim());
        } else if (company != null && !company.isBlank()) {
            list = repo.findByCompany(company.trim());
        } else {
            list = repo.findAll();
        }
        if (list == null || list.isEmpty()) {
            return "暂无面经数据。";
        }

        Map<String, Integer> freq = new HashMap<>();
        for (InterviewExperience e : list) {
            addText(freq, e.getBaguQuestions());
            addText(freq, e.getLlmQuestions());
            addText(freq, e.getProjectExperiences());
            addText(freq, e.getProjectExperience());
            addText(freq, e.getInternshipExperiences());
            addText(freq, e.getAlgorithmQuestions());
        }

        List<Map.Entry<String, Integer>> items = new ArrayList<>(freq.entrySet());
        items.sort((a, b) -> Integer.compare(b.getValue(), a.getValue()));
        int n = Math.max(5, Math.min(topN, 30));
        StringBuilder sb = new StringBuilder();
        sb.append("高频考点（简单统计）：\n");
        int count = 0;
        for (var it : items) {
            if (count >= n) break;
            sb.append(count + 1).append(". ").append(it.getKey()).append("（").append(it.getValue()).append("）\n");
            count++;
        }
        return sb.toString().trim();
    }

    private void addText(Map<String, Integer> freq, String s) {
        if (s == null || s.isBlank()) return;
        String cleaned = s.replace('\n', ' ').replace('\r', ' ');
        String[] parts = cleaned.split("[\\s,，;；/|、。！？()（）【】\\[\\]<>《》:：]+ ");
        // 上面 split 的正则末尾带空格，兜底再切一次
        if (parts.length <= 1) {
            parts = cleaned.split("[\\s,，;；/|、。！？()（）【】\\[\\]<>《》:：]+ ");
        }

        // 去重：同一条面经里重复词只计一次，减少刷频
        Set<String> seen = new HashSet<>();
        for (String p : parts) {
            String t = p == null ? "" : p.trim();
            if (t.length() < 2) continue;
            if (STOP.contains(t)) continue;
            // 过滤纯数字
            if (t.matches("\\d+")) continue;
            if (seen.add(t)) {
                freq.put(t, freq.getOrDefault(t, 0) + 1);
            }
        }
    }
}
