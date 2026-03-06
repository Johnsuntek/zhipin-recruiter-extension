// content/aiEvaluator.js — AI 评估模块
// 提供手动评估单个候选人的功能，自动评估在 candidateScanner.js 中

(function() {
  'use strict';

  console.log('[筛选助手] aiEvaluator 加载');

  const state = window.__hrHelper;

  // ========== 手动评估当前候选人 ==========
  window.__hrHelper.evaluateCurrentCandidate = async function(candidateId) {
    const candidate = state.candidates.find(c => c.id === candidateId);
    if (!candidate) {
      console.error('[筛选助手] 未找到候选人:', candidateId);
      return null;
    }

    // 先点击候选人加载详情
    if (candidate.el) {
      candidate.el.click();
      await delay(3000, 5000);
    }

    // 提取详情
    const detail = state.extractCandidateDetail();
    const resumeText = state.buildResumeText(candidate, detail);

    // 查找 JD
    const matchedJob = findMatchingJob(candidate.job);
    if (!matchedJob) {
      return { error: '未找到匹配的 JD，请先在职位管理页保存此职位' };
    }

    // 调用评估
    const response = await sendMessage({
      type: 'EVALUATE_CANDIDATE',
      candidateId: candidate.id,
      candidateInfo: resumeText,
      jobInfo: matchedJob
    });

    if (response.ok && response.evaluation) {
      candidate.score = response.evaluation.score;
      candidate.status = response.evaluation.score >= 80 ? 'qualified' :
                         response.evaluation.score >= 60 ? 'pending' : 'unqualified';
      candidate.evaluation = response.evaluation;
      candidate.verdict = response.evaluation.verdict;

      if (state.updatePanel) state.updatePanel();
      return response.evaluation;
    }

    return null;
  };

  // ========== 手动更改候选人状态 ==========
  window.__hrHelper.setCandidateStatus = async function(candidateId, status) {
    const candidate = state.candidates.find(c => c.id === candidateId);
    if (candidate) {
      candidate.status = status;
    }

    await sendMessage({
      type: 'UPDATE_CANDIDATE_STATUS',
      candidateId,
      status
    });

    // 重新计算统计
    state.stats.qualified = state.candidates.filter(c => c.status === 'qualified').length;
    state.stats.pending = state.candidates.filter(c => c.status === 'pending').length;
    state.stats.unqualified = state.candidates.filter(c => c.status === 'unqualified').length;

    if (state.updatePanel) state.updatePanel();
  };

  // ========== 工具函数 ==========
  function findMatchingJob(jobTitle) {
    const jobs = state.savedJobs;
    const clean = s => s.replace(/[【】\[\]（）()\s·+双休]/g, '').toLowerCase();
    const cleanTitle = clean(jobTitle);

    for (const jobId in jobs) {
      const job = jobs[jobId];
      if (!job.title) continue;
      if (clean(job.title).includes(cleanTitle) || cleanTitle.includes(clean(job.title))) {
        return job;
      }
    }
    return null;
  }

  function delay(min, max) {
    const ms = Math.floor(Math.random() * (max - min) + min);
    return new Promise(r => setTimeout(r, ms));
  }

  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

})();
