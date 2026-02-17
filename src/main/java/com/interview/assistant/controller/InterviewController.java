package com.interview.assistant.controller;

import com.interview.assistant.entity.InterviewChatSession;
import com.interview.assistant.entity.InterviewExperience;
import com.interview.assistant.service.InterviewDataService;
import com.interview.assistant.service.InterviewAgentService;
import com.interview.assistant.service.InterviewAgentWithToolsService;
import com.interview.assistant.service.InterviewChatService;
import com.interview.assistant.service.ImageParseService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.json.MappingJacksonValue;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/interviews")
@CrossOrigin
public class InterviewController {

    private static final Logger log = LoggerFactory.getLogger(InterviewController.class);
    private final InterviewDataService interviewDataService;
    private final InterviewAgentService agentService;
    private final InterviewAgentWithToolsService agentWithToolsService;
    private final InterviewChatService interviewChatService;
    private final ImageParseService imageParseService;

    public InterviewController(InterviewDataService interviewDataService, InterviewAgentService agentService,
                              InterviewAgentWithToolsService agentWithToolsService,
                              InterviewChatService interviewChatService, ImageParseService imageParseService) {
        this.interviewDataService = interviewDataService;
        this.agentService = agentService;
        this.agentWithToolsService = agentWithToolsService;
        this.interviewChatService = interviewChatService;
        this.imageParseService = imageParseService;
    }

    /** 图片解析：上传面经截图，大模型提取结构化内容 */
    @PostMapping(value = {"/parse-image", "/parseImage"}, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> parseImage(@RequestParam("image") MultipartFile image) {
        if (image.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "请选择图片"));
        }
        try {
            Map<String, Object> parsed = imageParseService.parseImage(image);
            return ResponseEntity.ok(parsed);
        } catch (Exception e) {
            log.error("parseImage failed", e);
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage() != null ? e.getMessage() : "图片解析失败"));
        }
    }

    @GetMapping("/companies")
    public ResponseEntity<List<String>> getCompanies() {
        return ResponseEntity.ok(interviewDataService.getAllCompanies());
    }

    @GetMapping("/companies/{company}/departments")
    public ResponseEntity<List<String>> getDepartments(@PathVariable String company) {
        return ResponseEntity.ok(interviewDataService.getDepartmentsByCompany(company));
    }

    @GetMapping("/search")
    public ResponseEntity<List<InterviewExperience>> search(
            @RequestParam String company,
            @RequestParam(required = false) String department) {
        return ResponseEntity.ok(interviewDataService.search(company, department));
    }

    @PostMapping("/questions")
    public ResponseEntity<?> generateQuestions(@RequestBody Map<String, String> request) {
        String company = request != null ? request.get("company") : null;
        String department = request != null ? request.getOrDefault("department", "") : "";
        String resume = request != null ? request.getOrDefault("resume", "") : "";
        try {
            String result = agentService.generateInterviewQuestions(company, department, resume);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("generateQuestions failed", e);
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage() != null ? e.getMessage() : "生成失败，请检查智谱 API 配置"));
        }
    }

    @PostMapping("/experiences")
    public ResponseEntity<?> addExperiences(@RequestBody List<InterviewExperience> experiences) {
        log.info("POST /experiences 收到请求, 条数: {}", experiences == null ? 0 : experiences.size());
        if (experiences == null || experiences.isEmpty()) {
            return ResponseEntity.badRequest().body("面经列表不能为空");
        }
        try {
            List<InterviewExperience> saved = interviewDataService.saveAll(experiences);
            log.info("POST /experiences 保存完成: {} 条", saved.size());
            return ResponseEntity.ok(saved);
        } catch (Exception e) {
            log.error("POST /experiences 失败", e);
            throw e;
        }
    }

    @DeleteMapping("/experiences/{id}")
    public ResponseEntity<?> deleteExperience(@PathVariable Long id) {
        try {
            interviewDataService.deleteById(id);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("DELETE /experiences/{} 失败", id, e);
            throw e;
        }
    }

    @PostMapping("/experiences/delete")
    public ResponseEntity<?> deleteExperiencePost(@RequestBody Map<String, Object> body) {
        Object idObj = body != null ? body.get("id") : null;
        if (idObj == null) return ResponseEntity.badRequest().build();
        Long id = idObj instanceof Number ? ((Number) idObj).longValue() : Long.parseLong(String.valueOf(idObj));
        try {
            interviewDataService.deleteById(id);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("POST /experiences/delete id={} 失败", id, e);
            throw e;
        }
    }

    @PostMapping("/chat")
    public ResponseEntity<String> chat(@RequestBody Map<String, String> request) {
        String query = request.get("query");
        String company = request.getOrDefault("company", "");
        String department = request.getOrDefault("department", "");
        String result = agentService.chatWithContext(query, company.isEmpty() ? null : company, department.isEmpty() ? null : department);
        return ResponseEntity.ok(result);
    }

    /** 带 Function Calling 的对话：模型可调用面经检索、题库查询、代码执行等工具后回复 */
    @PostMapping("/chat-with-tools")
    public ResponseEntity<?> chatWithTools(@RequestBody Map<String, String> request) {
        String message = request != null ? request.get("message") : null;
        if (message == null || message.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "message 不能为空"));
        }
        try {
            String reply = agentWithToolsService.chat(message);
            return ResponseEntity.ok(Map.of("reply", reply));
        } catch (Exception e) {
            log.error("chatWithTools failed", e);
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage() != null ? e.getMessage() : "对话失败"));
        }
    }

    /** 面试深挖问题后的上下文探讨，支持记忆 */
    @PostMapping("/chat-session")
    public ResponseEntity<?> chatSession(@RequestBody Map<String, String> request) {
        String sessionId = request != null ? request.get("sessionId") : null;
        String userMessage = request != null ? request.get("userMessage") : null;
        String questions = request != null ? request.getOrDefault("questions", "") : "";
        String resume = request != null ? request.getOrDefault("resume", "") : "";
        String company = request != null ? request.getOrDefault("company", "") : "";
        String department = request != null ? request.getOrDefault("department", "") : "";
        if (sessionId == null || sessionId.isBlank() || userMessage == null || userMessage.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "sessionId 和 userMessage 不能为空"));
        }
        try {
            String result = interviewChatService.chat(sessionId, userMessage, questions, resume, company, department);
            return ResponseEntity.ok(Map.of("reply", InterviewAgentWithToolsService.finalFormatting(result)));
        } catch (Exception e) {
            log.error("chatSession failed", e);
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage() != null ? e.getMessage() : "对话失败"));
        }
    }

    /** 结束当前会话，保存到历史（无消息时也会创建会话记录） */
    @PostMapping("/chat-session/end")
    public ResponseEntity<?> endChatSession(@RequestBody Map<String, String> request) {
        String sessionId = request != null ? request.get("sessionId") : null;
        String questions = request != null ? request.getOrDefault("questions", "") : "";
        String resume = request != null ? request.getOrDefault("resume", "") : "";
        String company = request != null ? request.getOrDefault("company", "") : "";
        String department = request != null ? request.getOrDefault("department", "") : "";
        if (sessionId == null || sessionId.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "sessionId 不能为空"));
        }
        try {
            interviewChatService.endSession(sessionId, questions, resume, company, department);
            return ResponseEntity.ok(Map.of("ok", true));
        } catch (Exception e) {
            log.error("endChatSession failed", e);
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage() != null ? e.getMessage() : "结束失败"));
        }
    }

    /** 历史会话列表（不含消息） */
    @GetMapping("/chat-sessions")
    public ResponseEntity<MappingJacksonValue> listChatSessions() {
        List<InterviewChatSession> list = interviewChatService.listSessions();
        MappingJacksonValue wrapper = new MappingJacksonValue(list);
        wrapper.setSerializationView(InterviewChatSession.Views.List.class);
        return ResponseEntity.ok(wrapper);
    }

    /** 按数据库 id 获取会话（必须在 /chat-sessions/{sessionId} 之前声明，避免路径歧义） */
    @GetMapping("/chat-sessions/by-id/{id}")
    public ResponseEntity<?> getChatSessionById(@PathVariable Long id) {
        InterviewChatSession s = interviewChatService.getSessionById(id);
        if (s == null) {
            return ResponseEntity.notFound().build();
        }
        MappingJacksonValue wrapper = new MappingJacksonValue(s);
        wrapper.setSerializationView(InterviewChatSession.Views.Detail.class);
        return ResponseEntity.ok(wrapper);
    }

    /** 按数据库 id 删除 */
    @DeleteMapping("/chat-sessions/by-id/{id}")
    public ResponseEntity<?> deleteChatSessionById(@PathVariable Long id) {
        try {
            interviewChatService.deleteSessionById(id);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("deleteChatSessionById failed", e);
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage() != null ? e.getMessage() : "删除失败"));
        }
    }

    /** 删除历史会话（按 sessionId） */
    @DeleteMapping("/chat-sessions/{sessionId}")
    public ResponseEntity<?> deleteChatSession(@PathVariable String sessionId) {
        try {
            interviewChatService.deleteSession(sessionId);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("deleteChatSession failed", e);
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage() != null ? e.getMessage() : "删除失败"));
        }
    }

    /** 获取单个会话详情（含消息，按 sessionId） */
    @GetMapping("/chat-sessions/{sessionId}")
    public ResponseEntity<?> getChatSession(@PathVariable String sessionId) {
        InterviewChatSession s = interviewChatService.getSession(sessionId);
        if (s == null) {
            return ResponseEntity.notFound().build();
        }
        MappingJacksonValue wrapper = new MappingJacksonValue(s);
        wrapper.setSerializationView(InterviewChatSession.Views.Detail.class);
        return ResponseEntity.ok(wrapper);
    }
}
