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

    private void addCorsHeaders(HttpServletRequest request, HttpServletResponse response) {
        String origin = request.getHeader("Origin");
        response.setHeader("Access-Control-Allow-Origin", origin != null && !origin.isEmpty() ? origin : "*");
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
        response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Password");
        response.setHeader("Access-Control-Max-Age", "86400");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String method = request.getMethod();
        String path = request.getRequestURI();
        if (!path.startsWith("/api")) {
            chain.doFilter(request, response);
            return;
        }
        // 预检请求直接放行并返回 CORS 头，确保带 X-Admin-Password 的请求能通过
        if ("OPTIONS".equalsIgnoreCase(method)) {
            addCorsHeaders(request, response);
            response.setStatus(HttpServletResponse.SC_OK);
            return;
        }
        if (adminPassword == null || adminPassword.isBlank()) {
            chain.doFilter(request, response);
            return;
        }
        if (!"POST".equalsIgnoreCase(method) && !"PUT".equalsIgnoreCase(method)
                && !"DELETE".equalsIgnoreCase(method) && !"PATCH".equalsIgnoreCase(method)) {
            chain.doFilter(request, response);
            return;
        }
        String header = request.getHeader("X-Admin-Password");
        String expected = adminPassword != null ? adminPassword.trim() : "";
        String actual = header != null ? header.trim() : "";
        if (!expected.isEmpty() && expected.equals(actual)) {
            chain.doFilter(request, response);
            return;
        }
        addCorsHeaders(request, response);
        response.setStatus(403);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"error\":\"需要管理员密码\"}");
    }
}
