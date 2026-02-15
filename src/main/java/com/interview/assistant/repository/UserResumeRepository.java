package com.interview.assistant.repository;

import com.interview.assistant.entity.UserResume;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserResumeRepository extends JpaRepository<UserResume, Long> {
}
