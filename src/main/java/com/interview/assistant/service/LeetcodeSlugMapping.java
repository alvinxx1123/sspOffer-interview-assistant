package com.interview.assistant.service;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * 常见算法题中文题名/关键词到力扣题目 slug 的映射。
 * 当题目不在本站题库时，用此映射返回力扣原题页链接而非搜索页。
 */
public final class LeetcodeSlugMapping {

    private static final Map<String, String> TITLE_TO_SLUG = new LinkedHashMap<>();

    static {
        // 常见题：中文题名或关键词 -> leetcode.cn/problems/{slug}/
        put("分糖果", "candy");
        put("分发糖果", "candy");
        put("完全平方数", "perfect-squares");
        put("两数之和", "two-sum");
        put("反转链表", "reverse-linked-list");
        put("LRU缓存", "lru-cache");
        put("LRU 缓存", "lru-cache");
        put("搜索插入位置", "search-insert-position");
        put("二叉树中序遍历", "binary-tree-inorder-traversal");
        put("三数之和", "3sum");
        put("无重复字符的最长子串", "longest-substring-without-repeating-characters");
        put("两数相加", "add-two-numbers");
        put("盛最多水的容器", "container-with-most-water");
        put("最长回文子串", "longest-palindromic-substring");
        put("合并两个有序链表", "merge-two-sorted-lists");
        put("有效的括号", "valid-parentheses");
        put("爬楼梯", "climbing-stairs");
        put("二叉树的最大深度", "maximum-depth-of-binary-tree");
        put("对称二叉树", "symmetric-tree");
        put("二叉树的层序遍历", "binary-tree-level-order-traversal");
        put("最大子数组和", "maximum-subarray");
        put("合并区间", "merge-intervals");
        put("接雨水", "trapping-rain-water");
        put("全排列", "permutations");
        put("子集", "subsets");
        put("组合总和", "combination-sum");
        put("括号生成", "generate-parentheses");
        put("二叉树的最近公共祖先", "lowest-common-ancestor-of-a-binary-tree");
        put("排序链表", "sort-list");
        put("岛屿数量", "number-of-islands");
        put("买卖股票的最佳时机", "best-time-to-buy-and-sell-stock");
        put("环形链表", "linked-list-cycle");
        put("相交链表", "intersection-of-two-linked-lists");
        put("反转链表 II", "reverse-linked-list-ii");
        put("删除链表的倒数第N个节点", "remove-nth-node-from-end-of-list");
        put("有效的数独", "valid-sudoku");
        put("字符串转换整数", "string-to-integer-atoi");
        put("整数反转", "reverse-integer");
        put("回文数", "palindrome-number");
        put("每日温度", "daily-temperatures");
        put("有效括号", "valid-parentheses");
        put("跳跃游戏", "jump-game");
        put("最小栈", "min-stack");
        put("杨辉三角", "pascals-triangle");
        put("帕斯卡三角", "pascals-triangle");
    }

    private static void put(String title, String slug) {
        TITLE_TO_SLUG.put(title, slug);
    }

    /**
     * 根据用户输入的题名或关键词解析力扣题目 slug。
     * 先精确匹配，再按包含关系匹配（关键词包含映射键或反之）。
     */
    public static Optional<String> resolveSlug(String keyword) {
        if (keyword == null || keyword.isBlank()) return Optional.empty();
        String k = keyword.trim();
        if (TITLE_TO_SLUG.containsKey(k)) return Optional.ofNullable(TITLE_TO_SLUG.get(k));
        for (Map.Entry<String, String> e : TITLE_TO_SLUG.entrySet()) {
            if (k.contains(e.getKey()) || e.getKey().contains(k)) return Optional.of(e.getValue());
        }
        return Optional.empty();
    }

    public static String problemUrl(String slug) {
        return "https://leetcode.cn/problems/" + slug + "/";
    }
}
