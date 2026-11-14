// content.js —— 抓取学习通题目 + 写入答案（含绕过防粘贴）+ 答案面板
(() => {
  if (window.__cxHelperLoaded) return;
  window.__cxHelperLoaded = true;

  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  // ============ 0. 配置读取 ============
  async function getAutoSubmit() {
    try {
      const { cfg } = await chrome.storage.local.get('cfg');
      return !!(cfg && cfg.autoSubmit);
    } catch (_) { return false; }
  }

  // ============ 1. 题目识别 ============
  // 学习通题目容器选择器（多套兼容）
  const QUESTION_SELECTORS = [
    '.TiMu',            // 学习通经典题目容器
    '.questionLi',
    '.question-item',
    '.topic-item',
    '.Cy_TItle',        // 章节测验
    '.mark_item',
    '.subject_describe',// 作业/考试页
    '.q_item',
    '[data-questionid]'
  ];
  const QUESTION_SEL_STR = QUESTION_SELECTORS.join(',');

  function collectQuestions() {
    const seen = new Set();
    const questions = [];

    // 优先用容器选择器；剔除嵌套的重复容器
    let containers = Array.from(document.querySelectorAll(QUESTION_SEL_STR));
    containers = containers.filter((box) => {
      const parent = box.parentElement;
      return !(parent && parent.closest && parent.closest(QUESTION_SEL_STR));
    });

    containers.forEach((box) => {
      const q = parseContainer(box);
      if (q && q.stem && !seen.has(q.stem)) {
        seen.add(q.stem);
        questions.push(q);
      }
    });

    // 兜底：按题号正则全文扫描（找不到容器时）
    if (questions.length === 0) {
      questions.push(...scanByText());
    }

    return questions;
  }

  function parseContainer(box) {
    const stem = extractStem(box);
    if (!stem) return null;
    const options = extractOptions(box);
    const type = detectType(box, options);
    return { stem, options, type, node: box };
  }

  function extractStem(box) {
    const sel = [
      '.Zy_TItle', '.Cy_TItle .clearfix', '.question-stem', '.qt-title',
      '.stem', '.title', '.subject_describe', '.clearfix', 'h3', 'p'
    ];
    for (const s of sel) {
      const el = box.querySelector(s);
      if (el && el.innerText && el.innerText.trim().length > 3) {
        const t = cleanStem(el.innerText);
        if (t) return t;
      }
    }
    // 兜底：取容器整体文本的前半段作为题干
    const all = cleanStem(box.innerText);
    if (all && all.length > 3) return all.slice(0, 300);
    return null;
  }

  function extractOptions(box) {
    const out = [];
    const seen = new Set();
    getOptionNodes(box).forEach((node) => {
      const inner = node.querySelector('.after, .option, .answer_p, label');
      const raw = inner ? inner.innerText : node.innerText;
      const t = normalizeOptionText(raw);
      if (!t || t.length > 300) return;
      const k = t.replace(/\s+/g, '');
      if (seen.has(k)) return;
      seen.add(k);
      out.push(t);
    });
    return out;
  }

  // 与 extractOptions 严格同序的可点击节点列表
  function getOptionNodes(box) {
    if (!box) return [];
    const lis = Array.from(box.querySelectorAll('li')).filter((li) => !li.querySelector('li'));
    if (lis.length) return lis;
    return Array.from(box.querySelectorAll('.after, label, .option, dd'));
  }

  // 去掉 "A." "A、" "(A)" 等前缀与多余空白
  function normalizeOptionText(s) {
    let t = cleanText(s);
    t = t.replace(/^[（(]\s*[A-Za-z]\s*[)）]\s*/, '');
    t = t.replace(/^[A-Za-z]\s*[.、．:：)）]\s*/, '');
    return t.trim();
  }

  function detectType(box, options) {
    const html = box.innerHTML || '';
    const txt = box.innerText || '';

    const hasRadio = /<input[^>]+type=["']?radio/i.test(html);
    const hasCheckbox = /<input[^>]+type=["']?checkbox/i.test(html);
    const hasRich = /<textarea|contenteditable/i.test(html) || !!box.querySelector('iframe');

    // 1) 题型标签优先（学习通会在题干前输出【单选题】等）
    if (/多选题|多项选择|不定项/.test(txt)) return 'multiple';
    if (/判断题|判断对错|是否正确/.test(txt)) return 'judge';
    if (/填空题/.test(txt)) return 'fill';
    if (/单选题|单项选择/.test(txt)) return 'single';
    if (/简答题|论述题|问答题|名词解释|计算题|分析题|材料题/.test(txt)) return 'short';

    // 2) 主观题关键词（且没有选项控件）
    if (!hasRadio && !hasCheckbox && /简答|论述|问答|名词解释|不少于|谈谈|简述|说明理由|请分析|举例说明/.test(txt)) {
      return 'short';
    }

    // 3) 控件判定
    if (hasCheckbox) return 'multiple';
    if (hasRadio) {
      // 两选项且都是对/错 → 判断题
      const marks = options.map((o) => o.replace(/[.、．\s]/g, ''));
      if (marks.length === 2 && marks.every((m) => /^(对|错|正确|错误|是|否|√|×|T|F)$/i.test(m))) {
        return 'judge';
      }
      return 'single';
    }

    // 4) 无控件 → 填空/主观
    if (/填空|____|_{3,}|【\s*】/.test(txt)) return 'fill';
    if (hasRich) return 'short';
    if (options.length > 1) return 'single';
    return 'short';
  }

  function cleanText(s) {
    return (s || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // 题干：额外去掉「【单选题】」「（2分）」「1.」这类前缀
  function cleanStem(s) {
    let t = cleanText(s);
    t = t.replace(/^[【\[]\s*(单选|多选|判断|填空|简答|论述|名词解释|计算)?题?\s*[】\]]\s*/g, '');
    t = t.replace(/^[（(]\s*[0-9.]+\s*分\s*[)）]\s*/g, '');
    t = t.replace(/^\s*\d+\s*[.、．]\s*/, '');
    return t.trim();
  }

  function scanByText() {
    const results = [];
    const seen = new Set();
    const blocks = document.querySelectorAll('div, p');
    const re = /^\s*(\d+)\s*[.、．]\s*/;
    blocks.forEach((b) => {
      if (b.querySelector(QUESTION_SEL_STR)) return;
      const t = b.innerText ? b.innerText.trim() : '';
      if (t.length < 8 || t.length > 800) return;
      if (re.test(t) && !seen.has(t)) {
        seen.add(t);
        results.push({ stem: cleanStem(t.replace(re, '')), options: [], type: 'short', node: b });
      }
    });
    return results;
  }

  // ============ 2. 答案写入（绕过防粘贴） ============
  function setNativeValue(input, value) {
    const proto = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (typeof input.focus === 'function') input.focus();
    if (desc && desc.set) desc.set.call(input, value);
    else input.value = value;
    // 触发完整事件链，让框架（Angular/Vue/React）感知
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function setContentEditable(el, value) {
    if (typeof el.focus === 'function') el.focus();
    try {
      el.innerHTML = '';
      if (document.execCommand) {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, value);
      } else {
        el.textContent = value;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (_) {
      el.textContent = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
  }

  function normText(s) {
    return cleanText(s).replace(/\s+/g, '');
  }

  // 点击第 idx 个选项；exclusive=true 时清掉其他单选
  function clickOptionAt(box, idx, exclusive) {
    const nodes = getOptionNodes(box);
    if (idx < 0 || idx >= nodes.length) return false;
    const node = nodes[idx];

    if (exclusive) {
      box.querySelectorAll('input[type="radio"]').forEach((r) => { r.checked = false; });
    }

    try { node.click(); } catch (_) {}

    const input = node.querySelector('input[type="radio"], input[type="checkbox"]');
    if (input) {
      if (!input.checked) input.checked = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return !!input.checked;
    }
    // 没有原生 input 的站点（用 class 标选中）
    node.classList.add('checked');
    node.classList.add('on');
    return true;
  }

  // 答案里只有字母（A / ABD / A,B）时按字母点选
  // 注意：选项原文也可能是纯字母（如 GET / TRUE），越界一律判为「不是字母答案」，回退按原文匹配
  function clickByLetters(q, ans, multiple) {
    const text = String(ans || '').trim();
    if (!/^[A-Za-z\s,，、/]+$/.test(text)) return false;
    const nodes = getOptionNodes(q.node);
    if (!nodes.length) return false;
    const letters = text.toUpperCase().match(/[A-Z]/g) || [];
    if (!letters.length) return false;
    const idxs = [];
    for (const l of letters) {
      const i = LETTERS.indexOf(l);
      if (i < 0 || i >= nodes.length) return false; // 含选项范围外的字母 → 视为原文，不做字母解析
      if (!idxs.includes(i)) idxs.push(i);
    }
    let ok = false;
    idxs.forEach((i) => { if (clickOptionAt(q.node, i, !multiple)) ok = true; });
    return ok;
  }

  // 答案里是选项原文时按文本点选
  function clickByText(q, ans) {
    const nodes = getOptionNodes(q.node);
    const target = normText(ans);
    if (!target) return false;
    for (let i = 0; i < nodes.length; i++) {
      const t = normText(nodes[i].innerText || nodes[i].textContent);
      if (t && (t === target || t.includes(target) || target.includes(t))) {
        return clickOptionAt(q.node, i, true);
      }
    }
    return false;
  }

  const JUDGE_TRUE_RE = /^(正确|对|√|是|true|t|a|yes|y)$/i;
  const JUDGE_FALSE_RE = /^(错误|错|×|否|false|f|b|no|n)$/i;

  function fillJudge(q, ans) {
    const raw = String(ans || '').trim();
    let val;
    // 先判否，避免「不正确」被「正确」命中
    if (/不正确|不对|错误|^错|×|false|否/i.test(raw)) val = false;
    else if (/正确|^对|√|是|true/i.test(raw)) val = true;
    else val = /^[tTyY]$/.test(raw);

    const nodes = getOptionNodes(q.node);
    const texts = q.options && q.options.length
      ? q.options
      : nodes.map((n) => normalizeOptionText(n.innerText));

    let idx = -1;
    texts.forEach((t, i) => {
      const m = t.replace(/[.、．\s（）()]/g, '');
      if (val && JUDGE_TRUE_RE.test(m)) idx = i;
      if (!val && JUDGE_FALSE_RE.test(m)) idx = i;
    });
    // 兜底：判断题两个选项默认 对/错 顺序
    if (idx === -1) idx = val ? 0 : 1;
    return clickOptionAt(q.node, idx, true);
  }

  // 跨入 iframe 编辑器写入富文本，并同步值到关联的隐藏 textarea
  function writeIframeEditor(iframe, value) {
    let doc;
    try {
      doc = iframe.contentDocument || iframe.contentWindow.document;
    } catch (_) { return false; }
    if (!doc || !doc.body) return false;

    const body = doc.body;
    if (typeof body.focus === 'function') body.focus();
    try {
      doc.execCommand('selectAll', false, null);
      doc.execCommand('insertText', false, value);
    } catch (_) {
      body.innerHTML = escapeHtml(value);
    }
    try {
      body.dispatchEvent(new Event('input', { bubbles: true }));
      body.dispatchEvent(new Event('keyup', { bubbles: true }));
      body.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch (_) {}

    // 同步值到宿主页面的隐藏 textarea（UEditor/KindEditor 机制）
    let host = iframe.parentElement;
    while (host && host !== document.body) {
      if (host.querySelector('textarea')) break;
      host = host.parentElement;
    }
    if (host && host !== document.body) {
      host.querySelectorAll('textarea').forEach((ta) => setNativeValue(ta, value));
    }
    return true;
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.disabled || el.readOnly) return false;
    const style = el.style || {};
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (el.getClientRects && el.getClientRects().length === 0) return false;
    return true;
  }

  function fillAnswer(question, answerText) {
    const box = question.node;
    if (!box) return false;
    const ans = String(answerText || '').trim();
    if (!ans) return false;

    // 选择题/判断题：点选项
    if (question.type === 'judge') return fillJudge(question, ans);

    if (question.type === 'single') {
      return clickByLetters(question, ans, false) || clickByText(question, ans);
    }
    if (question.type === 'multiple') {
      const byLetter = clickByLetters(question, ans, true);
      return byLetter || clickByText(question, ans);
    }

    // 填空/简答：优先 iframe 富文本编辑器（学习通 UEditor 场景）
    const iframes = box.querySelectorAll('iframe');
    for (const f of iframes) {
      if (writeIframeEditor(f, ans)) return true;
    }

    // 次选 contenteditable
    const cdes = Array.from(box.querySelectorAll('[contenteditable="true"], [contenteditable=""]'));
    for (const el of cdes) {
      if (isVisible(el)) return setContentEditable(el, ans);
    }

    // 再选可见的 input/textarea（填空按 ; 拆多空）
    const inputs = [];
    box.querySelectorAll('input, textarea').forEach((el) => {
      const t = (el.type || '').toLowerCase();
      if (t === 'hidden' || t === 'radio' || t === 'checkbox' || t === 'submit' || t === 'button') return;
      if (!isVisible(el)) return;
      inputs.push(el);
    });
    if (inputs.length) {
      const parts = ans.split(/[;；]/).map((s) => s.trim()).filter(Boolean);
      inputs.forEach((el, i) => setNativeValue(el, parts[i] !== undefined ? parts[i] : ans));
      return true;
    }

    // 兜底：只有隐藏 textarea 时也写入（至少提交时值存在）
    const hiddenTas = Array.from(box.querySelectorAll('textarea'));
    if (hiddenTas.length) {
      hiddenTas.forEach((ta) => setNativeValue(ta, ans));
      return true;
    }
    return false;
  }

  // ============ 3. 答案面板 UI ============
  let panel = null;

  function ensurePanel() {
    if (panel && panel.isConnected) return panel;
    panel = document.createElement('div');
    panel.id = '__cxHelperPanel';
    panel.innerHTML = `
      <style>
        #__cxHelperPanel { position: fixed; right: 16px; top: 16px; z-index: 2147483647;
          width: 420px; max-height: 82vh; overflow-y: auto; background: #fff;
          border: 1px solid #e5e6eb; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.18);
          font: 13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif; color: #1f2329; }
        #__cxHelperPanel .h { display:flex; align-items:center; justify-content:space-between;
          padding: 12px 16px; border-bottom:1px solid #e5e6eb; background:#f7f8fa;
          border-radius:12px 12px 0 0; font-weight:600; position:sticky; top:0; z-index:2; }
        #__cxHelperPanel .h .x { cursor:pointer; color:#999; font-size:18px; line-height:1; }
        #__cxHelperPanel .b { padding: 12px 16px; }
        #__cxHelperPanel .q { border:1px solid #eef0f2; border-radius:8px; padding:10px 12px; margin-bottom:10px; }
        #__cxHelperPanel .q .stem { font-weight:600; margin-bottom:6px; word-break:break-word; }
        #__cxHelperPanel .q .ans { color:#2f6fed; margin-bottom:8px; white-space:pre-wrap; word-break:break-word; }
        #__cxHelperPanel .q .ops { display:flex; gap:6px; flex-wrap:wrap; }
        #__cxHelperPanel .q button { padding:4px 10px; border:none; border-radius:6px; cursor:pointer;
          font-size:12px; background:#2f6fed; color:#fff; }
        #__cxHelperPanel .q button.fill { background:#30a46c; }
        #__cxHelperPanel .q button.again { background:#f0f1f3; color:#1f2329; }
        #__cxHelperPanel .foot { padding: 10px 16px; border-top:1px solid #e5e6eb; color:#999; font-size:12px;
          background:#fafafa; border-radius:0 0 12px 12px; }
        #__cxHelperPanel .err { color:#e5484d; padding: 8px 0; }
        #__cxHelperPanel .bar { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
        #__cxHelperPanel .bar button { flex:1; padding:6px 8px; border-radius:6px; border:1px solid #2f6fed;
          background:#fff; color:#2f6fed; cursor:pointer; font-size:12px; }
      </style>
      <div class="h"><span>答题助手 · 结果</span><span class="x" id="__cxClose">×</span></div>
      <div class="b" id="__cxBody"></div>
      <div class="foot">
        <div>点击「填入」把答案写入页面；仅用于自查与练习。</div>
        <div class="bar">
          <button id="__cxCopy">复制全部答案</button>
          <button id="__cxDiag">诊断页面结构</button>
        </div>
      </div>
    `;
    document.documentElement.appendChild(panel);
    panel.querySelector('#__cxClose').onclick = () => { panel.remove(); panel = null; };
    panel.querySelector('#__cxDiag').onclick = runDiagnose;
    panel.querySelector('#__cxCopy').onclick = copyAllAnswers;
    return panel;
  }

  let lastResults = { questions: [], results: [] };

  function copyAllAnswers() {
    const { questions, results } = lastResults;
    if (!results.length) return;
    const lines = results.map((r) => {
      const q = questions[r.index];
      return `第${r.index + 1}题：${r.answer || '（未识别）'}`;
    });
    const text = lines.join('\n');
    try {
      navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  }

  // ============ 诊断：导出题目区域 DOM 结构 ============
  function describeNode(el, depth) {
    if (!el || depth > 4) return '';
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    const cls = (el.className && typeof el.className === 'string') ? el.className : '';
    const type = el.type || '';
    const editable = el.isContentEditable ? ' [contenteditable]' : '';
    let line = '  '.repeat(depth) + `<${tag}${cls ? ' class="' + cls + '"' : ''}${type ? ' type="' + type + '"' : ''}${editable}>`;
    if (tag === 'iframe') line += ' [iframe]';
    return line;
  }

  function runDiagnose() {
    const questions = collectQuestions();
    const lines = [];
    lines.push('===== 诊断报告 =====');
    lines.push('页面：' + location.href);
    lines.push('是否 iframe：' + (window.top !== window.self));
    lines.push('题目数量：' + questions.length);

    questions.forEach((q, i) => {
      lines.push('');
      lines.push(`--- 第${i + 1}题 [${q.type}] ---`);
      lines.push('题干：' + q.stem.slice(0, 100));
      lines.push('选项数：' + (q.options ? q.options.length : 0));
      (q.options || []).forEach((o, j) => lines.push(`   ${LETTERS[j]}. ${o.slice(0, 60)}`));
      lines.push('选项节点数：' + getOptionNodes(q.node).length);

      const editables = collectEditable(q.node);
      lines.push('可写入元素数：' + editables.length);
      editables.slice(0, 10).forEach((el, j) => {
        const tag = (el.tagName || '').toLowerCase();
        const cls = (el.className && typeof el.className === 'string') ? el.className : '';
        const name = el.name || '';
        const id = el.id || '';
        const hidden = el.style && (el.style.display === 'none' || el.style.visibility === 'hidden');
        lines.push(`  [${j}] <${tag}${cls ? ' class="' + cls + '"' : ''}${name ? ' name="' + name + '"' : ''}${id ? ' id="' + id + '"' : ''}${el.type ? ' type=' + el.type : ''}${el.isContentEditable ? ' contenteditable' : ''}${el.__cxFrame ? ' (iframe内)' : ''}${hidden ? ' [被CSS隐藏!]' : ''}>`);
      });

      const richNodes = q.node.querySelectorAll('[contenteditable], iframe, .cke_editable, .edui-body, .note-editable, .ql-editor, .wangEditor-container');
      if (richNodes.length) {
        lines.push('容器内的富文本/iframe 节点：');
        richNodes.forEach((el, j) => {
          const tag = (el.tagName || '').toLowerCase();
          const cls = (el.className && typeof el.className === 'string') ? el.className : '';
          lines.push(`  [${j}] <${tag}${cls ? ' class="' + cls + '"' : ''}${el.isContentEditable ? ' contenteditable' : ''}>`);
        });
      }

      lines.push('容器结构：');
      lines.push(describeNode(q.node, 0));
      Array.from(q.node.querySelectorAll('*')).slice(0, 40).forEach((child) => {
        const hasInput = child.tagName && /INPUT|TEXTAREA|IFRAME/.test(child.tagName);
        const hasClass = child.className && typeof child.className === 'string' && child.className.trim();
        if (hasInput || hasClass) lines.push(describeNode(child, 1));
      });
    });

    const report = lines.join('\n');
    const p = ensurePanel();
    const body = p.querySelector('#__cxBody');
    body.innerHTML = '<pre style="white-space:pre-wrap;font-size:11px;line-height:1.4;max-height:50vh;overflow:auto;background:#f7f8fa;padding:10px;border-radius:6px;">' +
      escapeHtml(report) + '</pre>';
    try {
      navigator.clipboard.writeText(report);
      body.insertAdjacentHTML('afterbegin',
        '<div style="color:#30a46c;margin-bottom:6px;">✅ 诊断报告已复制到剪贴板，可直接粘贴发给开发者</div>');
    } catch (_) {}
  }

  function collectEditable(box) {
    const list = [];
    box.querySelectorAll('input, textarea').forEach((el) => {
      const t = (el.type || '').toLowerCase();
      if (t === 'hidden' || t === 'radio' || t === 'checkbox' || t === 'submit' || t === 'button') return;
      list.push(el);
    });
    box.querySelectorAll('[contenteditable="true"], [contenteditable=""]').forEach((el) => list.push(el));
    box.querySelectorAll('iframe').forEach((f) => {
      try {
        const doc = f.contentDocument || f.contentWindow.document;
        if (doc && doc.body) {
          const editable = doc.body.querySelector('[contenteditable="true"], body');
          if (editable) {
            editable.__cxFrame = f;
            list.push(editable);
          }
        }
      } catch (_) { /* 跨域 iframe 忽略 */ }
    });
    return list;
  }

  function renderAnswers(questions, results) {
    lastResults = { questions, results };
    const p = ensurePanel();
    const body = p.querySelector('#__cxBody');
    body.innerHTML = '';

    const typeNameMap = { single: '单选', multiple: '多选', judge: '判断', fill: '填空', short: '简答' };

    results.forEach((r) => {
      const q = questions[r.index];
      if (!q) return;
      const div = document.createElement('div');
      div.className = 'q';
      div.innerHTML = `
        <div class="stem">[${typeNameMap[q.type] || q.type}] ${escapeHtml(q.stem)}</div>
        <div class="ans">答案：${escapeHtml(r.answer || '（未识别）')}</div>
        <div class="ops"></div>
      `;
      const ops = div.querySelector('.ops');

      const fillBtn = document.createElement('button');
      fillBtn.className = 'fill';
      fillBtn.textContent = '填入';
      fillBtn.onclick = () => {
        const ok = fillAnswer(q, r.answer);
        fillBtn.textContent = ok ? '已填入 ✓' : '未找到输入框';
        fillBtn.disabled = ok;
      };

      const againBtn = document.createElement('button');
      againBtn.className = 'again';
      againBtn.textContent = '重答';
      againBtn.onclick = () => answerSingle(q, r, div, againBtn);

      ops.appendChild(fillBtn);
      ops.appendChild(againBtn);
      body.appendChild(div);
    });

    // 底部批量操作区
    const foot = document.createElement('div');
    foot.style.cssText = 'margin-top:12px;padding-top:10px;border-top:1px solid #e5e6eb;';
    const modeTip = document.createElement('div');
    modeTip.style.cssText = 'font-size:12px;margin-bottom:8px;color:#646a73;';
    modeTip.textContent = '自动提交已关闭：点「全部填入」只填答案，需手动提交';
    getAutoSubmit().then((auto) => {
      if (auto) {
        modeTip.textContent = '⚠️ 自动提交已开启：点「全部填入」后会直接提交';
        modeTip.style.color = '#c0353f';
      }
    });

    const fillAllBtn = document.createElement('button');
    fillAllBtn.style.cssText = 'width:100%;padding:9px;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;background:#2f6fed;color:#fff;';
    fillAllBtn.textContent = '全部填入';
    fillAllBtn.onclick = async () => {
      fillAllBtn.disabled = true;
      fillAllBtn.textContent = '填入中…';
      const auto = await getAutoSubmit();
      await fillAll(questions, results, auto, body);
      fillAllBtn.disabled = false;
      fillAllBtn.textContent = '全部填入';
    };

    foot.appendChild(modeTip);
    foot.appendChild(fillAllBtn);
    body.appendChild(foot);
  }

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // 批量填入全部答案；submitNow 表示填完后是否自动点提交
  async function fillAll(questions, results, submitNow, body) {
    let filled = 0;
    const failed = [];
    for (const r of results) {
      const q = questions[r.index];
      if (!q) continue;
      if (!r.answer) { failed.push(r.index + 1); continue; }
      let ok = false;
      try { ok = fillAnswer(q, r.answer); } catch (_) { ok = false; }
      if (ok) filled++;
      else failed.push(r.index + 1);
      await delay(140);
    }

    let msg = `已填入 ${filled}/${results.length} 题`;
    if (failed.length) msg += `，第 ${failed.join('、')} 题未写入`;

    if (submitNow) {
      await delay(500);
      const ok = clickSubmit();
      msg += ok ? '，已自动提交' : '，未找到提交按钮，请手动提交';
      pushTip(body, msg, !!ok);
    } else {
      pushTip(body, msg + '（自动提交已关闭，请核对后手动提交）', true);
    }
  }

  function pushTip(body, text, ok) {
    const tip = document.createElement('div');
    tip.style.cssText = ok
      ? 'margin-top:8px;padding:8px;border-radius:6px;font-size:12px;background:#e8f7ef;color:#18794e;'
      : 'margin-top:8px;padding:8px;border-radius:6px;font-size:12px;background:#fdecec;color:#c0353f;';
    tip.textContent = text;
    body.insertBefore(tip, body.firstChild);
  }

  // 点击页面上的「提交」按钮
  function clickSubmit() {
    const sels = [
      'a[onclick*="submit"], a[onclick*="Submit"]',
      'input[value*="提交"]',
      'button[type="submit"]',
      '.subBtn', '#subBtn'
    ];
    for (const sel of sels) {
      let el;
      try { el = document.querySelector(sel); } catch (_) { continue; }
      if (el && isVisible(el)) { el.click(); return true; }
    }
    const all = document.querySelectorAll('a, button, input[type="button"], input[type="submit"], div');
    for (const el of all) {
      const t = (el.innerText || el.value || '').trim();
      if ((t === '提交' || t === '交卷' || t === '提交作业' || t === '保存并提交') && el.children.length <= 2) {
        el.click();
        return true;
      }
    }
    return false;
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // 单题重答（注意：不能把 DOM 节点传给后台）
  async function answerSingle(q, r, div, btn) {
    btn.disabled = true;
    btn.textContent = '生成中…';
    try {
      const payload = { stem: q.stem, options: q.options, type: q.type };
      const res = await chrome.runtime.sendMessage({ type: 'ANSWER_QUESTIONS', questions: [payload] });
      if (res && res.ok && res.results && res.results.length) {
        const ans = res.results[0].answer;
        r.answer = ans;
        div.querySelector('.ans').textContent = '答案：' + (ans || '（未识别）');
        const fillBtn = div.querySelector('button.fill');
        fillBtn.textContent = '填入';
        fillBtn.disabled = false;
        fillBtn.onclick = () => {
          const ok = fillAnswer(q, ans);
          fillBtn.textContent = ok ? '已填入 ✓' : '未找到输入框';
          fillBtn.disabled = ok;
        };
      } else {
        div.querySelector('.ans').textContent = '错误：' + ((res && res.error) || '未知错误');
      }
    } catch (e) {
      div.querySelector('.ans').textContent = '错误：' + e.message;
    } finally {
      btn.disabled = false;
      btn.textContent = '重答';
    }
  }

  // ============ 4. 主流程 ============
  async function runAnswer() {
    const questions = collectQuestions();
    if (!questions.length) {
      const p = ensurePanel();
      p.querySelector('#__cxBody').innerHTML =
        '<div class="err">未识别到题目，请确认当前页面是答题/测验页。</div>' +
        '<div style="margin-top:8px;font-size:12px;color:#646a73;">若题目在子页面（iframe）中，可点下方「诊断页面结构」把报告发我适配。</div>';
      return { count: 0 };
    }

    const p = ensurePanel();
    p.querySelector('#__cxBody').innerHTML =
      `<div style="padding:8px 0">正在调用模型解答 ${questions.length} 道题…</div>`;

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'ANSWER_QUESTIONS',
        questions: questions.map(({ stem, options, type }) => ({ stem, options, type }))
      });
      if (res && res.ok) {
        renderAnswers(questions, res.results);
        return { count: questions.length };
      }
      p.querySelector('#__cxBody').innerHTML =
        '<div class="err">请求失败：' + escapeHtml((res && res.error) || '未知错误') + '</div>';
      return { count: 0 };
    } catch (e) {
      p.querySelector('#__cxBody').innerHTML =
        '<div class="err">连接后台失败：' + escapeHtml(e.message) + '</div>';
      return { count: 0 };
    }
  }

  // 监听来自 popup 的消息
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'PROBE_QUESTIONS') {
      let count = 0;
      try { count = collectQuestions().length; } catch (_) { count = 0; }
      sendResponse({ count, url: location.href });
      return;
    }
    if (msg.type === 'FETCH_QUESTIONS') {
      runAnswer().then((r) => sendResponse(r)).catch((e) => sendResponse({ count: 0, error: e.message }));
      return true; // 异步响应
    }
  });

  // 仅本地测试用：显式打开开关时才暴露内部函数，浏览器正常使用时不会挂载
  if (typeof globalThis !== 'undefined' && globalThis.__CX_TEST_HOOK__) {
    globalThis.__CX_TEST_INTERNALS__ = {
      collectQuestions, parseContainer, extractOptions, detectType, getOptionNodes,
      normalizeOptionText, fillAnswer, fillJudge, clickOptionAt, cleanStem, cleanText
    };
  }
})();
