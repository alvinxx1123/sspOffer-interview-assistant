package com.interview.assistant.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 运行时模型配置持有者：统一管理 LLM 与 Embedding 的 apiKey/baseUrl/model。
 * - 启动优先级：持久化文件(data/model-config.json) > 环境变量 > application.yml（含 deepseek 与 zhipu 配置向后兼容）
 * - 前端 PUT 更新后写入持久化文件并 bump 版本号，动态模型包装器据此重建底层实例
 * - LLM 换 key 即时生效；Embedding 换配置后需重建 RAG 索引（向量空间可能变化）
 */
@Component
public class ModelConfigHolder {

    private static final Logger log = LoggerFactory.getLogger(ModelConfigHolder.class);
    private static final Path CONFIG_FILE = Paths.get("data", "model-config.json");
    private static final String DEFAULT_LLM_BASE_URL = "https://api.deepseek.com";
    private static final String DEFAULT_EMBEDDING_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
    private static final String DEFAULT_LLM_MODEL = "deepseek-v4-flash";
    private static final String DEFAULT_EMBEDDING_MODEL = "embedding-3";

    private final ObjectMapper mapper = new ObjectMapper();

    @Value("${llm.apiKey:${deepseek.apiKey:}}")
    private String llmApiKeyYml;
    @Value("${llm.baseUrl:${deepseek.baseUrl:}}")
    private String llmBaseUrlYml;
    @Value("${llm.model:${deepseek.model:}}")
    private String llmModelYml;
    @Value("${llm.questionModel:${deepseek.questionModel:}}")
    private String questionModelYml;
    @Value("${llm.chatModel:${deepseek.chatModel:}}")
    private String chatModelYml;
    @Value("${llm.replayModel:${deepseek.replayModel:}}")
    private String replayModelYml;
    @Value("${llm.visionModel:${deepseek.visionModel:}}")
    private String visionModelYml;
    @Value("${llm.visionApiKey:}")
    private String visionApiKeyYml;
    @Value("${llm.visionBaseUrl:}")
    private String visionBaseUrlYml;
    @Value("${embedding.apiKey:${zhipu.apiKey:}}")
    private String embeddingApiKeyYml;

    // ── 可选：Unlimited-OCR（baidu 视觉-语言 OCR，NVIDIA GPU 部署） ──
    @Value("${unlimited-ocr.enabled:false}")
    private boolean unlimitedOcrEnabledYml;
    @Value("${unlimited-ocr.base-url:}")
    private String unlimitedOcrBaseUrlYml;
    @Value("${unlimited-ocr.api-key:}")
    private String unlimitedOcrApiKeyYml;
    @Value("${unlimited-ocr.model:Unlimited-OCR}")
    private String unlimitedOcrModelYml;
    @Value("${unlimited-ocr.timeout-seconds:120}")
    private int unlimitedOcrTimeoutSecondsYml;
    @Value("${unlimited-ocr.prompt:<image>document parsing.}")
    private String unlimitedOcrPromptYml;
    @Value("${embedding.baseUrl:${zhipu.embedding.base-url:}}")
    private String embeddingBaseUrlYml;
    @Value("${embedding.model:${zhipu.embedding.model:embedding-3}}")
    private String embeddingModelYml;

    private volatile String llmApiKey;
    private volatile String llmBaseUrl;
    private volatile String llmModel;
    private volatile String embeddingApiKey;
    private volatile String embeddingBaseUrl;
    private volatile String embeddingModel;

    /** 配置版本号：每次变更自增，动态包装器据此判断是否需要重建底层模型 */
    private final AtomicLong llmVersion = new AtomicLong(0);

    private volatile boolean unlimitedOcrEnabled;
    private volatile String unlimitedOcrBaseUrl;
    private volatile String unlimitedOcrApiKey;
    private volatile String unlimitedOcrModel;
    private volatile int unlimitedOcrTimeoutSeconds;
    private volatile String unlimitedOcrPrompt;

    /** 独立的多模态 LLM 配置（与 LLM 可分属不同 provider，例如 LLM 用 DeepSeek、Vision 用豆包 Ark） */
    private volatile String visionApiKey;
    private volatile String visionBaseUrl;
    private volatile String visionModel;
    private final AtomicLong embeddingVersion = new AtomicLong(0);

    @PostConstruct
    public void init() {
        loadPersistedOrFallback();
    }

    @SuppressWarnings("unchecked")
    private void loadPersistedOrFallback() {
        boolean loaded = false;
        if (Files.exists(CONFIG_FILE)) {
            try {
                Map<String, String> saved = mapper.readValue(Files.readString(CONFIG_FILE), Map.class);
                this.llmApiKey = saved.getOrDefault("llmApiKey", "");
                this.llmBaseUrl = saved.getOrDefault("llmBaseUrl", "");
                this.llmModel = saved.getOrDefault("llmModel", "");
                this.embeddingApiKey = saved.getOrDefault("embeddingApiKey", "");
                this.embeddingBaseUrl = saved.getOrDefault("embeddingBaseUrl", "");
                this.embeddingModel = saved.getOrDefault("embeddingModel", "");
                this.visionApiKey = saved.getOrDefault("visionApiKey", "");
                this.visionBaseUrl = saved.getOrDefault("visionBaseUrl", "");
                this.visionModel = saved.getOrDefault("visionModel", "");
                if (!this.llmApiKey.isBlank() || !this.embeddingApiKey.isBlank() || !this.visionApiKey.isBlank()) {
                    loaded = true;
                    log.info("从 data/model-config.json 加载运行时模型配置");
                }
            } catch (Exception e) {
                log.warn("读取 model-config.json 失败，回退到环境变量/yml: {}", e.getMessage());
            }
        }
        if (!loaded) {
            this.llmApiKey = resolve(this.llmApiKeyYml, "LLM_API_KEY", "DEEPSEEK_API_KEY");
            this.llmBaseUrl = firstNonBlank(this.llmBaseUrlYml, DEFAULT_LLM_BASE_URL);
            this.llmModel = firstNonBlank(this.llmModelYml, DEFAULT_LLM_MODEL);
            this.embeddingApiKey = resolve(this.embeddingApiKeyYml, "EMBEDDING_API_KEY", "ZHIPU_API_KEY");
            this.embeddingBaseUrl = firstNonBlank(this.embeddingBaseUrlYml, DEFAULT_EMBEDDING_BASE_URL);
            this.embeddingModel = firstNonBlank(this.embeddingModelYml, DEFAULT_EMBEDDING_MODEL);
            // vision 在 yml 里没填时回退 LLM（保持向后兼容）
            this.visionApiKey = resolve(this.visionApiKeyYml, "LLM_VISION_API_KEY", "LLM_API_KEY", "DEEPSEEK_API_KEY");
            this.visionBaseUrl = firstNonBlank(this.visionBaseUrlYml, this.llmBaseUrl);
            this.visionModel = firstNonBlank(this.visionModelYml, this.llmModel);
        }
        // vision 配置：优先 runtime 字段；为空用 LLM 同套
        log.info("visionConfig: apiKey={}, baseUrl={}, model={}", mask(this.visionApiKey), mask(this.visionBaseUrl), mask(this.visionModel));
        // vision 配置已在 try-catch 里加载；未填的话下面用 yml 兜底
        // Unlimited-OCR 配置（暂只从 yml/环境变量加载，不支持运行时切换；如需切换重启即可）
        this.unlimitedOcrEnabled = unlimitedOcrEnabledYml;
        this.unlimitedOcrBaseUrl = unlimitedOcrBaseUrlYml != null ? unlimitedOcrBaseUrlYml.trim() : "";
        this.unlimitedOcrApiKey = unlimitedOcrApiKeyYml != null ? unlimitedOcrApiKeyYml.trim() : "";
        this.unlimitedOcrModel = firstNonBlank(unlimitedOcrModelYml, "Unlimited-OCR");
        this.unlimitedOcrTimeoutSeconds = unlimitedOcrTimeoutSecondsYml > 0 ? unlimitedOcrTimeoutSecondsYml : 120;
        this.unlimitedOcrPrompt = firstNonBlank(unlimitedOcrPromptYml, "<image>document parsing.");
        log.info("模型配置就绪: llmBaseUrl={}, llmModel={}, embeddingBaseUrl={}, embeddingModel={}, unlimitedOcr={}",
                mask(this.llmBaseUrl), mask(this.llmModel), mask(this.embeddingBaseUrl), mask(this.embeddingModel),
                (unlimitedOcrEnabled && !unlimitedOcrBaseUrl.isBlank()) ? "on(" + mask(unlimitedOcrBaseUrl) + ")" : "off");
    }

    /** 更新 LLM 配置（null/空表示不修改该项），持久化并 bump 版本 */
    public synchronized void updateLlm(String apiKey, String baseUrl, String model) {
        boolean changed = false;
        if (apiKey != null && !apiKey.isBlank()) { this.llmApiKey = apiKey.trim(); changed = true; }
        if (baseUrl != null && !baseUrl.isBlank()) { this.llmBaseUrl = baseUrl.trim(); changed = true; }
        if (model != null && !model.isBlank()) { this.llmModel = model.trim(); changed = true; }
        if (changed) {
            llmVersion.incrementAndGet();
            persist();
        }
    }

    /** 更新独立的 vision 配置（运行时，可随时切换，不影响 LLM） */
    public synchronized void updateVision(String apiKey, String baseUrl, String model) {
        boolean changed = false;
        if (apiKey != null && !apiKey.isBlank()) { this.visionApiKey = apiKey.trim(); changed = true; }
        else if (apiKey != null && apiKey.isEmpty()) { this.visionApiKey = ""; changed = true; }
        if (baseUrl != null && !baseUrl.isBlank()) { this.visionBaseUrl = baseUrl.trim(); changed = true; }
        else if (baseUrl != null && baseUrl.isEmpty()) { this.visionBaseUrl = ""; changed = true; }
        if (model != null && !model.isBlank()) { this.visionModel = model.trim(); changed = true; }
        else if (model != null && model.isEmpty()) { this.visionModel = ""; changed = true; }
        if (changed) {
            persist();
            log.info("vision 配置已更新: baseUrl={}, model={}", mask(this.visionBaseUrl), mask(this.visionModel));
        }
    }

    public synchronized void updateEmbedding(String apiKey, String baseUrl, String model) {
        boolean changed = false;
        if (apiKey != null && !apiKey.isBlank()) { this.embeddingApiKey = apiKey.trim(); changed = true; }
        if (baseUrl != null && !baseUrl.isBlank()) { this.embeddingBaseUrl = baseUrl.trim(); changed = true; }
        if (model != null && !model.isBlank()) { this.embeddingModel = model.trim(); changed = true; }
        if (changed) {
            embeddingVersion.incrementAndGet();
            persist();
        }
    }

    public String getLlmApiKey() { return llmApiKey; }
    public String getLlmBaseUrl() { return firstNonBlank(llmBaseUrl, DEFAULT_LLM_BASE_URL); }
    public String getLlmModel() { return firstNonBlank(llmModel, DEFAULT_LLM_MODEL); }
    public String getEmbeddingApiKey() { return embeddingApiKey; }
    public String getEmbeddingBaseUrl() { return firstNonBlank(embeddingBaseUrl, DEFAULT_EMBEDDING_BASE_URL); }
    public String getEmbeddingModel() { return firstNonBlank(embeddingModel, DEFAULT_EMBEDDING_MODEL); }

    /** 某角色模型名：运行时未单独覆盖时回退到 yml 角色配置，再回退到基础模型 */
    public String getQuestionModel() { return firstNonBlank(questionModelYml, getLlmModel()); }
    public String getChatModel() { return firstNonBlank(chatModelYml, getLlmModel()); }
    public String getReplayModel() { return firstNonBlank(replayModelYml, getLlmModel()); }

    public long getLlmVersion() { return llmVersion.get(); }
    public long getEmbeddingVersion() { return embeddingVersion.get(); }

    public boolean isUnlimitedOcrEnabled() { return unlimitedOcrEnabled && unlimitedOcrBaseUrl != null && !unlimitedOcrBaseUrl.isBlank(); }
    public String getUnlimitedOcrBaseUrl() { return unlimitedOcrBaseUrl; }
    public String getUnlimitedOcrApiKey() { return unlimitedOcrApiKey; }
    public String getUnlimitedOcrModel() { return unlimitedOcrModel; }
    public int getUnlimitedOcrTimeoutSeconds() { return unlimitedOcrTimeoutSeconds; }
    public String getUnlimitedOcrPrompt() { return unlimitedOcrPrompt; }

    /** 独立 Vision getter：未配置则回退 LLM 配置（保持向后兼容） */
    public String getVisionApiKey() { return firstNonBlank(visionApiKey, llmApiKey); }
    public String getVisionBaseUrl() { return firstNonBlank(visionBaseUrl, llmBaseUrl); }
    public String getVisionModel() { return firstNonBlank(visionModel, getVisionModelYml(), getLlmModel()); }
    public String getVisionModelYml() { return firstNonBlank(visionModelYml, getLlmModel()); }
    public boolean isVisionConfigured() {
        String k = visionApiKey == null ? "" : visionApiKey;
        return !k.isBlank();
    }

    public boolean isLlmConfigured() { return llmApiKey != null && !llmApiKey.isBlank(); }
    public boolean isEmbeddingConfigured() { return embeddingApiKey != null && !embeddingApiKey.isBlank(); }

    private void persist() {
        try {
            if (!Files.exists(CONFIG_FILE.getParent())) Files.createDirectories(CONFIG_FILE.getParent());
            Map<String, String> data = new java.util.LinkedHashMap<>();
            data.put("llmApiKey", nullSafe(llmApiKey));
            data.put("llmBaseUrl", nullSafe(llmBaseUrl));
            data.put("llmModel", nullSafe(llmModel));
            data.put("embeddingApiKey", nullSafe(embeddingApiKey));
            data.put("embeddingBaseUrl", nullSafe(embeddingBaseUrl));
            data.put("embeddingModel", nullSafe(embeddingModel));
            data.put("visionApiKey", nullSafe(visionApiKey));
            data.put("visionBaseUrl", nullSafe(visionBaseUrl));
            data.put("visionModel", nullSafe(visionModel));
            Files.writeString(CONFIG_FILE, mapper.writeValueAsString(data));
        } catch (IOException e) {
            log.warn("持久化 model-config.json 失败: {}", e.getMessage());
        }
    }

    private String resolve(String ymlValue, String... envNames) {
        if (ymlValue != null && !ymlValue.isBlank()) return ymlValue.trim();
        for (String env : envNames) {
            String v = System.getenv(env);
            if (v != null && !v.isBlank()) return v.trim();
        }
        return "";
    }

    private String firstNonBlank(String... values) {
        for (String v : values) if (v != null && !v.isBlank()) return v.trim();
        return "";
    }

    private String nullSafe(String s) { return s == null ? "" : s; }

    private String mask(String s) {
        if (s == null || s.isBlank()) return "(空)";
        return s.length() <= 8 ? "****" : s.substring(0, 4) + "****" + s.substring(s.length() - 3);
    }
}
