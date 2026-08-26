package com.interview.assistant.config;

import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.embedding.EmbeddingModel;
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

    /**
     * 智谱 API Key 已配置时使用智谱 Embedding;否则直接抛错,不再 fallback 到本地 AllMiniLM。
     *
     * <p>原因:langchain4j 0.36.0 传递依赖的 ai.djl.huggingface:tokenizers 在 0.30~0.36 全系
     * 没有 macOS x86_64 native dylib,本地 fallback 在 macOS Intel 上必崩。强制走智谱远程
     * 即可彻底脱离 native 依赖,Windows / Linux / macOS(Intel 与 Apple Silicon)都能启动。
     */
    @Bean
    public EmbeddingModel embeddingModel(ModelConfigHolder holder, WebClient.Builder webClientBuilder) {
        return new ZhipuEmbeddingModel(holder, webClientBuilder);
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
