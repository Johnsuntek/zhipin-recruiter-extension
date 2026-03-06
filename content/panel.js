// content/panel.js — 侧边面板 UI (Shadow DOM)
// 候选人管理面板，展示评估结果

(function() {
  'use strict';

  console.log('[筛选助手] panel 加载');

  const state = window.__hrHelper;

  // 面板状态
  let panelOpen = false;
  let currentTab = 'all';        // all / qualified / pending / unqualified / waiting
  let currentJobFilter = 'all';  // all / 具体岗位名
  let expandedCardId = null;     // 当前展开详情的候选人

  // ========== 创建 Shadow DOM 面板 ==========
  const host = document.createElement('div');
  host.id = 'hr-screening-panel-host';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // 加载样式
  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('content/panel.css');
  shadow.appendChild(styleLink);

  // 触发按钮
  const triggerBtn = document.createElement('button');
  triggerBtn.className = 'trigger-btn';
  triggerBtn.textContent = '🦐筛选';
  triggerBtn.addEventListener('click', togglePanel);
  shadow.appendChild(triggerBtn);

  // 面板容器
  const panel = document.createElement('div');
  panel.className = 'panel';
  shadow.appendChild(panel);

  // ========== 渲染面板 ==========
  function renderPanel() {
    const candidates = getFilteredCandidates();
    const jobs = state.savedJobs || {};
    const jobNames = getJobNames();
    const hasJobs = Object.keys(jobs).length > 0;

    panel.innerHTML = `
      <!-- 头部 -->
      <div class="panel-header">
        <div>
          <div class="title">🦐 开发岗位筛选助手</div>
          <div class="status">${hasJobs ? '✅ 已加载 ' + Object.keys(jobs).length + ' 个职位 JD' : '⚠️ 未保存职位 JD'}</div>
        </div>
        <button class="close-btn" id="closeBtn">✕</button>
      </div>

      <!-- 统计条 -->
      <div class="stats-bar">
        <div class="stat-card total">
          <div class="number">${state.stats.total}</div>
          <div class="label">总候选人</div>
        </div>
        <div class="stat-card qualified">
          <div class="number">${state.stats.qualified}</div>
          <div class="label">合格</div>
        </div>
        <div class="stat-card pending">
          <div class="number">${state.stats.pending}</div>
          <div class="label">待定</div>
        </div>
        <div class="stat-card unqualified">
          <div class="number">${state.stats.unqualified}</div>
          <div class="label">不合格</div>
        </div>
      </div>

      <!-- 控制区 -->
      <div class="controls">
        <div class="filter-row">
          <select id="jobFilter">
            <option value="all">全部岗位</option>
            ${jobNames.map(j => `<option value="${j}" ${currentJobFilter === j ? 'selected' : ''}>${j}</option>`).join('')}
          </select>
        </div>

        ${!hasJobs ? `
          <div class="no-jd-banner">
            <span class="icon">⚠️</span>
            <span>请先去<strong>职位管理</strong>页面保存岗位 JD，才能开始 AI 评估</span>
          </div>
        ` : `
          <button class="auto-screen-btn ${state.isScanning ? 'stop' : 'start'}" id="autoScreenBtn">
            ${state.isScanning ? '⏹ 停止筛选' : '▶ 开始自动筛选'}
          </button>
          <div class="progress-bar ${state.isScanning ? 'active' : ''}">
            <div class="fill" style="width: ${getProgress()}%"></div>
          </div>
          <div class="progress-text ${state.isScanning ? 'active' : ''}">
            ${state.currentCandidateId ? '正在评估: ' + getCandidateName(state.currentCandidateId) : ''}
            · ${state.stats.screened}/${state.stats.total}
          </div>
        `}
      </div>

      <!-- 状态标签页 -->
      <div class="tabs">
        <div class="tab ${currentTab === 'all' ? 'active' : ''}" data-tab="all">全部 (${state.stats.total})</div>
        <div class="tab ${currentTab === 'qualified' ? 'active' : ''}" data-tab="qualified">✅合格 (${state.stats.qualified})</div>
        <div class="tab ${currentTab === 'pending' ? 'active' : ''}" data-tab="pending">⚠️待定 (${state.stats.pending})</div>
        <div class="tab ${currentTab === 'unqualified' ? 'active' : ''}" data-tab="unqualified">❌不合格 (${state.stats.unqualified})</div>
        <div class="tab ${currentTab === 'waiting' ? 'active' : ''}" data-tab="waiting">待评估</div>
      </div>

      <!-- 候选人列表 -->
      <div class="candidate-list" id="candidateList">
        ${candidates.length === 0 ? `
          <div class="empty-state">
            <div class="icon">📋</div>
            <div class="text">暂无候选人</div>
            <div class="hint">${currentTab === 'all' ? '请在沟通列表中查看候选人' : '当前筛选条件下无候选人'}</div>
          </div>
        ` : candidates.map(c => renderCandidateCard(c)).join('')}
      </div>

      <!-- 底部工具栏 -->
      <div class="panel-footer">
        <div>
          <button id="exportBtn">📊 导出报告</button>
          <button id="refreshBtn">🔄 刷新</button>
        </div>
        <span class="version">v0.3.0</span>
      </div>
    `;

    bindEvents();
  }

  // ========== 渲染候选人卡片 ==========
  function renderCandidateCard(c) {
    const scoreColor = c.score >= 80 ? 'green' : c.score >= 60 ? 'orange' : 'red';
    const statusText = {
      qualified: '✅ 推荐面试',
      pending: '⚠️ 可以考虑',
      unqualified: '❌ 不匹配',
      waiting: '⏳ 待评估',
      no_jd: '⚠️ 无JD'
    };

    const evalDetail = c.evaluation ? renderEvalDetail(c.evaluation) : '';

    return `
      <div class="candidate-card ${c.id === state.currentCandidateId ? 'active' : ''}" data-id="${c.id}">
        <div class="card-header">
          <div>
            <span class="name">${c.name}</span>
            <span class="meta">${c.time || ''}</span>
          </div>
          ${c.score !== null ? `
            <span class="status-badge ${c.status}">${c.score}分</span>
          ` : `
            <span class="status-badge ${c.status}">${statusText[c.status] || '待评估'}</span>
          `}
        </div>

        <div class="job-tag">→ ${c.job}</div>

        ${c.score !== null ? `
          <div class="score-bar">
            <div class="fill ${scoreColor}" style="width: ${c.score}%"></div>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:11px; color:#999;">
            <span>${statusText[c.status] || ''}</span>
            <span>${c.verdict || ''}</span>
          </div>
        ` : ''}

        ${c.evaluation && c.evaluation.summary ? `
          <div class="eval-summary">${c.evaluation.summary.substring(0, 100)}${c.evaluation.summary.length > 100 ? '...' : ''}</div>
        ` : ''}

        <div class="card-actions">
          ${c.status === 'waiting' ? `
            <button class="btn-evaluate" data-id="${c.id}">🤖 AI评估</button>
          ` : `
            <button class="btn-qualify" data-id="${c.id}">✅ 合格</button>
            <button class="btn-reject" data-id="${c.id}">❌ 不合格</button>
          `}
          <button class="btn-detail" data-id="${c.id}">📋 详情</button>
        </div>

        <div class="eval-detail ${expandedCardId === c.id ? 'open' : ''}" id="detail-${c.id}">
          ${evalDetail}
        </div>
      </div>
    `;
  }

  // ========== 渲染评估详情 ==========
  function renderEvalDetail(evaluation) {
    if (!evaluation || !evaluation.analysis) return '<div class="eval-summary">暂无详细评估</div>';

    const analysis = evaluation.analysis;
    const dimNames = {
      techStack: '技术栈',
      experience: '工作经验',
      education: '学历',
      projectRelevance: '项目相关',
      bonus: '加分项',
      hardRequirements: '硬性门槛'
    };

    let dimsHtml = '';
    for (const key in analysis) {
      const dim = analysis[key];
      const name = dimNames[key] || key;

      if (key === 'hardRequirements') {
        dimsHtml += `
          <div class="dim-row">
            <span class="dim-name">${name}</span>
            <span class="dim-score">${dim.pass ? '✅' : '❌'}</span>
            <span class="dim-detail">${dim.detail || ''}</span>
          </div>
        `;
      } else {
        dimsHtml += `
          <div class="dim-row">
            <span class="dim-name">${name}</span>
            <span class="dim-score">${dim.score}/${dim.max}</span>
            <span class="dim-detail">${dim.detail || ''}</span>
          </div>
        `;
      }
    }

    let highlightsHtml = '';
    if (evaluation.highlights && evaluation.highlights.length) {
      highlightsHtml = `
        <div class="highlights">
          <span>💡 亮点：</span>${evaluation.highlights.join('、')}
        </div>
      `;
    }

    let risksHtml = '';
    if (evaluation.risks && evaluation.risks.length) {
      risksHtml = `
        <div class="risks">
          <span>⚠️ 风险：</span>${evaluation.risks.join('、')}
        </div>
      `;
    }

    return `
      ${dimsHtml}
      <div class="ai-summary">
        <div class="label">💡 AI 建议</div>
        <div>${evaluation.summary || '暂无'}</div>
        ${highlightsHtml}
        ${risksHtml}
      </div>
    `;
  }

  // ========== 事件绑定 ==========
  function bindEvents() {
    // 关闭按钮
    const closeBtn = panel.querySelector('#closeBtn');
    if (closeBtn) closeBtn.addEventListener('click', togglePanel);

    // 自动筛选
    const autoBtn = panel.querySelector('#autoScreenBtn');
    if (autoBtn) {
      autoBtn.addEventListener('click', () => {
        if (state.isScanning) {
          state.stopAutoScreening();
        } else {
          state.startAutoScreening();
        }
        renderPanel();
      });
    }

    // 标签页切换
    panel.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        currentTab = tab.dataset.tab;
        renderPanel();
      });
    });

    // 岗位筛选
    const jobFilter = panel.querySelector('#jobFilter');
    if (jobFilter) {
      jobFilter.addEventListener('change', () => {
        currentJobFilter = jobFilter.value;
        renderPanel();
      });
    }

    // 候选人操作按钮
    panel.querySelectorAll('.btn-evaluate').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        btn.textContent = '⏳ 评估中...';
        btn.disabled = true;
        await state.evaluateCurrentCandidate(id);
        renderPanel();
      });
    });

    panel.querySelectorAll('.btn-qualify').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await state.setCandidateStatus(btn.dataset.id, 'qualified');
        renderPanel();
      });
    });

    panel.querySelectorAll('.btn-reject').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await state.setCandidateStatus(btn.dataset.id, 'unqualified');
        renderPanel();
      });
    });

    panel.querySelectorAll('.btn-detail').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        expandedCardId = expandedCardId === id ? null : id;
        renderPanel();
      });
    });

    // 候选人卡片点击 → 在左侧列表中选中
    panel.querySelectorAll('.candidate-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        const candidate = state.candidates.find(c => c.id === id);
        if (candidate && candidate.el) {
          candidate.el.click();
        }
      });
    });

    // 导出
    const exportBtn = panel.querySelector('#exportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportReport);
    }

    // 刷新
    const refreshBtn = panel.querySelector('#refreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        state.scanCandidateList();
        renderPanel();
      });
    }
  }

  // ========== 筛选候选人 ==========
  function getFilteredCandidates() {
    let list = state.candidates || [];

    // 按状态筛选
    if (currentTab !== 'all') {
      list = list.filter(c => c.status === currentTab);
    }

    // 按岗位筛选
    if (currentJobFilter !== 'all') {
      list = list.filter(c => c.job === currentJobFilter);
    }

    // 排序：已评估的按分数降序，未评估的在后面
    list.sort((a, b) => {
      if (a.score !== null && b.score !== null) return b.score - a.score;
      if (a.score !== null) return -1;
      if (b.score !== null) return 1;
      return 0;
    });

    return list;
  }

  // ========== 辅助函数 ==========
  function getJobNames() {
    const names = new Set();
    (state.candidates || []).forEach(c => {
      if (c.job) names.add(c.job);
    });
    return Array.from(names);
  }

  function getCandidateName(id) {
    const c = state.candidates.find(c => c.id === id);
    return c ? c.name : '';
  }

  function getProgress() {
    if (state.stats.total === 0) return 0;
    return Math.floor((state.stats.screened / state.stats.total) * 100);
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    if (panelOpen) {
      panel.classList.add('open');
      triggerBtn.style.display = 'none';
      renderPanel();
    } else {
      panel.classList.remove('open');
      triggerBtn.style.display = '';
    }
  }

  // ========== 导出报告 ==========
  function exportReport() {
    const screened = state.candidates.filter(c => c.status !== 'waiting');
    if (screened.length === 0) {
      alert('暂无已评估的候选人');
      return;
    }

    let md = `# 候选人筛选报告\n\n`;
    md += `> 生成时间：${new Date().toLocaleString('zh-CN')}\n\n`;
    md += `## 统计\n\n`;
    md += `- 总候选人：${state.stats.total}\n`;
    md += `- 已评估：${state.stats.screened}\n`;
    md += `- 合格：${state.stats.qualified}\n`;
    md += `- 待定：${state.stats.pending}\n`;
    md += `- 不合格：${state.stats.unqualified}\n\n`;

    // 合格候选人
    const qualified = screened.filter(c => c.status === 'qualified');
    if (qualified.length) {
      md += `## ✅ 合格候选人 (${qualified.length})\n\n`;
      qualified.forEach(c => {
        md += `### ${c.name} — ${c.job} (${c.score}分)\n`;
        if (c.evaluation) md += `${c.evaluation.summary || ''}\n`;
        md += `\n`;
      });
    }

    // 待定候选人
    const pending = screened.filter(c => c.status === 'pending');
    if (pending.length) {
      md += `## ⚠️ 待定候选人 (${pending.length})\n\n`;
      pending.forEach(c => {
        md += `### ${c.name} — ${c.job} (${c.score}分)\n`;
        if (c.evaluation) md += `${c.evaluation.summary || ''}\n`;
        md += `\n`;
      });
    }

    // 不合格候选人
    const unqualified = screened.filter(c => c.status === 'unqualified');
    if (unqualified.length) {
      md += `## ❌ 不合格候选人 (${unqualified.length})\n\n`;
      unqualified.forEach(c => {
        md += `- ${c.name} — ${c.job} (${c.score}分)\n`;
      });
    }

    // 下载
    const blob = new Blob([md], { type: 'text/markdown; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `筛选报告_${new Date().toISOString().split('T')[0]}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ========== 暴露更新方法 ==========
  window.__hrHelper.updatePanel = renderPanel;

  // 初始渲染
  renderPanel();

})();
