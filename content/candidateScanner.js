// content/candidateScanner.js — 沟通页：扫描候选人列表 + 提取简历 + 自动筛选
// 在 zhipin.com/web/chat/* 和 zhipin.com/web/boss/* 页面工作

(function () {
  'use strict';

  console.log('[筛选助手] candidateScanner 加载');

  // ========== 全局状态（挂载到 window 供其他模块访问）==========
  window.__hrHelper = window.__hrHelper || {
    candidates: [],             // 当前页面候选人列表
    screenedCandidates: {},     // 已评估的候选人 { id: result }
    savedJobs: {},              // 已保存的 JD { jobId: jobData }
    schedules: {},              // 预约记录 { scheduleId: schedule }
    isScanning: false,          // 是否正在自动筛选
    currentCandidateId: null,   // 当前正在评估的候选人
    stats: {
      total: 0,
      qualified: 0,
      pending: 0,
      unqualified: 0,
      scheduling: 0,
      scheduled: 0
    }
  };

  const state = window.__hrHelper;

  // 初始化
  initData();

  // ========== 初始化：加载已保存的数据 ==========
  async function initData() {
    try {
      const response = await sendMessage({ type: 'GET_ALL_DATA' });
      if (response.ok) {
        state.savedJobs = response.data.jobs || {};
        state.screenedCandidates = response.data.candidates || {};
        state.schedules = response.data.schedules || {};
        console.log('[筛选助手] 已加载', Object.keys(state.savedJobs).length, '个已保存职位');
        console.log('[筛选助手] 已加载', Object.keys(state.screenedCandidates).length, '个已评估候选人');
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
      const platformId = dataId || '';
      const candidateUrl = window.location.href;

      // 生成候选人唯一 ID：平台 ID + URL 哈希
      const id = platformId
        ? `bp_${platformId}`
        : `bp_${hashString(name + '_' + job + '_' + candidateUrl)}`;

      // 检查是否已有评估结果
      const existing = state.screenedCandidates[id];

      candidates.push({
        id,
        platformId,
        name,
        job,
        time: timeEl ? timeEl.textContent.trim() : '',
        msg: msgEl ? msgEl.textContent.trim().substring(0, 120) : '',
        el: item,
        score: existing ? existing.score : null,
        status: existing ? existing.status : 'waiting',
        evaluation: existing ? existing.evaluation : null,
        scheduleId: existing ? existing.scheduleId : null
      });
    });

    state.candidates = candidates;
    recalcStats();

    console.log('[筛选助手] 扫描到', candidates.length, '个候选人');

    // 通知面板更新
    if (state.updatePanel) {
      state.updatePanel();
    }

    return candidates;
  }

  // ========== 重新计算统计数据 ==========
  function recalcStats() {
    const candidates = state.candidates;
    state.stats.total = candidates.length;
    state.stats.qualified = candidates.filter(c => c.status === 'qualified').length;
    state.stats.pending = candidates.filter(c => c.status === 'pending').length;
    state.stats.unqualified = candidates.filter(c => c.status === 'unqualified').length;
    state.stats.scheduling = candidates.filter(c => c.status === 'scheduling' || c.status === 'negotiating').length;
    state.stats.scheduled = candidates.filter(c => c.status === 'scheduled' || c.status === 'confirmed').length;
  }

  // ========== 提取候选人详细简历信息 ==========
  window.__hrHelper.extractCandidateDetail = extractCandidateDetail;

  function extractCandidateDetail() {
    const detail = {};

    // 右侧信息区域
    const infoArea = document.querySelector('.geek-info, .resume-info, .detail-figure');
    const rightPanel = document.querySelector('.chat-box, .right-panel, .detail-panel');

    if (infoArea) {
      const text = infoArea.textContent || '';

      // 姓名
      const nameEl = infoArea.querySelector('.geek-name, .name, h2, h3');
      if (nameEl) detail.name = nameEl.textContent.trim();

      // 当前职位
      const posEl = infoArea.querySelector('.geek-position, .position, .cur-job');
      if (posEl) detail.position = posEl.textContent.trim();

      // 年龄
      const ageMatch = text.match(/(\d{2,3})岁/);
      if (ageMatch) detail.age = ageMatch[1] + '岁';

      // 工作经验
      const expMatch = text.match(/([\d]+年以上|[\d]+-[\d]+年|[\d]+年|应届|在校)/);
      if (expMatch) detail.experience = expMatch[1];

      // 学历
      const eduOptions = ['博士', '硕士', '本科', '大专', '中专', '高中'];
      for (const edu of eduOptions) {
        if (text.includes(edu)) { detail.education = edu; break; }
      }

      // 期望薪资
      const salaryMatch = text.match(/期望[：:]*\s*(\d+-\d+K)/i) || text.match(/(\d+-\d+K)/i);
      if (salaryMatch) detail.expectedSalary = salaryMatch[1];

      // 城市
      const cityOptions = [
        '深圳', '北京', '上海', '广州', '杭州', '成都', '武汉', '南京',
        '重庆', '东莞', '苏州', '西安', '长沙', '郑州', '青岛', '天津'
      ];
      for (const city of cityOptions) {
        if (text.includes(city)) { detail.city = city; break; }
      }

      // 简历类型
      if (text.includes('在线简历')) detail.resumeType = '在线简历';
      if (text.includes('附件简历')) detail.resumeType = '附件简历';
    }

    // 从右侧面板提取完整信息
    if (rightPanel) {
      // 技术栈标签
      const techTags = [];
      rightPanel.querySelectorAll('.tag, .skill-tag, .label, [class*="skill"], [class*="tag"]').forEach(tag => {
        const tagText = tag.textContent.trim();
        if (tagText.length > 0 && tagText.length < 30) {
          techTags.push(tagText);
        }
      });
      if (techTags.length) detail.techStack = techTags;

      // 工作经历
      const workHistory = [];
      const workItems = rightPanel.querySelectorAll(
        '.work-exp-item, .experience-item, [class*="work"], [class*="exp-item"]'
      );
      workItems.forEach(item => {
        const entry = {};
        const companyEl = item.querySelector('.company, .org-name, [class*="company"]');
        const titleEl = item.querySelector('.position, .title, [class*="position"]');
        const timeEl = item.querySelector('.date, .time, [class*="date"]');
        const descEl = item.querySelector('.desc, .description, .content, [class*="desc"]');

        if (companyEl) entry.company = companyEl.textContent.trim();
        if (titleEl) entry.title = titleEl.textContent.trim();
        if (timeEl) entry.period = timeEl.textContent.trim();
        if (descEl) entry.description = descEl.textContent.trim();

        // 如果没有结构化数据，用整块文本
        if (!entry.company && !entry.title) {
          entry.text = item.textContent.trim();
        }

        workHistory.push(entry);
      });
      if (workHistory.length) detail.workHistory = workHistory;

      // 教育经历
      const eduHistory = [];
      const eduItems = rightPanel.querySelectorAll(
        '.edu-item, .education-item, [class*="edu"]'
      );
      eduItems.forEach(item => {
        const entry = {};
        const schoolEl = item.querySelector('.school, .org-name, [class*="school"]');
        const majorEl = item.querySelector('.major, [class*="major"]');
        const degreeEl = item.querySelector('.degree, [class*="degree"]');
        const timeEl = item.querySelector('.date, .time, [class*="date"]');

        if (schoolEl) entry.school = schoolEl.textContent.trim();
        if (majorEl) entry.major = majorEl.textContent.trim();
        if (degreeEl) entry.degree = degreeEl.textContent.trim();
        if (timeEl) entry.period = timeEl.textContent.trim();

        if (!entry.school) {
          entry.text = item.textContent.trim();
        }

        eduHistory.push(entry);
      });
      if (eduHistory.length) detail.eduHistory = eduHistory;

      // 项目经验
      const projectHistory = [];
      const projectItems = rightPanel.querySelectorAll(
        '.project-item, [class*="project"], [class*="proj"]'
      );
      projectItems.forEach(item => {
        const entry = {};
        const nameEl = item.querySelector('.name, .title, [class*="name"]');
        const descEl = item.querySelector('.desc, .description, .content');
        const roleEl = item.querySelector('.role, [class*="role"]');

        if (nameEl) entry.name = nameEl.textContent.trim();
        if (descEl) entry.description = descEl.textContent.trim();
        if (roleEl) entry.role = roleEl.textContent.trim();

        if (!entry.name) {
          entry.text = item.textContent.trim();
        }

        projectHistory.push(entry);
      });
      if (projectHistory.length) detail.projectHistory = projectHistory;

      // 整体文本作为备用
      detail.fullText = rightPanel.textContent.trim().substring(0, 4000);
    }

    return detail;
  }

  // ========== 构建候选人简历文本（发给 LLM 评估）==========
  window.__hrHelper.buildResumeText = buildResumeText;

  function buildResumeText(candidate, detail) {
    const parts = [];
    parts.push(`姓名：${candidate.name}`);
    parts.push(`应聘岗位：${candidate.job}`);

    if (detail.position) parts.push(`当前职位：${detail.position}`);
    if (detail.age) parts.push(`年龄：${detail.age}`);
    if (detail.experience) parts.push(`工作经验：${detail.experience}`);
    if (detail.education) parts.push(`学历：${detail.education}`);
    if (detail.expectedSalary) parts.push(`期望薪资：${detail.expectedSalary}`);
    if (detail.city) parts.push(`期望城市：${detail.city}`);

    if (detail.techStack && detail.techStack.length) {
      parts.push(`技术栈：${detail.techStack.join('、')}`);
    }

    if (detail.workHistory && detail.workHistory.length) {
      parts.push('\n工作经历：');
      detail.workHistory.forEach(w => {
        if (w.company || w.title) {
          parts.push(`  ${w.company || ''} - ${w.title || ''} (${w.period || ''})`);
          if (w.description) parts.push(`    ${w.description.substring(0, 300)}`);
        } else if (w.text) {
          parts.push('  ' + w.text.substring(0, 300));
        }
      });
    }

    if (detail.projectHistory && detail.projectHistory.length) {
      parts.push('\n项目经验：');
      detail.projectHistory.forEach(p => {
        if (p.name) {
          parts.push(`  项目：${p.name}`);
          if (p.role) parts.push(`  角色：${p.role}`);
          if (p.description) parts.push(`  描述：${p.description.substring(0, 300)}`);
        } else if (p.text) {
          parts.push('  ' + p.text.substring(0, 300));
        }
      });
    }

    if (detail.eduHistory && detail.eduHistory.length) {
      parts.push('\n教育经历：');
      detail.eduHistory.forEach(e => {
        if (e.school) {
          parts.push(`  ${e.school} - ${e.major || ''} (${e.degree || ''}) ${e.period || ''}`);
        } else if (e.text) {
          parts.push('  ' + e.text);
        }
      });
    }

    if (candidate.msg) {
      parts.push(`\n自我介绍/打招呼：${candidate.msg}`);
    }

    // 如果结构化提取不足，使用全文
    if (!detail.workHistory && !detail.techStack && detail.fullText) {
      parts.push('\n简历全文（从页面提取）：');
      parts.push(detail.fullText.substring(0, 2500));
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

    if (total === 0) {
      console.log('[筛选助手] 没有待评估的候选人');
      state.isScanning = false;
      return;
    }

    for (let i = 0; i < total; i++) {
      if (!state.isScanning) break;

      const c = waitingCandidates[i];
      state.currentCandidateId = c.id;

      // 更新面板进度
      if (state.updatePanel) {
        state.updatePanel();
      }

      // 1. 点击候选人以加载详情
      if (c.el) {
        c.el.click();
        await delay(3000, 6000); // 等待详情加载
      }

      // 2. 提取详细简历信息
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

      // 5. 发送给 background 进行 AI 评估
      console.log('[筛选助手] 评估候选人:', c.name, '→', c.job);
      try {
        const response = await sendMessage({
          type: 'EVALUATE_CANDIDATE',
          candidateId: c.id,
          candidateInfo: {
            name: c.name,
            job: c.job,
            platformId: c.platformId
          },
          resumeText,
          jobId: matchedJob.jobId
        });

        if (response.ok && response.evaluation) {
          c.score = response.evaluation.score;
          c.status = response.evaluation.score >= 80 ? 'qualified' :
                     response.evaluation.score >= 60 ? 'pending' : 'unqualified';
          c.evaluation = response.evaluation;
          c.verdict = response.evaluation.verdict || response.evaluation.conclusion;

          // 同步到本地缓存
          state.screenedCandidates[c.id] = {
            score: c.score,
            status: c.status,
            evaluation: c.evaluation
          };
        }
      } catch (err) {
        console.error('[筛选助手] 评估失败:', c.name, err);
        c.evaluation = { summary: '评估失败: ' + err.message };
      }

      // 更新统计 & 面板
      recalcStats();
      if (state.updatePanel) {
        state.updatePanel();
      }

      // 反爬随机延迟 3-8 秒
      await delay(3000, 8000);
    }

    state.isScanning = false;
    state.currentCandidateId = null;
    console.log('[筛选助手] 自动筛选完成');

    recalcStats();
    if (state.updatePanel) {
      state.updatePanel();
    }
  }

  function stopAutoScreening() {
    state.isScanning = false;
    console.log('[筛选助手] 停止自动筛选');
  }

  // ========== 手动评估单个候选人 ==========
  window.__hrHelper.evaluateCurrentCandidate = async function (candidateId) {
    const candidate = state.candidates.find(c => c.id === candidateId);
    if (!candidate) {
      console.error('[筛选助手] 未找到候选人:', candidateId);
      return null;
    }

    // 点击候选人加载详情
    if (candidate.el) {
      candidate.el.click();
      await delay(3000, 5000);
    }

    const detail = extractCandidateDetail();
    const resumeText = buildResumeText(candidate, detail);
    const matchedJob = findMatchingJob(candidate.job);

    if (!matchedJob) {
      return { error: '未找到匹配的 JD，请先在职位管理页保存此职位' };
    }

    const response = await sendMessage({
      type: 'EVALUATE_CANDIDATE',
      candidateId: candidate.id,
      candidateInfo: { name: candidate.name, job: candidate.job, platformId: candidate.platformId },
      resumeText,
      jobId: matchedJob.jobId
    });

    if (response.ok && response.evaluation) {
      candidate.score = response.evaluation.score;
      candidate.status = response.evaluation.score >= 80 ? 'qualified' :
                         response.evaluation.score >= 60 ? 'pending' : 'unqualified';
      candidate.evaluation = response.evaluation;
      candidate.verdict = response.evaluation.verdict || response.evaluation.conclusion;

      state.screenedCandidates[candidate.id] = {
        score: candidate.score,
        status: candidate.status,
        evaluation: candidate.evaluation
      };

      recalcStats();
      if (state.updatePanel) state.updatePanel();
      return response.evaluation;
    }

    return null;
  };

  // ========== 手动更改候选人状态 ==========
  window.__hrHelper.setCandidateStatus = async function (candidateId, status) {
    const candidate = state.candidates.find(c => c.id === candidateId);
    if (candidate) {
      candidate.status = status;
    }

    await sendMessage({
      type: 'UPDATE_CANDIDATE_STATUS',
      candidateId,
      status
    });

    recalcStats();
    if (state.updatePanel) state.updatePanel();
  };

  // ========== 查找匹配的 JD ==========
  function findMatchingJob(jobTitle) {
    const jobs = state.savedJobs;
    const clean = s => s.replace(/[【】\[\]（）()\s·+双休五险一金全额]/g, '').toLowerCase();
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

  // ========== 监听候选人列表 DOM 变化 ==========
  function observeListChanges() {
    const listContainer = document.querySelector(
      '.geek-list, .chat-list, [class*="geek-list"], .user-list'
    );

    if (!listContainer) {
      // 重试，直到找到列表容器
      setTimeout(observeListChanges, 3000);
      return;
    }

    const observer = new MutationObserver(debounce(() => {
      scanCandidateList();
    }, 500));

    observer.observe(listContainer, { childList: true, subtree: true });
    console.log('[筛选助手] 已开始监听候选人列表变化');
  }

  // ========== 工具函数 ==========
  function delay(min, max) {
    const ms = Math.floor(Math.random() * (max - min) + min);
    return new Promise(r => setTimeout(r, ms));
  }

  function debounce(fn, wait) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为 32 位整数
    }
    return Math.abs(hash).toString(36);
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
