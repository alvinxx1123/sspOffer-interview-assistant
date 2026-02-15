package com.interview.assistant.repository;

import com.interview.assistant.entity.InterviewExperience;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface InterviewExperienceRepository extends JpaRepository<InterviewExperience, Long> {

    List<InterviewExperience> findByCompany(String company);

    List<InterviewExperience> findByCompanyAndDepartment(String company, String department);

    List<InterviewExperience> findByCompanyAndPosition(String company, String position);

    @Query("SELECT DISTINCT e.company FROM InterviewExperience e ORDER BY e.company")
    List<String> findDistinctCompanies();

    @Query("SELECT DISTINCT e.department FROM InterviewExperience e WHERE e.company = :company AND e.department IS NOT NULL")
    List<String> findDistinctDepartmentsByCompany(String company);
}
