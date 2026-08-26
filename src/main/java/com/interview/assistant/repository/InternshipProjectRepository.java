package com.interview.assistant.repository;

import com.interview.assistant.entity.InternshipProject;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface InternshipProjectRepository extends JpaRepository<InternshipProject, Long> {
    List<InternshipProject> findAllByOrderByUpdatedAtDesc();
}
