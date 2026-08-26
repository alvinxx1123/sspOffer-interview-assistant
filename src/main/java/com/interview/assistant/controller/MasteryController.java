package com.interview.assistant.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.interview.assistant.entity.InternshipProject;
import com.interview.assistant.service.MasteryService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 实习掌握度闭环接口。
 * - POST /api/mastery/projects        上传文档建项目
 * - POST /api/mastery/projects/{id}/generate   SSE 流式生成经历+概念图谱
 * - POST /api/mastery/projects/{id}/diagnose   诊断：图谱+答题→掌握地图
 * - GET  /api/mastery/projects         项目列表
 * - GET  /api/mastery/projects/{id}     项目详情
 * - PUT  /api/mastery/projects/{id}/experience  编辑经历
 * - DELETE /api/mastery/projects/{id}   删除项目
 */
@RestController
@RequestMapping("/api/mastery")
@CrossOrigin
public class MasteryController {

    private static final Logger log = LoggerFactory.getLogger(MasteryController.class);
    private final MasteryService masteryService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public MasteryController(MasteryService masteryService) {
        this.masteryService = masteryService;
    }

    @PostMapping(value = "/projects", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> createProject(
            @RequestParam("files") MultipartFile[] files,
            @RequestParam(value = "name", required = false) String name,
            @RequestParam(value = "company", required = false) String company,
            @RequestParam(value = "role", required = false) String role,
            @RequestParam(value = "startDate", required = false) String startDate,
            @RequestParam(value = "endDate", required = false) String endDate) {
        if (files == null || files.length == 0) {
            return ResponseEntity.badRequest().body(Map.of("error", "请至少上传一个文档"));
        }
        try {
            InternshipProject p = masteryService.createProject(name, company, role, startDate, endDate,
                    java.util.Arrays.asList(files));
            return ResponseEntity.ok(p);
        } catch (Exception e) {
            log.error("createProject failed", e);
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage() != null ? e.getMessage() : "创建失败"));
        }
    }

    @GetMapping("/projects")
    public ResponseEntity<List<InternshipProject>> listProjects() {
        return ResponseEntity.ok(masteryService.listProjects());
    }

    @GetMapping("/projects/{id}")
    public ResponseEntity<InternshipProject> getProject(@PathVariable Long id) {
        InternshipProject p = masteryService.getProject(id);
        return p != null ? ResponseEntity.ok(p) : ResponseEntity.notFound().build();
    }

    @DeleteMapping("/projects/{id}")
    public ResponseEntity<Void> deleteProject(@PathVariable Long id) {
        masteryService.deleteProject(id);
        return ResponseEntity.ok().build();
    }

    @PutMapping("/projects/{id}/experience")
    public ResponseEntity<?> updateExperience(@PathVariable Long id, @RequestBody Map<String, String> body) {
        String text = body != null ? body.getOrDefault("experienceText", "") : "";
        try {
            return ResponseEntity.ok(masteryService.updateExperience(id, text));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage() != null ? e.getMessage() : "更新失败"));
        }
    }

    /** SSE 流式生成经历与概念图谱：step(阶段) / delta(经历增量) / graph(图谱JSON) / result / error */
    @PostMapping(value = "/projects/{id}/generate", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter generate(@PathVariable Long id) {
        SseEmitter emitter = new SseEmitter(180_000L);
        ExecutorService executor = Executors.newSingleThreadExecutor();
        executor.execute(() -> {
            try {
                String result = masteryService.generateExperienceStreaming(id, new MasteryService.StreamCallbacks(
                        step -> {
                            try {
                                emitter.send(SseEmitter.event().name("step")
                                        .data(objectMapper.writeValueAsString(step)));
                            } catch (IOException e) {
                                log.warn("SSE send step failed", e);
                            }
                        },
                        delta -> {
                            try {
                                emitter.send(SseEmitter.event().name("delta").data(delta != null ? delta : ""));
                            } catch (IOException e) {
                                log.warn("SSE send delta failed", e);
                            }
                        },
                        outline -> {
                            try {
                                emitter.send(SseEmitter.event().name("outline").data(outline != null ? outline : ""));
                            } catch (IOException e) {
                                log.warn("SSE send outline failed", e);
                            }
                        },
                        graph -> {
                            try {
                                emitter.send(SseEmitter.event().name("graph").data(graph != null ? graph : ""));
                            } catch (IOException e) {
                                log.warn("SSE send graph failed", e);
                            }
                        }
                ));
                emitter.send(SseEmitter.event().name("result").data(result != null ? result : ""));
            } catch (Exception e) {
                log.error("mastery generate failed", e);
                try {
                    emitter.send(SseEmitter.event().name("error").data(e.getMessage() != null ? e.getMessage() : "生成失败"));
                } catch (IOException ignored) {}
            } finally {
                try {
                    emitter.complete();
                } catch (Exception ignored) {}
                executor.shutdown();
            }
        });
        emitter.onTimeout(() -> {
            executor.shutdownNow();
            emitter.complete();
        });
        emitter.onError(e -> executor.shutdownNow());
        return emitter;
    }

    /** 诊断：提交对各概念 probeQuestion 的回答（JSON: [{concept, question, answer}]），返回掌握地图 */
    @PostMapping("/projects/{id}/diagnose")
    public ResponseEntity<?> diagnose(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        Object answers = body != null ? body.get("answers") : null;
        if (answers == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "answers 不能为空"));
        }
        try {
            String answersJson = answers instanceof String s ? s : objectMapper.writeValueAsString(answers);
            String masteryJson = masteryService.diagnose(id, answersJson);
            return ResponseEntity.ok(Map.of("masteryMap", masteryJson));
        } catch (Exception e) {
            log.error("diagnose failed", e);
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage() != null ? e.getMessage() : "诊断失败"));
        }
    }

    /** 便捷：从项目已有的概念图谱抽取诊断题清单（前端也可直接解析 conceptGraphJson） */
    @GetMapping("/projects/{id}/probes")
    public ResponseEntity<?> probes(@PathVariable Long id) {
        InternshipProject p = masteryService.getProject(id);
        if (p == null) return ResponseEntity.notFound().build();
        if (p.getConceptGraphJson() == null || p.getConceptGraphJson().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "尚未生成概念图谱"));
        }
        return ResponseEntity.ok(Map.of("conceptGraphJson", p.getConceptGraphJson()));
    }

    @SuppressWarnings("unused")
    private JsonNode parseQuiet(String json) {
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }
}
