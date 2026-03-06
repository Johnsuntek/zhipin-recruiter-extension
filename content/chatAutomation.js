// content/chatAutomation.js — 聊天自动化：预约电话 + 拒绝告知
// 注入到 zhipin.com/web/boss/chat/* 页面
// 核心功能：监听聊天消息，AI 自动多轮对话预约电话时间

(function () {
  'use strict';

  console.log('[筛选助手] chatAutomation 加载');

  // ========== 配置 ==========
  const CONFIG = {
    MIN_REPLY_DELAY: 15000,     // 最小回复延迟（15秒，模拟思考）
    MAX_REPLY_DELAY: 45000,     // 最大回复延迟（45秒）
    TYPING_DELAY_PER_CHAR: 80,  // 每字符打字延迟（毫秒）
    TYPING_JITTER: 40,          // 打字抖动范围
    AUTO_SUBMIT: false,         // 是否自动发送（默认关闭，需 HRBP 确认）
    CHECK_INTERVAL: 5000,       // 检查新消息间隔
    MAX_RETRIES: 3              // 发送失败最大重试次数
  };

  // 当前聊天自动化状态
  let currentScheduleId = null;
  let isProcessing = false;
  let chatObserver = null;
  let lastProcessedMessageCount = 0;

  // ========== 初始化 ==========
  init();

  async function init() {
    // 等待页面加载
    await waitForElement('.chat-content, .message-list, .chat-conversation, [class*="chat-msg"]');
    console.log('[筛选助手] 聊天区域已加载，开始监听');

    // 加载配置
    try {
      const resp = await sendMessage({ type: 'GET_SETTINGS' });
      if (resp.ok && resp.settings) {
        if (resp.settings.safetyConfig) {
          CONFIG.MIN_REPLY_DELAY = (resp.settings.safetyConfig.minReplyDelaySec || 30) * 1000;
          CONFIG.MAX_REPLY_DELAY = (resp.settings.safetyConfig.maxReplyDelaySec || 120) * 1000;
        }
        CONFIG.AUTO_SUBMIT = !!resp.settings.autoSubmitChat;
      }
    } catch (err) {
      console.warn('[筛选助手] 加载聊天配置失败:', err);
    }

    // 开始监听聊天消息
    observeChatMessages();

    // 暴露方法给其他模块
    window.__hrHelper = window.__hrHelper || {};
    window.__hrHelper.sendGreeting = sendGreeting;
    window.__hrHelper.sendRejection = sendRejection;
    window.__hrHelper.startChatAutomation = startChatAutomation;
    window.__hrHelper.stopChatAutomation = stopChatAutomation;
    window.__hrHelper.insertTextToChat = insertTextToChat;
  }

  // ========== 发送初始问候消息（预约电话）==========
  async function sendGreeting(candidateId, scheduleId, timeSlots) {
    console.log('[筛选助手] 发送预约问候:', candidateId);

    try {
      // 检查每日限额
      const canSend = await checkDailyLimit();
      if (!canSend) {
        console.warn('[筛选助手] 已达今日消息上限');
        return { ok: false, error: '已达今日消息上限' };
      }

      // 请求 background 生成问候消息
      const resp = await sendMessage({
        type: 'GENERATE_GREETING',
        candidateId,
        timeSlots
      });

      if (!resp.ok) {
        throw new Error(resp.error || '生成问候消息失败');
      }

      const greetingText = resp.message;

      // 模拟真人延迟后发送
      await randomDelay(CONFIG.MIN_REPLY_DELAY, CONFIG.MAX_REPLY_DELAY);

      // 插入文本到聊天输入框
      await insertTextToChat(greetingText);

      if (CONFIG.AUTO_SUBMIT) {
        await randomDelay(500, 1500);
        await simulateSend();
      } else {
        // 提示 HRBP 确认发送
        showSendConfirmHint();
      }

      // 记录聊天日志
      await sendMessage({
        type: 'ADD_CHAT_LOG',
        scheduleId,
        role: 'hrbp',
        message: greetingText
      });

      // 更新预约状态
      await sendMessage({
        type: 'UPDATE_SCHEDULE',
        scheduleId,
        status: 'pending'
      });

      // 激活自动化监听
      currentScheduleId = scheduleId;
      startChatAutomation(candidateId, scheduleId, timeSlots);

      return { ok: true };
    } catch (err) {
      console.error('[筛选助手] 发送问候失败:', err);
      return { ok: false, error: err.message };
    }
  }

  // ========== 发送拒绝/告知消息 ==========
  async function sendRejection(candidateId) {
    console.log('[筛选助手] 发送告知消息:', candidateId);

    try {
      const canSend = await checkDailyLimit();
      if (!canSend) {
        return { ok: false, error: '已达今日消息上限' };
      }

      // 获取拒绝模板
      const resp = await sendMessage({ type: 'GET_REJECTION_MESSAGE' });
      if (!resp.ok) {
        throw new Error(resp.error || '获取告知模板失败');
      }

      await randomDelay(CONFIG.MIN_REPLY_DELAY, CONFIG.MAX_REPLY_DELAY);
      await insertTextToChat(resp.message);

      if (CONFIG.AUTO_SUBMIT) {
        await randomDelay(500, 1500);
        await simulateSend();
      } else {
        showSendConfirmHint();
      }

      // 更新候选人状态
      await sendMessage({
        type: 'UPDATE_CANDIDATE_STATUS',
        candidateId,
        status: 'rejected_notified'
      });

      return { ok: true };
    } catch (err) {
      console.error('[筛选助手] 发送告知失败:', err);
      return { ok: false, error: err.message };
    }
  }

  // ========== 启动聊天自动化（持续监听候选人回复）==========
  function startChatAutomation(candidateId, scheduleId, timeSlots) {
    currentScheduleId = scheduleId;
    console.log('[筛选助手] 启动聊天自动化, 预约ID:', scheduleId);

    // 存储上下文到 window 供 observer 回调使用
    window.__hrHelper._chatContext = {
      candidateId,
      scheduleId,
      timeSlots,
      active: true
    };
  }

  function stopChatAutomation() {
    if (window.__hrHelper && window.__hrHelper._chatContext) {
      window.__hrHelper._chatContext.active = false;
    }
    currentScheduleId = null;
    isProcessing = false;
    console.log('[筛选助手] 停止聊天自动化');
  }

  // ========== 监听聊天消息（MutationObserver）==========
  function observeChatMessages() {
    const chatContainer = document.querySelector(
      '.chat-content, .message-list, .chat-conversation, [class*="chat-msg"], .messages'
    );

    if (!chatContainer) {
      console.warn('[筛选助手] 未找到聊天容器，5秒后重试');
      setTimeout(observeChatMessages, 5000);
      return;
    }

    // 记录当前消息数量
    lastProcessedMessageCount = getChatMessages().length;

    chatObserver = new MutationObserver(debounce(async () => {
      const ctx = window.__hrHelper && window.__hrHelper._chatContext;
      if (!ctx || !ctx.active || isProcessing) return;

      const messages = getChatMessages();
      if (messages.length <= lastProcessedMessageCount) return;

      // 检查是否有新的候选人消息（非 HRBP 发送的）
      const newMessages = messages.slice(lastProcessedMessageCount);
      const candidateMessages = newMessages.filter(m => m.role === 'candidate');

      if (candidateMessages.length === 0) {
        lastProcessedMessageCount = messages.length;
        return;
      }

      // 处理候选人最新回复
      const latestMsg = candidateMessages[candidateMessages.length - 1];
      lastProcessedMessageCount = messages.length;

      console.log('[筛选助手] 检测到候选人新消息:', latestMsg.text.substring(0, 50));
      await handleCandidateReply(latestMsg.text, ctx);
    }, 2000));

    chatObserver.observe(chatContainer, {
      childList: true,
      subtree: true,
      characterData: true
    });

    console.log('[筛选助手] 已开始监听聊天消息');
  }

  // ========== 处理候选人回复 ==========
  async function handleCandidateReply(messageText, context) {
    if (isProcessing) return;
    isProcessing = true;

    try {
      // 检查每日限额
      const canSend = await checkDailyLimit();
      if (!canSend) {
        console.warn('[筛选助手] 已达今日消息上限，暂停自动回复');
        isProcessing = false;
        return;
      }

      // 记录候选人消息
      await sendMessage({
        type: 'ADD_CHAT_LOG',
        scheduleId: context.scheduleId,
        role: 'candidate',
        message: messageText
      });

      // 1. 解析候选人的时间意图
      console.log('[筛选助手] 解析时间意图...');
      const intentResp = await sendMessage({
        type: 'PARSE_TIME_INTENT',
        message: messageText,
        availableSlots: context.timeSlots
      });

      if (!intentResp.ok) {
        console.error('[筛选助手] 解析时间意图失败:', intentResp.error);
        isProcessing = false;
        return;
      }

      const intent = intentResp.intent;

      // 2. 如果时间已确认，更新预约状态
      if (intent.hasTimeInfo && intent.matchesAvailable && intent.confirmedSlot) {
        await sendMessage({
          type: 'UPDATE_SCHEDULE',
          scheduleId: context.scheduleId,
          status: 'confirmed',
          extra: { confirmedTime: intent.confirmedSlot }
        });
      } else if (intent.hasTimeInfo && !intent.matchesAvailable) {
        await sendMessage({
          type: 'UPDATE_SCHEDULE',
          scheduleId: context.scheduleId,
          status: 'negotiating'
        });
      }

      // 3. 获取完整聊天历史用于生成回复
      const chatHistory = buildChatHistoryText();

      // 4. 生成 AI 回复
      console.log('[筛选助手] 生成回复...');
      const replyResp = await sendMessage({
        type: 'GENERATE_CHAT_REPLY',
        jobTitle: getJobTitleFromPage(),
        timeSlots: context.timeSlots,
        status: intent.matchesAvailable ? 'confirming' : 'negotiating',
        chatHistory,
        lastMessage: messageText
      });

      if (!replyResp.ok) {
        console.error('[筛选助手] 生成回复失败:', replyResp.error);
        isProcessing = false;
        return;
      }

      // 5. 模拟真人延迟
      await randomDelay(CONFIG.MIN_REPLY_DELAY, CONFIG.MAX_REPLY_DELAY);

      // 6. 插入回复到聊天输入框
      await insertTextToChat(replyResp.reply);

      // 7. 自动发送或等待确认
      if (CONFIG.AUTO_SUBMIT) {
        await randomDelay(500, 1500);
        await simulateSend();
      } else {
        showSendConfirmHint();
      }

      // 8. 记录 HRBP 回复
      await sendMessage({
        type: 'ADD_CHAT_LOG',
        scheduleId: context.scheduleId,
        role: 'hrbp',
        message: replyResp.reply
      });

      // 9. 如果已确认时间，停止自动化
      if (intent.hasTimeInfo && intent.matchesAvailable && intent.confirmedSlot) {
        console.log('[筛选助手] 电话时间已确认:', intent.confirmedSlot);
        stopChatAutomation();
      }

    } catch (err) {
      console.error('[筛选助手] 处理候选人回复出错:', err);
    } finally {
      isProcessing = false;
    }
  }

  // ========== 获取聊天消息列表 ==========
  function getChatMessages() {
    const messages = [];
    const msgElements = document.querySelectorAll(
      '.chat-item, .message-item, .msg-item, [class*="message-wrap"], [class*="chat-record"]'
    );

    msgElements.forEach(el => {
      const text = (el.querySelector('.text, .msg-text, .content, .msg-content, p') ||
                    el).textContent.trim();
      if (!text) return;

      // 判断消息发送方：HRBP 发出 or 候选人发出
      const isSelf = el.classList.contains('self') ||
                     el.classList.contains('right') ||
                     el.classList.contains('is-self') ||
                     el.querySelector('.self, .right, [class*="self"]') !== null;

      messages.push({
        role: isSelf ? 'hrbp' : 'candidate',
        text,
        el
      });
    });

    return messages;
  }

  // ========== 构建聊天历史文本 ==========
  function buildChatHistoryText() {
    const messages = getChatMessages();
    // 取最近 10 条消息
    const recent = messages.slice(-10);
    return recent.map(m => `${m.role === 'hrbp' ? 'HR' : '候选人'}: ${m.text}`).join('\n');
  }

  // ========== 从页面提取当前职位名 ==========
  function getJobTitleFromPage() {
    const jobEl = document.querySelector(
      '.source-job, .job-name, .job-title, .chat-job, [class*="job-name"]'
    );
    return jobEl ? jobEl.textContent.trim() : '开发工程师';
  }

  // ========== 将文本插入聊天输入框 ==========
  async function insertTextToChat(text) {
    // 尝试多种输入框选择器
    const inputSelectors = [
      '.chat-input',
      '.message-input textarea',
      '.message-input [contenteditable]',
      '[contenteditable="true"]',
      'textarea.input',
      '.chat-editor',
      '.chat-input textarea',
      'textarea[class*="input"]'
    ];

    let inputEl = null;
    for (const selector of inputSelectors) {
      inputEl = document.querySelector(selector);
      if (inputEl) break;
    }

    if (!inputEl) {
      console.error('[筛选助手] 未找到聊天输入框');
      throw new Error('未找到聊天输入框');
    }

    // 聚焦输入框
    inputEl.focus();
    await randomDelay(200, 500);

    // 根据元素类型选择插入方式
    if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
      // 模拟逐字打字
      inputEl.value = '';
      for (let i = 0; i < text.length; i++) {
        inputEl.value += text[i];

        // 触发 input 事件
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));

        // 打字延迟 + 抖动
        const charDelay = CONFIG.TYPING_DELAY_PER_CHAR +
          (Math.random() * CONFIG.TYPING_JITTER * 2 - CONFIG.TYPING_JITTER);
        await new Promise(r => setTimeout(r, Math.max(10, charDelay)));

        // 偶尔暂停更长时间（模拟思考）
        if (Math.random() < 0.05) {
          await randomDelay(300, 800);
        }
      }

      // 触发 change 事件
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // contenteditable 元素
      inputEl.innerHTML = '';
      inputEl.focus();

      for (let i = 0; i < text.length; i++) {
        // 使用 document.execCommand 插入字符（兼容性更好）
        document.execCommand('insertText', false, text[i]);

        const charDelay = CONFIG.TYPING_DELAY_PER_CHAR +
          (Math.random() * CONFIG.TYPING_JITTER * 2 - CONFIG.TYPING_JITTER);
        await new Promise(r => setTimeout(r, Math.max(10, charDelay)));

        if (Math.random() < 0.05) {
          await randomDelay(300, 800);
        }
      }

      // 触发 input 事件
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    console.log('[筛选助手] 文本已插入聊天输入框');
  }

  // ========== 模拟点击发送按钮 ==========
  async function simulateSend() {
    const sendSelectors = [
      '.btn-send',
      '.send-btn',
      'button[type="submit"]',
      '.chat-send',
      '[class*="send-btn"]',
      'button[class*="send"]'
    ];

    let sendBtn = null;
    for (const selector of sendSelectors) {
      sendBtn = document.querySelector(selector);
      if (sendBtn && !sendBtn.disabled) break;
      sendBtn = null;
    }

    if (sendBtn) {
      sendBtn.click();
      console.log('[筛选助手] 已点击发送按钮');
    } else {
      // 尝试按 Enter 键
      const inputEl = document.querySelector(
        '.chat-input, .message-input textarea, [contenteditable="true"]'
      );
      if (inputEl) {
        inputEl.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
        }));
        console.log('[筛选助手] 已模拟 Enter 发送');
      } else {
        console.warn('[筛选助手] 未找到发送按钮或输入框');
      }
    }
  }

  // ========== 显示发送确认提示 ==========
  function showSendConfirmHint() {
    // 在输入框附近显示提示
    const hint = document.createElement('div');
    hint.style.cssText = `
      position: fixed; bottom: 80px; right: 20px; z-index: 99999;
      background: #00A6A7; color: white; padding: 10px 16px;
      border-radius: 8px; font-size: 13px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      animation: fadeIn 0.3s ease;
    `;
    hint.textContent = '消息已填入输入框，请确认后手动发送';
    document.body.appendChild(hint);

    setTimeout(() => {
      hint.style.opacity = '0';
      hint.style.transition = 'opacity 0.3s';
      setTimeout(() => hint.remove(), 300);
    }, 5000);
  }

  // ========== 检查每日限额 ==========
  async function checkDailyLimit() {
    try {
      const resp = await sendMessage({ type: 'GET_SETTINGS' });
      if (!resp.ok) return true; // 获取失败时允许继续

      const stats = await sendMessage({ type: 'GET_ALL_DATA' });
      if (!stats.ok) return true;

      const today = new Date().toISOString().split('T')[0];
      const dailyStats = stats.data.dailyStats || {};
      const todayCount = dailyStats[today] || 0;
      const maxDaily = resp.settings.safetyConfig?.maxDailyMessages || 50;

      return todayCount < maxDaily;
    } catch {
      return true;
    }
  }

  // ========== 工具函数 ==========

  function randomDelay(min, max) {
    const ms = Math.floor(Math.random() * (max - min) + min);
    return new Promise(r => setTimeout(r, ms));
  }

  function debounce(fn, wait) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function waitForElement(selector, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) { resolve(el); return; }

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      const timer = setTimeout(() => {
        observer.disconnect();
        // 不 reject，降级继续运行
        resolve(null);
      }, timeout);
    });
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

  // ========== 监听来自其他模块的消息 ==========
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'CHAT_SEND_GREETING') {
      sendGreeting(msg.candidateId, msg.scheduleId, msg.timeSlots)
        .then(sendResponse)
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (msg.type === 'CHAT_SEND_REJECTION') {
      sendRejection(msg.candidateId)
        .then(sendResponse)
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }
  });

})();
