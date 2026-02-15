package com.interview.assistant.service;

import dev.langchain4j.memory.chat.MessageWindowChatMemory;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.service.AiServices;
import dev.langchain4j.service.SystemMessage;
import dev.langchain4j.service.UserMessage;
import dev.langchain4j.service.V;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

@Service
public class InterviewAgentService {

    private final ChatLanguageModel chatModel;
    private final ChatLanguageModel questionChatModel;
    private final ChatLanguageModel replayChatModel;
    private final RagService ragService;

    public InterviewAgentService(ChatLanguageModel chatModel,
                                @Qualifier("questionChatModel") ChatLanguageModel questionChatModel,
                                @Qualifier("replayChatModel") ChatLanguageModel replayChatModel,
                                RagService ragService) {
        this.chatModel = chatModel;
        this.questionChatModel = questionChatModel;
        this.replayChatModel = replayChatModel;
        this.ragService = ragService;
    }

    public interface InterviewCoach {
        @SystemMessage("""
            你是一位资深互联网大厂（阿里、腾讯、字节、美团、华为等）的技术面试官，有多年校招/社招面试经验。
            你的提问风格真实模拟一线大厂面试官：会深挖简历、追问细节、考察真实水平，而非泛泛而谈。
            
            你的提问特点：
            1. 实习经历：追问具体做了什么、承担的角色、遇到的难点、如何解决、数据/效果如何
            2. 项目经历：深挖技术选型原因、架构设计、性能优化、并发/高可用处理、踩过的坑
            3. 专业技术：针对简历提到的技术栈追问原理、源码、对比、最佳实践
            4. 整体考察：综合能力、技术深度、解决问题的能力、项目落地的真实性
            
            提问要像真实面试官一样：具体、有递进性、能区分「背答案」和「真懂」的候选人。用中文回答。
            """)
        @UserMessage("""
            根据面经和简历生成 7-9 个深挖问题。严格按类别输出，必须含八股和大模型题。
            
            目标: {{company}} / {{department}}
            面经: {{context}}
            简历: {{resume}}
            
            输出规则：
            - 直接以编号 1. 2. 3. 开头，禁止任何开场白、称呼、总结
            - 每题控制在 50 字以内，只问核心，不要多句堆砌
            - 顺序：实习 1-2 题、项目 1-2 题、八股至少 2 题、大模型至少 1 题
            """)
        String generateDeepQuestions(@V("company") String company, @V("department") String department, @V("context") String context, @V("resume") String resume);
    }

    public interface ReplayCoach {
        @SystemMessage("""
            你是资深面试复盘教练。根据用户面经内容分两种方式分析：
            
            【若面经只有面试官的问题、没有候选人回答】
            - 分析这场面试的侧重点（考察什么方向、哪些技术栈）
            - 给出针对性的准备建议：该补哪些知识点、怎么组织回答、注意事项
            
            【若面经包含候选人的回答】
            - 结合候选人回答，逐题或按块评估：答对/答偏/答错
            - 答错或答不好的地方：指出正确思路或参考答案、如何改进
            - 整体建议与可补充的知识点
            
            格式要求（必须遵守）：
            用中文。禁止使用 Markdown 符号：不要用 *、**、###、## 做列表或加粗。
            用「数字序号 + 小标题 + 冒号」分段，例如：1. 侧重点： 下面用 (1)(2)(3) 或 直接换行缩进写要点。
            列表用「(1)(2)(3)」或「一、二、三」或换行缩进，不要用 * 或 **。分段用空行。内容完整不要截断。
            """)
        @UserMessage("""
            面试公司：{{company}}，部门：{{department}}
            
            面经内容：
            {{content}}
            
            请按上述规则进行复盘分析（根据是否含候选人回答自动选择分析方式）。
            """)
        String replay(@V("company") String company, @V("department") String department, @V("content") String content);
    }

    public String generateInterviewQuestions(String company, String department, String resume) {
        String c = company != null && !company.trim().isEmpty() ? company.trim() : null;
        String d = department != null && !department.trim().isEmpty() ? department.trim() : null;
        String query = (c != null ? c + " " : "") + (d != null ? d + " " : "") + "互联网技术面试 八股 项目 实习 大模型 算法";
        List<String> relevant = ragService.search(query, c, d, 5);
        String context;
        if (relevant.isEmpty()) {
            context = "暂无相关面经数据。请结合互联网公司常见技术面试知识：八股（Java、Spring、Redis、MySQL、网络、OS、分布式等）、大模型八股（Transformer、RAG、微调、Prompt 等）、项目深挖、系统设计，以及候选人简历生成针对性的深挖问题。";
        } else {
            context = String.join("\n\n---\n\n", relevant.stream()
                    .map(t -> t.length() > 800 ? t.substring(0, 800) + "..." : t)
                    .collect(Collectors.toList()));
        }
        String co = c != null ? c : "通用";
        String de = d != null ? d : "技术";

        InterviewCoach coach = AiServices.builder(InterviewCoach.class)
                .chatLanguageModel(questionChatModel)
                .chatMemory(MessageWindowChatMemory.withMaxMessages(10))
                .build();

        return coach.generateDeepQuestions(co, de, context, resume != null ? resume : "（未提供简历）");
    }

    public String replayInterview(String company, String department, String content) {
        String c = company != null && !company.trim().isEmpty() ? company.trim() : null;
        String d = department != null && !department.trim().isEmpty() ? department.trim() : null;
        String query = (content != null && content.length() > 100)
                ? content.substring(0, Math.min(400, content.length())) + " 面试复盘 考察 八股 项目"
                : (c != null ? c + " " : "") + (d != null ? d + " " : "") + "面试复盘 技术考察 八股 项目";
        List<String> relevant = ragService.search(query, c, d, 5);
        String ragContext = relevant.isEmpty() ? "" : "\n\n【数据库中相关面经参考】\n" + String.join("\n\n---\n\n", relevant.stream()
                .map(t -> t.length() > 600 ? t.substring(0, 600) + "..." : t)
                .collect(Collectors.toList()));
        String fullContent = content + ragContext;
        ReplayCoach coach = AiServices.builder(ReplayCoach.class)
                .chatLanguageModel(replayChatModel)
                .build();
        return coach.replay(c != null ? c : "未知", d != null ? d : "未知", fullContent);
    }

    public String chatWithContext(String query, String company, String department) {
        List<String> relevant = ragService.search(query, company, department, 5);
        String context = relevant.isEmpty() ? "暂无相关数据" : String.join("\n\n", relevant);

        var assistant = AiServices.builder(ChatAssistant.class)
                .chatLanguageModel(chatModel)
                .build();

        return assistant.answer(query, context);
    }

    public interface ChatAssistant {
        @SystemMessage("你是sspOffer面经助手，根据提供的面经数据回答用户问题。用中文回答，简洁专业。")
        @UserMessage("用户问题: {{query}}\n\n参考面经:\n{{context}}\n\n请回答:")
        String answer(@V("query") String query, @V("context") String context);
    }
}
