package com.interview.assistant.repository;

import com.interview.assistant.entity.ApplicationRecord;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ApplicationRecordRepository extends JpaRepository<ApplicationRecord, Long> {

    List<ApplicationRecord> findAllByOrderByAppliedAtDesc();
}
