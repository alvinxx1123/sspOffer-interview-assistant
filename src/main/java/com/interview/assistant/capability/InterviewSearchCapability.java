package com.interview.assistant.capability;

import com.interview.assistant.service.RagService;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.stream.Collectors;

@Component
public class InterviewSearchCapability {

    private final RagService ragService;

    public InterviewSearchCapability(RagService ragService) {
        this.ragService = ragService;
    }

    public String search(String query, String company, String department, int maxResults) {
        if (query == null || query.isBlank()) {
            query = (company != null ? company : "") + " " + (department != null ? department : "") + " 面试 面经";
        }
        String c = (company != null && !company.isBlank()) ? company.trim() : null;
        String d = (department != null && !department.isBlank()) ? department.trim() : null;
        List<String> results = ragService.search(query, c, d, maxResults);
        if (results.isEmpty()) {
            return "未找到相关面经。可提醒用户先录入面经或换一个公司/部门再试。";
        }
        return results.stream()
                .map(t -> t.length() > 600 ? t.substring(0, 600) + "..." : t)
                .collect(Collectors.joining("\n\n---\n\n"));
    }
}
