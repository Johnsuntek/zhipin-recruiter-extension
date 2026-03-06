// options.js — 设置页面逻辑

const DEFAULT_SETTINGS = {
  llmProvider: 'openai',
  apiKey: '',
  apiBaseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  maxTokensPerRequest: 2000,
  dailyRequestLimit: 200,
  hrbpName: 'HR',
  companyName: '',
  templates: {
    reject: '感谢您的关注！您的简历已收录到我们的人才数据库中，我们会持续评估合适的机会。如有匹配的岗位，会第一时间与您联系，请保持关注。'
  }
};

// 加载设置
function loadSettings() {
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
    if (!res || !res.ok) return;
    const s = { ...DEFAULT_SETTINGS, ...res.settings };

    document.getElementById('llmProvider').value = s.llmProvider;
    document.getElementById('apiKey').value = s.apiKey;
    document.getElementById('apiBaseUrl').value = s.apiBaseUrl;
    document.getElementById('model').value = s.model;
    document.getElementById('maxTokens').value = s.maxTokensPerRequest;
    document.getElementById('dailyLimit').value = s.dailyRequestLimit;
    document.getElementById('hrbpName').value = s.hrbpName;
    document.getElementById('companyName').value = s.companyName;
    document.getElementById('rejectTemplate').value = s.templates?.reject || DEFAULT_SETTINGS.templates.reject;
  });
}

// 保存设置
function saveSettings() {
  const settings = {
    llmProvider: document.getElementById('llmProvider').value,
    apiKey: document.getElementById('apiKey').value.trim(),
    apiBaseUrl: document.getElementById('apiBaseUrl').value.trim(),
    model: document.getElementById('model').value.trim(),
    maxTokensPerRequest: parseInt(document.getElementById('maxTokens').value) || 2000,
    dailyRequestLimit: parseInt(document.getElementById('dailyLimit').value) || 200,
    hrbpName: document.getElementById('hrbpName').value.trim(),
    companyName: document.getElementById('companyName').value.trim(),
    templates: {
      reject: document.getElementById('rejectTemplate').value.trim()
    }
  };

  chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings }, (res) => {
    if (res && res.ok) {
      const msg = document.getElementById('savedMsg');
      msg.classList.add('show');
      setTimeout(() => msg.classList.remove('show'), 2000);
    }
  });
}

// 测试 API 连接
async function testApi() {
  const status = document.getElementById('apiStatus');
  const btn = document.getElementById('testApiBtn');
  btn.disabled = true;
  status.textContent = '⏳ 测试中...';
  status.style.color = '#faad14';

  const apiKey = document.getElementById('apiKey').value.trim();
  const apiBaseUrl = document.getElementById('apiBaseUrl').value.trim();
  const model = document.getElementById('model').value.trim();

  if (!apiKey) {
    status.textContent = '❌ 请填写 API Key';
    status.style.color = '#f5222d';
    btn.disabled = false;
    return;
  }

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
      status.textContent = `✅ 连接成功 (${data.model || model})`;
      status.style.color = '#52c41a';
    } else {
      const err = await response.text();
      status.textContent = `❌ 错误 ${response.status}`;
      status.style.color = '#f5222d';
      console.error('API 测试失败:', err);
    }
  } catch (e) {
    status.textContent = `❌ 连接失败: ${e.message}`;
    status.style.color = '#f5222d';
  }

  btn.disabled = false;
}

// 清空数据
function clearData(keys) {
  if (!confirm('确定要清空数据吗？此操作不可恢复。')) return;
  chrome.storage.local.remove(keys, () => {
    alert('已清空');
  });
}

// 事件绑定
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();

  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('testApiBtn').addEventListener('click', testApi);

  document.getElementById('clearCandidates').addEventListener('click', () => clearData(['candidates']));
  document.getElementById('clearJobs').addEventListener('click', () => clearData(['savedJobs']));
  document.getElementById('clearAll').addEventListener('click', () => clearData(['savedJobs', 'candidates', 'schedules', 'dailyStats']));
});
