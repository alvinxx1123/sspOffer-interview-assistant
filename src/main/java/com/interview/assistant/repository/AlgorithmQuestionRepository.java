package com.interview.assistant.repository;

import com.interview.assistant.entity.AlgorithmQuestion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface AlgorithmQuestionRepository extends JpaRepository<AlgorithmQuestion, Long> {

    List<AlgorithmQuestion> findByCompany(String company);

    List<AlgorithmQuestion> findByDifficulty(String difficulty);

    List<AlgorithmQuestion> findByLeetcodeProblemId(Integer leetcodeProblemId);

    /** 按标题模糊查询（忽略大小写），用于智能助手按题名找题 */
    List<AlgorithmQuestion> findByTitleContainingIgnoreCase(String title);
}
