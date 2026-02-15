package com.interview.assistant.repository;

import com.interview.assistant.entity.InterviewChatSession;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface InterviewChatSessionRepository extends JpaRepository<InterviewChatSession, Long> {

    Optional<InterviewChatSession> findBySessionId(String sessionId);

    List<InterviewChatSession> findAllByOrderByCreatedAtDesc();
}
