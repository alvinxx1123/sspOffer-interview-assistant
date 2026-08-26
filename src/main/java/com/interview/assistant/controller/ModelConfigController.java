package com.interview.assistant.controller;

import com.interview.assistant.config.ModelConfigHolder;
import com.interview.assistant.repository.InterviewExperienceRepository;
import com.interview.assistant.service.RagService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 模型配置接口：前端可查看（脱敏）并更新 LLM/Embedding 的 apiKey/baseUrl/model。
 * 更新即时生效（动态模型包装器按版本重建）；Embedding 更新后需调用 reindex 重建向量索引。
 * 所有写操作受 AdminPasswordFilter 保护。
 */
@RestController
@RequestMapping("/api/settings/models")
@CrossOrigin
public class ModelConfigController {

    private static final Logger log = LoggerFactory.getLogger(ModelConfigController.class);
    private final ModelConfigHolder holder;
    private final RagService ragService;
    private final InterviewExperienceRepository experienceRepository;

    public ModelConfigController(ModelConfigHolder holder, RagService ragService,
                                 InterviewExperienceRepository experienceRepository) {
        this.holder = holder;
        this.ragService = ragService;
        this.experienceRepository = experienceRepository;
    }

    /** 查看当前配置（key 脱敏，仅显示首尾） */
    @GetMapping
    public ResponseEntity<Map<String, Object>> get() {
        Map<String, Object> llm = new LinkedHashMap<>();
        llm.put("apiKey", mask(holder.getLlmApiKey()));
        llm.put("baseUrl", holder.getLlmBaseUrl());
        llm.put("model", holder.getLlmModel());
        llm.put("configured", holder.isLlmConfigured());
        Map<String, Object> embedding = new LinkedHashMap<>();
        embedding.put("apiKey", mask(holder.getEmbeddingApiKey()));
        embedding.put("baseUrl", holder.getEmbeddingBaseUrl());
        embedding.put("model", holder.getEmbeddingModel());
        embedding.put("configured", holder.isEmbeddingConfigured());
        // 独立 vision 配置（与多模态 OCR / 图片识别相关；与 LLM 可不同 provider）
        Map<String, Object> vision = new LinkedHashMap<>();
        vision.put("apiKey", mask(holder.getVisionApiKey()));
        vision.put("baseUrl", holder.getVisionBaseUrl());
        vision.put("model", holder.getVisionModel());
        vision.put("configured", holder.isVisionConfigured());
        return ResponseEntity.ok(Map.of("llm", llm, "embedding", embedding, "vision", vision));
    }

    /** 更新配置：传哪个段就改哪个，空值表示不改。embeddingChanged=true 时建议前端随后调 reindex。 */
    @PutMapping
    public ResponseEntity<?> update(@RequestBody Map<String, Object> body) {
        try {
            Map<String, Object> llm = body.get("llm") instanceof Map ? (Map<String, Object>) body.get("llm") : Map.of();
            Map<String, Object> emb = body.get("embedding") instanceof Map ? (Map<String, Object>) body.get("embedding") : Map.of();
            Map<String, Object> vis = body.get("vision") instanceof Map ? (Map<String, Object>) body.get("vision") : Map.of();
            holder.updateLlm(str(llm.get("apiKey")), str(llm.get("baseUrl")), str(llm.get("model")));
            holder.updateEmbedding(str(emb.get("apiKey")), str(emb.get("baseUrl")), str(emb.get("model")));
            // 允许前端选择性更新 vision；传空字符串 = 清空 key/url/model
            holder.updateVision(str(vis.get("apiKey")), str(vis.get("baseUrl")), str(vis.get("model")));
            log.info("模型配置已更新（前端）");
            return get();
        } catch (Exception e) {
            log.error("update model config failed", e);
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage() != null ? e.getMessage() : "更新失败"));
        }
    }

    /** 重建 RAG 向量索引：embedding 换 key/模型后必须调用，否则旧向量与新模型维度不匹配 */
    @PostMapping("/reindex")
    public ResponseEntity<?> reindex() {
        try {
            ragService.clearAll();
            List<?> all = experienceRepository.findAll();
            ragService.indexExperiencesAsync(all.stream()
                    .map(o -> (com.interview.assistant.entity.InterviewExperience) o)
                    .toList());
            log.info("RAG 索引已重建: {} 条面经", all.size());
            return ResponseEntity.ok(Map.of("ok", true, "count", all.size()));
        } catch (Exception e) {
            log.error("reindex failed", e);
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage() != null ? e.getMessage() : "重建失败"));
        }
    }

    private String str(Object o) { return o == null ? null : String.valueOf(o); }

    private String mask(String key) {
        if (key == null || key.isBlank()) return "";
        if (key.length() <= 8) return "****";
        return key.substring(0, 4) + "****" + key.substring(key.length() - 3);
    }
}
