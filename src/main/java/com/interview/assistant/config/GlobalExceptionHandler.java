package com.interview.assistant.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

/**
 * 统一异常处理：避免未捕获异常导致连接被重置或代理返回 502。
 * 任何异常都会返回 500 + JSON 错误信息，便于排查。
 * 强制 Content-Type: application/json，避免客户端 Accept: text/html 时无法序列化 Map。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> handleException(Exception e) {
        log.error("未处理异常", e);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return ResponseEntity
                .status(HttpStatus.INTERNAL_SERVER_ERROR)
                .headers(headers)
                .body(Map.of(
                        "error", "INTERNAL_SERVER_ERROR",
                        "message", e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName()
                ));
    }
}
