// content/candidateScanner.js — 沟通页：扫描候选人列表 + 提取简历
// 在 zhipin.com/web/chat/index 页面工作

(function() {
  'use strict';

  console.log('[筛选助手] candidateScanner 加载');

  // 全局状态（挂载到 window 供其他模块访问）
  window.__hrHelper = window.__hrHelper || {
    candidates: [],           // 当前候选人列表
    screenedCandidates: {},   // 已评估的候选人 { id: result }
    savedJobs: {},            // 已保存的 JD
    isScanning: false,        // 是否正在自动扫描
    currentCandidateId: null, // 当前选中的候选人
    stats: { total: 0, screened: 0, qualified: 0, pending: 0, unqualified: 0 }
  };

  const state = window.__hrHelper;

  // 初始化：加载已保存的 JD 和候选人数据
  initData();

  // ========== 初始化 ==========
  async function initData() {
    try {
      const response = await sendMessage({ type: 'GET_ALL_DATA' });
      if (response.ok) {
        state.savedJobs = response.data.jobs || {};
        state.screenedCandidates = response.data.candidates || {};
        console.log('[筛选助手] 已加载', Object.keys(state.savedJobs).length, '个已保存职位');
      }
    } catch (err) {
      console.error('[筛选助手] 加载数据失败:', err);
    }

    // 等页面加载完再扫描
    setTimeout(() => {
      scanCandidateList();
      observeListChanges();
    }, 2000);
  }

  // ========== 扫描候选人列表 ==========
  window.__hrHelper.scanCandidateList = scanCandidateList;

  function scanCandidateList() {
    const items = document.querySelectorAll('.geek-item-wrap, .geek-item');
    const candidates = [];

    items.forEach(item => {
      const nameEl = item.querySelector('.geek-name, .name');
      const jobEl = item.querySelector('.source-job, .job');
      const timeEl = item.querySelector('.time');
      const msgEl = item.querySelector('.gray, .last-msg');
      const dataId = item.getAttribute('data-id') || item.getAttribute('data-geek-id');

      if (!nameEl) return;

      const name = nameEl.textContent.trim();
      const job = jobEl ? jobEl.textContent.trim() : '未知岗位';
      const id = dataId || `c_${name}_${job}`;

      // 检查是否已评估
      const existing = state.screenedCandidates[id];

      candidates.push({
        id,
        name,
        job,
        time: timeEl ? timeEl.textContent.trim() : '',
        msg: msgEl ? msgEl.textContent.trim().substring(0, 120) : '',
        el: item,
        score: existing ? existing.score : null,
        status: existing ? existing.status : 'waiting',
        evaluation: existing ? existing.evaluation : null
      });
    });

    state.candidates = candidates;
    state.stats.total = candidates.length;
    state.stats.screened = candidates.filter(c => c.status !== 'waiting').length;
    state.stats.qualified = candidates.filter(c => c.status === 'qualified').length;
    state.stats.pending = candidates.filter(c => c.status === 'pending').length;
    state.stats.unqualified = candidates.filter(c => c.status === 'unqualified').length;

    console.log('[筛选助手] 扫描到', candidates.length, '个候选人');

    // 通知面板更新
    if (window.__hrHelper.updatePanel) {
      window.__hrHelper.updatePanel();
    }

    return candidates;
  }

  // ========== 提取候选人详细信息 ==========
  window.__hrHelper.extractCandidateDetail = extractCandidateDetail;

  function extractCandidateDetail() {
    // 右侧详情区域
    const detail = {};
    const infoArea = document.querySelector('.geek-info, .resume-info, .detail-figure');
    const chatArea = document.querySelector('.chat-content, .message-list');

    // 从详情区提取
    if (infoArea) {
      const text = infoArea.textContent || '';

      // 基本信息
      const ageMatch = text.match(/(\d{2,3})岁/);
      if (ageMatch) detail.age = ageMatch[1] + '岁';

      const expMatch = text.match(/([\d]+年以上|[\d]+年|应届|在校)/);
      if (expMatch) detail.experience = expMatch[1];

      const eduOptions = ['博士', '硕士', '本科', '大专', '中专', '高中'];
      for (const edu of eduOptions) {
        if (text.includes(edu)) { detail.education = edu; break; }
      }

      // 期望信息
      const salaryMatch = text.match(/期望[：:]*\s*(\d+-\d+K)/i) || text.match(/(\d+-\d+K)/);
      if (salaryMatch) detail.expectedSalary = salaryMatch[1];

      const cityOptions = ['深圳', '北京', '上海', '广州', '杭州', '成都', '武汉', '南京', '重庆', '东莞', '苏州'];
      for (const city of cityOptions) {
        if (text.includes(city)) { detail.city = city; break; }
      }

      // 简历类型
      if (text.includes('在线简历')) detail.resumeType = '在线简历';
      if (text.includes('附件简历')) detail.resumeType = '附件简历';
    }

    // 从整个右侧面板提取完整文本（简历信息）
    const rightPanel = document.querySelector('.chat-box, .right-panel, .detail-panel');
    if (rightPanel) {
      // 获取工作经历、教育经历等
      const workHistory = [];
      const eduHistory = [];

      // 工作经历区块
      const workItems = rightPanel.querySelectorAll('.work-exp-item, .experience-item, [class*="work"], [class*="exp-item"]');
      workItems.forEach(item => {
        workHistory.push(item.textContent.trim());
      });

      // 教育经历区块
      const eduItems = rightPanel.querySelectorAll('.edu-item, .education-item, [class*="edu"]');
      eduItems.forEach(item => {
        eduHistory.push(item.textContent.trim());
      });

      if (workHistory.length) detail.workHistory = workHistory;
      if (eduHistory.length) detail.eduHistory = eduHistory;

      // 整体文本作为备用
      detail.fullText = rightPanel.textContent.trim().substring(0, 3000);
    }

    return detail;
  }

  // ========== 构建候选人简历文本（发给 LLM）==========
  window.__hrHelper.buildResumeText = buildResumeText;

  function buildResumeText(candidate, detail) {
    const parts = [];
    parts.push(`姓名：${candidate.name}`);
    parts.push(`应聘岗位：${candidate.job}`);

    if (detail.age) parts.push(`年龄：${detail.age}`);
    if (detail.experience) parts.push(`工作经验：${detail.experience}`);
    if (detail.education) parts.push(`学历：${detail.education}`);
    if (detail.expectedSalary) parts.push(`期望薪资：${detail.expectedSalary}`);
    if (detail.city) parts.push(`期望城市：${detail.city}`);

    if (detail.workHistory && detail.workHistory.length) {
      parts.push('\n工作经历：');
      detail.workHistory.forEach(w => parts.push('  ' + w));
    }

    if (detail.eduHistory && detail.eduHistory.length) {
      parts.push('\n教育经历：');
      detail.eduHistory.forEach(e => parts.push('  ' + e));
    }

    if (candidate.msg) {
      parts.push(`\n自我介绍/打招呼：${candidate.msg}`);
    }

    // 如果上面提取不到足够信息，用全文
    if (!detail.workHistory && detail.fullText) {
      parts.push('\n简历全文（从页面提取）：');
      parts.push(detail.fullText.substring(0, 2000));
    }

    return parts.join('\n');
  }

  // ========== 自动筛选流程 ==========
  window.__hrHelper.startAutoScreening = startAutoScreening;
  window.__hrHelper.stopAutoScreening = stopAutoScreening;

  async function startAutoScreening() {
    if (state.isScanning) return;
    state.isScanning = true;
    console.log('[筛选助手] 开始自动筛选');

    const waitingCandidates = state.candidates.filter(c => c.status === 'waiting');
    const total = waitingCandidates.length;

    for (let i = 0; i < total; i++) {
      if (!state.isScanning) break;

      const c = waitingCandidates[i];
      state.currentCandidateId = c.id;

      // 更新面板进度
      if (window.__hrHelper.updatePanel) {
        window.__hrHelper.updatePanel();
      }

      // 1. 点击候选人
      if (c.el) {
        c.el.click();
        await delay(3000, 6000); // 等待详情加载
      }

      // 2. 提取详细信息
      const detail = extractCandidateDetail();

      // 3. 构建简历文本
      const resumeText = buildResumeText(c, detail);

      // 4. 查找匹配的 JD
      const matchedJob = findMatchingJob(c.job);

      if (!matchedJob) {
        console.log('[筛选助手] 未找到匹配的 JD:', c.job, '，跳过');
        c.status = 'no_jd';
        c.evaluation = { summary: '未找到对应岗位 JD，请先保存此职位的 JD' };
        continue;
      }

      // 5. 调用 AI 评估
      console.log('[筛选助手] 评估候选人:', c.name, '→', c.job);
      try {
        const response = await sendMessage({
          type: 'EVALUATE_CANDIDATE',
          candidateId: c.id,
          candidateInfo: resumeText,
          jobInfo: matchedJob
        });

        if (response.ok && response.evaluation) {
          c.score = response.evaluation.score;
          c.status = response.evaluation.score >= 80 ? 'qualified' :
                     response.evaluation.score >= 60 ? 'pending' : 'unqualified';
          c.evaluation = response.evaluation;
          c.verdict = response.evaluation.verdict;

          // 更新统计
          state.stats.screened++;
          if (c.status === 'qualified') state.stats.qualified++;
          else if (c.status === 'pending') state.stats.pending++;
          else if (c.status === 'unqualified') state.stats.unqualified++;
        }
      } catch (err) {
        console.error('[筛选助手] 评估失败:', c.name, err);
        c.evaluation = { summary: '评估失败: ' + err.message };
      }

      // 更新面板
      if (window.__hrHelper.updatePanel) {
        window.__hrHelper.updatePanel();
      }

      // 反爬延迟
      await delay(3000, 8000);
    }

    state.isScanning = false;
    state.currentCandidateId = null;
    console.log('[筛选助手] 自动筛选完成');

    if (window.__hrHelper.updatePanel) {
      window.__hrHelper.updatePanel();
    }
  }

  function stopAutoScreening() {
    state.isScanning = false;
    console.log('[筛选助手] 停止自动筛选');
  }

  // ========== 查找匹配的 JD ==========
  function findMatchingJob(jobTitle) {
    const jobs = state.savedJobs;
    const clean = s => s.replace(/[【】\[\]（）()\s·+双休]/g, '').toLowerCase();
    const cleanTitle = clean(jobTitle);

    for (const jobId in jobs) {
      const job = jobs[jobId];
      if (!job.title) continue;
      const cleanJobTitle = clean(job.title);
      if (cleanTitle.includes(cleanJobTitle) || cleanJobTitle.includes(cleanTitle)) {
        return job;
      }
    }
    return null;
  }

  // ========== 监听列表变化 ==========
  function observeListChanges() {
    const listContainer = document.querySelector('.geek-list, .chat-list, [class*="geek-list"]');
    if (!listContainer) {
      // 重试
      setTimeout(observeListChanges, 3000);
      return;
    }

    const observer = new MutationObserver(() => {
      scanCandidateList();
    });
    observer.observe(listContainer, { childList: true, subtree: true });
  }

  // ========== 工具函数 ==========
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
