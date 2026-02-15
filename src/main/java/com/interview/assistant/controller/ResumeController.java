package com.interview.assistant.controller;

import com.interview.assistant.entity.UserResume;
import com.interview.assistant.repository.UserResumeRepository;
import com.interview.assistant.service.ResumeParseService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/resumes")
@CrossOrigin
public class ResumeController {

    private final UserResumeRepository resumeRepository;
    private final ResumeParseService resumeParseService;

    public ResumeController(UserResumeRepository resumeRepository, ResumeParseService resumeParseService) {
        this.resumeRepository = resumeRepository;
        this.resumeParseService = resumeParseService;
    }

    /** 上传并解析简历（PDF 或图片），提取文本（供 AI 面试使用），不落库 */
    @PostMapping(value = "/parse", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> parseResume(@RequestParam("file") MultipartFile file) {
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "请选择文件"));
        }
        try {
            String content = resumeParseService.parseResume(file);
            return ResponseEntity.ok(Map.of("content", content));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage() != null ? e.getMessage() : "解析失败"));
        }
    }

    /** 上传 PDF/图片简历并保存（含文件用于下载、预览） */
    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> uploadResume(@RequestParam("file") MultipartFile file) {
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "请选择文件"));
        }
        String name = file.getOriginalFilename();
        if (name == null) name = "简历";
        String ext = name.contains(".") ? name.substring(name.lastIndexOf('.')).toLowerCase() : "";
        if (!".pdf".equals(ext) && !ext.matches("\\.(jpg|jpeg|png|gif|webp)")) {
            return ResponseEntity.badRequest().body(Map.of("error", "仅支持 PDF 或图片格式"));
        }
        try {
            String content = resumeParseService.parseResume(file);
            byte[] fileData = file.getBytes();
            String contentType = file.getContentType();
            if (contentType == null) contentType = "application/pdf";

            UserResume resume = new UserResume();
            resume.setName(name);
            resume.setFileName(name);
            resume.setContent(content);
            resume.setFileData(fileData);
            resume.setContentType(contentType);
            resume.setUpdatedAt(java.time.LocalDateTime.now());
            resume = resumeRepository.save(resume);
            resume.setFileData(null);
            return ResponseEntity.ok(resume);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage() != null ? e.getMessage() : "上传失败"));
        }
    }

    /** 下载简历文件 */
    @GetMapping("/{id}/download")
    public ResponseEntity<byte[]> download(@PathVariable Long id) {
        return resumeRepository.findById(id)
                .filter(r -> r.getFileData() != null && r.getFileData().length > 0)
                .map(r -> {
                    String name = r.getFileName() != null ? r.getFileName() : "resume.pdf";
                    String encoded = URLEncoder.encode(name, StandardCharsets.UTF_8).replace("+", "%20");
                    return ResponseEntity.ok()
                            .contentType(MediaType.parseMediaType(r.getContentType() != null ? r.getContentType() : "application/pdf"))
                            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename*=UTF-8''" + encoded)
                            .body(r.getFileData());
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /** 预览简历（浏览器内嵌打开） */
    @GetMapping("/{id}/preview")
    public ResponseEntity<byte[]> preview(@PathVariable Long id) {
        return resumeRepository.findById(id)
                .filter(r -> r.getFileData() != null && r.getFileData().length > 0)
                .map(r -> ResponseEntity.ok()
                        .contentType(MediaType.parseMediaType(r.getContentType() != null ? r.getContentType() : "application/pdf"))
                        .header(HttpHeaders.CONTENT_DISPOSITION, "inline")
                        .body(r.getFileData()))
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping
    public ResponseEntity<List<UserResume>> list() {
        var list = resumeRepository.findAll();
        list.forEach(r -> r.setFileData(null));
        return ResponseEntity.ok(list);
    }

    @GetMapping("/{id}")
    public ResponseEntity<UserResume> getById(@PathVariable Long id) {
        return resumeRepository.findById(id)
                .map(r -> {
                    r.setFileData(null);
                    return ResponseEntity.ok(r);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        resumeRepository.deleteById(id);
        return ResponseEntity.ok().build();
    }
}
