package com.interview.assistant.controller;

import com.interview.assistant.service.CodeExecutionService;
import com.interview.assistant.service.CodeExecutionService.ExecutionResult;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/execute")
@CrossOrigin
public class CodeExecutionController {

    private final CodeExecutionService executionService;

    public CodeExecutionController(CodeExecutionService executionService) {
        this.executionService = executionService;
    }

    @PostMapping
    public ResponseEntity<ExecutionResult> execute(@RequestBody Map<String, Object> request) {
        String language = (String) request.getOrDefault("language", "python");
        String code = (String) request.get("code");
        String stdin = (String) request.getOrDefault("stdin", "");
        Boolean acmMode = (Boolean) request.getOrDefault("acmMode", false);

        if (code == null) {
            return ResponseEntity.badRequest().build();
        }

        ExecutionResult result = executionService.execute(language, code, stdin, acmMode);
        return ResponseEntity.ok(result);
    }
}
