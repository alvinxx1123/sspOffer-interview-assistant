package com.interview.assistant.capability;

import com.interview.assistant.entity.InterviewExperience;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Component
public class ExperienceCleaningCapability {

    public Map<String, Object> cleanParsedPayload(Map<String, Object> parsed) {
        if (parsed == null) return parsed;
        normalizeTextField(parsed, "company");
        normalizeTextField(parsed, "department");
        normalizeTextField(parsed, "position");
        normalizeTextField(parsed, "type");
        normalizeTextField(parsed, "content");
        dedupeQuestionBlock(parsed, "baguQuestions");
        dedupeQuestionBlock(parsed, "llmQuestions");
        dedupeQuestionBlock(parsed, "algorithmQuestions");
        return parsed;
    }

    public InterviewExperience cleanExperience(InterviewExperience exp) {
        if (exp == null) return null;
        exp.setSource(cleanInline(exp.getSource()));
        exp.setCompany(cleanInline(exp.getCompany()));
        exp.setDepartment(cleanInline(exp.getDepartment()));
        exp.setPosition(cleanInline(exp.getPosition()));
        exp.setType(cleanInline(exp.getType()));
        exp.setContent(cleanBlock(exp.getContent()));
        exp.setBaguQuestions(cleanQuestionBlock(exp.getBaguQuestions()));
        exp.setLlmQuestions(cleanQuestionBlock(exp.getLlmQuestions()));
        exp.setAlgorithmQuestions(cleanQuestionBlock(exp.getAlgorithmQuestions()));
        exp.setProjectExperience(cleanBlock(exp.getProjectExperience()));
        return exp;
    }

    private void normalizeTextField(Map<String, Object> parsed, String key) {
        Object val = parsed.get(key);
        if (val == null) return;
        parsed.put(key, cleanInline(String.valueOf(val)));
    }

    private void dedupeQuestionBlock(Map<String, Object> parsed, String key) {
        Object val = parsed.get(key);
        if (val == null) return;
        parsed.put(key, cleanQuestionBlock(String.valueOf(val)));
    }

    private String cleanQuestionBlock(String raw) {
        if (raw == null || raw.isBlank()) return raw;
        Set<String> unique = new LinkedHashSet<>();
        for (String line : raw.replace("|", " ").split("\\r?\\n")) {
            String cleaned = cleanInline(line)
                    .replaceFirst("^\\d+[.、)]\\s*", "");
            if (!cleaned.isBlank()) {
                unique.add(cleaned);
            }
        }
        return String.join("\n", unique);
    }

    private String cleanBlock(String raw) {
        if (raw == null || raw.isBlank()) return raw;
        List<String> lines = new ArrayList<>();
        for (String line : raw.split("\\r?\\n")) {
            String cleaned = cleanInline(line);
            if (!cleaned.isBlank()) {
                lines.add(cleaned);
            }
        }
        return String.join("\n", lines);
    }

    private String cleanInline(String raw) {
        if (raw == null) return null;
        return raw.replace("介 绍", "介绍")
                .replace("|", " ")
                .replaceAll("\\s+", " ")
                .trim();
    }
}
