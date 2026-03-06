// options.js — 设置页面逻辑

const DEFAULT_SETTINGS = {
  llmProvider: 'openai',
  apiKey: '',
  apiBaseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  maxTokensPerRequest: 2000,
  hrbpName: '',
  companyName: '',
  templates: {
    reject: '感谢您的关注！您的简历已收录到我们的人才数据库中，我们会持续评估合适的机会。如有匹配的岗位，会第一时间与您联系，请保持关注。',
    schedule: '您好！我是{company}的{hrbpName}，关于{jobTitle}岗位，想和您做一个简单的电话沟通，以下时间段您方便吗？\n{timeSlots}'
  },
  safety: {
    minDelay: 3,
    maxDelay: 8,
    dailyLimit: 200,
    timeoutHours: 24
  }
};

/**
 * 显示提示消息
 */
function showToast(message, isError) {
  const el = document.getElementById('toastMsg');
  el.textContent = message;
  el.className = isError ? 'toast show error' : 'toast show';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.classList.remove('show');
  }, 2500);
}

/**
 * 加载设置
 */
function loadSettings() {
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
    if (!res || !res.ok) return;

    const s = deepMerge(DEFAULT_SETTINGS, res.settings || {});

    document.getElementById('llmProvider').value = s.llmProvider;
    document.getElementById('apiKey').value = s.apiKey;
    document.getElementById('apiBaseUrl').value = s.apiBaseUrl;
    document.getElementById('model').value = s.model;
    document.getElementById('maxTokens').value = s.maxTokensPerRequest;
    document.getElementById('hrbpName').value = s.hrbpName;
    document.getElementById('companyName').value = s.companyName;
    document.getElementById('rejectTemplate').value = s.templates?.reject || DEFAULT_SETTINGS.templates.reject;
    document.getElementById('scheduleTemplate').value = s.templates?.schedule || DEFAULT_SETTINGS.templates.schedule;
    document.getElementById('minDelay').value = s.safety?.minDelay ?? DEFAULT_SETTINGS.safety.minDelay;
    document.getElementById('maxDelay').value = s.safety?.maxDelay ?? DEFAULT_SETTINGS.safety.maxDelay;
    document.getElementById('dailyLimit').value = s.safety?.dailyLimit ?? DEFAULT_SETTINGS.safety.dailyLimit;
    document.getElementById('timeoutHours').value = s.safety?.timeoutHours ?? DEFAULT_SETTINGS.safety.timeoutHours;
  });
}

/**
 * 深合并对象
 */
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object'
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * 收集表单数据并保存设置
 */
function saveSettings() {
  const minDelay = parseInt(document.getElementById('minDelay').value) || DEFAULT_SETTINGS.safety.minDelay;
  const maxDelay = parseInt(document.getElementById('maxDelay').value) || DEFAULT_SETTINGS.safety.maxDelay;

  // 验证延迟值
  if (minDelay > maxDelay) {
    showToast('最小延迟不能大于最大延迟', true);
    return;
  }

  const settings = {
    llmProvider: document.getElementById('llmProvider').value,
    apiKey: document.getElementById('apiKey').value.trim(),
    apiBaseUrl: document.getElementById('apiBaseUrl').value.trim(),
    model: document.getElementById('model').value.trim(),
    maxTokensPerRequest: parseInt(document.getElementById('maxTokens').value) || DEFAULT_SETTINGS.maxTokensPerRequest,
    hrbpName: document.getElementById('hrbpName').value.trim(),
    companyName: document.getElementById('companyName').value.trim(),
    templates: {
      reject: document.getElementById('rejectTemplate').value.trim(),
      schedule: document.getElementById('scheduleTemplate').value.trim()
    },
    safety: {
      minDelay,
      maxDelay,
      dailyLimit: parseInt(document.getElementById('dailyLimit').value) || DEFAULT_SETTINGS.safety.dailyLimit,
      timeoutHours: parseInt(document.getElementById('timeoutHours').value) || DEFAULT_SETTINGS.safety.timeoutHours
    }
  };

  chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings }, (res) => {
    if (res && res.ok) {
      showToast('设置已保存');
    } else {
      showToast('保存失败，请重试', true);
    }
  });
}

/**
 * 测试 API 连接
 */
async function testApi() {
  const statusEl = document.getElementById('apiStatus');
  const btn = document.getElementById('testApiBtn');

  const apiKey = document.getElementById('apiKey').value.trim();
  const apiBaseUrl = document.getElementById('apiBaseUrl').value.trim();
  const model = document.getElementById('model').value.trim();

  if (!apiKey) {
    statusEl.textContent = '请先填写 API Key';
    statusEl.style.color = '#f5222d';
    return;
  }

  if (!apiBaseUrl) {
    statusEl.textContent = '请先填写 API Base URL';
    statusEl.style.color = '#f5222d';
    return;
  }

  btn.disabled = true;
  statusEl.textContent = '正在测试连接...';
  statusEl.style.color = '#faad14';

  try {
    const response = await fetch(`${apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || 'gpt-4o',
        messages: [{ role: 'user', content: '请回复"OK"' }],
        max_tokens: 10
      })
    });

    if (response.ok) {
      const data = await response.json();
      const usedModel = data.model || model || '未知';
      statusEl.textContent = `连接成功 (${usedModel})`;
      statusEl.style.color = '#52c41a';
    } else {
      const status = response.status;
      let errorHint = '';
      if (status === 401) errorHint = '，API Key 无效';
      else if (status === 403) errorHint = '，权限不足';
      else if (status === 404) errorHint = '，接口地址错误';
      else if (status === 429) errorHint = '，请求频率超限';

      statusEl.textContent = `连接失败 (HTTP ${status}${errorHint})`;
      statusEl.style.color = '#f5222d';
      console.error('API 测试失败:', await response.text());
    }
  } catch (e) {
    statusEl.textContent = `连接失败: ${e.message}`;
    statusEl.style.color = '#f5222d';
  }

  btn.disabled = false;
}

/**
 * 清空数据（通过 background 消息）
 */
function clearData(type) {
  const messages = {
    candidates: '确定要清空所有候选人数据吗？此操作不可恢复。',
    jobs: '确定要清空所有职位数据吗？此操作不可恢复。',
    all: '确定要清空所有数据吗？包括候选人、职位、预约记录等。此操作不可恢复。'
  };

  const storageKeys = {
    candidates: ['candidates'],
    jobs: ['savedJobs'],
    all: ['savedJobs', 'candidates', 'schedules', 'dailyStats']
  };

  if (!confirm(messages[type])) return;

  // 二次确认（仅清空全部时）
  if (type === 'all') {
    if (!confirm('再次确认：真的要清空所有数据吗？')) return;
  }

  chrome.storage.local.remove(storageKeys[type], () => {
    showToast(type === 'all' ? '所有数据已清空' : '数据已清空');
  });
}

/**
 * 事件绑定与初始化
 */
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();

  // 保存设置
  document.getElementById('saveBtn').addEventListener('click', saveSettings);

  // 测试 API
  document.getElementById('testApiBtn').addEventListener('click', testApi);

  // 数据清理
  document.getElementById('clearCandidates').addEventListener('click', () => clearData('candidates'));
  document.getElementById('clearJobs').addEventListener('click', () => clearData('jobs'));
  document.getElementById('clearAll').addEventListener('click', () => clearData('all'));
});
