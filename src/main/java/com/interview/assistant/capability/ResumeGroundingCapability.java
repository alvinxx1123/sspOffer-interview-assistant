package com.interview.assistant.capability;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

@Component
public class ResumeGroundingCapability {

    private static final String[] TECH_KEYWORDS = {
            "Java", "Spring", "Spring Boot", "MySQL", "Redis", "Kafka", "RocketMQ", "Elasticsearch",
            "Docker", "Kubernetes", "LangChain", "LangChain4j", "RAG", "Agent", "LLM",
            "Transformer", "Prompt", "Monaco", "React", "Vite", "H2", "JPA", "Netty", "Nginx"
    };

    public String buildCandidateProfile(String resume) {
        if (resume == null || resume.isBlank()) {
            return "暂无候选人画像（未提供简历）。";
        }
        String normalized = resume.replace("\r", "").trim();
        List<String> internships = extractRelevantLines(normalized, "实习");
        List<String> projects = extractRelevantLines(normalized, "项目");
        Set<String> techStack = extractTechStack(normalized);

        StringBuilder sb = new StringBuilder();
        if (!internships.isEmpty()) {
            sb.append("实习经历：").append(String.join("；", limit(internships, 3))).append('\n');
        }
        if (!projects.isEmpty()) {
            sb.append("项目经历：").append(String.join("；", limit(projects, 4))).append('\n');
        }
        if (!techStack.isEmpty()) {
            sb.append("技术栈：").append(String.join("、", techStack)).append('\n');
        }
        sb.append("出题偏好：优先围绕候选人明确写过的项目模块、性能优化、系统设计、Java 后端基础与 AI/Agent 实战。");
        return sb.toString().trim();
    }

    public String buildSearchTerms(String resume) {
        Set<String> techStack = extractTechStack(resume);
        return String.join(" ", techStack);
    }

    private List<String> extractRelevantLines(String text, String keyword) {
        List<String> lines = new ArrayList<>();
        for (String line : text.split("\\n")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) continue;
            if (trimmed.contains(keyword) || trimmed.matches(".*(负责|设计|实现|优化|搭建|项目|系统).*")) {
                lines.add(trimmed);
            }
        }
        return lines;
    }

    private Set<String> extractTechStack(String resume) {
        Set<String> hit = new LinkedHashSet<>();
        if (resume == null || resume.isBlank()) return hit;
        String lower = resume.toLowerCase();
        for (String keyword : TECH_KEYWORDS) {
            if (lower.contains(keyword.toLowerCase())) {
                hit.add(keyword);
            }
        }
        return hit;
    }

    private List<String> limit(List<String> source, int max) {
        return source.subList(0, Math.min(max, source.size()));
    }
}

