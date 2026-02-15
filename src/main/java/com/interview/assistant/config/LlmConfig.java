package com.interview.assistant.config;

import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.model.openai.OpenAiChatModel;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

import java.time.Duration;

/**
 * 使用智谱 GLM（OpenAI 兼容 API）
 * 智谱 API: https://open.bigmodel.cn/api/paas/v4
 */
@Configuration
public class LlmConfig {

    @Value("${zhipu.apiKey:}")
    private String apiKey;

    @Value("${zhipu.model:glm-4-flash}")
    private String model;

    @Value("${zhipu.questionModel:}")
    private String questionModel;

    @Value("${zhipu.chatModel:glm-4-flash}")
    private String chatModel;

    /** 复盘专用：纯文本分析，必须用 flash 等快速模型，不要用 glm-4.6v 等多模态模型 */
    @Value("${zhipu.replayModel:glm-4-flash}")
    private String replayModel;

    private static final String ZHIPU_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

    @Bean
    @Primary
    public ChatLanguageModel chatLanguageModel() {
        String key = (apiKey != null && !apiKey.isEmpty()) ? apiKey : System.getenv("ZHIPU_API_KEY");
        if (key == null || key.isEmpty()) {
            throw new IllegalStateException(
                "智谱 API Key 未配置。请设置环境变量 ZHIPU_API_KEY 或在 application.yml 中配置 zhipu.api-key");
        }
        return OpenAiChatModel.builder()
                .baseUrl(ZHIPU_BASE_URL)
                .apiKey(key)
                .modelName(model)
                .temperature(0.7)
                .maxTokens(2048)
                .timeout(Duration.ofMinutes(2))
                .build();
    }

    /** 深挖问题生成专用：可用更快的 flash 模型提速（questionModel 未配置则返回主模型） */
    @Bean("questionChatModel")
    public ChatLanguageModel questionChatModel(ChatLanguageModel chatLanguageModel) {
        String qModel = (questionModel != null && !questionModel.isBlank()) ? questionModel : model;
        if (qModel.equals(model)) {
            return chatLanguageModel;
        }
        String key = (apiKey != null && !apiKey.isEmpty()) ? apiKey : System.getenv("ZHIPU_API_KEY");
        return OpenAiChatModel.builder()
                .baseUrl(ZHIPU_BASE_URL)
                .apiKey(key)
                .modelName(qModel)
                .temperature(0.7)
                .maxTokens(8192)
                .timeout(Duration.ofMinutes(2))
                .build();
    }

    /** 面试对话专用：快速模型 + 更高 maxTokens 避免截断 */
    @Bean("interviewChatModel")
    public ChatLanguageModel interviewChatModel() {
        String key = (apiKey != null && !apiKey.isEmpty()) ? apiKey : System.getenv("ZHIPU_API_KEY");
        String cm = (chatModel != null && !chatModel.isBlank()) ? chatModel : "glm-4-flash";
        return OpenAiChatModel.builder()
                .baseUrl(ZHIPU_BASE_URL)
                .apiKey(key)
                .modelName(cm)
                .temperature(0.7)
                .maxTokens(4096)
                .timeout(Duration.ofMinutes(2))
                .build();
    }

    /** 面试复盘专用：纯文本分析，固定用 glm-4-flash 等快速模型（不用主 model，主 model 可能是 glm-4.6v 等多模态慢模型） */
    @Bean("replayChatModel")
    public ChatLanguageModel replayChatModel() {
        String key = (apiKey != null && !apiKey.isEmpty()) ? apiKey : System.getenv("ZHIPU_API_KEY");
        String rm = (replayModel != null && !replayModel.isBlank()) ? replayModel : "glm-4-flash";
        return OpenAiChatModel.builder()
                .baseUrl(ZHIPU_BASE_URL)
                .apiKey(key)
                .modelName(rm)
                .temperature(0.5)
                .maxTokens(8192)
                .timeout(Duration.ofMinutes(2))
                .build();
    }
}
