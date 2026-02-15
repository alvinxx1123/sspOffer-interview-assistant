package com.interview.assistant.repository;

import com.interview.assistant.entity.AlgorithmQuestion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface AlgorithmQuestionRepository extends JpaRepository<AlgorithmQuestion, Long> {

    List<AlgorithmQuestion> findByCompany(String company);

    List<AlgorithmQuestion> findByDifficulty(String difficulty);

    List<AlgorithmQuestion> findByLeetcodeProblemId(Integer leetcodeProblemId);
}
