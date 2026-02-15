package com.interview.assistant.entity;

import jakarta.persistence.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "algorithm_questions", indexes = {
    @Index(name = "idx_aq_company", columnList = "company"),
    @Index(name = "idx_aq_leetcode_id", columnList = "leetcodeProblemId")
})
public class AlgorithmQuestion {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String title;

    @Column(columnDefinition = "TEXT", nullable = false)
    private String description;

    private String difficulty;

    private String company;

    private String department;

    private Integer leetcodeProblemId;

    private String leetcodeSlug;

    private String defaultCode;

    private String testCases;

    private LocalDateTime createdAt = LocalDateTime.now();

    public String getLeetcodeUrl() {
        if (leetcodeSlug != null && !leetcodeSlug.isEmpty()) {
            return "https://leetcode.cn/problems/" + leetcodeSlug + "/";
        }
        if (leetcodeProblemId != null) {
            return "https://leetcode.cn/problemset/all/?search=" + leetcodeProblemId;
        }
        return null;
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public String getDifficulty() { return difficulty; }
    public void setDifficulty(String difficulty) { this.difficulty = difficulty; }
    public String getCompany() { return company; }
    public void setCompany(String company) { this.company = company; }
    public String getDepartment() { return department; }
    public void setDepartment(String department) { this.department = department; }
    public Integer getLeetcodeProblemId() { return leetcodeProblemId; }
    public void setLeetcodeProblemId(Integer leetcodeProblemId) { this.leetcodeProblemId = leetcodeProblemId; }
    public String getLeetcodeSlug() { return leetcodeSlug; }
    public void setLeetcodeSlug(String leetcodeSlug) { this.leetcodeSlug = leetcodeSlug; }
    public String getDefaultCode() { return defaultCode; }
    public void setDefaultCode(String defaultCode) { this.defaultCode = defaultCode; }
    public String getTestCases() { return testCases; }
    public void setTestCases(String testCases) { this.testCases = testCases; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
