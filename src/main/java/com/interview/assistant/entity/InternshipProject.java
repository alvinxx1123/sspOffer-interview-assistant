package com.interview.assistant.entity;

import jakarta.persistence.*;

import java.time.LocalDateTime;

/**
 * 实习掌握度闭环项目：承载「文档→经历+概念图谱→诊断掌握地图」全流程状态。
 * - sourceText：上传文档解析后拼成的文本
 * - experienceText：生成的 STAR 经历（可编辑）
 * - conceptGraphJson：概念图谱 JSON（每条经历关联底层概念+诊断题）
 * - masteryMapJson：诊断后的掌握地图 JSON（per-concept 等级+gap+drill）
 */
@Entity
@Table(name = "internship_projects")
public class InternshipProject {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name = "未命名项目";

    private String company;
    private String role;

    private String startDate;
    private String endDate;

    @Column(columnDefinition = "TEXT")
    private String projectOutlineJson;

    @Column(columnDefinition = "TEXT")
    private String sourceText;

    @Column(columnDefinition = "TEXT")
    private String experienceText;

    @Column(columnDefinition = "TEXT")
    private String conceptGraphJson;

    @Column(columnDefinition = "TEXT")
    private String masteryMapJson;

    /** 上传文档逐文件解析状态：JSON 数组 [{filename,status,error?,textLength?}] + 汇总 {successCount,failedCount,totalCount} */
    @Column(columnDefinition = "TEXT")
    private String parseStatusJson;

    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getCompany() { return company; }
    public void setCompany(String company) { this.company = company; }
    public String getRole() { return role; }
    public void setRole(String role) { this.role = role; }
    public String getStartDate() { return startDate; }
    public void setStartDate(String startDate) { this.startDate = startDate; }
    public String getEndDate() { return endDate; }
    public void setEndDate(String endDate) { this.endDate = endDate; }
    public String getProjectOutlineJson() { return projectOutlineJson; }
    public void setProjectOutlineJson(String projectOutlineJson) { this.projectOutlineJson = projectOutlineJson; }
    public String getSourceText() { return sourceText; }
    public void setSourceText(String sourceText) { this.sourceText = sourceText; }
    public String getExperienceText() { return experienceText; }
    public void setExperienceText(String experienceText) { this.experienceText = experienceText; }
    public String getConceptGraphJson() { return conceptGraphJson; }
    public void setConceptGraphJson(String conceptGraphJson) { this.conceptGraphJson = conceptGraphJson; }
    public String getMasteryMapJson() { return masteryMapJson; }
    public void setMasteryMapJson(String masteryMapJson) { this.masteryMapJson = masteryMapJson; }
    public String getParseStatusJson() { return parseStatusJson; }
    public void setParseStatusJson(String parseStatusJson) { this.parseStatusJson = parseStatusJson; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
