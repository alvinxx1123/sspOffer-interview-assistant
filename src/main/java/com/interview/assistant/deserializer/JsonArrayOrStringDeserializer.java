package com.interview.assistant.deserializer;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.JsonNode;

import java.io.IOException;

/**
 * 反序列化时接受 JSON 数组或字符串，统一转为 JSON 字符串存储。
 * 解决前端/智谱解析可能返回数组而实体字段为 String 的兼容问题。
 */
public class JsonArrayOrStringDeserializer extends JsonDeserializer<String> {

    @Override
    public String deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
        JsonNode node = p.getCodec().readTree(p);
        if (node == null || node.isNull()) {
            return null;
        }
        if (node.isArray()) {
            return node.toString();
        }
        if (node.isTextual()) {
            return node.asText();
        }
        return node.toString();
    }
}
