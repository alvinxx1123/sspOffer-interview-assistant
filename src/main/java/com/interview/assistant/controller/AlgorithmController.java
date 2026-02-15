package com.interview.assistant.controller;

import com.interview.assistant.entity.AlgorithmQuestion;
import com.interview.assistant.repository.AlgorithmQuestionRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/algorithms")
@CrossOrigin
public class AlgorithmController {

    private final AlgorithmQuestionRepository questionRepository;

    public AlgorithmController(AlgorithmQuestionRepository questionRepository) {
        this.questionRepository = questionRepository;
    }

    @GetMapping
    public ResponseEntity<List<AlgorithmQuestion>> list(
            @RequestParam(required = false) String company,
            @RequestParam(required = false) String difficulty) {
        List<AlgorithmQuestion> questions;
        if (company != null && !company.isEmpty()) {
            questions = questionRepository.findByCompany(company);
        } else if (difficulty != null && !difficulty.isEmpty()) {
            questions = questionRepository.findByDifficulty(difficulty);
        } else {
            questions = questionRepository.findAll();
        }
        return ResponseEntity.ok(questions);
    }

    @GetMapping("/{id}")
    public ResponseEntity<AlgorithmQuestion> getById(@PathVariable Long id) {
        return questionRepository.findById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/{id}/leetcode-url")
    public ResponseEntity<String> getLeetcodeUrl(@PathVariable Long id) {
        return questionRepository.findById(id)
                .map(q -> q.getLeetcodeUrl())
                .filter(url -> url != null)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<AlgorithmQuestion> create(@RequestBody AlgorithmQuestion question) {
        return ResponseEntity.ok(questionRepository.save(question));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        questionRepository.deleteById(id);
        return ResponseEntity.ok().build();
    }
}
