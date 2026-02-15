package com.interview.assistant.service;

import com.interview.assistant.entity.InterviewExperience;
import com.interview.assistant.repository.InterviewExperienceRepository;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class InterviewDataService {

    private final InterviewExperienceRepository repository;
    private final RagService ragService;

    public InterviewDataService(InterviewExperienceRepository repository, RagService ragService) {
        this.repository = repository;
        this.ragService = ragService;
    }

    public InterviewExperience save(InterviewExperience exp) {
        exp = repository.save(exp);
        ragService.indexExperience(exp);
        return exp;
    }

    public List<InterviewExperience> saveAll(List<InterviewExperience> experiences) {
        experiences = repository.saveAll(experiences);
        // 异步做 RAG 索引，避免上传时 AllMiniLM 首次加载/批量 embedding 导致超时 502
        ragService.indexExperiencesAsync(experiences);
        return experiences;
    }

    public List<InterviewExperience> searchByCompany(String company) {
        return repository.findByCompany(company);
    }

    public List<InterviewExperience> searchByCompanyAndDepartment(String company, String department) {
        return repository.findByCompanyAndDepartment(company, department);
    }

    public List<String> getAllCompanies() {
        return repository.findDistinctCompanies();
    }

    public List<String> getDepartmentsByCompany(String company) {
        return repository.findDistinctDepartmentsByCompany(company);
    }

    public List<InterviewExperience> search(String company, String department) {
        if (department != null && !department.isEmpty()) {
            return searchByCompanyAndDepartment(company, department);
        }
        return searchByCompany(company);
    }

    public void deleteById(Long id) {
        repository.deleteById(id);
    }
}
