// background.js — Service Worker
// 职责：LLM API 调用 + chrome.storage 数据管理

const STORAGE_KEYS = {
  JOBS: 'savedJobs',
  CANDIDATES: 'candidates',
  SCHEDULES: 'schedules',
  SETTINGS: 'settings',
  DAILY_STATS: 'dailyStats'
};

// ========== 默认设置 ==========
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

// ========== 存储操作 ==========
async function getStorage(keys) {
  return new Promise(resolve => {
    chrome.storage.local.get(keys, resolve);
  });
}

async function setStorage(data) {
  return new Promise(resolve => {
    chrome.storage.local.set(data, resolve);
  });
}

async function getSettings() {
  const { settings } = await getStorage([STORAGE_KEYS.SETTINGS]);
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function getSavedJobs() {
  const { savedJobs } = await getStorage([STORAGE_KEYS.JOBS]);
  return savedJobs || {};
}

async function getCandidates() {
  const { candidates } = await getStorage([STORAGE_KEYS.CANDIDATES]);
  return candidates || {};
}

// ========== LLM API 调用 ==========
async function callLLM(prompt, systemPrompt) {
  const settings = await getSettings();

  if (!settings.apiKey) {
    throw new Error('请先在设置页面配置 API Key');
  }

  const url = `${settings.apiBaseUrl}/chat/completions`;

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      max_tokens: settings.maxTokensPerRequest,
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`LLM API 错误 (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// 解析 LLM 返回的 JSON（容错处理）
function parseLLMJson(text) {
  // 尝试提取 JSON 块
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) ||
                    text.match(/```\s*([\s\S]*?)```/) ||
                    text.match(/(\{[\s\S]*\})/);

  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1].trim());
    } catch (e) {
      console.error('[筛选助手] JSON 解析失败:', e, jsonMatch[1]);
    }
  }

  // 直接尝试解析
  try {
    return JSON.parse(text.trim());
  } catch (e) {
    console.error('[筛选助手] 无法解析 LLM 返回:', text);
    return null;
  }
}

// ========== 消息处理 ==========
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {

        // ---- 设置 ----
        case 'GET_SETTINGS': {
          const settings = await getSettings();
          sendResponse({ ok: true, settings });
          break;
        }

        case 'SAVE_SETTINGS': {
          await setStorage({ [STORAGE_KEYS.SETTINGS]: message.settings });
          sendResponse({ ok: true });
          break;
        }

        // ---- 职位 JD ----
        case 'SAVE_JOB': {
          const jobs = await getSavedJobs();
          const job = message.job;
          const now = new Date().toISOString();
          jobs[job.jobId] = {
            ...jobs[job.jobId],
            ...job,
            savedAt: now
          };
          await setStorage({ [STORAGE_KEYS.JOBS]: jobs });
          sendResponse({ ok: true });
          break;
        }

        case 'GET_JOBS': {
          const jobs = await getSavedJobs();
          sendResponse({ ok: true, jobs });
          break;
        }

        case 'DELETE_JOB': {
          const jobs = await getSavedJobs();
          delete jobs[message.jobId];
          await setStorage({ [STORAGE_KEYS.JOBS]: jobs });
          sendResponse({ ok: true });
          break;
        }

        // ---- LLM: 提取 JD 维度 ----
        case 'EXTRACT_JD_DIMENSIONS': {
          const prompt = `从以下职位描述中提取关键评估维度，返回 JSON 格式：
{
  "techStack": ["技术1", "技术2"],
  "expYears": "X-Y年",
  "education": "本科/硕士/学历不限",
  "keyRequirements": ["关键要求1", "关键要求2"],
  "bonusPoints": ["加分项1", "加分项2"],
  "hardRequirements": ["硬性门槛1"],
  "salary": "薪资范围",
  "isDevRole": true
}

注意：
- techStack 只列出明确提到的技术栈（编程语言、框架、工具、中间件等）
- isDevRole 判断是否为开发相关岗位（前端/后端/全栈/移动端/测试开发/DevOps/架构师等）
- 如果某项信息JD中没有明确提到，填空数组或空字符串

职位名称：${message.jobTitle}
职位描述：
${message.jdText}`;

          const result = await callLLM(prompt);
          const dimensions = parseLLMJson(result);
          sendResponse({ ok: true, dimensions });
          break;
        }

        // ---- LLM: 评估候选人 ----
        case 'EVALUATE_CANDIDATE': {
          const { candidateInfo, jobInfo } = message;
          const dims = jobInfo.dimensions || {};

          const prompt = `你是一名专业的技术招聘评估专家。请将以下候选人简历与职位要求进行逐项对比评估。

## 职位要求
- 职位：${jobInfo.title}
- 技术栈要求：${(dims.techStack || []).join(', ') || '未指定'}
- 经验要求：${dims.expYears || '未指定'}
- 学历要求：${dims.education || '未指定'}
- 关键要求：${(dims.keyRequirements || []).join(', ') || '未指定'}
- 加分项：${(dims.bonusPoints || []).join(', ') || '无'}
- 硬性门槛：${(dims.hardRequirements || []).join(', ') || '无'}
- 薪资范围：${dims.salary || jobInfo.salary || '未指定'}

## 候选人信息
${candidateInfo}

## 请严格按以下 JSON 格式返回（不要加其他文字）：
{
  "score": 85,
  "verdict": "推荐面试",
  "analysis": {
    "techStack": { "score": 18, "max": 25, "detail": "说明" },
    "experience": { "score": 18, "max": 20, "detail": "说明" },
    "education": { "score": 10, "max": 10, "detail": "说明" },
    "projectRelevance": { "score": 20, "max": 25, "detail": "说明" },
    "bonus": { "score": 8, "max": 10, "detail": "说明" },
    "hardRequirements": { "pass": true, "detail": "说明" }
  },
  "summary": "一段话总结评估结论和建议",
  "risks": ["风险1", "风险2"],
  "highlights": ["亮点1", "亮点2"]
}

评分标准：
- 80-100：强烈推荐/推荐面试
- 60-79：可以考虑
- 0-59：不太匹配/明显不符`;

          const result = await callLLM(prompt);
          const evaluation = parseLLMJson(result);

          if (evaluation) {
            // 保存评估结果到候选人数据
            const candidates = await getCandidates();
            const candidateId = message.candidateId;
            candidates[candidateId] = {
              ...candidates[candidateId],
              score: evaluation.score,
              verdict: evaluation.verdict,
              evaluation,
              evaluatedAt: new Date().toISOString(),
              jobId: jobInfo.jobId,
              status: evaluation.score >= 80 ? 'qualified' :
                      evaluation.score >= 60 ? 'pending' : 'unqualified'
            };
            await setStorage({ [STORAGE_KEYS.CANDIDATES]: candidates });
          }

          sendResponse({ ok: true, evaluation });
          break;
        }

        // ---- 候选人管理 ----
        case 'UPDATE_CANDIDATE': {
          const candidates = await getCandidates();
          const now = new Date().toISOString();
          const id = message.candidate.candidateId;
          candidates[id] = {
            ...candidates[id],
            ...message.candidate,
            updatedAt: now
          };
          await setStorage({ [STORAGE_KEYS.CANDIDATES]: candidates });
          sendResponse({ ok: true });
          break;
        }

        case 'UPDATE_CANDIDATE_STATUS': {
          const candidates = await getCandidates();
          const { candidateId, status } = message;
          if (candidates[candidateId]) {
            candidates[candidateId].status = status;
            candidates[candidateId].updatedAt = new Date().toISOString();
            await setStorage({ [STORAGE_KEYS.CANDIDATES]: candidates });
          }
          sendResponse({ ok: true });
          break;
        }

        case 'GET_ALL_DATA': {
          const [jobsData, candidatesData, settingsData] = await Promise.all([
            getSavedJobs(),
            getCandidates(),
            getSettings()
          ]);
          sendResponse({
            ok: true,
            data: {
              jobs: jobsData,
              candidates: candidatesData,
              settings: settingsData
            }
          });
          break;
        }

        default:
          sendResponse({ ok: false, error: '未知消息类型: ' + message.type });
      }
    } catch (err) {
      console.error('[筛选助手] background 错误:', err);
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true; // 异步响应
});
