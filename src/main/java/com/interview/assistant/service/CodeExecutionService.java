package com.interview.assistant.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class CodeExecutionService {

    private static final Logger log = LoggerFactory.getLogger(CodeExecutionService.class);

    @Value("${piston.api-url:https://emkc.org/api/v2/piston}")
    private String pistonApiUrl;
    @Value("${piston.timeout-seconds:30}")
    private int pistonTimeoutSeconds;

    private final WebClient.Builder webClientBuilder;

    private final ObjectMapper objectMapper = new ObjectMapper();

    public CodeExecutionService(WebClient.Builder webClientBuilder) {
        this.webClientBuilder = webClientBuilder;
    }

    private static final Map<String, String> LANGUAGE_MAP = Map.ofEntries(
            Map.entry("java", "java"), Map.entry("python", "python"), Map.entry("py", "python"),
            Map.entry("go", "go"), Map.entry("golang", "go"), Map.entry("cpp", "c++"),
            Map.entry("c++", "c++"), Map.entry("c", "c"), Map.entry("javascript", "javascript"),
            Map.entry("js", "javascript"), Map.entry("typescript", "typescript"), Map.entry("ts", "typescript")
    );

    public ExecutionResult execute(String language, String code, String stdin, boolean acmMode) {
        String baseUrl = (pistonApiUrl != null && !pistonApiUrl.isBlank()) ? pistonApiUrl.trim() : "https://emkc.org/api/v2/piston";
        if (pistonApiUrl == null || pistonApiUrl.isBlank()) {
            log.warn("piston.api-url 未配置，使用默认公网地址。自建 Piston 请在 application.yml 或环境变量 PISTON_API_URL 中配置");
        }
        String pistonLang = LANGUAGE_MAP.getOrDefault(language.toLowerCase(), language.toLowerCase());
        String version = getDefaultVersion(pistonLang);

        try {
            WebClient client = webClientBuilder.baseUrl(baseUrl).build();

            Map<String, Object> requestBody = new HashMap<>();
            requestBody.put("language", pistonLang);
            requestBody.put("version", version);
            String javaCode = code;
            String mainFileName = null;
            if ("java".equals(pistonLang) && code != null) {
                Pattern mainPat = Pattern.compile("public\\s+static\\s+void\\s+main\\s*\\(");
                Matcher mainClassMatcher = Pattern.compile("public\\s+class\\s+(\\w+)").matcher(code);
                if (!mainPat.matcher(code).find()) {
                    javaCode = wrapJavaWithoutMain(code);
                    mainFileName = "Main";
                } else {
                    javaCode = normalizeJavaMainToMain(code);
                    mainFileName = mainClassMatcher.find() ? mainClassMatcher.group(1) : "Main";
                }
            }
            Map<String, Object> fileEntry = new HashMap<>();
            fileEntry.put("content", javaCode);
            if (mainFileName != null) {
                fileEntry.put("name", mainFileName);
            }
            requestBody.put("files", java.util.List.of(fileEntry));
            if (acmMode && stdin != null && !stdin.isEmpty()) {
                requestBody.put("stdin", stdin);
            }

            String response = client.post()
                    .uri("/execute")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(requestBody)
                    .retrieve()
                    .bodyToMono(String.class)
                    .block(Duration.ofSeconds(Math.max(10, pistonTimeoutSeconds)));

            JsonNode node = objectMapper.readTree(response);
            String stdout = node.has("run") && node.get("run").has("stdout")
                    ? node.get("run").get("stdout").asText() : "";
            String stderr = node.has("run") && node.get("run").has("stderr")
                    ? node.get("run").get("stderr").asText() : "";
            int code_ = node.has("run") && node.get("run").has("code")
                    ? node.get("run").get("code").asInt() : -1;

            if (node.has("compile") && node.get("compile").has("stderr")) {
                String compileErr = node.get("compile").get("stderr").asText();
                if (!compileErr.isEmpty()) {
                    return new ExecutionResult("", compileErr, -1);
                }
            }

            return new ExecutionResult(stdout, stderr, code_);
        } catch (Exception e) {
            log.error("Code execution failed", e);
            return new ExecutionResult("", "执行失败: " + e.getMessage(), -1);
        }
    }

    /** Piston 以文件第一个类为入口（忽略 name）。将包含 main 的 public class 移到最前，保留原名（如 test） */
    private String normalizeJavaMainToMain(String code) {
        if (code == null) return code;
        String imports = extractJavaImports(code);
        Matcher m = Pattern.compile("public\\s+class\\s+(\\w+)").matcher(code);
        if (!m.find()) return code;
        int brace = code.indexOf('{', m.end());
        if (brace < 0) return code;
        int depth = 1;
        int end = brace + 1;
        while (end < code.length() && depth > 0) {
            char c = code.charAt(end++);
            if (c == '{') depth++;
            else if (c == '}') depth--;
        }
        String mainBlock = code.substring(m.start(), end);  // 保留原名，不改为 Main
        String rest = (code.substring(0, m.start()) + code.substring(end)).trim();
        String restWithoutImports = rest.replaceAll("(?m)^(package\\s+[^;]+;|import\\s+[^;]+;)\\s*", "").trim();
        return (imports.isEmpty() ? "" : imports + "\n\n") + mainBlock + "\n\n" + restWithoutImports;
    }

    private String extractJavaImports(String code) {
        StringBuilder sb = new StringBuilder();
        for (String line : code.split("\n")) {
            String t = line.trim();
            if (t.startsWith("package ") && t.endsWith(";")) sb.append(line).append("\n");
            else if (t.startsWith("import ") && t.endsWith(";")) sb.append(line).append("\n");
            else if (!t.isEmpty() && !t.startsWith("//") && !t.startsWith("/*")) break;
        }
        return sb.toString().trim();
    }

    /** 当 Java 代码无 main 时，注入 Main 类并调用 Solution.twoSum（常见力扣题） */
    private String wrapJavaWithoutMain(String code) {
        String src = code.replaceFirst("(?i)public\\s+class\\s+Solution", "class Solution");
        return src + "\n\npublic class Main {\n" +
                "    public static void main(String[] args) {\n" +
                "        Solution s = new Solution();\n" +
                "        System.out.println(java.util.Arrays.toString(s.twoSum(new int[]{2, 7, 11, 15}, 9)));\n" +
                "    }\n" +
                "}\n";
    }

    private String getDefaultVersion(String lang) {
        return switch (lang) {
            case "java" -> "15.0.2";
            case "python" -> "3.10.0";
            case "go" -> "1.16.2";
            case "c++" -> "10.2.0";
            case "javascript" -> "18.15.0";
            default -> "*";
        };
    }

    public record ExecutionResult(String stdout, String stderr, int exitCode) {}
}
