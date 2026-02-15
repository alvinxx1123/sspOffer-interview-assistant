package com.interview.assistant.repository;

import com.interview.assistant.entity.InterviewChatMessage;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface InterviewChatMessageRepository extends JpaRepository<InterviewChatMessage, Long> {

    List<InterviewChatMessage> findBySession_IdOrderBySortOrderAscIdAsc(Long sessionId);
}
