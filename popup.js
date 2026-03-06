// popup.js — 扩展弹窗逻辑

/**
 * 计算时间倒计时文本
 */
function getCountdown(targetTime) {
  const now = Date.now();
  const target = new Date(targetTime).getTime();
  const diff = target - now;

  if (diff <= 0) return '已开始';

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}天${hours % 24}小时后`;
  if (hours > 0) return `${hours}小时${minutes % 60}分钟后`;
  return `${minutes}分钟后`;
}

/**
 * 格式化日期时间为可读文本
 */
function formatDateTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${month}月${day}日 ${hours}:${mins}`;
}

/**
 * 获取评估状态的显示文本和样式类
 */
function getStatusDisplay(status) {
  const map = {
    qualified:   { text: '合格',   cls: 'status-qualified' },
    pending:     { text: '待定',   cls: 'status-pending' },
    unqualified: { text: '不合格', cls: 'status-unqualified' },
    scheduled:   { text: '已预约', cls: 'status-scheduled' }
  };
  return map[status] || { text: status || '未知', cls: '' };
}

/**
 * 获取分数对应的颜色类
 */
function getScoreClass(score) {
  if (score >= 80) return 'score-green';
  if (score >= 60) return 'score-orange';
  return 'score-red';
}

/**
 * 转义 HTML 特殊字符
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * 加载并渲染所有数据
 */
function loadData() {
  chrome.runtime.sendMessage({ type: 'GET_ALL_DATA' }, (res) => {
    if (!res || !res.ok) return;

    const { jobs, candidates, schedules } = res.data;

    // --- 统计 ---
    const allCandidates = Object.values(candidates || {});
    const qualified = allCandidates.filter(c => c.status === 'qualified');
    const pending = allCandidates.filter(c => c.status === 'pending');
    const unqualified = allCandidates.filter(c => c.status === 'unqualified');
    const scheduled = allCandidates.filter(c => c.status === 'scheduled');

    document.getElementById('statTotal').textContent = allCandidates.length;
    document.getElementById('statQualified').textContent = qualified.length;
    document.getElementById('statPending').textContent = pending.length;
    document.getElementById('statUnqualified').textContent = unqualified.length;
    document.getElementById('statScheduled').textContent = scheduled.length;

    // --- 即将到来的电话沟通 ---
    renderSchedules(schedules);

    // --- 已保存职位 ---
    renderJobs(jobs, allCandidates);

    // --- 最近评估 ---
    renderRecentEvaluations(allCandidates);
  });
}

/**
 * 渲染即将到来的预约电话
 */
function renderSchedules(schedules) {
  const allSchedules = Object.values(schedules || {});
  const upcoming = allSchedules
    .filter(s => s.status === 'confirmed' && s.confirmedTime)
    .sort((a, b) => new Date(a.confirmedTime).getTime() - new Date(b.confirmedTime).getTime());

  const card = document.getElementById('scheduleCard');
  const list = document.getElementById('scheduleList');
  const count = document.getElementById('scheduleCount');

  if (upcoming.length === 0) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';
  count.textContent = `(${upcoming.length})`;

  list.innerHTML = upcoming.map(s => `
    <div class="schedule-item">
      <div class="schedule-info">
        <div class="schedule-name">${escapeHtml(s.candidateName || '未知候选人')}</div>
        <div class="schedule-job">${escapeHtml(s.jobTitle || '')}</div>
      </div>
      <div class="schedule-time">
        <div class="time">${formatDateTime(s.confirmedTime)}</div>
        <div class="countdown">${getCountdown(s.confirmedTime)}</div>
      </div>
    </div>
  `).join('');
}

/**
 * 渲染已保存的职位列表
 */
function renderJobs(jobs, allCandidates) {
  const jobList = Object.values(jobs || {});
  const content = document.getElementById('jobListContent');
  const jobCount = document.getElementById('jobCount');

  if (jobList.length === 0) {
    content.innerHTML = '<div class="empty">暂无已保存的职位<br>请在 BOSS 直聘职位页面保存 JD</div>';
    jobCount.textContent = '';
    return;
  }

  jobCount.textContent = `(${jobList.length})`;

  content.innerHTML = jobList.map(j => {
    // 统计该职位下的候选人数
    const candidateCount = allCandidates.filter(c => c.jobId === j.id || c.job === j.title).length;
    const badgeText = candidateCount > 0 ? `${candidateCount} 人` : '暂无候选人';

    return `
      <div class="job-item">
        <span class="job-name">${escapeHtml(j.title || '未命名职位')}</span>
        <span class="job-badge">${badgeText}</span>
      </div>
    `;
  }).join('');
}

/**
 * 渲染最近5条评估记录
 */
function renderRecentEvaluations(allCandidates) {
  const recent = allCandidates
    .filter(c => c.score !== undefined && c.score !== null)
    .sort((a, b) => (b.evaluatedAt || '').localeCompare(a.evaluatedAt || ''))
    .slice(0, 5);

  const card = document.getElementById('recentCard');
  const list = document.getElementById('recentList');

  if (recent.length === 0) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';

  list.innerHTML = recent.map(c => {
    const scoreClass = getScoreClass(c.score);
    const statusInfo = getStatusDisplay(c.status);

    return `
      <div class="eval-item">
        <span class="eval-info">${escapeHtml(c.name || '未知')} · ${escapeHtml(c.job || '')}</span>
        <span class="eval-score ${scoreClass}">${c.score}分</span>
        <span class="eval-status ${statusInfo.cls}">${statusInfo.text}</span>
      </div>
    `;
  }).join('');
}

/**
 * 初始化
 */
document.addEventListener('DOMContentLoaded', () => {
  loadData();

  // 设置按钮
  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 打开 BOSS 直聘
  document.getElementById('openBossBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.zhipin.com/web/chat/index' });
  });
});
