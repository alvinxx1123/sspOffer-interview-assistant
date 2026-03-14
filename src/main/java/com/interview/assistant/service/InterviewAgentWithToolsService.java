package com.interview.assistant.service;

import com.interview.assistant.entity.AlgorithmQuestion;
import com.interview.assistant.repository.AlgorithmQuestionRepository;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.service.AiServices;
import com.interview.assistant.config.PromptTemplates;
import dev.langchain4j.service.SystemMessage;
import dev.langchain4j.service.UserMessage;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Random;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 带 Function Calling（Tool Use）的面试助手：模型可根据用户意图调用
 * 面经检索、题库查询、代码执行等工具，再根据工具结果生成自然语言回复。
 * 「查询算法题」分支在本类内单独处理，直接返回标准 Markdown，零 HTML，避免乱码与空白页。
 */
@Service
public class InterviewAgentWithToolsService {

    private final ChatLanguageModel chatModel;
    private final InterviewAssistantTools tools;
    private final AlgorithmQuestionRepository algorithmQuestionRepository;
    private final AlgorithmProblemSearchService algorithmProblemSearchService;

    @Value("${app.base-url:}")
    private String appBaseUrl;

    public InterviewAgentWithToolsService(@Qualifier("interviewChatModel") ChatLanguageModel chatModel,
                                         InterviewAssistantTools tools,
                                         AlgorithmQuestionRepository algorithmQuestionRepository,
                                         AlgorithmProblemSearchService algorithmProblemSearchService) {
        this.chatModel = chatModel;
        this.tools = tools;
        this.algorithmQuestionRepository = algorithmQuestionRepository;
        this.algorithmProblemSearchService = algorithmProblemSearchService;
    }

    public interface AssistantWithTools {
        @SystemMessage(PromptTemplates.TOOLS_ASSISTANT_SYSTEM)
        @UserMessage("{{message}}")
        String chat(String message);
    }

    private volatile AssistantWithTools assistant;

    private AssistantWithTools getAssistant() {
        if (assistant == null) {
            synchronized (this) {
                if (assistant == null) {
                    assistant = AiServices.builder(AssistantWithTools.class)
                            .chatLanguageModel(chatModel)
                            .tools(tools)
                            .build();
                }
            }
        }
        return assistant;
    }

    /**
     * 用户发送一条消息，助手可自动选择调用工具后回复。
     * 「查询算法题」类请求在本方法内直接处理，不经过 LLM，保证只输出一条有效链接且零 HTML。
     */
    public String chat(String userMessage) {
        if (userMessage == null || userMessage.isBlank()) {
            return "请输入您的问题，例如：查一下字节后端的面经、给我一道中等难度的算法题、运行这段 Java 代码。";
        }
        String msg = userMessage.trim();
        String result = isAlgorithmQuery(msg)
                ? handleAlgorithmQuery(msg)
                : finalFormatting(getAssistant().chat(msg));
        return fixMalformedLinkInResponse(result);
    }

    // ==================== 仅处理「查询算法题」的逻辑，不涉及查面经/运行代码 ====================

    /** 是否属于「要算法题/要题目」类请求。优先命中，避免走 LLM 输出 HTML 导致乱码与空白页。 */
    private boolean isAlgorithmQuery(String message) {
        if (message == null || message.isBlank()) return false;
        String m = message.trim().replaceAll("\\s+", " ");
        // 短句且含「算法题/一道题」直接走算法分支（如「给我一道算法题」）
        if (m.length() <= 25 && (m.contains("算法题") || m.contains("一道题"))) return true;
        return m.matches(".*(给|来|推荐).*(算法题|一道题|题目).*")
                || m.matches(".*(一道|来道).*题.*")
                || m.contains("算法题")
                || m.contains("一道算法题");
    }

    /** 从用户输入中提取题目标题关键词（如「给我一道编辑距离的算法题」→「编辑距离」）。去掉“给我一道”“的”“算法题”等前缀后缀。 */
    private String extractKeyword(String userQuery) {
        if (userQuery == null) return "";
        String s = userQuery
                .replaceAll("(?i)(给我|来一道|推荐一道|一道|的|算法题|查询|搜索|一下)", " ")
                .replaceAll("\\s+", " ")
                .trim();
        return s.isEmpty() ? "" : s;
    }

    /**
     * 算法题专用：随机抽题 / 指定题（本地优先 → 联网），只返回一条纯净 URL 的标准 Markdown。
     * ❌ 严禁在 URL 或描述中拼接 &lt;a href=、target="_blank" 等 HTML；URL 必须是纯净 http 字符串。
     */
    private String handleAlgorithmQuery(String userQuery) {
        String finalTitle = "";
        String finalUrl = "";
        String desc = "";
        boolean found = false;

        // 步骤 A：意图识别（随机 vs 指定）
        // 随机：输入模糊且不包含具体算法名（如仅“给我一道算法题”“来道题”）；指定：含具体题名（如“编辑距离”“反转链表”）
        String keyword = extractKeyword(userQuery);
        boolean isRandom = (userQuery.matches(".*(给|来|推荐).*(算法题|一道题|题目).*") || userQuery.contains("来道题"))
                && (keyword.isEmpty() || keyword.length() <= 2 || "题".equals(keyword) || "算法题".equals(keyword));

        if (isRandom) {
            List<AlgorithmQuestion> all = algorithmQuestionRepository.findAll();
            if (all != null && !all.isEmpty()) {
                AlgorithmQuestion q = all.get(new Random().nextInt(all.size()));
                finalTitle = q.getTitle() != null ? q.getTitle() : "题目";
                finalUrl = buildLocalIdeUrl(q.getId());
                desc = "已为您随机抽取一道题，难度：" + (q.getDifficulty() != null ? q.getDifficulty() : "-") + "。";
                found = true;
            }
        }

        // 步骤 B：指定题目查询（本地 vs 联网）
        if (!found) {
            if (keyword.isEmpty()) keyword = userQuery.trim();
            List<AlgorithmQuestion> localList = algorithmQuestionRepository.findByTitleContainingIgnoreCase(keyword);
            if (localList != null && !localList.isEmpty()) {
                AlgorithmQuestion q = localList.get(0);
                finalTitle = q.getTitle() != null ? q.getTitle() : keyword;
                finalUrl = buildLocalIdeUrl(q.getId());
                desc = "✅ 本地题库已找到该题。";
                found = true;
            } else {
                String searchUrl = algorithmProblemSearchService.searchProblemLink(keyword).orElse(null);
                if (searchUrl != null && searchUrl.contains("http")) {
                    finalUrl = searchUrl.split("\\?")[0].split("\"")[0].trim();
                    finalTitle = keyword;
                    desc = "🌐 本地暂无，已联网搜索到力扣原题。";
                    found = true;
                }
            }
        }

        if (found && finalUrl != null && !finalUrl.isEmpty()) {
            // 关键：在最后输出前，强制清洗 URL，避免 HTML 进入 Markdown 导致点击跳转空白页
            String cleanUrl = forceCleanUrl(finalUrl);
            String result = formatPerfectMarkdown(desc, finalTitle, cleanUrl);
            return sanitizeZeroHtml(result);
        }
        return "抱歉，未找到相关题目。";
    }

    /**
     * 强制清洗 URL：剥离所有 HTML 标签、引号和参数，只保留纯净的 http 地址。
     */
    private String forceCleanUrl(String rawUrl) {
        if (rawUrl == null) return "";
        // 1. 如果包含 <a href，提取 href 引号内的内容
        if (rawUrl.contains("href=")) {
            int start = rawUrl.indexOf("href=") + 5;
            if (start < rawUrl.length() && (rawUrl.charAt(start) == '"' || rawUrl.charAt(start) == '\'')) start++;
            String sub = rawUrl.substring(Math.min(start, rawUrl.length()));
            int end = sub.indexOf("'");
            if (end == -1) end = sub.indexOf("\"");
            if (end > 0) rawUrl = sub.substring(0, end);
        }
        // 2. 暴力清洗：去掉 < > " ' 以及 target=...
        String clean = rawUrl.replaceAll("<[^>]*>", "")
                .replaceAll("(?i)target\\s*=\\s*['\"].*?['\"]", "")
                .replaceAll("(?i)rel\\s*=\\s*['\"].*?['\"]", "")
                .replace("\"", "")
                .replace("'", "")
                .trim();
        // 3. 仅对力扣链接去掉 ?envType 等参数，本站 ide?questionId= 保留
        if (clean.contains("?") && (clean.contains("leetcode.cn/problems/") || clean.contains("leetcode.com/problems/"))) {
            clean = clean.split("\\?")[0];
        }
        return clean;
    }

    /**
     * 仅生成纯净 http 字符串。❌ 禁止在 URL 中加 &lt;a href=、target=、rel= 等 HTML。
     * 格式：http://8.138.47.162:8080/ide?questionId= + questionId
     */
    private String buildLocalIdeUrl(long questionId) {
        String base = (appBaseUrl == null || appBaseUrl.isBlank()) ? "http://8.138.47.162:8080" : appBaseUrl.replaceAll("/$", "");
        return base + "/ide?questionId=" + questionId;
    }

    /**
     * 最终格式严格为：描述\n\n---\n👉 **立即练习**：[题目名](纯净URL)。
     * url 变量仅允许 http(s) 字符串，严禁拼接任何 HTML。
     */
    private static String formatPerfectMarkdown(String desc, String title, String url) {
        if (url == null || url.isEmpty()) return desc != null ? desc : "";
        String cleanUrl = url.split("\"")[0].split(" ")[0].trim().replace(">", "").replace("<", "");
        if (cleanUrl.toLowerCase().contains("target=")) cleanUrl = cleanUrl.substring(0, cleanUrl.toLowerCase().indexOf("target=")).trim();
        if (cleanUrl.toLowerCase().contains("rel=")) cleanUrl = cleanUrl.substring(0, cleanUrl.toLowerCase().indexOf("rel=")).trim();
        if (cleanUrl.contains("?") && (cleanUrl.contains("leetcode.cn/problems/") || cleanUrl.contains("leetcode.com/problems/"))) {
            cleanUrl = cleanUrl.split("\\?")[0];
        }
        if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) return desc != null ? desc : "";
        String linkText = (title != null && !title.isEmpty()) ? title : "点击进入练习";
        linkText = linkText.split("\"")[0].replace("<", "").replace(">", "").trim();
        if (linkText.isEmpty()) linkText = "点击进入练习";
        return String.format("%s\n\n---\n👉 **立即练习**（链接已修复）：[%s](%s)", desc, linkText, cleanUrl);
    }

    /** 最终防线：从整段返回中移除 HTML 碎片，避免前端点击跳转到 /&lt;a%20href= 空白页。不修改换行与正常 Markdown。 */
    private static String sanitizeZeroHtml(String s) {
        if (s == null) return "";
        return s
                .replace("\" target=\"_blank\"", "")
                .replace(" target=\"_blank\"", "")
                .replace(" rel=\"noopener noreferrer\"", "")
                .replace("<a href=", "");
    }

    /**
     * 对整段回复做「畸形链接」修复：将「URL" target=...>标题」替换为标准 Markdown [标题](URL)。
     * 避免因 LLM 或旧逻辑输出 HTML 导致前端显示乱码、点击跳转空白页。
     */
    private static String fixMalformedLinkInResponse(String response) {
        if (response == null || !response.contains("ide?questionId=") || !response.contains("target=")) return response;
        // 匹配：纯净 URL（到引号或空格为止）+ " target=...> + 标题（到 < 或换行为止）
        Pattern p = Pattern.compile("(https?://[^\"<>\\s]+/ide\\?questionId=\\d+)\\s*\"\\s*target[^>]*>\\s*([^<\\n\\r]+?)(?=</a>|$|\\n|\\r)");
        Matcher m = p.matcher(response);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            String url = m.group(1).trim();
            String title = m.group(2).trim().replaceFirst("</a>.*$", "").trim();
            if (title.isEmpty()) title = "立即练习";
            m.appendReplacement(sb, Matcher.quoteReplacement("👉 **立即练习**（链接已修复）：[" + title + "](" + url + ")"));
        }
        m.appendTail(sb);
        String out = sb.toString();
        // 再删残留字面量，防止漏网
        out = out.replace("\" target=\"_blank\" rel=\"noopener noreferrer\">", " ");
        return out;
    }

    /**
     * 破坏性重构：不在原字符串上做复杂清洗，而是：
     * 1. 先从原始回复中提取 (title, validUrl)，再暴力拆除所有 URL/链接/HTML；
     * 2. 用提取到的 (title, validUrl) 拼接标准 Markdown 链接，不信任模型输出的链接部分。
     */
    public static String finalFormatting(String rawReply) {
        if (rawReply == null || rawReply.isEmpty()) return "";
        String s = rawReply
                .replace('\u201C', '"').replace('\u201D', '"').replace('\u201E', '"').replace('\u201F', '"')
                .replace('\u2033', '"').replace('\u2036', '"').replace('\uFF02', '"')
                .replace("&quot;", "\"").replace("&#34;", "\"");
        // 重要：先提取 (linkTitle, validUrl)，再删 HTML 碎片，否则替换会破坏结构导致提取到 "</a>" 等错误 title

        // ========== 第一步：在拆除前先提取 (linkTitle, validUrl)（必须在任何替换前完成） ==========
        String linkTitle = null;
        String validUrl = null;
        int anchor = s.indexOf("ide?questionId=");
        if (anchor >= 0) {
            int urlStart = Math.max(s.lastIndexOf("http://", anchor), s.lastIndexOf("https://", anchor));
            if (urlStart >= 0) {
                int urlEnd = urlStart;
                while (urlEnd < s.length() && !Character.isWhitespace(s.charAt(urlEnd)) && s.charAt(urlEnd) != '"' && s.charAt(urlEnd) != '\'' && s.charAt(urlEnd) != '>' && s.charAt(urlEnd) != '<') urlEnd++;
                String extracted = s.substring(urlStart, urlEnd).trim();
                if (extracted.matches("https?://[^\\s\"'<>]+/ide\\?questionId=\\d+")) {
                    validUrl = extracted.split("\"")[0].trim();
                    int gt = s.indexOf('>', urlEnd);
                    if (gt >= 0 && gt + 1 < s.length()) {
                        // 标题到 </a> 或换行为止，允许中间有空格（如「LRU 缓存」）
                        int tEnd = gt + 1;
                        while (tEnd < s.length() && s.charAt(tEnd) != '<' && s.charAt(tEnd) != '\n' && s.charAt(tEnd) != '\r') tEnd++;
                        String raw = s.substring(gt + 1, tEnd).trim().replaceFirst("</a>.*", "").replaceFirst("[。.]\\s*$", "").trim();
                        if (!raw.isEmpty() && raw.length() <= 50) linkTitle = raw;
                    }
                    if (linkTitle == null) {
                        int tStart = urlEnd;
                        while (tStart < s.length() && (Character.isWhitespace(s.charAt(tStart)) || s.charAt(tStart) == '"' || s.charAt(tStart) == '\'')) tStart++;
                        int tEnd = tStart;
                        while (tEnd < s.length() && s.charAt(tEnd) != '<' && s.charAt(tEnd) != '\n' && s.charAt(tEnd) != '\r') tEnd++;
                        if (tEnd > tStart) {
                            String raw = s.substring(tStart, tEnd).trim().replaceFirst("[。.]\\s*$", "").trim();
                            if (!raw.isEmpty() && raw.length() <= 50) linkTitle = raw;
                        }
                    }
                    if (linkTitle == null) linkTitle = "在线练习";
                }
            }
        }
        if (validUrl == null) {
            Matcher m = Pattern.compile("\\[([^\\]]+)\\]\\((https?://[^)]+)\\)").matcher(s);
            if (m.find()) {
                linkTitle = m.group(1);
                validUrl = m.group(2).split("\"")[0].trim();
            }
        }

        // 【铁证兜底】在拆除前删掉乱码字面量，避免残留到前端；提取已完成故不会破坏 (linkTitle, validUrl)
        s = s.replace("\" target=\"_blank\" rel=\"noopener noreferrer\">", " ");

        // ========== 第二步：暴力拆除（扒掉所有链接、URL、HTML 属性） ==========
        String cleanText = s;
        cleanText = cleanText.replaceAll("https?://\\S+", "");
        cleanText = cleanText.replaceAll("\\[.*?\\]\\(.*?\\)", "");
        cleanText = cleanText.replaceAll("\\[[^\\]]*\\]\\(\\s*[\"']?", ""); // 残留 [反转链表]( 等未闭合
        cleanText = cleanText.replaceAll("<a\\s[^>]*>.*?</a>", "");
        cleanText = cleanText.replaceAll("(?i)target\\s*=\\s*[\"']?_blank[\"']?", "");
        cleanText = cleanText.replaceAll("(?i)rel\\s*=\\s*[\"'][^\"']*[\"']", "");
        cleanText = cleanText.replace("\">", " ").replace("'>", " ").replace("\"", " ").replace(">", " ");
        for (String phrase : new String[]{
                "在线练习链接", "你可以在这里找到该题目的描述和在线 IDE 做题链接", "你可以在这里找到这道题目的在线IDE链接",
                "你可以在这里找到本站在线 IDE 做题链接", "您可以在本站在线IDE做题链接（仅此一条，请原样输出该 URL 勿改）",
                "链接为", "你可以在这里做题", "您可以在这里做题", "你可以在这里找到原题", "你可以在这里找到该题的在线 IDE 链接"
        }) {
            cleanText = cleanText.replace(phrase, "");
        }
        cleanText = cleanText.replaceAll("([。!?])\\1+", "$1");
        if (cleanText.endsWith(": ") || cleanText.endsWith("： ") || cleanText.endsWith(":") || cleanText.endsWith("：")) {
            cleanText = cleanText.replaceFirst("[：:]\\s*$", "").trim();
        }
        cleanText = cleanText.trim().replaceAll("\\s+", " ");

        // ========== 第三步：完美重建（仅用我们提取的 title/url 拼接） ==========
        if (validUrl != null && !validUrl.isEmpty()) {
            String pureUrl = validUrl.split("\"")[0].split(" ")[0].trim();
            pureUrl = pureUrl.replace(">", "").replace("<", "");
            // 力扣等外链去掉 ?envType= 等参数，只保留纯净路径
            if (pureUrl.contains("?") && (pureUrl.contains("leetcode.cn/problems/") || pureUrl.contains("leetcode.com/problems/"))) {
                pureUrl = pureUrl.split("\\?")[0];
            }
            String title = (linkTitle != null && !linkTitle.isEmpty()) ? linkTitle : "点击进入练习";
            String label = pureUrl.contains("/ide?questionId=") ? "**在线练习链接**" : "**原题链接**";
            return cleanText + "\n\n---\n\n" + label + " [" + title + "](" + pureUrl + ")";
        }
        return cleanText;
    }
}
