package com.interview.assistant.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * 简单密码保护：对 POST/PUT/DELETE/PATCH 请求要求 X-Admin-Password 与配置一致。
 * 若 app.admin-password 未配置或为空，则不校验（方便本地开发）。
 */
@Component
@Order(1)
public class AdminPasswordFilter extends OncePerRequestFilter {

    @Value("${app.admin-password:}")
    private String adminPassword;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (adminPassword == null || adminPassword.isBlank()) {
            chain.doFilter(request, response);
            return;
        }
        String method = request.getMethod();
        String path = request.getRequestURI();
        if (!path.startsWith("/api")) {
            chain.doFilter(request, response);
            return;
        }
        if (!"POST".equalsIgnoreCase(method) && !"PUT".equalsIgnoreCase(method)
                && !"DELETE".equalsIgnoreCase(method) && !"PATCH".equalsIgnoreCase(method)) {
            chain.doFilter(request, response);
            return;
        }
        String header = request.getHeader("X-Admin-Password");
        if (adminPassword.equals(header)) {
            chain.doFilter(request, response);
            return;
        }
        response.setStatus(403);
        response.setContentType("application/json;charset=UTF-8");
        response.setHeader("Access-Control-Allow-Origin", request.getHeader("Origin") != null ? request.getHeader("Origin") : "*");
        response.setHeader("Access-Control-Allow-Credentials", "true");
        response.getWriter().write("{\"error\":\"需要管理员密码\"}");
    }
}
