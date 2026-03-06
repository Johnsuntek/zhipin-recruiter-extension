# 技术实施规范

基于 PRD.md 需求，本文档定义实现细节，供开发参考。

---

## 项目结构

```
zhipin-resume-filter-extension/
├── manifest.json              # Chrome Extension Manifest V3
├── background.js              # Service Worker: 存储管理 + LLM API 调用
├── content/
│   ├── main.js                # 主入口: 页面检测 + 模块加载
│   ├── jobSaver.js            # 职位页: "保存此职位"按钮 + JD 提取
│   ├── candidateScanner.js    # 沟通页: 候选人列表扫描 + 简历提取
│   ├── aiEvaluator.js         # AI 评估: 调用 LLM 对比简历 vs JD
│   ├── chatBot.js             # AI 聊天: 自动预约电话 / 礼貌拒绝
│   ├── panel.js               # 侧边面板 UI (Shadow DOM)
│   └── panel.css              # 面板样式
├── popup.html                 # 扩展弹窗: 快速总览
├── popup.js
├── options.html               # 设置页: API Key、消息模板、风控参数
├── options.js
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── PRD.md                     # 产品需求文档
└── TECH_SPEC.md               # 本文件
```

---

## 一、BOSS 直聘页面结构（2026年3月实测）

### 页面 URL 映射

| 页面 | URL 模式 | 用途 |
|------|----------|------|
| 沟通列表 | `zhipin.com/web/chat/index` | 候选人列表 + 聊天 |
| 职位管理 | `zhipin.com/web/chat/job/list` | 岗位列表（在 iframe 内） |
| 沟通页(新) | `zhipin.com/web/chat/*` | 所有沟通相关页面 |

### 关键 DOM 选择器（已验证）

```javascript
// 候选人列表
const candidateItems = '.geek-item-wrap, .geek-item';
const candidateName = '.geek-name, .name';
const candidateJob = '.source-job, .job';
const candidateTime = '.time';
const candidateMsg = '.gray, .last-msg';
const candidateId = '[data-id], [data-geek-id]';

// 右侧候选人详情区
const detailArea = '.geek-info, .resume-info, .detail-figure';
// 详情区文本中可提取: 年龄(XX岁)、经验(X年)、学历、期望薪资、城市
// 工作经历: 时间段 + 公司 + 职位
// 教育: 学校 + 专业 + 学历

// 聊天输入框
const chatInput = '.chat-input, .message-input textarea, [contenteditable]';
// 发送按钮
const sendBtn = '.btn-send, .send-btn, button[type="submit"]';

// 快捷回复按钮区域
// "求简历" "换电话" "换微信" "约面试" "不合适"
```

### 反爬策略

- 任何自动化操作之间需要 **3-8 秒随机延迟**
- 每天自动消息上限建议 **50 条**
- 聊天中模拟真人节奏：打字延迟 + 不秒回（等 10-30 秒再回复）
- 遇到异常（验证码、页面跳转）立即暂停

---

## 二、各模块实现细节

### 2.1 保存职位 JD (`jobSaver.js`)

**触发场景**：用户在 BOSS 直聘的职位管理页面

**实现方式**：
1. 检测页面是否包含职位列表（iframe 内或直接页面）
2. 在每个职位卡片旁注入 **「保存此职位」** 按钮
3. 点击后自动提取：
   - 职位名称、城市、薪资范围、经验要求、学历要求
   - JD 全文（职位描述）
4. 用 LLM 从 JD 文本中提取结构化评估维度：

```javascript
// LLM 提取 prompt
const extractPrompt = `从以下职位描述中提取关键评估维度，返回 JSON：
{
  "techStack": ["Python", "Django", "PostgreSQL"],  // 要求的技术栈
  "expYears": "3-5年",                               // 经验年限
  "education": "本科",                                // 学历要求
  "keyRequirements": ["分布式系统经验", "高并发处理"], // 关键项目经验
  "bonusPoints": ["开源贡献", "大厂经验"],            // 加分项
  "hardRequirements": ["计算机相关专业"],              // 硬性门槛
  "salary": "15-25K"                                  // 薪资范围
}

职位描述：
${jdText}`;
```

5. 提取结果显示在弹窗中，HRBP 可手动修正
6. 确认后保存到 `chrome.storage.local`

**数据结构**：
```javascript
{
  jobId: "unique_id",
  title: "后端开发工程师",
  city: "深圳",
  salary: "15-25K",
  jdText: "原始JD全文...",
  dimensions: {  // LLM 提取 + HRBP 修正后的评估维度
    techStack: ["Python", "Django"],
    expYears: "3-5年",
    education: "本科",
    keyRequirements: [...],
    bonusPoints: [...],
    hardRequirements: [...]
  },
  savedAt: "2026-03-06T10:00:00Z",
  isDevRole: true  // 标记是否为开发岗位
}
```

### 2.2 AI 智能评估 (`aiEvaluator.js`)

**核心逻辑**：将候选人完整简历与 JD 维度逐项对比

**LLM 评估 Prompt**：
```javascript
const evaluatePrompt = `你是一名专业的技术招聘评估专家。请将以下候选人简历与职位要求进行逐项对比评估。

## 职位要求
- 职位：${job.title}
- 技术栈要求：${job.dimensions.techStack.join(', ')}
- 经验要求：${job.dimensions.expYears}
- 学历要求：${job.dimensions.education}
- 关键要求：${job.dimensions.keyRequirements.join(', ')}
- 加分项：${job.dimensions.bonusPoints.join(', ')}
- 硬性门槛：${job.dimensions.hardRequirements.join(', ')}

## 候选人简历
${candidateResumeText}

## 请返回 JSON 格式：
{
  "score": 85,           // 0-100 匹配度评分
  "verdict": "推荐面试",  // "强烈推荐" / "推荐面试" / "可以考虑" / "不太匹配" / "明显不符"
  "analysis": {
    "techStack": { "score": 18, "max": 25, "detail": "掌握 Python/Django，缺少 K8s 经验" },
    "experience": { "score": 18, "max": 20, "detail": "5年后端经验，满足要求" },
    "education": { "score": 10, "max": 10, "detail": "本科计算机专业，达标" },
    "projectRelevance": { "score": 20, "max": 25, "detail": "有高并发系统经验，分布式经验较少" },
    "bonus": { "score": 8, "max": 10, "detail": "有 GitHub 开源项目" },
    "hardRequirements": { "pass": true, "detail": "均满足" }
  },
  "summary": "技术栈高度匹配，5年后端经验扎实，有高并发项目经验。缺少 K8s 和分布式系统经验，但整体素质优秀，建议安排技术面试深入了解。",
  "risks": ["分布式经验不足", "未使用过公司核心框架"],
  "highlights": ["Python 深度使用", "开源贡献", "大厂背景"]
}`;
```

**评分标准**：
| 分数 | 状态 | 颜色 | 建议动作 |
|------|------|------|----------|
| 80-100 | ✅ 强烈推荐/推荐面试 | 绿色 | 预约电话 |
| 60-79 | ⚠️ 可以考虑 | 橙色 | HRBP 判断 |
| 0-59 | ❌ 不太匹配/明显不符 | 红色 | 礼貌告知 |

### 2.3 AI 自动预约电话 (`chatBot.js`)

**核心功能**：合格候选人标记后，AI 在 BOSS 直聘聊天中自主多轮对话预约电话时间

**HRBP 操作**：
1. 在面板中点击候选人的「预约电话时间」按钮
2. 弹出时间选择器，选择自己的空闲时间段（可多选）
3. 点击确认，AI 开始工作

**AI 对话流程**：

```
第一轮（AI 主动发送）：
"你好！我是 [公司名] 的 HR [HRBP名字]。我们认真查看了你的简历，
觉得你的背景和我们 [岗位名称] 的需求非常匹配！
想和你做一个简短的电话沟通，了解一下你的想法和期望。
请问这周 [时间段1] 或 [时间段2] 你方便接电话吗？"

等待候选人回复...（异步，可能几小时甚至隔天）

候选人回复后：
- 如果时间匹配 → "太好了！那我们就定在 [时间]，届时会用 [电话号码] 联系你。请保持手机畅通，期待和你交流！"
- 如果时间不匹配 → "理解！那 [替代时间段] 怎么样？或者你方便告诉我你最近几天哪个时间段比较空闲吗？"
- 如果候选人问薪资/详情 → 简要回答（基于 JD 信息），然后引导回预约
- 如果候选人表示不感兴趣 → "完全理解，感谢你的时间！如果将来有合适的机会，我们再联系。"
```

**实现要点**：
1. 使用 `MutationObserver` 监听聊天区域新消息
2. 新消息到达后，提取文本，发给 LLM 判断候选人意图
3. LLM 生成回复，写入聊天输入框并发送
4. 每次回复前等待 **15-45 秒**（模拟真人思考）
5. 状态机管理对话阶段：`initiated → waiting → negotiating → confirmed / declined / timeout`

**LLM 对话 Prompt**：
```javascript
const chatPrompt = `你是一名专业、友好的技术招聘 HR。正在 BOSS 直聘上与候选人沟通预约电话面试时间。

## 背景信息
- 公司：${companyName}
- 岗位：${jobTitle}
- HR名字：${hrbpName}
- 可选时间段：${availableSlots.join(', ')}
- 候选人姓名：${candidateName}

## 对话历史
${chatHistory}

## 候选人最新消息
"${latestMessage}"

## 要求
1. 用口语化、简短的中文回复（BOSS直聘聊天风格，不要太正式）
2. 目标是确认一个电话沟通时间
3. 如果候选人提问，简要回答后引导回预约
4. 如果候选人拒绝，礼貌告别
5. 不要泄露内部评估分数
6. 回复控制在 50-100 字

请直接输出回复内容（不要加引号或解释）：`;
```

**预约状态管理**：
```javascript
{
  candidateId: "xxx",
  status: "scheduling",  // scheduling / negotiating / confirmed / declined / timeout
  availableSlots: ["周三 14:00-17:00", "周四 10:00-12:00"],
  confirmedSlot: null,     // 确认后填入
  chatHistory: [],         // 对话记录
  lastMessageAt: "...",    // 最后消息时间
  timeoutHours: 48,        // 超时时间
  startedAt: "..."
}
```

### 2.4 侧边面板 UI (`panel.js`)

**使用 Shadow DOM 隔离样式**

**面板结构**：
```
┌─────────────────────────────────────┐
│ 🦐 开发岗位筛选助手          [−]   │ ← 标题栏
│─────────────────────────────────────│
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐      │ ← 统计卡片
│  │总数 │ │合格 │ │预约中│ │已约 │      │
│  └────┘ └────┘ └────┘ └────┘      │
│─────────────────────────────────────│
│  标签页: [全部|合格|不合格|预约中|已约] │ ← 状态筛选
│  岗位:  [全部岗位 ▼]              │ ← 岗位筛选
│─────────────────────────────────────│
│  候选人卡片列表                     │ ← 可滚动
│  ┌─────────────────────────────┐   │
│  │ 张三  5年 · 本科 · 85分 ✅  │   │
│  │ → 后端开发  Python/Go       │   │
│  │ AI: 技术栈匹配度高...       │   │
│  │ [📞预约] [👎拒绝] [📋详情]  │   │
│  └─────────────────────────────┘   │
│─────────────────────────────────────│
│  即将到来的电话                      │ ← 已预约视图
│  · 周三 14:00 张三 后端开发         │
│  · 周四 10:30 李四 前端开发         │
│─────────────────────────────────────│
│  [📊导出] [⚙️设置]      v0.3      │ ← 底部工具栏
└─────────────────────────────────────┘
```

---

## 三、LLM API 调用

### 方案选择

通过 `background.js` 调用 LLM API（HRBP 在设置页面填入 API Key）。

**支持的 API**（按优先级）：
1. OpenAI API（GPT-4o）
2. 其他兼容 OpenAI 格式的 API（如公司内部 LLM 代理）

**API 配置**（保存在 chrome.storage.local）：
```javascript
{
  llmProvider: "openai",       // "openai" | "custom"
  apiKey: "sk-xxx",
  apiBaseUrl: "https://api.openai.com/v1",  // 可自定义
  model: "gpt-4o",
  maxTokensPerRequest: 2000,
  dailyRequestLimit: 200
}
```

**调用方式**：
```javascript
// background.js 中统一处理 LLM 调用
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "LLM_EVALUATE") {
    callLLM(msg.prompt).then(result => sendResponse({ ok: true, result }));
    return true; // async
  }
});
```

---

## 四、数据存储

全部使用 `chrome.storage.local`，不上传服务器。

### 存储 Key 设计

| Key | 类型 | 内容 |
|-----|------|------|
| `savedJobs` | Object | `{ [jobId]: { title, dimensions, jdText, ... } }` |
| `candidates` | Object | `{ [candidateId]: { name, score, status, eval, ... } }` |
| `schedules` | Array | `[{ candidateId, status, slots, confirmed, chatHistory }]` |
| `settings` | Object | `{ llmProvider, apiKey, templates, dailyLimit, ... }` |
| `dailyStats` | Object | `{ date, messagessSent, evaluationsDone }` |

---

## 五、开发阶段

### 第一阶段：能评估（本次实现）

- [ ] `jobSaver.js` — 在职位页面注入"保存此职位"按钮，LLM 提取 JD 维度
- [ ] `candidateScanner.js` — 沟通页扫描候选人列表，点击提取完整简历
- [ ] `aiEvaluator.js` — 调用 LLM 对比简历 vs JD，返回结构化评估
- [ ] `panel.js` — 侧边面板展示候选人列表 + AI 评估结果
- [ ] `background.js` — LLM API 调用 + 数据存储
- [ ] `options.html/js` — API Key 配置 + 消息模板编辑
- [ ] HRBP 手动标记合格/不合格

### 第二阶段：能自动沟通

- [ ] `chatBot.js` — AI 自动预约电话时间（多轮对话）
- [ ] `chatBot.js` — 不合格候选人自动发送礼貌告知
- [ ] 预约状态管理 + 面板展示
- [ ] 新消息监听 + 自动回复

### 第三阶段：打磨体验

- [ ] AI 对话质量优化（更自然的语气）
- [ ] 风控策略（每日限额、异常检测、情绪识别）
- [ ] 数据导出 Excel
- [ ] 自定义消息模板和 AI 参数

---

## 六、注意事项

1. **纯 Vanilla JS**，不用框架，保持轻量
2. **Shadow DOM** 隔离面板样式，不影响 BOSS 直聘原页面
3. **不自动发送任何消息**，除非 HRBP 明确触发
4. **所有自动化操作有随机延迟**，模拟人工
5. **中文界面**，代码注释用中文
6. **仅针对开发岗位**，非开发岗位的候选人跳过（但保留扩展性）
