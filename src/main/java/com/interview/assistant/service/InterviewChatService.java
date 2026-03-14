package com.interview.assistant.service;

import com.interview.assistant.config.PromptTemplates;
import com.interview.assistant.entity.InterviewChatMessage;
import com.interview.assistant.entity.InterviewChatSession;
import com.interview.assistant.repository.InterviewChatMessageRepository;
import com.interview.assistant.repository.InterviewChatSessionRepository;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.data.message.SystemMessage;
import dev.langchain4j.data.message.UserMessage;
import dev.langchain4j.memory.chat.MessageWindowChatMemory;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.model.output.Response;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 面试深挖问题后的上下文探讨聊天服务，支持按会话记忆；会话恢复时从 DB 灌回最近 N 条消息，兼顾不丢记忆与上下文上限。
 */
@Service
public class InterviewChatService {

    /** 从 DB 恢复会话时最多灌回的消息条数（user+assistant 各算一条），避免上下文过长 */
    private static final int MAX_RESTORE_MESSAGES = 20;

    private final ChatLanguageModel chatModel;
    private final RagService ragService;
    private final InterviewChatSessionRepository sessionRepository;
    private final InterviewChatMessageRepository messageRepository;

    /** sessionId -> 会话上下文（含记忆和面试背景） */
    private final Map<String, InterviewSession> sessions = new ConcurrentHashMap<>();

    public InterviewChatService(@Qualifier("interviewChatModel") ChatLanguageModel chatModel,
                               RagService ragService,
                               InterviewChatSessionRepository sessionRepository,
                               InterviewChatMessageRepository messageRepository) {
        this.chatModel = chatModel;
        this.ragService = ragService;
        this.sessionRepository = sessionRepository;
        this.messageRepository = messageRepository;
    }

    public String chat(String sessionId, String userMessage, String questions, String resume, String company, String department) {
        if (sessionId == null || sessionId.isBlank()) {
            throw new IllegalArgumentException("sessionId 不能为空");
        }
        if (userMessage == null || userMessage.isBlank()) {
            throw new IllegalArgumentException("userMessage 不能为空");
        }

        InterviewSession session = sessions.computeIfAbsent(sessionId, id -> buildOrRestoreSession(id, questions, resume));

        synchronized (session) {
            session.memory.add(UserMessage.from(userMessage));

            String c = company != null && !company.isEmpty() ? company : null;
            String d = department != null && !department.isEmpty() ? department : null;
            List<String> ragRelevant = ragService.search(userMessage, c, d, 5);
            String ragContext = ragRelevant.isEmpty() ? "" : "\n\n【相关面经参考，供追问和答疑时参考】\n" + String.join("\n\n---\n\n", ragRelevant.stream()
                    .map(t -> t.length() > 500 ? t.substring(0, 500) + "..." : t)
                    .toList());

            List<ChatMessage> messages = new ArrayList<>();
            messages.add(SystemMessage.from(session.systemContext + ragContext));
            messages.addAll(session.memory.messages());

            Response<AiMessage> response = chatModel.generate(messages);
            AiMessage aiMessage = response.content();
            String text = aiMessage.text();

            session.memory.add(aiMessage);

            // 持久化到数据库
            persistMessage(sessionId, userMessage, text, questions, resume, company, department);
            return text;
        }
    }

    private void persistMessage(String sessionId, String userContent, String aiContent, String questions, String resume, String company, String department) {
        InterviewChatSession dbSession = sessionRepository.findBySessionId(sessionId).orElseGet(() -> {
            InterviewChatSession s = new InterviewChatSession();
            s.setSessionId(sessionId);
            s.setQuestions(questions);
            s.setResume(resume != null && resume.length() > 5000 ? resume.substring(0, 5000) + "..." : resume);
            s.setCompany(company);
            s.setDepartment(department);
            return sessionRepository.save(s);
        });

        int order = messageRepository.findBySession_IdOrderBySortOrderAscIdAsc(dbSession.getId()).size();
        InterviewChatMessage userMsg = new InterviewChatMessage();
        userMsg.setSession(dbSession);
        userMsg.setRole("user");
        userMsg.setContent(userContent);
        userMsg.setSortOrder(order++);
        messageRepository.save(userMsg);

        InterviewChatMessage aiMsg = new InterviewChatMessage();
        aiMsg.setSession(dbSession);
        aiMsg.setRole("assistant");
        aiMsg.setContent(aiContent);
        aiMsg.setSortOrder(order);
        messageRepository.save(aiMsg);
    }

    public void endSession(String sessionId, String questions, String resume, String company, String department) {
        InterviewChatSession dbSession = sessionRepository.findBySessionId(sessionId).orElseGet(() -> {
            InterviewChatSession s = new InterviewChatSession();
            s.setSessionId(sessionId);
            s.setQuestions(questions);
            s.setResume(resume != null && resume.length() > 5000 ? resume.substring(0, 5000) + "..." : resume);
            s.setCompany(company);
            s.setDepartment(department);
            return sessionRepository.save(s);
        });
        dbSession.setEndedAt(java.time.LocalDateTime.now());
        sessionRepository.save(dbSession);
        sessions.remove(sessionId);
    }

    public void deleteSession(String sessionId) {
        sessionRepository.findBySessionId(sessionId).ifPresent(s -> {
            sessions.remove(sessionId);
            sessionRepository.delete(s);
        });
    }

    public void deleteSessionById(Long id) {
        sessionRepository.findById(id).ifPresent(s -> {
            sessions.remove(s.getSessionId());
            sessionRepository.delete(s);
        });
    }

    @Transactional(readOnly = true)
    public InterviewChatSession getSessionById(Long id) {
        return sessionRepository.findById(id)
                .map(s -> {
                    s.getMessages().size();
                    return s;
                })
                .orElse(null);
    }

    public List<InterviewChatSession> listSessions() {
        return sessionRepository.findAllByOrderByCreatedAtDesc();
    }

    @Transactional(readOnly = true)
    public InterviewChatSession getSession(String sessionId) {
        return sessionRepository.findBySessionId(sessionId)
                .map(s -> {
                    s.getMessages().size(); // 触发懒加载
                    return s;
                })
                .orElse(null);
    }

    /** 新建或从 DB 恢复会话：若有历史消息则灌回最近 MAX_RESTORE_MESSAGES 条到 memory */
    private InterviewSession buildOrRestoreSession(String sessionId, String questions, String resume) {
        StringBuilder system = new StringBuilder(PromptTemplates.CHAT_SESSION_SYSTEM);
        if (questions != null && !questions.isBlank()) {
            system.append("\n\n【本场面试深挖问题】\n").append(questions);
        }
        if (resume != null && !resume.isBlank()) {
            system.append("\n\n【候选人简历】\n").append(resume.length() > 2000 ? resume.substring(0, 2000) + "..." : resume);
        }
        MessageWindowChatMemory memory = MessageWindowChatMemory.withMaxMessages(MAX_RESTORE_MESSAGES);
        sessionRepository.findBySessionId(sessionId).ifPresent(dbSession -> {
            List<InterviewChatMessage> all = messageRepository.findBySession_IdOrderBySortOrderAscIdAsc(dbSession.getId());
            int from = Math.max(0, all.size() - MAX_RESTORE_MESSAGES);
            for (int i = from; i < all.size(); i++) {
                InterviewChatMessage msg = all.get(i);
                if ("user".equals(msg.getRole())) {
                    memory.add(UserMessage.from(msg.getContent()));
                } else if ("assistant".equals(msg.getRole())) {
                    memory.add(AiMessage.from(msg.getContent()));
                }
            }
        });
        return new InterviewSession(system.toString(), memory);
    }

    private static class InterviewSession {
        final String systemContext;
        final MessageWindowChatMemory memory;

        InterviewSession(String systemContext, MessageWindowChatMemory memory) {
            this.systemContext = systemContext;
            this.memory = memory;
        }
    }
}
