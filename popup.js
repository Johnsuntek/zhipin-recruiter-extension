// popup.js — 扩展弹窗逻辑

function loadData() {
  chrome.runtime.sendMessage({ type: 'GET_ALL_DATA' }, (res) => {
    if (!res || !res.ok) return;

    const { jobs, candidates } = res.data;

    // 统计
    const allCandidates = Object.values(candidates || {});
    const qualified = allCandidates.filter(c => c.status === 'qualified');
    const pending = allCandidates.filter(c => c.status === 'pending');
    const unqualified = allCandidates.filter(c => c.status === 'unqualified');

    document.getElementById('statTotal').textContent = allCandidates.length;
    document.getElementById('statQualified').textContent = qualified.length;
    document.getElementById('statPending').textContent = pending.length;
    document.getElementById('statUnqualified').textContent = unqualified.length;

    // 已保存职位
    const jobList = Object.values(jobs || {});
    const jobContent = document.getElementById('jobListContent');

    if (jobList.length === 0) {
      jobContent.innerHTML = '<div class="empty">暂无已保存的职位<br>请在 BOSS 直聘职位管理页面保存</div>';
    } else {
      jobContent.innerHTML = jobList.map(j => `
        <div class="job-item">
          <span class="name">${j.title || '未命名'}</span>
          <span class="badge">${j.dimensions ? '✅ 已分析' : '📥 已保存'}</span>
        </div>
      `).join('');
      jobContent.classList.remove('empty');
    }

    // 最近评估
    const recent = allCandidates
      .filter(c => c.score !== undefined && c.score !== null)
      .sort((a, b) => (b.evaluatedAt || '').localeCompare(a.evaluatedAt || ''))
      .slice(0, 5);

    if (recent.length > 0) {
      document.getElementById('recentSection').style.display = 'block';
      document.getElementById('recentList').innerHTML = recent.map(c => {
        const colorClass = c.score >= 80 ? 'green' : c.score >= 60 ? 'orange' : 'red';
        return `
          <div class="recent-item">
            <span>${c.name || '未知'} · ${c.job || ''}</span>
            <span class="score ${colorClass}">${c.score}分</span>
          </div>
        `;
      }).join('');
    }
  });
}

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
