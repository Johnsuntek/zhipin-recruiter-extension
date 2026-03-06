// content/jobScanner.js — 职位管理页：扫描 JD + 保存职位
// 在 zhipin.com/web/chat/job/* 职位管理页面工作
// 替代旧的 jobSaver.js，仅处理开发岗位

(function () {
  'use strict';

  console.log('[筛选助手] jobScanner 加载');

  // 开发岗位关键词（用于过滤非开发岗位）
  const DEV_ROLE_KEYWORDS = [
    '开发', '工程师', '前端', '后端', '全栈', 'Java', 'Python', 'Go', 'Golang',
    'PHP', 'C++', 'C#', '.NET', 'Node', 'React', 'Vue', 'Angular', 'iOS', 'Android',
    '移动端', '客户端', '服务端', '架构', 'DevOps', 'SRE', '运维开发', '测试开发',
    '算法', '数据开发', '大数据', 'AI', '机器学习', '深度学习', 'NLP',
    'DBA', '数据库', '嵌入式', '系统开发', '中间件', '云原生', '微服务',
    'Flutter', 'React Native', 'Rust', 'Scala', 'Kotlin', 'Swift',
    'Web', 'API', 'SDK', 'CTO', '技术总监', '技术经理', '研发'
  ];

  // 中国主要城市列表
  const CITY_LIST = [
    '深圳', '北京', '上海', '广州', '杭州', '成都', '武汉', '南京', '重庆',
    '东莞', '苏州', '西安', '长沙', '郑州', '青岛', '天津', '厦门', '合肥',
    '佛山', '无锡', '珠海', '宁波', '大连', '济南', '福州', '昆明', '贵阳',
    '哈尔滨', '沈阳', '石家庄', '太原', '南宁', '南昌', '兰州', '海口'
  ];

  // 等待页面加载完成
  setTimeout(scanJobList, 2000);

  // 监听 DOM 变化，处理动态加载的职位列表
  const observer = new MutationObserver(debounce(scanJobList, 1000));
  observer.observe(document.body, { childList: true, subtree: true });

  // ========== 扫描职位列表 ==========
  function scanJobList() {
    // 职位管理页的职位卡片 / 列表行
    const jobItems = document.querySelectorAll(
      '.job-card, .job-item, .job-list-item, [class*="job-item"], tr[class*="job"], .job-tab-item'
    );

    // 备选：表格行
    if (jobItems.length === 0) {
      const rows = document.querySelectorAll('table tbody tr, .job-list tr');
      rows.forEach(row => processJobElement(row));
      return;
    }

    jobItems.forEach(item => processJobElement(item));
  }

  // ========== 处理单个职位元素 ==========
  function processJobElement(jobElement) {
    // 防止重复注入
    if (jobElement.dataset._hrScanInjected) return;
    jobElement.dataset._hrScanInjected = '1';

    // 提取职位标题，判断是否为开发岗位
    const titleEl = jobElement.querySelector(
      'a[class*="job"], .job-name, .job-title, a[href*="job"], .title, .name'
    );
    const title = titleEl ? titleEl.textContent.trim() : jobElement.textContent.trim().substring(0, 50);

    if (!isDevRole(title)) {
      console.log('[筛选助手] 跳过非开发岗位:', title);
      return;
    }

    injectSaveButton(jobElement, title);
  }

  // ========== 判断是否为开发岗位 ==========
  function isDevRole(title) {
    const lowerTitle = title.toLowerCase();
    return DEV_ROLE_KEYWORDS.some(keyword => lowerTitle.includes(keyword.toLowerCase()));
  }

  // ========== 注入"保存此职位"按钮 ==========
  function injectSaveButton(jobElement, title) {
    const btn = document.createElement('button');
    btn.textContent = '保存此职位';
    btn.style.cssText = `
      background: #00A6A7; color: white; border: none; border-radius: 4px;
      padding: 4px 12px; font-size: 12px; cursor: pointer; margin-left: 8px;
      transition: background 0.2s; font-weight: 500;
    `;
    btn.addEventListener('mouseenter', () => { btn.style.background = '#008f90'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#00A6A7'; });

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      btn.textContent = '提取中...';
      btn.disabled = true;

      try {
        const jobData = extractJobFromElement(jobElement);

        if (!jobData.title && !jobData.jdText) {
          alert('未能提取到职位信息，请检查页面是否加载完成');
          resetButton(btn);
          return;
        }

        // 显示确认弹窗，让 HRBP 审核/编辑提取结果
        showJobReviewDialog(jobData, btn);
      } catch (err) {
        console.error('[筛选助手] 提取职位信息失败:', err);
        btn.textContent = '提取失败';
        btn.style.background = '#f5222d';
        setTimeout(() => resetButton(btn), 2000);
      }
    });

    // 找合适的位置插入按钮
    const actionArea = jobElement.querySelector('.btn-area, .actions, .operate, .job-op') || jobElement;
    actionArea.appendChild(btn);
  }

  // ========== 从 DOM 元素中提取职位信息 ==========
  function extractJobFromElement(el) {
    const text = el.textContent || '';

    // 职位名称
    const titleEl = el.querySelector(
      'a[class*="job"], .job-name, .job-title, a[href*="job"], .title, .name'
    );
    const title = titleEl ? titleEl.textContent.trim() : '';

    // 城市
    let city = '';
    for (const c of CITY_LIST) {
      if (text.includes(c)) { city = c; break; }
    }

    // 薪资
    const salaryMatch = text.match(/(\d+-\d+K|\d+k-\d+k|\d+-\d+万)/i);
    const salary = salaryMatch ? salaryMatch[1] : '';

    // 经验要求
    const expMatch = text.match(/([\d]+年以上|[\d]+-[\d]+年|[\d]+年|经验不限|应届)/);
    const experience = expMatch ? expMatch[1] : '';

    // 学历要求
    const eduMatch = text.match(/(博士|硕士|本科|大专|学历不限)/);
    const education = eduMatch ? eduMatch[1] : '';

    // JD 全文（尝试从当前页面的详情区域获取）
    const jdEl = document.querySelector(
      '.job-detail-content, .job-sec-text, .job-description, .detail-content, .job-detail'
    );
    const jdText = jdEl ? jdEl.textContent.trim() : text;

    // 生成唯一 ID
    const jobId = 'job_' + title.replace(/\s+/g, '_') + '_' + Date.now().toString(36);

    return {
      jobId,
      title,
      city,
      salary,
      experience,
      education,
      jdText,
      dimensions: null,
      isDevRole: true,
      savedAt: new Date().toISOString()
    };
  }

  // ========== 显示职位审核/编辑弹窗 ==========
  function showJobReviewDialog(jobData, btn) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.5); z-index: 99999; display: flex;
      align-items: center; justify-content: center; font-family: -apple-system,
      BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: white; border-radius: 12px; padding: 24px; width: 520px;
      max-height: 85vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    `;

    dialog.innerHTML = `
      <h2 style="margin:0 0 16px; font-size:18px; color:#333;">
        职位信息确认 — ${jobData.title || '未知职位'}
      </h2>
      <p style="color:#666; font-size:13px; margin-bottom:16px;">
        请检查以下提取结果，修正后点击保存
      </p>

      <div style="display:grid; gap:12px;">
        <label style="display:block;">
          <span style="font-weight:600; font-size:13px; color:#333;">职位名称：</span>
          <input id="_hr_title" value="${escapeHtml(jobData.title)}"
            style="width:100%; box-sizing:border-box; margin-top:4px; padding:8px;
            border:1px solid #d9d9d9; border-radius:6px; font-size:13px;">
        </label>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <label>
            <span style="font-weight:600; font-size:13px; color:#333;">城市：</span>
            <input id="_hr_city" value="${escapeHtml(jobData.city)}"
              style="width:100%; box-sizing:border-box; margin-top:4px; padding:6px 8px;
              border:1px solid #d9d9d9; border-radius:6px; font-size:13px;">
          </label>
          <label>
            <span style="font-weight:600; font-size:13px; color:#333;">薪资范围：</span>
            <input id="_hr_salary" value="${escapeHtml(jobData.salary)}"
              style="width:100%; box-sizing:border-box; margin-top:4px; padding:6px 8px;
              border:1px solid #d9d9d9; border-radius:6px; font-size:13px;">
          </label>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <label>
            <span style="font-weight:600; font-size:13px; color:#333;">经验要求：</span>
            <input id="_hr_exp" value="${escapeHtml(jobData.experience)}"
              style="width:100%; box-sizing:border-box; margin-top:4px; padding:6px 8px;
              border:1px solid #d9d9d9; border-radius:6px; font-size:13px;">
          </label>
          <label>
            <span style="font-weight:600; font-size:13px; color:#333;">学历要求：</span>
            <input id="_hr_edu" value="${escapeHtml(jobData.education)}"
              style="width:100%; box-sizing:border-box; margin-top:4px; padding:6px 8px;
              border:1px solid #d9d9d9; border-radius:6px; font-size:13px;">
          </label>
        </div>

        <label style="display:block;">
          <span style="font-weight:600; font-size:13px; color:#333;">职位描述（JD）：</span>
          <textarea id="_hr_jdText" rows="8"
            style="width:100%; box-sizing:border-box; margin-top:4px; padding:8px;
            border:1px solid #d9d9d9; border-radius:6px; font-size:13px;
            line-height:1.6; resize:vertical;">${escapeHtml(jobData.jdText)}</textarea>
        </label>
      </div>

      <div style="display:flex; gap:12px; justify-content:flex-end; margin-top:20px;">
        <button id="_hr_cancel"
          style="padding:8px 20px; border:1px solid #d9d9d9; border-radius:6px;
          background:white; cursor:pointer; font-size:14px;">取消</button>
        <button id="_hr_confirm"
          style="padding:8px 24px; border:none; border-radius:6px; background:#00A6A7;
          color:white; cursor:pointer; font-size:14px; font-weight:600;">确认保存</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // 取消
    dialog.querySelector('#_hr_cancel').addEventListener('click', () => {
      overlay.remove();
      resetButton(btn);
    });

    // 确认保存
    dialog.querySelector('#_hr_confirm').addEventListener('click', async () => {
      const confirmBtn = dialog.querySelector('#_hr_confirm');
      confirmBtn.textContent = '保存中...';
      confirmBtn.disabled = true;

      // 收集编辑后的数据
      jobData.title = dialog.querySelector('#_hr_title').value.trim();
      jobData.city = dialog.querySelector('#_hr_city').value.trim();
      jobData.salary = dialog.querySelector('#_hr_salary').value.trim();
      jobData.experience = dialog.querySelector('#_hr_exp').value.trim();
      jobData.education = dialog.querySelector('#_hr_edu').value.trim();
      jobData.jdText = dialog.querySelector('#_hr_jdText').value.trim();

      try {
        // 发送给 background 保存（background 会自动调用 LLM 提取维度）
        const response = await sendMessage({
          type: 'SAVE_JOB',
          job: jobData
        });

        if (response.ok) {
          overlay.remove();
          btn.textContent = '已保存';
          btn.style.background = '#52c41a';
          btn.disabled = true;
          console.log('[筛选助手] 职位已保存:', jobData.title);
        } else {
          throw new Error(response.error || '保存失败');
        }
      } catch (err) {
        console.error('[筛选助手] 保存职位失败:', err);
        confirmBtn.textContent = '保存失败: ' + err.message;
        confirmBtn.style.background = '#f5222d';
        setTimeout(() => {
          confirmBtn.textContent = '确认保存';
          confirmBtn.style.background = '#00A6A7';
          confirmBtn.disabled = false;
        }, 2000);
      }
    });

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resetButton(btn);
      }
    });
  }

  // ========== 工具函数 ==========

  function resetButton(btn) {
    btn.textContent = '保存此职位';
    btn.style.background = '#00A6A7';
    btn.disabled = false;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
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
