package com.interview.assistant.entity;

import com.fasterxml.jackson.annotation.JsonView;
import jakarta.persistence.*;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "interview_chat_sessions", indexes = @Index(columnList = "session_id", unique = true))
public class InterviewChatSession {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @JsonView(Views.List.class)
    private Long id;

    @Column(name = "session_id", unique = true, nullable = false)
    @JsonView(Views.List.class)
    private String sessionId;

    @Column(columnDefinition = "TEXT")
    @JsonView(Views.List.class)
    private String questions;

    @Column(columnDefinition = "TEXT")
    @JsonView(Views.Detail.class)
    private String resume;

    @JsonView(Views.List.class)
    private String company;

    @JsonView(Views.List.class)
    private String department;

    @JsonView(Views.List.class)
    private LocalDateTime createdAt = LocalDateTime.now();

    @JsonView(Views.List.class)
    private LocalDateTime endedAt;

    @OneToMany(mappedBy = "session", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("sortOrder ASC, id ASC")
    @JsonView(Views.Detail.class)
    private List<InterviewChatMessage> messages = new ArrayList<>();

    public static class Views {
        public interface List {}
        public interface Detail extends List {}
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }
    public String getQuestions() { return questions; }
    public void setQuestions(String questions) { this.questions = questions; }
    public String getResume() { return resume; }
    public void setResume(String resume) { this.resume = resume; }
    public String getCompany() { return company; }
    public void setCompany(String company) { this.company = company; }
    public String getDepartment() { return department; }
    public void setDepartment(String department) { this.department = department; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getEndedAt() { return endedAt; }
    public void setEndedAt(LocalDateTime endedAt) { this.endedAt = endedAt; }
    public List<InterviewChatMessage> getMessages() { return messages; }
    public void setMessages(List<InterviewChatMessage> messages) { this.messages = messages; }
}
