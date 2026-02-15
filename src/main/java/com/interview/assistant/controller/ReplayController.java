package com.interview.assistant.controller;

import com.interview.assistant.entity.UserInterviewRecord;
import com.interview.assistant.repository.UserInterviewRecordRepository;
import com.interview.assistant.service.InterviewAgentService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/replay")
@CrossOrigin
public class ReplayController {

    private final InterviewAgentService agentService;
    private final UserInterviewRecordRepository recordRepository;

    public ReplayController(InterviewAgentService agentService, UserInterviewRecordRepository recordRepository) {
        this.agentService = agentService;
        this.recordRepository = recordRepository;
    }

    @PostMapping("/analyze")
    public ResponseEntity<?> analyze(@RequestBody Map<String, String> request) {
        String company = request.getOrDefault("company", "未知");
        String department = request.getOrDefault("department", "未知");
        String content = request.get("content");
        if (content == null || content.isEmpty()) {
            return ResponseEntity.badRequest().body("面经内容不能为空");
        }
        try {
            String result = agentService.replayInterview(company, department, content);
            if (result == null || result.isBlank()) {
                return ResponseEntity.status(500).body(Map.of("error", "复盘未返回内容，请重试或检查智谱 API"));
            }
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            String msg = e.getMessage() != null ? e.getMessage() : "复盘分析失败，请检查智谱 API 配置或网络";
            return ResponseEntity.status(500).body(Map.of("error", msg));
        }
    }

    /** 保存面经：传 id 则更新已有记录（同一面经多次修改只占一条），否则新建 */
    @PostMapping("/save")
    public ResponseEntity<UserInterviewRecord> save(@RequestBody Map<String, Object> request) {
        UserInterviewRecord record;
        Object idObj = request.get("id");
        if (idObj != null) {
            Long id = idObj instanceof Number ? ((Number) idObj).longValue() : Long.parseLong(String.valueOf(idObj));
            record = recordRepository.findById(id).orElse(null);
        } else {
            record = null;
        }
        if (record == null) {
            record = new UserInterviewRecord();
        }
        record.setCompany((String) request.get("company"));
        record.setDepartment((String) request.get("department"));
        record.setPosition((String) request.get("position"));
        record.setContent((String) request.get("content"));
        record = recordRepository.save(record);
        return ResponseEntity.ok(record);
    }

    @GetMapping("/records")
    public ResponseEntity<List<UserInterviewRecord>> list() {
        return ResponseEntity.ok(recordRepository.findAll());
    }

    @DeleteMapping("/records/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        recordRepository.deleteById(id);
        return ResponseEntity.ok().build();
    }
}
