package com.interview.assistant.controller;

import com.interview.assistant.entity.ApplicationRecord;
import com.interview.assistant.repository.ApplicationRecordRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/applications")
@CrossOrigin
public class ApplicationController {

    private final ApplicationRecordRepository repository;

    public ApplicationController(ApplicationRecordRepository repository) {
        this.repository = repository;
    }

    @GetMapping
    public ResponseEntity<List<ApplicationRecord>> list() {
        return ResponseEntity.ok(repository.findAllByOrderByAppliedAtDesc());
    }

    @PostMapping
    public ResponseEntity<?> create(@RequestBody Map<String, Object> body) {
        String company = getString(body, "company");
        String status = getString(body, "status");
        if (company.isEmpty() || status.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "投递公司和投递进度不能为空"));
        }
        ApplicationRecord r = new ApplicationRecord();
        r.setCompany(company);
        r.setAppliedAt(getDate(body, "appliedAt"));
        r.setStatus(status);
        r.setNotes(getString(body, "notes"));
        r.setUpdatedAt(java.time.LocalDateTime.now());
        r = repository.save(r);
        return ResponseEntity.ok(r);
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApplicationRecord> update(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return repository.findById(id)
                .map(r -> {
                    if (body.containsKey("company")) r.setCompany(getString(body, "company"));
                    if (body.containsKey("appliedAt")) r.setAppliedAt(getDate(body, "appliedAt"));
                    if (body.containsKey("status")) r.setStatus(getString(body, "status"));
                    if (body.containsKey("notes")) r.setNotes(getString(body, "notes"));
                    r.setUpdatedAt(java.time.LocalDateTime.now());
                    return ResponseEntity.ok(repository.save(r));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        repository.deleteById(id);
        return ResponseEntity.ok().build();
    }

    private static String getString(Map<String, Object> body, String key) {
        Object v = body.get(key);
        return v != null ? v.toString().trim() : "";
    }

    private static LocalDate getDate(Map<String, Object> body, String key) {
        Object v = body.get(key);
        if (v == null) return LocalDate.now();
        if (v instanceof String s) {
            try {
                return LocalDate.parse(s);
            } catch (Exception e) {
                return LocalDate.now();
            }
        }
        return LocalDate.now();
    }
}
