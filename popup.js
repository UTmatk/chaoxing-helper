// popup.js —— 状态显示 + 触发抓题；配置在设置页
const $ = (id) => document.getElementById(id);

const QUESTION_SEL = '.TiMu,.questionLi,.question-item,.topic-item,.Cy_TItle,.mark_item,.subject_describe,.q_item,[data-questionid]';

async function updateStatus() {
  const { cfg } = await chrome.storage.local.get('cfg');
  const c = cfg || {};
  const hasKey = !!(c.apiKey && c.apiKey.trim());
  const dot = $('dot');
  const txt = $('statusText');
  if (hasKey) {
    dot.className = 'dot ok';
    txt.textContent = `已配置模型：${c.model || '未填写'}`;
  } else {
    dot.className = 'dot bad';
    txt.textContent = '尚未配置 API，请点「设置」';
  }
}

function setStatus(text, ok) {
  $('statusText').textContent = text;
  $('dot').className = 'dot ' + (ok ? 'ok' : 'bad');
}

// 页面可能是旧标签页（插件后装）+ 题目常在 iframe 里，这里同时处理两件事
async function ensureContentScript(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'PROBE_QUESTIONS' }, { frameId: 0 });
    if (r) return true;
  } catch (_) { /* 未注入 */ }
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
    return true;
  } catch (_) {
    return false;
  }
}

// 找出题目数量最多的 frame（学习通作业页题目常在 iframe 内）
async function findQuestionFrame(tabId) {
  try {
    const frames = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (sel) => {
        let n = 0;
        try { n = document.querySelectorAll(sel).length; } catch (_) { n = 0; }
        return { n, url: location.href, isTop: window.top === window.self };
      },
      args: [QUESTION_SEL]
    });
    const list = (frames || []).filter((f) => f && f.result);
    list.sort((a, b) => (b.result.n || 0) - (a.result.n || 0));
    if (list.length && list[0].result.n > 0) {
      return { frameId: list[0].frameId, count: list[0].result.n, isTop: !!list[0].result.isTop };
    }
    return { frameId: 0, count: 0, isTop: true };
  } catch (_) {
    return { frameId: 0, count: 0, isTop: true };
  }
}

async function fetchQuestions() {
  const btn = $('btnFetch');
  const { cfg } = await chrome.storage.local.get('cfg');
  const c = cfg || {};
  if (!c.apiKey) {
    setStatus('请先点「设置」填写 API Key', false);
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    setStatus('未取到当前标签页', false);
    return;
  }

  btn.disabled = true;
  btn.textContent = '抓取中…';
  try {
    await ensureContentScript(tab.id);

    const frame = await findQuestionFrame(tab.id);
    const opts = { frameId: frame.frameId };

    let res;
    try {
      res = await chrome.tabs.sendMessage(tab.id, { type: 'FETCH_QUESTIONS' }, opts);
    } catch (_) {
      // 该 frame 没有内容脚本，补注入后再试
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [frame.frameId] }, files: ['content.js'] });
      } catch (_) {}
      res = await chrome.tabs.sendMessage(tab.id, { type: 'FETCH_QUESTIONS' }, opts);
    }

    if (res && res.count) {
      setStatus(`已抓取 ${res.count} 道题，结果面板在${frame.isTop ? '页面' : '题目所在子页面'}右上角`, true);
      setTimeout(() => window.close(), 900);
    } else {
      setStatus('未识别到题目，请确认已打开答题页（可刷新后重试）', false);
    }
  } catch (e) {
    setStatus('无法连接页面，请刷新答题页后重试', false);
  } finally {
    btn.disabled = false;
    btn.textContent = '抓取当前题目';
  }
}

$('btnFetch').addEventListener('click', fetchQuestions);
$('btnOpenOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());

updateStatus();
