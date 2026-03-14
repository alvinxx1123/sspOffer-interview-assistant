package com.interview.assistant.config;

import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.model.embedding.onnx.allminilml6v2.AllMiniLmL6V2EmbeddingModel;
import dev.langchain4j.store.embedding.EmbeddingStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

import java.io.IOException;

@Configuration
public class AppConfig implements WebMvcConfigurer {

    /** 生产部署：前端打包后放入 static，SPA 路由回退到 index.html */
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/**")
                .addResourceLocations("classpath:/static/")
                .resourceChain(true)
                .addResolver(new PathResourceResolver() {
                    @Override
                    protected Resource getResource(String resourcePath, Resource location) throws IOException {
                        if (resourcePath.startsWith("api")) return null;
                        Resource r = location.createRelative(resourcePath);
                        if (r.exists() && r.isReadable()) return r;
                        return new ClassPathResource("/static/index.html");
                    }
                });
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns("*")
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*");
    }

    /** 智谱 API Key 已配置时使用智谱 Embedding，否则使用本地 AllMiniLM */
    @Bean
    public EmbeddingModel embeddingModel(@Value("${zhipu.apiKey:}") String zhipuApiKey,
                                        WebClient.Builder webClientBuilder) {
        String key = (zhipuApiKey != null && !zhipuApiKey.isBlank()) ? zhipuApiKey : System.getenv("ZHIPU_API_KEY");
        if (key != null && !key.isBlank()) {
            return new ZhipuEmbeddingModel(key, "", "embedding-2", webClientBuilder);
        }
        return new AllMiniLmL6V2EmbeddingModel();
    }

    @Bean
    public EmbeddingStore<TextSegment> embeddingStore() {
        return new InterviewEmbeddingStore();
    }

    @Bean
    public WebClient.Builder webClientBuilder() {
        return WebClient.builder();
    }
}
