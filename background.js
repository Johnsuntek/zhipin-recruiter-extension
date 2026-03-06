// ============================================================
// BOSS直聘开发岗位筛选助手 - Background Service Worker
// 职责: 存储管理、AI调用、预约状态机、消息路由
// ============================================================

const STORAGE_KEYS = {
  SETTINGS: 'settings',
  JOBS: 'savedJobs',
  CANDIDATES: 'candidates',
  SCHEDULES: 'schedules',
  DAILY_STATS: 'dailyStats'
};

const DEFAULT_SETTINGS = {
  llmProvider: 'openai',
  apiKey: '',
  apiBaseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  maxTokensPerRequest: 4000,
  hrbpName: '',
  companyName: '',
  templates: {
    rejection: '感谢您的关注！您的简历已收录到我们的人才数据库中，我们会持续评估合适的机会。如有匹配的岗位，会第一时间与您联系，请保持关注。',
    greeting: '您好！我是{company}的{hrbpName}，很高兴在BOSS直聘上看到您的简历。我们正在招聘{jobTitle}岗位，觉得您的背景很匹配。想和您做个简短的电话沟通，了解一下您的情况和期望。\n\n请问您这几个时间段方便接听电话吗？\n{timeSlots}\n\n期待您的回复！'
  },
  safetyConfig: {
    minReplyDelaySec: 30,
    maxReplyDelaySec: 120,
    maxDailyMessages: 50,
    timeoutHours: 48
  }
};

// ========== 存储工具 ==========
async function getStore(key) {
  const result = await chrome.storage.local.get(key);
  return result[key] || (key === STORAGE_KEYS.SETTINGS ? { ...DEFAULT_SETTINGS } : {});
}

async function setStore(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

async function getSettings() {
  const saved = await getStore(STORAGE_KEYS.SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    templates: { ...DEFAULT_SETTINGS.templates, ...(saved.templates || {}) },
    safetyConfig: { ...DEFAULT_SETTINGS.safetyConfig, ...(saved.safetyConfig || {}) }
  };
}

// ========== LLM 调用 ==========
async function callLLM(systemPrompt, userPrompt) {
  const settings = await getSettings();
  if (!settings.apiKey) throw new Error('请先在设置页面配置 API Key');

  const resp = await fetch(`${settings.apiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: settings.maxTokensPerRequest,
      temperature: 0.3
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`LLM API 错误 (${resp.status}): ${err}`);
  }

  const data = await resp.json();
  return data.choices[0].message.content.trim();
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch {}
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  if (m) { try { return JSON.parse(m[1].trim()); } catch {} }
  throw new Error('无法解析 LLM 返回的 JSON');
}

// ========== AI 功能 ==========

// 提取 JD 评估维度
async function extractJDDimensions(jdText, jobTitle) {
  const result = await callLLM(
    '你是专业技术招聘顾问。从开发岗位JD中提取结构化评估维度。只返回JSON。',
    `职位: ${jobTitle}\nJD:\n${jdText}\n\n返回JSON:\n{\n  "techStack": ["必须技术栈"],\n  "experienceYears": "年限要求",\n  "education": "学历要求",\n  "projectKeywords": ["关键项目经验词"],\n  "bonusItems": ["加分项"],\n  "hardRequirements": ["硬性门槛"],\n  "isDevRole": true,\n  "summary": "一句话核心要求"\n}`
  );
  return parseJSON(result);
}

// 评估候选人
async function evaluateCandidate(resumeText, dimensions, jobTitle) {
  const result = await callLLM(
    '你是专业技术招聘评估专家。根据JD评估维度对候选人简历逐项评估。只返回JSON。',
    `## 职位: ${jobTitle}\n## JD维度:\n${JSON.stringify(dimensions, null, 2)}\n\n## 候选人简历:\n${resumeText}\n\n返回JSON:\n{\n  "score": 85,\n  "recommendation": "qualified/unqualified/pending",\n  "analysis": {\n    "techStack": {"score": 20, "max": 25, "match": "高/中/低", "detail": "分析"},\n    "experience": {"score": 18, "max": 20, "match": "高/中/低", "detail": "分析"},\n    "education": {"score": 10, "max": 10, "match": "高/中/低", "detail": "分析"},\n    "projectRelevance": {"score": 20, "max": 25, "match": "高/中/低", "detail": "分析"},\n    "bonus": {"score": 8, "max": 10, "detail": "分析"},\n    "hardRequirements": {"pass": true, "detail": "分析"}\n  },\n  "conclusion": "简要评估结论",\n  "highlights": ["亮点"],\n  "risks": ["风险"]\n}`
  );
  return parseJSON(result);
}

// 生成聊天回复（预约协商用）
async function generateChatReply(context) {
  return await callLLM(
    '你是HR助手，正在BOSS直聘上代替HRBP与候选人沟通预约电话时间。回复要自然、礼貌、简洁，像真人聊天。只返回回复文本。',
    `HRBP: ${context.hrbpName}\n公司: ${context.company}\n职位: ${context.jobTitle}\n可用时间: ${context.timeSlots}\n\n当前状态: ${context.status}\n对话历史:\n${context.chatHistory}\n\n候选人最新消息:\n${context.lastMessage}\n\n生成回复。如候选人提了时间，判断是否匹配HRBP可用时间，匹配则确认，不匹配则建议其他时间。`
  );
}

// 解析候选人回复中的时间意图
async function parseTimeIntent(message, availableSlots) {
  const result = await callLLM(
    '分析候选人回复，判断是否提到具体时间以及是否与可用时间匹配。只返回JSON。',
    `可用时间段: ${JSON.stringify(availableSlots)}\n候选人回复: "${message}"\n\n返回JSON:\n{\n  "hasTimeInfo": true,\n  "proposedTime": "候选人提的时间",\n  "matchesAvailable": true,\n  "confirmedSlot": "匹配的时间段",\n  "needsNegotiation": false\n}`
  );
  return parseJSON(result);
}

// ========== 预约管理 ==========
async function createSchedule(candidateId, timeSlots) {
  const schedules = await getStore(STORAGE_KEYS.SCHEDULES);
  const schedule = {
    id: `sch_${Date.now()}`,
    candidateId,
    hrbpTimeSlots: timeSlots,
    confirmedTime: null,
    status: 'pending',
    chatLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  schedules[schedule.id] = schedule;
  await setStore(STORAGE_KEYS.SCHEDULES, schedules);

  const candidates = await getStore(STORAGE_KEYS.CANDIDATES);
  if (candidates[candidateId]) {
    candidates[candidateId].status = 'scheduling';
    candidates[candidateId].scheduleId = schedule.id;
    await setStore(STORAGE_KEYS.CANDIDATES, candidates);
  }
  return schedule;
}

async function updateSchedule(scheduleId, status, extra = {}) {
  const schedules = await getStore(STORAGE_KEYS.SCHEDULES);
  if (!schedules[scheduleId]) return null;
  Object.assign(schedules[scheduleId], { status, updatedAt: new Date().toISOString(), ...extra });
  await setStore(STORAGE_KEYS.SCHEDULES, schedules);

  const candidates = await getStore(STORAGE_KEYS.CANDIDATES);
  const cid = schedules[scheduleId].candidateId;
  if (candidates[cid]) {
    candidates[cid].status = status === 'confirmed' ? 'scheduled' : status === 'timeout' ? 'timeout' : 'scheduling';
    await setStore(STORAGE_KEYS.CANDIDATES, candidates);
  }
  return schedules[scheduleId];
}

async function addChatLog(scheduleId, role, message) {
  const schedules = await getStore(STORAGE_KEYS.SCHEDULES);
  if (!schedules[scheduleId]) return;
  schedules[scheduleId].chatLog.push({ role, message, timestamp: new Date().toISOString() });
  schedules[scheduleId].updatedAt = new Date().toISOString();
  await setStore(STORAGE_KEYS.SCHEDULES, schedules);
}

// ========== 每日限额 ==========
async function checkDailyLimit() {
  const settings = await getSettings();
  const stats = await getStore(STORAGE_KEYS.DAILY_STATS);
  const today = new Date().toISOString().split('T')[0];
  return (stats[today] || 0) < settings.safetyConfig.maxDailyMessages;
}

async function incrementDailyCount() {
  const stats = await getStore(STORAGE_KEYS.DAILY_STATS);
  const today = new Date().toISOString().split('T')[0];
  stats[today] = (stats[today] || 0) + 1;
  await setStore(STORAGE_KEYS.DAILY_STATS, stats);
}

// ========== 超时检查 ==========
chrome.alarms.create('checkTimeouts', { periodInMinutes: 30 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'checkTimeouts') return;
  const settings = await getSettings();
  const schedules = await getStore(STORAGE_KEYS.SCHEDULES);
  const now = Date.now();
  for (const [id, s] of Object.entries(schedules)) {
    if (s.status !== 'pending' && s.status !== 'negotiating') continue;
    if ((now - new Date(s.updatedAt).getTime()) / 3600000 > settings.safetyConfig.timeoutHours) {
      await updateSchedule(id, 'timeout');
    }
  }
});

// ========== 消息路由 ==========
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
  return true;
});

async function handleMessage(msg) {
  switch (msg.type) {
    case 'GET_SETTINGS':
      return { ok: true, settings: await getSettings() };

    case 'SAVE_SETTINGS':
      await setStore(STORAGE_KEYS.SETTINGS, msg.settings);
      return { ok: true };

    case 'SAVE_JOB': {
      const jobs = await getStore(STORAGE_KEYS.JOBS);
      const dimensions = await extractJDDimensions(msg.job.jdText, msg.job.title);
      jobs[msg.job.jobId] = { ...msg.job, dimensions, savedAt: new Date().toISOString() };
      await setStore(STORAGE_KEYS.JOBS, jobs);
      return { ok: true, dimensions };
    }

    case 'GET_JOBS':
      return { ok: true, jobs: await getStore(STORAGE_KEYS.JOBS) };

    case 'DELETE_JOB': {
      const jobs = await getStore(STORAGE_KEYS.JOBS);
      delete jobs[msg.jobId];
      await setStore(STORAGE_KEYS.JOBS, jobs);
      return { ok: true };
    }

    case 'EXTRACT_JD_DIMENSIONS': {
      const dimensions = await extractJDDimensions(msg.jdText, msg.jobTitle);
      return { ok: true, dimensions };
    }

    case 'EVALUATE_CANDIDATE': {
      const jobs = await getStore(STORAGE_KEYS.JOBS);
      const job = jobs[msg.jobId];
      if (!job) return { ok: false, error: '未找到关联的职位JD' };
      const evaluation = await evaluateCandidate(msg.resumeText, job.dimensions, job.title);
      const candidates = await getStore(STORAGE_KEYS.CANDIDATES);
      candidates[msg.candidateId] = {
        ...(candidates[msg.candidateId] || {}),
        ...msg.candidateInfo,
        candidateId: msg.candidateId,
        jobId: msg.jobId,
        jobTitle: job.title,
        evaluation,
        score: evaluation.score,
        status: evaluation.recommendation || (evaluation.score >= 80 ? 'qualified' : evaluation.score >= 60 ? 'pending' : 'unqualified'),
        evaluatedAt: new Date().toISOString()
      };
      await setStore(STORAGE_KEYS.CANDIDATES, candidates);
      return { ok: true, evaluation };
    }

    case 'UPDATE_CANDIDATE_STATUS': {
      const candidates = await getStore(STORAGE_KEYS.CANDIDATES);
      if (candidates[msg.candidateId]) {
        candidates[msg.candidateId].status = msg.status;
        candidates[msg.candidateId].updatedAt = new Date().toISOString();
        await setStore(STORAGE_KEYS.CANDIDATES, candidates);
      }
      return { ok: true };
    }

    case 'UPDATE_CANDIDATE': {
      const candidates = await getStore(STORAGE_KEYS.CANDIDATES);
      const id = msg.candidate.candidateId;
      candidates[id] = { ...candidates[id], ...msg.candidate, updatedAt: new Date().toISOString() };
      await setStore(STORAGE_KEYS.CANDIDATES, candidates);
      return { ok: true };
    }

    case 'CREATE_SCHEDULE': {
      const schedule = await createSchedule(msg.candidateId, msg.timeSlots);
      return { ok: true, schedule };
    }

    case 'GENERATE_GREETING': {
      const settings = await getSettings();
      const candidates = await getStore(STORAGE_KEYS.CANDIDATES);
      const c = candidates[msg.candidateId];
      if (!c) return { ok: false, error: '候选人未找到' };
      const text = settings.templates.greeting
        .replace('{company}', settings.companyName || '我们公司')
        .replace('{hrbpName}', settings.hrbpName || 'HR')
        .replace('{jobTitle}', c.jobTitle || '开发工程师')
        .replace('{timeSlots}', msg.timeSlots.join('\n'));
      return { ok: true, message: text };
    }

    case 'GENERATE_CHAT_REPLY': {
      if (!(await checkDailyLimit())) return { ok: false, error: '已达今日消息上限' };
      const settings = await getSettings();
      const reply = await generateChatReply({
        hrbpName: settings.hrbpName || 'HR',
        company: settings.companyName || '我们公司',
        jobTitle: msg.jobTitle,
        timeSlots: msg.timeSlots,
        status: msg.status,
        chatHistory: msg.chatHistory,
        lastMessage: msg.lastMessage
      });
      return { ok: true, reply };
    }

    case 'PARSE_TIME_INTENT': {
      const intent = await parseTimeIntent(msg.message, msg.availableSlots);
      return { ok: true, intent };
    }

    case 'UPDATE_SCHEDULE': {
      const schedule = await updateSchedule(msg.scheduleId, msg.status, msg.extra || {});
      return { ok: true, schedule };
    }

    case 'ADD_CHAT_LOG': {
      await addChatLog(msg.scheduleId, msg.role, msg.message);
      await incrementDailyCount();
      return { ok: true };
    }

    case 'GET_REJECTION_MESSAGE': {
      const settings = await getSettings();
      return { ok: true, message: settings.templates.rejection };
    }

    case 'GET_ALL_DATA':
      return {
        ok: true,
        data: {
          jobs: await getStore(STORAGE_KEYS.JOBS),
          candidates: await getStore(STORAGE_KEYS.CANDIDATES),
          schedules: await getStore(STORAGE_KEYS.SCHEDULES),
          settings: await getSettings()
        }
      };

    case 'CLEAR_DATA': {
      const targets = { all: ['JOBS','CANDIDATES','SCHEDULES','DAILY_STATS'], candidates: ['CANDIDATES','SCHEDULES'], jobs: ['JOBS'] };
      for (const k of (targets[msg.dataType] || [])) await setStore(STORAGE_KEYS[k], {});
      return { ok: true };
    }

    default:
      return { ok: false, error: '未知消息类型: ' + msg.type };
  }
}
