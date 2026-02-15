package com.interview.assistant.repository;

import com.interview.assistant.entity.UserInterviewRecord;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface UserInterviewRecordRepository extends JpaRepository<UserInterviewRecord, Long> {

    List<UserInterviewRecord> findByCompany(String company);
}
