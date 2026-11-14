// background.js —— 服务后台：调用 OpenAI 兼容 API
const DEFAULT_CFG = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  prompt: '',
  autoSubmit: false,
  maxTokens: 2048,
  timeoutMs: 60000
};

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

async function getConfig() {
  const { cfg } = await chrome.storage.local.get('cfg');
  return { ...DEFAULT_CFG, ...(cfg || {}) };
}

// 归一化 base_url（去末尾斜杠；兼容误填的 /chat/completions 或 /v1/v1）
function normalizeBase(url) {
  if (!url) return DEFAULT_CFG.baseUrl;
  let u = String(url).trim().replace(/\/+$/, '');
  u = u.replace(/\/chat\/completions$/i, '');
  u = u.replace(/\/v1\/v1$/i, '/v1');
  return u;
}

// 构建单题提示词
function buildPrompt(q, systemPrompt) {
  const typeName = { single: '单选题', multiple: '多选题', judge: '判断题', fill: '填空题', short: '简答题/主观题' }[q.type] || '题目';

  const lines = [];
  if (systemPrompt) lines.push(systemPrompt);
  lines.push(`请回答下面这道${typeName}。`);
  lines.push(`题目：${q.stem}`);

  if (q.options && q.options.length) {
    lines.push('选项：');
    q.options.forEach((o, i) => lines.push(`${LETTERS[i] || '?'}. ${o}`));
  }

  if (q.type === 'single') {
    lines.push(`要求：只回答正确选项的字母（${LETTERS.slice(0, Math.max(1, (q.options || []).length))} 之一），不要解释。`);
  } else if (q.type === 'multiple') {
    lines.push(`要求：只回答所有正确选项的字母（如 ABD，取值 ${LETTERS.slice(0, Math.max(1, (q.options || []).length))}），按字母顺序，不要解释。`);
  } else if (q.type === 'judge') {
    lines.push('要求：只回答「正确」或「错误」，不要解释。');
  } else if (q.type === 'fill') {
    lines.push('要求：直接给出填空的答案内容，若有多个空用分号分隔，不要解释。');
  } else {
    lines.push('要求：按题目要求写一段结构完整、内容充实的答案（若题目要求字数则满足其要求），直接作答。');
  }
  return lines.join('\n');
}

// 实际调用 chat completions
async function callLLM(cfg, messages) {
  const base = normalizeBase(cfg.baseUrl);
  const endpoint = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  const timeout = Number(cfg.timeoutMs) > 0 ? Number(cfg.timeoutMs) : 60000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  let resp;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: 0.2,
        max_tokens: Number(cfg.maxTokens) > 0 ? Number(cfg.maxTokens) : 2048
      })
    });
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === 'AbortError') throw new Error(`请求超时（${timeout}ms），请检查网络或 base_url`);
    throw new Error('网络请求失败：' + e.message);
  }
  clearTimeout(timer);

  if (!resp.ok) {
    let detail = '';
    try {
      const j = await resp.json();
      detail = (j && j.error && j.error.message) || JSON.stringify(j);
    } catch (_) {
      try { detail = await resp.text(); } catch (_) { detail = ''; }
    }
    if (resp.status === 401 || resp.status === 403) detail = (detail || '') + '（API Key 无效或无权限）';
    throw new Error(`HTTP ${resp.status}: ${detail.slice(0, 300)}`);
  }

  const data = await resp.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
  if (!content) throw new Error('响应中未包含有效内容');
  return String(content).trim();
}

// 去掉 markdown 加重符、前缀「答案：」等噪音
function cleanAnswerText(raw) {
  let t = String(raw || '').trim();
  t = t.replace(/\*\*|__|`/g, '');
  t = t.replace(/^(答案|正确答案|答)\s*[:：]\s*/i, '');
  t = t.trim();
  return t;
}

// 解析模型输出为结构化答案
function parseAnswer(raw, type, optionCount) {
  const text = cleanAnswerText(raw);
  if (!text) return '';

  const maxIdx = Math.max(1, Math.min(26, optionCount || 26));
  const pool = LETTERS.slice(0, maxIdx);

  if (type === 'single') {
    // 只接受选项范围内的字母，避免把 "A" 之外的单词首字母误判
    const m = text.match(/[A-Za-z]/g);
    if (m) {
      for (const ch of m) {
        const up = ch.toUpperCase();
        if (pool.includes(up)) return up;
      }
    }
    return text;
  }

  if (type === 'multiple') {
    const letters = (text.toUpperCase().match(/[A-Z]/g) || [])
      .filter((l) => pool.includes(l))
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort();
    if (letters.length) return letters.join('');
    return text;
  }

  if (type === 'judge') {
    // 先判否：「不正确」不能被「正确」命中
    if (/不正确|不对|错误|×|false|否/i.test(text)) return '错误';
    if (/正确|√|^对|true|是/i.test(text)) return '正确';
    return text;
  }

  return text; // fill / short 直接返回原文
}

// 从模型整段输出里切出「第N题：答案」
function splitByIndex(raw, count) {
  const map = {};
  const blockRe = /第\s*(\d+)\s*题\s*[:：]?\s*([\s\S]*?)(?=第\s*\d+\s*题\s*[:：]?|$)/g;
  let m;
  while ((m = blockRe.exec(raw)) !== null) {
    map[parseInt(m[1], 10)] = m[2].trim();
  }
  // 兼容「1. 答案」「1、答案」的行首格式
  if (!Object.keys(map).length) {
    String(raw).split(/\r?\n/).forEach((line) => {
      const mm = line.match(/^\s*(\d+)\s*[.、．)）]\s*(.+)$/);
      if (mm) {
        const i = parseInt(mm[1], 10);
        if (i >= 1 && i <= count) map[i] = mm[2].trim();
      }
    });
  }
  return map;
}

// 批量答题：一次调用传多题，减少请求次数；未识别的题再单题补答
async function answerBatch(questions, cfg) {
  const system = cfg.prompt || '你是一名高校课程助教，请准确、简洁地回答问题。';
  const results = new Array(questions.length).fill(null).map((_, i) => ({ index: i, answer: '', raw: '' }));

  const userLines = ['下面有多道题目，请按顺序逐一回答。每道题用独立编号输出。'];
  questions.forEach((q, i) => {
    const typeName = { single: '单选题', multiple: '多选题', judge: '判断题', fill: '填空题', short: '简答题' }[q.type] || '题目';
    userLines.push(`\n【第${i + 1}题】(${typeName})`);
    userLines.push(q.stem);
    if (q.options && q.options.length) {
      q.options.forEach((o, j) => userLines.push(`${LETTERS[j] || '?'}. ${o}`));
    }
  });
  userLines.push('\n请严格按格式回答，每题一行：\n第N题：答案');

  let raw = '';
  let lastErr = null;
  try {
    raw = await callLLM(cfg, [
      { role: 'system', content: system },
      { role: 'user', content: userLines.join('\n') }
    ]);
    const map = splitByIndex(raw, questions.length);
    questions.forEach((q, i) => {
      const ans = map[i + 1] || '';
      results[i] = { index: i, answer: parseAnswer(ans, q.type, (q.options || []).length), raw };
    });
  } catch (e) {
    lastErr = e;
    // 批量失败时降级为逐题请求
  }

  // 未拿到答案的题：单题补答（最多 12 题，避免请求爆炸）
  const missing = results.filter((r) => !r.answer).map((r) => r.index).slice(0, 12);
  for (const idx of missing) {
    const q = questions[idx];
    try {
      const one = await callLLM(cfg, [
        { role: 'system', content: system },
        { role: 'user', content: buildPrompt(q, '') }
      ]);
      results[idx] = { index: idx, answer: parseAnswer(one, q.type, (q.options || []).length), raw: one };
      lastErr = null;
    } catch (e) {
      lastErr = e;
    }
  }

  // 全部失败才抛错，让前端看到具体原因
  if (lastErr && results.every((r) => !r.answer)) throw lastErr;

  return { results, raw: raw || '(逐题补答)' };
}

// 获取模型列表（OpenAI 兼容 GET /models）
async function listModels(cfg) {
  const base = normalizeBase(cfg.baseUrl);
  const endpoint = base.endsWith('/models') ? base : `${base}/models`;
  const resp = await fetch(endpoint, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${cfg.apiKey}` }
  });
  if (!resp.ok) {
    let detail = '';
    try { detail = ((await resp.json()).error || {}).message || ''; } catch (_) {}
    throw new Error(`HTTP ${resp.status} ${detail}`.trim());
  }
  const data = await resp.json();
  const list = (data.data || []).map((m) => m.id || m.name).filter(Boolean);
  if (!list.length) throw new Error('返回的模型列表为空');
  return list;
}

// 消息路由
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || !msg.type) return;

    if (msg.type === 'TEST_API') {
      try {
        const reply = await callLLM(msg.cfg, [{ role: 'user', content: '请回复两个字：成功' }]);
        sendResponse({ ok: true, reply });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return;
    }

    if (msg.type === 'LIST_MODELS') {
      try {
        const models = await listModels(msg.cfg);
        sendResponse({ ok: true, models });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return;
    }

    if (msg.type === 'ANSWER_QUESTIONS') {
      try {
        const cfg = await getConfig();
        if (!cfg.apiKey) {
          sendResponse({ ok: false, error: '未配置 API Key，请先在设置页填写' });
          return;
        }
        if (!cfg.model) {
          sendResponse({ ok: false, error: '未配置模型名称' });
          return;
        }
        const { results, raw } = await answerBatch(msg.questions || [], cfg);
        sendResponse({ ok: true, results, raw });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return;
    }
  })();
  return true; // 保持异步 sendResponse 有效
});
