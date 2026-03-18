package com.interview.assistant.capability;

import com.interview.assistant.service.CodeExecutionService;
import org.springframework.stereotype.Component;

@Component
public class CodeExecutionCapability {

    private final CodeExecutionService codeExecutionService;

    public CodeExecutionCapability(CodeExecutionService codeExecutionService) {
        this.codeExecutionService = codeExecutionService;
    }

    public String run(String language, String code) {
        if (code == null || code.isBlank()) {
            return "代码为空，无法执行。";
        }
        String lang = (language == null || language.isBlank()) ? "java" : language.trim();
        CodeExecutionService.ExecutionResult result = codeExecutionService.execute(lang, code, "", true);
        if (result.exitCode() == 0) {
            String out = result.stdout();
            return out != null && !out.isBlank()
                    ? "执行成功。输出：\n" + (out.length() > 500 ? out.substring(0, 500) + "..." : out)
                    : "执行成功，无标准输出。";
        }
        String err = result.stderr();
        return "执行失败（退出码 " + result.exitCode() + "）：" + (err != null ? err : "未知错误");
    }
}
