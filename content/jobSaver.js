// content/jobSaver.js — 职位管理页：保存 JD + LLM 提取评估维度
// 在职位管理页面（zhipin.com/web/chat/job/list）为每个职位注入"保存此职位"按钮

(function() {
  'use strict';

  console.log('[筛选助手] jobSaver 加载');

  // 等待页面加载完成
  setTimeout(scanJobList, 2000);

  // 监听DOM变化，处理动态加载
  const observer = new MutationObserver(() => {
    scanJobList();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  function scanJobList() {
    // 职位管理页的职位卡片
    // 可能的选择器（需根据实际DOM调整）
    const jobItems = document.querySelectorAll(
      '.job-card, .job-item, .job-list-item, [class*="job-item"], tr[class*="job"]'
    );

    // 备选：尝试表格行
    if (jobItems.length === 0) {
      const rows = document.querySelectorAll('table tbody tr, .job-list tr');
      rows.forEach(row => injectSaveButton(row));
      return;
    }

    jobItems.forEach(item => injectSaveButton(item));
  }

  function injectSaveButton(jobElement) {
    if (jobElement.dataset._hrSaveInjected) return;
    jobElement.dataset._hrSaveInjected = '1';

    const btn = document.createElement('button');
    btn.textContent = '📥 保存此职位';
    btn.style.cssText = `
      background: #00A6A7; color: white; border: none; border-radius: 4px;
      padding: 4px 10px; font-size: 12px; cursor: pointer; margin-left: 8px;
      transition: background 0.2s;
    `;
    btn.addEventListener('mouseenter', () => btn.style.background = '#008f90');
    btn.addEventListener('mouseleave', () => btn.style.background = '#00A6A7');

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.textContent = '⏳ 提取中...';
      btn.disabled = true;

      try {
        const jobData = extractJobFromElement(jobElement);

        if (!jobData.jdText && !jobData.title) {
          alert('未能提取到职位信息，请检查页面是否加载完成');
          btn.textContent = '📥 保存此职位';
          btn.disabled = false;
          return;
        }

        // 先保存基本信息
        await sendMessage({ type: 'SAVE_JOB', job: jobData });

        // 如果有 JD 文本，调用 LLM 提取维度
        if (jobData.jdText) {
          btn.textContent = '🤖 AI 分析中...';
          const response = await sendMessage({
            type: 'EXTRACT_JD_DIMENSIONS',
            jobTitle: jobData.title,
            jdText: jobData.jdText
          });

          if (response.ok && response.dimensions) {
            jobData.dimensions = response.dimensions;
            // 显示提取结果让 HRBP 确认
            showDimensionsDialog(jobData, btn);
            return;
          }
        }

        btn.textContent = '✅ 已保存';
        btn.style.background = '#52c41a';
      } catch (err) {
        console.error('[筛选助手] 保存职位失败:', err);
        btn.textContent = '❌ 失败';
        btn.style.background = '#f5222d';
        setTimeout(() => {
          btn.textContent = '📥 保存此职位';
          btn.style.background = '#00A6A7';
          btn.disabled = false;
        }, 2000);
      }
    });

    // 找合适的位置插入按钮
    const actionArea = jobElement.querySelector('.btn-area, .actions, .operate') || jobElement;
    actionArea.appendChild(btn);
  }

  function extractJobFromElement(el) {
    const text = el.textContent || '';

    // 尝试提取职位名称
    const titleEl = el.querySelector('a[class*="job"], .job-name, .job-title, a[href*="job"]');
    const title = titleEl ? titleEl.textContent.trim() : '';

    // 尝试提取其他信息
    const cityMatch = text.match(/(深圳|北京|上海|广州|杭州|成都|武汉|南京|重庆|东莞|苏州|西安|长沙|郑州|青岛|天津)/);
    const salaryMatch = text.match(/(\d+-\d+K|\d+k-\d+k)/i);
    const expMatch = text.match(/([\d]+年|经验不限|应届)/);
    const eduMatch = text.match(/(博士|硕士|本科|大专|学历不限)/);
    const statusMatch = text.match(/(开放中|已关闭|待开放|暂停)/);

    // 尝试获取 JD 全文（可能需要点击职位后才能看到）
    const jdEl = document.querySelector('.job-detail-content, .job-sec-text, .job-description');
    const jdText = jdEl ? jdEl.textContent.trim() : text;

    // 生成唯一 ID
    const jobId = title.replace(/\s+/g, '_') + '_' + Date.now().toString(36);

    return {
      jobId,
      title,
      city: cityMatch ? cityMatch[1] : '',
      salary: salaryMatch ? salaryMatch[1] : '',
      experience: expMatch ? expMatch[1] : '',
      education: eduMatch ? eduMatch[1] : '',
      status: statusMatch ? statusMatch[1] : '未知',
      jdText,
      dimensions: null,
      isDevRole: false
    };
  }

  // 显示维度确认弹窗
  function showDimensionsDialog(jobData, btn) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.5); z-index: 99999; display: flex;
      align-items: center; justify-content: center;
    `;

    const dims = jobData.dimensions || {};
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: white; border-radius: 12px; padding: 24px; width: 500px;
      max-height: 80vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    `;

    dialog.innerHTML = `
      <h2 style="margin:0 0 16px; font-size:18px; color:#333;">
        📋 AI 提取结果 — ${jobData.title}
      </h2>
      <p style="color:#666; font-size:13px; margin-bottom:16px;">
        ${dims.isDevRole ? '✅ 开发岗位' : '⚠️ 非开发岗位'} · 请检查并修正后保存
      </p>

      <label style="display:block; margin-bottom:12px;">
        <span style="font-weight:600; font-size:13px;">技术栈要求：</span>
        <textarea id="_hr_techStack" rows="2" style="width:100%; box-sizing:border-box; margin-top:4px; padding:8px; border:1px solid #d9d9d9; border-radius:6px; font-size:13px;">${(dims.techStack || []).join(', ')}</textarea>
      </label>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
        <label>
          <span style="font-weight:600; font-size:13px;">经验要求：</span>
          <input id="_hr_expYears" value="${dims.expYears || ''}" style="width:100%; box-sizing:border-box; margin-top:4px; padding:6px 8px; border:1px solid #d9d9d9; border-radius:6px; font-size:13px;">
        </label>
        <label>
          <span style="font-weight:600; font-size:13px;">学历要求：</span>
          <input id="_hr_education" value="${dims.education || ''}" style="width:100%; box-sizing:border-box; margin-top:4px; padding:6px 8px; border:1px solid #d9d9d9; border-radius:6px; font-size:13px;">
        </label>
      </div>

      <label style="display:block; margin-bottom:12px;">
        <span style="font-weight:600; font-size:13px;">关键要求：</span>
        <textarea id="_hr_keyReq" rows="2" style="width:100%; box-sizing:border-box; margin-top:4px; padding:8px; border:1px solid #d9d9d9; border-radius:6px; font-size:13px;">${(dims.keyRequirements || []).join(', ')}</textarea>
      </label>

      <label style="display:block; margin-bottom:12px;">
        <span style="font-weight:600; font-size:13px;">加分项：</span>
        <textarea id="_hr_bonus" rows="2" style="width:100%; box-sizing:border-box; margin-top:4px; padding:8px; border:1px solid #d9d9d9; border-radius:6px; font-size:13px;">${(dims.bonusPoints || []).join(', ')}</textarea>
      </label>

      <label style="display:block; margin-bottom:20px;">
        <span style="font-weight:600; font-size:13px;">硬性门槛：</span>
        <textarea id="_hr_hardReq" rows="2" style="width:100%; box-sizing:border-box; margin-top:4px; padding:8px; border:1px solid #d9d9d9; border-radius:6px; font-size:13px;">${(dims.hardRequirements || []).join(', ')}</textarea>
      </label>

      <div style="display:flex; gap:12px; justify-content:flex-end;">
        <button id="_hr_cancel" style="padding:8px 20px; border:1px solid #d9d9d9; border-radius:6px; background:white; cursor:pointer; font-size:14px;">取消</button>
        <button id="_hr_confirm" style="padding:8px 20px; border:none; border-radius:6px; background:#00A6A7; color:white; cursor:pointer; font-size:14px; font-weight:600;">确认保存</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // 取消
    dialog.querySelector('#_hr_cancel').addEventListener('click', () => {
      overlay.remove();
      btn.textContent = '📥 保存此职位';
      btn.style.background = '#00A6A7';
      btn.disabled = false;
    });

    // 确认保存
    dialog.querySelector('#_hr_confirm').addEventListener('click', async () => {
      const splitComma = s => s.split(/[,，]/).map(x => x.trim()).filter(Boolean);

      jobData.dimensions = {
        techStack: splitComma(dialog.querySelector('#_hr_techStack').value),
        expYears: dialog.querySelector('#_hr_expYears').value.trim(),
        education: dialog.querySelector('#_hr_education').value.trim(),
        keyRequirements: splitComma(dialog.querySelector('#_hr_keyReq').value),
        bonusPoints: splitComma(dialog.querySelector('#_hr_bonus').value),
        hardRequirements: splitComma(dialog.querySelector('#_hr_hardReq').value),
        isDevRole: dims.isDevRole !== false
      };

      await sendMessage({ type: 'SAVE_JOB', job: jobData });
      overlay.remove();
      btn.textContent = '✅ 已保存';
      btn.style.background = '#52c41a';
      btn.disabled = false;
    });

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        btn.textContent = '📥 保存此职位';
        btn.style.background = '#00A6A7';
        btn.disabled = false;
      }
    });
  }

  // 发送消息到 background
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
