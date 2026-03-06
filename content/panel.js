// content/panel.js — 侧边面板 UI (Shadow DOM)
// 候选人管理面板：评估结果展示 + 预约管理 + 时间选择器

(function () {
  'use strict';

  console.log('[筛选助手] panel 加载');

  const state = window.__hrHelper;

  // 面板状态
  let panelOpen = false;
  let currentTab = 'all';         // all / qualified / unqualified / scheduling / scheduled
  let currentJobFilter = 'all';   // all / 具体岗位名
  let expandedCardId = null;      // 当前展开详情的候选人
  let timePickerTarget = null;    // 当前打开时间选择器的候选人 ID

  // ========== 创建 Shadow DOM 面板 ==========
  const host = document.createElement('div');
  host.id = 'hr-screening-panel-host';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // 加载样式
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('content/panel.css');
  shadow.appendChild(link);

  // 触发按钮（竖排文字"筛选助手"）
  const triggerBtn = document.createElement('button');
  triggerBtn.className = 'trigger-btn';
  triggerBtn.textContent = '筛选助手';
  triggerBtn.addEventListener('click', togglePanel);
  shadow.appendChild(triggerBtn);

  // 面板容器
  const panel = document.createElement('div');
  panel.className = 'panel';
  shadow.appendChild(panel);

  // 模态层容器
  const modalContainer = document.createElement('div');
  modalContainer.className = 'modal-container';
  shadow.appendChild(modalContainer);

  // ========== 渲染面板 ==========
  function renderPanel() {
    const candidates = getFilteredCandidates();
    const jobs = state.savedJobs || {};
    const jobNames = getJobNames();
    const hasJobs = Object.keys(jobs).length > 0;
    const stats = state.stats || {};
    const screenedCount = (stats.qualified || 0) + (stats.pending || 0) + (stats.unqualified || 0);

    panel.innerHTML = `
      <!-- 头部 -->
      <div class="panel-header">
        <div class="header-left">
          <div class="title">开发岗位筛选助手</div>
          <div class="status">${hasJobs ? '已加载 ' + Object.keys(jobs).length + ' 个职位 JD' : '未保存职位 JD'}</div>
        </div>
        <button class="close-btn" id="closeBtn">&#10005;</button>
      </div>

      <!-- 统计条 -->
      <div class="stats-bar">
        <div class="stat-card total">
          <div class="number">${stats.total || 0}</div>
          <div class="label">总候选人</div>
        </div>
        <div class="stat-card qualified">
          <div class="number">${stats.qualified || 0}</div>
          <div class="label">合格</div>
        </div>
        <div class="stat-card pending">
          <div class="number">${stats.pending || 0}</div>
          <div class="label">待定</div>
        </div>
        <div class="stat-card unqualified">
          <div class="number">${stats.unqualified || 0}</div>
          <div class="label">不合格</div>
        </div>
        <div class="stat-card scheduling">
          <div class="number">${stats.scheduling || 0}</div>
          <div class="label">预约中</div>
        </div>
      </div>

      <!-- 控制区 -->
      <div class="controls">
        <div class="filter-row">
          <select id="jobFilter">
            <option value="all">全部岗位</option>
            ${jobNames.map(j => `<option value="${escapeHtml(j)}" ${currentJobFilter === j ? 'selected' : ''}>${escapeHtml(j)}</option>`).join('')}
          </select>
        </div>

        ${!hasJobs ? `
          <div class="no-jd-banner">
            <span>请先去<strong>职位管理</strong>页面保存岗位 JD，才能开始 AI 评估</span>
          </div>
        ` : `
          <button class="auto-screen-btn ${state.isScanning ? 'stop' : 'start'}" id="autoScreenBtn">
            ${state.isScanning ? '停止筛选' : '开始自动筛选'}
          </button>
          ${state.isScanning ? `
            <div class="progress-bar active">
              <div class="fill" style="width: ${getProgress(screenedCount)}%"></div>
            </div>
            <div class="progress-text active">
              ${state.currentCandidateId ? '正在评估: ' + getCandidateName(state.currentCandidateId) : ''}
              ${screenedCount}/${stats.total || 0}
            </div>
          ` : ''}
        `}
      </div>

      <!-- 状态标签页 -->
      <div class="tabs">
        <div class="tab ${currentTab === 'all' ? 'active' : ''}" data-tab="all">全部</div>
        <div class="tab ${currentTab === 'qualified' ? 'active' : ''}" data-tab="qualified">合格</div>
        <div class="tab ${currentTab === 'unqualified' ? 'active' : ''}" data-tab="unqualified">不合格</div>
        <div class="tab ${currentTab === 'scheduling' ? 'active' : ''}" data-tab="scheduling">预约中</div>
        <div class="tab ${currentTab === 'scheduled' ? 'active' : ''}" data-tab="scheduled">已预约</div>
      </div>

      <!-- 候选人列表 -->
      <div class="candidate-list" id="candidateList">
        ${currentTab === 'scheduled' ? renderScheduledView() :
          candidates.length === 0 ? renderEmptyState() :
          candidates.map(c => renderCandidateCard(c)).join('')}
      </div>

      <!-- 底部工具栏 -->
      <div class="panel-footer">
        <div class="footer-actions">
          <button id="exportBtn">导出报告</button>
          <button id="refreshBtn">刷新</button>
        </div>
        <span class="version">v1.0.0</span>
      </div>
    `;

    bindEvents();
  }

  // ========== 渲染候选人卡片 ==========
  function renderCandidateCard(c) {
    const scoreColor = c.score >= 80 ? 'green' : c.score >= 60 ? 'orange' : 'red';
    const statusLabels = {
      qualified: '推荐面试',
      pending: '可以考虑',
      unqualified: '不匹配',
      waiting: '待评估',
      no_jd: '无JD',
      scheduling: '预约中',
      negotiating: '协商中',
      scheduled: '已预约',
      confirmed: '已预约',
      rejected_notified: '已告知',
      timeout: '超时'
    };

    const statusLabel = statusLabels[c.status] || '待评估';
    const evalSummary = c.evaluation && (c.evaluation.summary || c.evaluation.conclusion)
      ? (c.evaluation.summary || c.evaluation.conclusion) : '';

    return `
      <div class="candidate-card ${c.id === state.currentCandidateId ? 'active' : ''}" data-id="${c.id}">
        <div class="card-header">
          <div class="card-info">
            <span class="name">${escapeHtml(c.name)}</span>
            <span class="job-tag">${escapeHtml(c.job)}</span>
          </div>
          <span class="status-badge ${c.status}">${c.score !== null ? c.score + '分' : statusLabel}</span>
        </div>

        ${c.score !== null ? `
          <div class="score-bar">
            <div class="fill ${scoreColor}" style="width: ${c.score}%"></div>
          </div>
          <div class="score-meta">
            <span>${statusLabel}</span>
            <span>${escapeHtml(c.verdict || '')}</span>
          </div>
        ` : ''}

        ${evalSummary ? `
          <div class="eval-summary">${escapeHtml(evalSummary).substring(0, 120)}${evalSummary.length > 120 ? '...' : ''}</div>
        ` : ''}

        <div class="card-actions">
          ${c.status === 'waiting' ? `
            <button class="btn-action btn-evaluate" data-id="${c.id}">AI评估</button>
          ` : ''}
          ${c.status === 'qualified' || c.status === 'pending' ? `
            <button class="btn-action btn-schedule" data-id="${c.id}">预约电话时间</button>
          ` : ''}
          ${c.status === 'unqualified' ? `
            <button class="btn-action btn-reject-notify" data-id="${c.id}">发送告知</button>
          ` : ''}
          ${c.status !== 'waiting' ? `
            <button class="btn-action btn-detail" data-id="${c.id}">详情</button>
          ` : ''}
        </div>

        ${expandedCardId === c.id ? renderEvalDetail(c.evaluation) : ''}
      </div>
    `;
  }

  // ========== 渲染评估详情 ==========
  function renderEvalDetail(evaluation) {
    if (!evaluation) return '<div class="eval-detail open"><div class="eval-summary">暂无详细评估</div></div>';

    const analysis = evaluation.analysis || {};
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
            <span class="dim-score ${dim.pass ? 'pass' : 'fail'}">${dim.pass ? '通过' : '不通过'}</span>
            <span class="dim-detail">${escapeHtml(dim.detail || '')}</span>
          </div>
        `;
      } else if (dim && dim.score !== undefined) {
        dimsHtml += `
          <div class="dim-row">
            <span class="dim-name">${name}</span>
            <span class="dim-score">${dim.score}/${dim.max || 0}</span>
            <span class="dim-detail">${escapeHtml(dim.detail || '')}</span>
          </div>
        `;
      }
    }

    let highlightsHtml = '';
    if (evaluation.highlights && evaluation.highlights.length) {
      highlightsHtml = `<div class="highlights"><strong>亮点：</strong>${evaluation.highlights.map(escapeHtml).join('、')}</div>`;
    }

    let risksHtml = '';
    if (evaluation.risks && evaluation.risks.length) {
      risksHtml = `<div class="risks"><strong>风险：</strong>${evaluation.risks.map(escapeHtml).join('、')}</div>`;
    }

    return `
      <div class="eval-detail open">
        ${dimsHtml}
        <div class="ai-summary">
          <div class="summary-label">AI 建议</div>
          <div>${escapeHtml(evaluation.summary || evaluation.conclusion || '暂无')}</div>
          ${highlightsHtml}
          ${risksHtml}
        </div>
      </div>
    `;
  }

  // ========== 渲染已预约视图（按时间排序）==========
  function renderScheduledView() {
    const schedules = state.schedules || {};
    const confirmedList = [];

    for (const sid in schedules) {
      const s = schedules[sid];
      if (s.status === 'confirmed' || s.status === 'scheduled') {
        const candidate = state.candidates.find(c => c.id === s.candidateId) ||
                          state.screenedCandidates[s.candidateId] || {};
        confirmedList.push({
          ...s,
          candidateName: candidate.name || s.candidateId,
          jobTitle: candidate.job || candidate.jobTitle || ''
        });
      }
    }

    // 按确认时间排序
    confirmedList.sort((a, b) => {
      const ta = a.confirmedTime || a.updatedAt || '';
      const tb = b.confirmedTime || b.updatedAt || '';
      return ta.localeCompare(tb);
    });

    if (confirmedList.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-icon">&#128197;</div>
          <div class="empty-text">暂无已预约的电话</div>
          <div class="empty-hint">合格候选人预约成功后会显示在这里</div>
        </div>
      `;
    }

    return confirmedList.map(s => `
      <div class="scheduled-card">
        <div class="scheduled-time">${escapeHtml(s.confirmedTime || '待定')}</div>
        <div class="scheduled-info">
          <span class="scheduled-name">${escapeHtml(s.candidateName)}</span>
          <span class="scheduled-job">${escapeHtml(s.jobTitle)}</span>
        </div>
        <span class="status-badge confirmed">已预约</span>
      </div>
    `).join('');
  }

  // ========== 渲染空状态 ==========
  function renderEmptyState() {
    const hints = {
      all: '请在沟通列表中查看候选人',
      qualified: '暂无合格候选人',
      unqualified: '暂无不合格候选人',
      scheduling: '暂无正在预约中的候选人',
      scheduled: '暂无已预约的候选人'
    };
    return `
      <div class="empty-state">
        <div class="empty-icon">&#128203;</div>
        <div class="empty-text">暂无候选人</div>
        <div class="empty-hint">${hints[currentTab] || ''}</div>
      </div>
    `;
  }

  // ========== 时间选择器模态框 ==========
  function showTimePickerModal(candidateId) {
    timePickerTarget = candidateId;
    const candidate = state.candidates.find(c => c.id === candidateId);
    const candidateName = candidate ? candidate.name : '';

    // 生成未来 7 天的日期选项
    const dateOptions = [];
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const dateStr = `${d.getMonth() + 1}月${d.getDate()}日`;
      const weekDay = weekDays[d.getDay()];
      dateOptions.push({
        value: d.toISOString().split('T')[0],
        label: `${dateStr} ${weekDay}`,
        isToday: i === 0
      });
    }

    // 时间段选项
    const timeSlots = [
      '09:00-10:00', '10:00-11:00', '11:00-12:00',
      '14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:00'
    ];

    modalContainer.innerHTML = `
      <div class="modal-overlay" id="timePickerOverlay">
        <div class="modal-content">
          <div class="modal-header">
            <h3>选择空闲时间段</h3>
            <span class="modal-subtitle">为 ${escapeHtml(candidateName)} 预约电话沟通</span>
          </div>

          <div class="modal-body">
            <div class="date-section">
              <div class="section-label">选择日期（可多选）</div>
              <div class="date-grid">
                ${dateOptions.map(d => `
                  <label class="date-option">
                    <input type="checkbox" name="date" value="${d.value}" class="date-checkbox">
                    <span class="date-label">${d.label}${d.isToday ? '（今天）' : ''}</span>
                  </label>
                `).join('')}
              </div>
            </div>

            <div class="time-section">
              <div class="section-label">选择时间段（可多选）</div>
              <div class="time-grid">
                ${timeSlots.map(t => `
                  <label class="time-option">
                    <input type="checkbox" name="time" value="${t}" class="time-checkbox">
                    <span class="time-label">${t}</span>
                  </label>
                `).join('')}
              </div>
            </div>

            <div class="selected-preview" id="selectedPreview">
              <div class="section-label">已选时间段</div>
              <div class="preview-list" id="previewList">请选择日期和时间段</div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="modal-btn cancel" id="cancelTimePicker">取消</button>
            <button class="modal-btn confirm" id="confirmTimePicker">确认预约</button>
          </div>
        </div>
      </div>
    `;

    modalContainer.style.display = 'block';
    bindTimePickerEvents();
  }

  // ========== 绑定时间选择器事件 ==========
  function bindTimePickerEvents() {
    const overlay = modalContainer.querySelector('#timePickerOverlay');
    const cancelBtn = modalContainer.querySelector('#cancelTimePicker');
    const confirmBtn = modalContainer.querySelector('#confirmTimePicker');

    // 关闭
    cancelBtn.addEventListener('click', closeTimePicker);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeTimePicker();
    });

    // 选择变化时更新预览
    const checkboxes = modalContainer.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
      cb.addEventListener('change', updateTimePreview);
    });

    // 确认
    confirmBtn.addEventListener('click', async () => {
      const selectedSlots = getSelectedTimeSlots();
      if (selectedSlots.length === 0) {
        alert('请至少选择一个时间段');
        return;
      }

      confirmBtn.textContent = '创建预约...';
      confirmBtn.disabled = true;

      try {
        // 创建预约
        const resp = await sendMessage({
          type: 'CREATE_SCHEDULE',
          candidateId: timePickerTarget,
          timeSlots: selectedSlots
        });

        if (resp.ok && resp.schedule) {
          // 更新候选人状态
          const candidate = state.candidates.find(c => c.id === timePickerTarget);
          if (candidate) {
            candidate.status = 'scheduling';
            candidate.scheduleId = resp.schedule.id;
          }

          // 触发发送问候消息
          if (state.sendGreeting) {
            await state.sendGreeting(timePickerTarget, resp.schedule.id, selectedSlots);
          }

          closeTimePicker();
          renderPanel();
        } else {
          throw new Error(resp.error || '创建预约失败');
        }
      } catch (err) {
        console.error('[筛选助手] 创建预约失败:', err);
        confirmBtn.textContent = '创建失败: ' + err.message;
        setTimeout(() => {
          confirmBtn.textContent = '确认预约';
          confirmBtn.disabled = false;
        }, 2000);
      }
    });
  }

  function updateTimePreview() {
    const previewList = modalContainer.querySelector('#previewList');
    const slots = getSelectedTimeSlots();

    if (slots.length === 0) {
      previewList.textContent = '请选择日期和时间段';
      return;
    }

    previewList.innerHTML = slots.map(s => `<div class="preview-item">${escapeHtml(s)}</div>`).join('');
  }

  function getSelectedTimeSlots() {
    const dates = [];
    const times = [];

    modalContainer.querySelectorAll('.date-checkbox:checked').forEach(cb => {
      dates.push(cb.value);
    });
    modalContainer.querySelectorAll('.time-checkbox:checked').forEach(cb => {
      times.push(cb.value);
    });

    // 组合日期和时间
    const slots = [];
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    dates.forEach(date => {
      const d = new Date(date + 'T00:00:00');
      const dateLabel = `${d.getMonth() + 1}月${d.getDate()}日 ${weekDays[d.getDay()]}`;
      times.forEach(time => {
        slots.push(`${dateLabel} ${time}`);
      });
    });

    return slots;
  }

  function closeTimePicker() {
    modalContainer.style.display = 'none';
    modalContainer.innerHTML = '';
    timePickerTarget = null;
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

    // AI 评估按钮
    panel.querySelectorAll('.btn-evaluate').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        btn.textContent = '评估中...';
        btn.disabled = true;
        await state.evaluateCurrentCandidate(id);
        renderPanel();
      });
    });

    // 预约电话时间按钮
    panel.querySelectorAll('.btn-schedule').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        showTimePickerModal(btn.dataset.id);
      });
    });

    // 发送告知按钮
    panel.querySelectorAll('.btn-reject-notify').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;

        if (!confirm('确认向该候选人发送告知消息？')) return;

        btn.textContent = '发送中...';
        btn.disabled = true;

        // 先点击该候选人，确保聊天窗口切换到对应候选人
        const candidate = state.candidates.find(c => c.id === id);
        if (candidate && candidate.el) {
          candidate.el.click();
          await new Promise(r => setTimeout(r, 2000));
        }

        if (state.sendRejection) {
          const result = await state.sendRejection(id);
          if (result.ok) {
            btn.textContent = '已发送';
            candidate.status = 'rejected_notified';
            renderPanel();
          } else {
            btn.textContent = '发送失败';
            setTimeout(() => { btn.textContent = '发送告知'; btn.disabled = false; }, 2000);
          }
        }
      });
    });

    // 详情展开
    panel.querySelectorAll('.btn-detail').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        expandedCardId = expandedCardId === id ? null : id;
        renderPanel();
      });
    });

    // 候选人卡片点击（在列表中选中对应候选人）
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
      refreshBtn.addEventListener('click', async () => {
        // 重新加载数据
        try {
          const response = await sendMessage({ type: 'GET_ALL_DATA' });
          if (response.ok) {
            state.savedJobs = response.data.jobs || {};
            state.screenedCandidates = response.data.candidates || {};
            state.schedules = response.data.schedules || {};
          }
        } catch (err) {
          console.error('[筛选助手] 刷新数据失败:', err);
        }
        state.scanCandidateList();
        renderPanel();
      });
    }
  }

  // ========== 筛选候选人 ==========
  function getFilteredCandidates() {
    let list = state.candidates || [];

    // 按状态筛选
    switch (currentTab) {
      case 'qualified':
        list = list.filter(c => c.status === 'qualified' || c.status === 'pending');
        break;
      case 'unqualified':
        list = list.filter(c => c.status === 'unqualified' || c.status === 'rejected_notified');
        break;
      case 'scheduling':
        list = list.filter(c => c.status === 'scheduling' || c.status === 'negotiating');
        break;
      case 'scheduled':
        list = list.filter(c => c.status === 'scheduled' || c.status === 'confirmed');
        break;
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
    const c = (state.candidates || []).find(c => c.id === id);
    return c ? c.name : '';
  }

  function getProgress(screened) {
    const total = state.stats.total || 0;
    if (total === 0) return 0;
    return Math.floor((screened / total) * 100);
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

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ========== 导出报告 ==========
  function exportReport() {
    const screened = (state.candidates || []).filter(c => c.status !== 'waiting');
    if (screened.length === 0) {
      alert('暂无已评估的候选人');
      return;
    }

    let md = `# 候选人筛选报告\n\n`;
    md += `> 生成时间：${new Date().toLocaleString('zh-CN')}\n\n`;
    md += `## 统计\n\n`;
    md += `- 总候选人：${state.stats.total}\n`;
    md += `- 合格：${state.stats.qualified}\n`;
    md += `- 待定：${state.stats.pending}\n`;
    md += `- 不合格：${state.stats.unqualified}\n`;
    md += `- 预约中：${state.stats.scheduling}\n`;
    md += `- 已预约：${state.stats.scheduled}\n\n`;

    const qualified = screened.filter(c => c.status === 'qualified');
    if (qualified.length) {
      md += `## 合格候选人 (${qualified.length})\n\n`;
      qualified.forEach(c => {
        md += `### ${c.name} - ${c.job} (${c.score}分)\n`;
        if (c.evaluation) md += `${c.evaluation.summary || c.evaluation.conclusion || ''}\n`;
        md += `\n`;
      });
    }

    const pending = screened.filter(c => c.status === 'pending');
    if (pending.length) {
      md += `## 待定候选人 (${pending.length})\n\n`;
      pending.forEach(c => {
        md += `### ${c.name} - ${c.job} (${c.score}分)\n`;
        if (c.evaluation) md += `${c.evaluation.summary || c.evaluation.conclusion || ''}\n`;
        md += `\n`;
      });
    }

    const unqualified = screened.filter(c => c.status === 'unqualified');
    if (unqualified.length) {
      md += `## 不合格候选人 (${unqualified.length})\n\n`;
      unqualified.forEach(c => {
        md += `- ${c.name} - ${c.job} (${c.score}分)\n`;
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

  // ========== 暴露更新方法给其他模块 ==========
  window.__hrHelper.updatePanel = renderPanel;

  // ========== 消息通信 ==========
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

  // 初始渲染
  renderPanel();

})();
