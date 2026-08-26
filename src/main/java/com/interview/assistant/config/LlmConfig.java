package com.interview.assistant.config;

import dev.langchain4j.agent.tool.ToolSpecification;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.model.StreamingResponseHandler;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.model.chat.StreamingChatLanguageModel;
import dev.langchain4j.model.openai.OpenAiChatModel;
import dev.langchain4j.model.openai.OpenAiStreamingChatModel;
import dev.langchain4j.model.output.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

import java.time.Duration;
import java.util.List;
import java.util.function.Supplier;

/**
 * 大模型 Provider（OpenAI 兼容协议）。
 * 全部通过 ModelConfigHolder 读取 apiKey/baseUrl/model，支持运行时切换；未配置则启动失败。
 * 包装器在配置版本变化时自动重建底层 OpenAiChatModel，调用方无感知。
 *
 * 角色（温度/maxTokens 差异化，模型名可单独覆盖，否则用基础模型）：
 * - primary：通用对话/出题兜底
 * - questionChatModel：出题（更大 maxTokens）
 * - questionStreamingChatModel：出题 SSE 流式
 * - interviewChatModel：面试对话（更高 maxTokens 防截断）
 * - replayChatModel：复盘（更低温度）
 */
@Configuration
public class LlmConfig {

    private static final Logger log = LoggerFactory.getLogger(LlmConfig.class);
    private static final Duration TIMEOUT = Duration.ofMinutes(2);

    @Bean
    @Primary
    public ChatLanguageModel chatLanguageModel(ModelConfigHolder holder) {
        return new DynamicChatModel(holder, () -> holder.getLlmModel(), 0.7, 2048, "primary");
    }

    @Bean("questionChatModel")
    public ChatLanguageModel questionChatModel(ModelConfigHolder holder) {
        return new DynamicChatModel(holder, holder::getQuestionModel, 0.7, 8192, "question");
    }

    @Bean("questionStreamingChatModel")
    public StreamingChatLanguageModel questionStreamingChatModel(ModelConfigHolder holder) {
        return new DynamicStreamingChatModel(holder, holder::getQuestionModel, 0.7, 8192, "question-stream");
    }

    @Bean("interviewChatModel")
    public ChatLanguageModel interviewChatModel(ModelConfigHolder holder) {
        return new DynamicChatModel(holder, holder::getChatModel, 0.7, 4096, "chat");
    }

    @Bean("replayChatModel")
    public ChatLanguageModel replayChatModel(ModelConfigHolder holder) {
        return new DynamicChatModel(holder, holder::getReplayModel, 0.5, 8192, "replay");
    }

    /** 动态 ChatLanguageModel：持有底层模型快照与对应配置版本，版本变化时重建。 */
    static class DynamicChatModel implements ChatLanguageModel {
        private final ModelConfigHolder holder;
        private final Supplier<String> modelSupplier;
        private final double temperature;
        private final int maxTokens;
        private final String role;

        private volatile ChatLanguageModel delegate;
        private volatile long builtVersion = -1;

        DynamicChatModel(ModelConfigHolder holder, Supplier<String> modelSupplier,
                         double temperature, int maxTokens, String role) {
            this.holder = holder;
            this.modelSupplier = modelSupplier;
            this.temperature = temperature;
            this.maxTokens = maxTokens;
            this.role = role;
        }

        @Override
        public Response<AiMessage> generate(List<ChatMessage> messages) {
            return current().generate(messages);
        }

        @Override
        public Response<AiMessage> generate(List<ChatMessage> messages, List<ToolSpecification> toolSpecifications) {
            return current().generate(messages, toolSpecifications);
        }

        @Override
        public Response<AiMessage> generate(List<ChatMessage> messages, ToolSpecification toolSpecification) {
            return current().generate(messages, toolSpecification);
        }

        private ChatLanguageModel current() {
            long v = holder.getLlmVersion();
            ChatLanguageModel d = delegate;
            if (d != null && v == builtVersion) return d;
            synchronized (this) {
                if (delegate != null && holder.getLlmVersion() == builtVersion) return delegate;
                ensureConfigured();
                delegate = OpenAiChatModel.builder()
                        .baseUrl(holder.getLlmBaseUrl())
                        .apiKey(holder.getLlmApiKey())
                        .modelName(modelSupplier.get())
                        .temperature(temperature)
                        .maxTokens(maxTokens)
                        .timeout(TIMEOUT)
                        .build();
                builtVersion = holder.getLlmVersion();
                log.info("重建 LLM 模型[{}] model={}", role, modelSupplier.get());
                return delegate;
            }
        }

        private void ensureConfigured() {
            if (!holder.isLlmConfigured()) {
                throw new IllegalStateException("LLM API Key 未配置。请设置环境变量 LLM_API_KEY（或 DEEPSEEK_API_KEY），或在前端「设置」页填入。");
            }
        }
    }

    /** 动态 StreamingChatLanguageModel：同上，用于 SSE 流式生成。 */
    static class DynamicStreamingChatModel implements StreamingChatLanguageModel {
        private final ModelConfigHolder holder;
        private final Supplier<String> modelSupplier;
        private final double temperature;
        private final int maxTokens;
        private final String role;

        private volatile StreamingChatLanguageModel delegate;
        private volatile long builtVersion = -1;

        DynamicStreamingChatModel(ModelConfigHolder holder, Supplier<String> modelSupplier,
                                  double temperature, int maxTokens, String role) {
            this.holder = holder;
            this.modelSupplier = modelSupplier;
            this.temperature = temperature;
            this.maxTokens = maxTokens;
            this.role = role;
        }

        @Override
        public void generate(List<ChatMessage> messages, StreamingResponseHandler<AiMessage> handler) {
            current().generate(messages, handler);
        }

        private StreamingChatLanguageModel current() {
            long v = holder.getLlmVersion();
            StreamingChatLanguageModel d = delegate;
            if (d != null && v == builtVersion) return d;
            synchronized (this) {
                if (delegate != null && holder.getLlmVersion() == builtVersion) return delegate;
                if (!holder.isLlmConfigured()) {
                    throw new IllegalStateException("LLM API Key 未配置。请设置环境变量 LLM_API_KEY（或 DEEPSEEK_API_KEY），或在前端「设置」页填入。");
                }
                delegate = OpenAiStreamingChatModel.builder()
                        .baseUrl(holder.getLlmBaseUrl())
                        .apiKey(holder.getLlmApiKey())
                        .modelName(modelSupplier.get())
                        .temperature(temperature)
                        .maxTokens(maxTokens)
                        .timeout(TIMEOUT)
                        .build();
                builtVersion = holder.getLlmVersion();
                log.info("重建 Streaming LLM 模型[{}] model={}", role, modelSupplier.get());
                return delegate;
            }
        }
    }
}
