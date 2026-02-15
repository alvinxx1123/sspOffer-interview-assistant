package com.interview.assistant.entity;

import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import com.interview.assistant.deserializer.JsonArrayOrStringDeserializer;
import jakarta.persistence.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "interview_experiences", indexes = {
    @Index(name = "idx_ie_company", columnList = "company"),
    @Index(name = "idx_ie_department", columnList = "department"),
    @Index(name = "idx_ie_source", columnList = "source")
})
public class InterviewExperience {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    @JsonDeserialize(using = JsonArrayOrStringDeserializer.class)
    private String source;

    @Column(nullable = false)
    @JsonDeserialize(using = JsonArrayOrStringDeserializer.class)
    private String company;

    @JsonDeserialize(using = JsonArrayOrStringDeserializer.class)
    private String department;

    @Column(nullable = false)
    @JsonDeserialize(using = JsonArrayOrStringDeserializer.class)
    private String position;

    @JsonDeserialize(using = JsonArrayOrStringDeserializer.class)
    private String type;

    @Column(columnDefinition = "TEXT", nullable = false)
    @JsonDeserialize(using = JsonArrayOrStringDeserializer.class)
    private String content;

    /** 实习经历，多条，JSON 数组 ["实习1","实习2"]。接受数组或字符串输入 */
    @Column(columnDefinition = "TEXT")
    @JsonDeserialize(using = JsonArrayOrStringDeserializer.class)
    private String internshipExperiences;

    /** 实习经历对应面试追问/答案，JSON 数组，与 internshipExperiences 下标一一对应 */
    @Column(columnDefinition = "TEXT")
    @JsonDeserialize(using = JsonArrayOrStringDeserializer.class)
    private String internshipAnswers;

    /** 项目经历，多条，JSON 数组 ["项目1","项目2"]。接受数组或字符串输入 */
    @Column(columnDefinition = "TEXT")
    @JsonDeserialize(using = JsonArrayOrStringDeserializer.class)
    private String projectExperiences;

    /** 项目经历对应面试追问/答案，JSON 数组，与 projectExperiences 下标一一对应 */
    @Column(columnDefinition = "TEXT")
    @JsonDeserialize(using = JsonArrayOrStringDeserializer.class)
    private String projectAnswers;

    @Column(columnDefinition = "TEXT")
    @JsonDeserialize(using = JsonArrayOrStringDeserializer.class)
    private String projectExperience;  // 兼容旧数据

    @Column(columnDefinition = "TEXT")
    @JsonDeserialize(using = JsonArrayOrStringDeserializer.class)
    private String baguQuestions;

    /** 八股题目对应答案，JSON 数组，与 baguQuestions 下标一一对应 */
    @Column(columnDefinition = "TEXT")
    @JsonDeserialize(using = JsonArrayOrStringDeserializer.class)
    private String baguAnswers;

    @Column(columnDefinition = "TEXT")
    @JsonDeserialize(using = JsonArrayOrStringDeserializer.class)
    private String llmQuestions;

    @Column(columnDefinition = "TEXT")
    @JsonDeserialize(using = JsonArrayOrStringDeserializer.class)
    private String algorithmQuestions;

    /** 算法题原题链接，如力扣 URL（单条兼容） */
    @Column(length = 512)
    @JsonDeserialize(using = JsonArrayOrStringDeserializer.class)
    private String algorithmLink;

    /** 算法题对应原题链接，JSON 数组，与 algorithmQuestions 下标一一对应 */
    @Column(columnDefinition = "TEXT")
    @JsonDeserialize(using = JsonArrayOrStringDeserializer.class)
    private String algorithmLinks;

    private LocalDateTime createdAt = LocalDateTime.now();

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }
    public String getCompany() { return company; }
    public void setCompany(String company) { this.company = company; }
    public String getDepartment() { return department; }
    public void setDepartment(String department) { this.department = department; }
    public String getPosition() { return position; }
    public void setPosition(String position) { this.position = position; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }
    public String getInternshipExperiences() { return internshipExperiences; }
    public void setInternshipExperiences(String internshipExperiences) { this.internshipExperiences = internshipExperiences; }
    public String getInternshipAnswers() { return internshipAnswers; }
    public void setInternshipAnswers(String internshipAnswers) { this.internshipAnswers = internshipAnswers; }
    public String getProjectExperiences() { return projectExperiences; }
    public void setProjectExperiences(String projectExperiences) { this.projectExperiences = projectExperiences; }
    public String getProjectAnswers() { return projectAnswers; }
    public void setProjectAnswers(String projectAnswers) { this.projectAnswers = projectAnswers; }
    public String getProjectExperience() { return projectExperience; }
    public void setProjectExperience(String projectExperience) { this.projectExperience = projectExperience; }
    public String getAlgorithmLink() { return algorithmLink; }
    public void setAlgorithmLink(String algorithmLink) { this.algorithmLink = algorithmLink; }
    public String getAlgorithmLinks() { return algorithmLinks; }
    public void setAlgorithmLinks(String algorithmLinks) { this.algorithmLinks = algorithmLinks; }
    public String getBaguQuestions() { return baguQuestions; }
    public void setBaguQuestions(String baguQuestions) { this.baguQuestions = baguQuestions; }
    public String getBaguAnswers() { return baguAnswers; }
    public void setBaguAnswers(String baguAnswers) { this.baguAnswers = baguAnswers; }
    public String getLlmQuestions() { return llmQuestions; }
    public void setLlmQuestions(String llmQuestions) { this.llmQuestions = llmQuestions; }
    public String getAlgorithmQuestions() { return algorithmQuestions; }
    public void setAlgorithmQuestions(String algorithmQuestions) { this.algorithmQuestions = algorithmQuestions; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
