package com.interview.assistant.service;

import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class SkillPackService {

    private final Map<String, String> markdownCache = new ConcurrentHashMap<>();
    private final Map<String, String> fileCache = new ConcurrentHashMap<>();

    public String getMarkdown(String skillId) {
        return markdownCache.computeIfAbsent(skillId, this::loadMarkdown);
    }

    public String getPromptAddendum(String skillId) {
        return getSection(skillId, "## Prompt Addendum");
    }

    public String getReference(String skillId, String fileName) {
        return loadSkillFile(skillId, "references/" + fileName);
    }

    public String getTemplate(String skillId, String fileName) {
        return loadSkillFile(skillId, "templates/" + fileName);
    }

    public List<String> getResourcesSummary(String skillId) {
        return List.of(
                getSection(skillId, "## Resources"),
                getPromptAddendum(skillId)
        );
    }

    public String getSection(String skillId, String heading) {
        String markdown = getMarkdown(skillId);
        if (markdown.isBlank()) return "";
        String[] lines = markdown.split("\\r?\\n");
        boolean collecting = false;
        StringBuilder sb = new StringBuilder();
        for (String line : lines) {
            if (line.trim().equals(heading)) {
                collecting = true;
                continue;
            }
            if (collecting && line.startsWith("## ")) {
                break;
            }
            if (collecting) {
                sb.append(line).append('\n');
            }
        }
        return sb.toString().trim();
    }

    private String loadMarkdown(String skillId) {
        ClassPathResource resource = new ClassPathResource("skill-packs/" + skillId + "/SKILL.md");
        if (!resource.exists()) return "";
        try (InputStream in = resource.getInputStream()) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return "";
        }
    }

    private String loadSkillFile(String skillId, String relativePath) {
        String cacheKey = skillId + "::" + relativePath;
        return fileCache.computeIfAbsent(cacheKey, key -> {
            ClassPathResource resource = new ClassPathResource("skill-packs/" + skillId + "/" + relativePath);
            if (!resource.exists()) return "";
            try (InputStream in = resource.getInputStream()) {
                return new String(in.readAllBytes(), StandardCharsets.UTF_8);
            } catch (IOException e) {
                return "";
            }
        });
    }
}
