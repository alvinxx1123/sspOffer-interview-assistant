package com.interview.assistant.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonView;
import jakarta.persistence.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "interview_chat_messages")
public class InterviewChatMessage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "session_id", nullable = false)
    private InterviewChatSession session;

    @Column(nullable = false, length = 20)
    private String role; // user | assistant

    @Column(columnDefinition = "TEXT", nullable = false)
    private String content;

    private int sortOrder;

    private LocalDateTime createdAt = LocalDateTime.now();

    @JsonView(InterviewChatSession.Views.Detail.class)
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    @JsonIgnore
    public InterviewChatSession getSession() { return session; }
    public void setSession(InterviewChatSession session) { this.session = session; }
    @JsonView(InterviewChatSession.Views.Detail.class)
    public String getRole() { return role; }
    public void setRole(String role) { this.role = role; }
    @JsonView(InterviewChatSession.Views.Detail.class)
    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }
    @JsonView(InterviewChatSession.Views.Detail.class)
    public int getSortOrder() { return sortOrder; }
    public void setSortOrder(int sortOrder) { this.sortOrder = sortOrder; }
    @JsonView(InterviewChatSession.Views.Detail.class)
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
