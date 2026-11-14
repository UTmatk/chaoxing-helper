// test/micro-dom.js —— 极简 DOM，仅用于验证 content.js 的抓题/填答逻辑
// 支持: tag, .class, [attr], [attr="v"], 后代与 > 子选择器（逗号分隔）

function parseCompound(token) {
  const m = token.match(/^([a-zA-Z0-9*]*)(.*)$/);
  const tag = m[1] || '*';
  const rest = m[2];
  const classes = [];
  const attrs = [];
  const re = /\.([\w-]+)|\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g;
  let x;
  while ((x = re.exec(rest)) !== null) {
    if (x[1]) classes.push(x[1]);
    else attrs.push({ name: x[2], value: x[3] });
  }
  return { tag: tag.toLowerCase(), classes, attrs };
}

function parseSelector(sel) {
  return sel.split(',').map((s) => s.trim()).filter(Boolean).map((part) => {
    const tokens = part.replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean);
    return tokens;
  });
}

class El {
  constructor(tag, props = {}) {
    this.tagName = tag.toUpperCase();
    this.className = props.className || '';
    this.id = props.id || '';
    this.type = props.type;
    this.name = props.name;
    this.value = props.value;
    this.checked = !!props.checked;
    this.disabled = !!props.disabled;
    this.readOnly = !!props.readOnly;
    this.style = props.style || {};
    this.children = [];
    this.parentElement = null;
    this._text = props.text || '';
    this._listeners = {};
    this.clicked = 0;
    this.classList = {
      add: (c) => {
        if (!this.className.split(/\s+/).includes(c)) this.className = (this.className + ' ' + c).trim();
      }
    };
  }
  append(...kids) {
    kids.forEach((k) => { k.parentElement = this; this.children.push(k); });
    return this;
  }
  get innerText() {
    const own = this._text ? ' ' + this._text + ' ' : '';
    return (own + this.children.map((c) => c.innerText).join(' ')).replace(/\s+/g, ' ').trim();
  }
  set innerText(v) { this._text = v; this.children = []; }
  get innerHTML() {
    const attrs = [];
    if (this.className) attrs.push(`class="${this.className}"`);
    if (this.type) attrs.push(`type="${this.type}"`);
    const inner = (this._text || '') + this.children.map((c) => c.outerHTML).join('');
    if (this.tagName === 'INPUT') return '';
    return `<${this.tagName.toLowerCase()}${attrs.length ? ' ' + attrs.join(' ') : ''}>${inner}</${this.tagName.toLowerCase()}>`;
  }
  get outerHTML() {
    if (this.tagName === 'INPUT') {
      return `<input type="${this.type || 'text'}">`;
    }
    return this.innerHTML;
  }
  get textContent() { return this.innerText; }
  get isContentEditable() { return false; }
  getClientRects() { return [{}]; }
  click() { this.clicked++; }
  focus() {}
  dispatchEvent() { return true; }
  addEventListener() {}
  matches(token) {
    const c = parseCompound(token);
    if (c.tag !== '*' && this.tagName.toLowerCase() !== c.tag) return false;
    const cls = this.className.split(/\s+/).filter(Boolean);
    if (!c.classes.every((x) => cls.includes(x))) return false;
    for (const a of c.attrs) {
      if (a.value === undefined) {
        if (this[a.name] === undefined || this[a.name] === null) return false;
      } else if (String(this[a.name]) !== a.value) return false;
    }
    return true;
  }
  descendants(out = []) {
    this.children.forEach((c) => { out.push(c); c.descendants(out); });
    return out;
  }
  querySelectorAll(selector) {
    const groups = parseSelector(selector);
    const all = this.descendants();
    const res = [];
    for (const el of all) {
      for (const tokens of groups) {
        if (this._matchChain(el, tokens)) { if (!res.includes(el)) res.push(el); break; }
      }
    }
    return res;
  }
  querySelector(selector) {
    const r = this.querySelectorAll(selector);
    return r.length ? r[0] : null;
  }
  closest(selector) {
    const groups = parseSelector(selector);
    let cur = this;
    while (cur) {
      if (groups.some((tokens) => cur._matchChainSelf(tokens))) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  _matchChainSelf(tokens) {
    // 只匹配自身最后一个 token（用于 closest）
    return this.matches(tokens[tokens.length - 1]);
  }
  _matchChain(el, tokens) {
    const last = tokens[tokens.length - 1];
    if (!el.matches(last)) return false;
    let node = el;
    let i = tokens.length - 2;
    // tokens 形如 [a, '>', b, '>', c]：从右往左
    while (i >= 0) {
      const comb = tokens[i];
      if (comb === '>') {
        i -= 1;
        if (i < 0) return true;
        node = node.parentElement;
        if (!node || !node.matches(tokens[i])) return false;
        i -= 1;
      } else {
        // 后代
        const want = tokens[i];
        node = node.parentElement;
        while (node && !node.matches(want)) node = node.parentElement;
        if (!node) return false;
        i -= 1;
      }
    }
    return true;
  }
}

function buildMockPage() {
  // 单选：4 个选项，嵌套 li > a > (i.fl + div.after)
  const mkOpt = (letter, text, type, name) => {
    const li = new El('li');
    const a = new El('a').append(new El('i', { className: 'fl', text: letter + '.' }), new El('div', { className: 'after', text }));
    li.append(a);
    const inp = new El('input', { type, name });
    li.append(inp);
    return li;
  };

  const single = new El('div', { className: 'TiMu' }).append(
    new El('div', { className: 'Zy_TItle' }).append(
      new El('div', { className: 'clearfix', text: '【单选题】(2分) HTTP 200 表示什么？' })
    ),
    new El('ul', { className: 'Zy_ulTop' }).append(
      mkOpt('A', '服务器错误', 'radio', 'q1'),
      mkOpt('B', '请求成功', 'radio', 'q1'),
      mkOpt('C', '页面未找到', 'radio', 'q1'),
      mkOpt('D', '重定向', 'radio', 'q1')
    )
  );

  // 判断题：两选项 对 / 错
  const judge = new El('div', { className: 'TiMu' }).append(
    new El('div', { className: 'Zy_TItle' }).append(
      new El('div', { className: 'clearfix', text: '【判断题】HTTP 是无状态协议。' })
    ),
    new El('ul', { className: 'Zy_ulTop' }).append(
      mkOpt('A', '对', 'radio', 'q2'),
      mkOpt('B', '错', 'radio', 'q2')
    )
  );

  // 多选：6 个选项，防止 A-D 越界
  const multi = new El('div', { className: 'TiMu' }).append(
    new El('div', { className: 'Zy_TItle' }).append(
      new El('div', { className: 'clearfix', text: '【多选题】以下哪些属于 HTTP 方法？' })
    ),
    new El('ul', { className: 'Zy_ulTop' }).append(
      mkOpt('A', 'GET', 'checkbox', 'q3'),
      mkOpt('B', 'POST', 'checkbox', 'q3'),
      mkOpt('C', 'FETCH', 'checkbox', 'q3'),
      mkOpt('D', 'PUT', 'checkbox', 'q3'),
      mkOpt('E', 'DELETE', 'checkbox', 'q3'),
      mkOpt('F', 'HEAD', 'checkbox', 'q3')
    )
  );

  // 填空：两个空
  const fill = new El('div', { className: 'TiMu' }).append(
    new El('div', { className: 'Zy_TItle' }).append(
      new El('div', { className: 'clearfix', text: '【填空题】HTTP 默认端口是 ____，HTTPS 默认端口是 ____。' })
    ),
    new El('input', { type: 'text', name: 'blank1' }),
    new El('input', { type: 'text', name: 'blank2' })
  );

  const root = new El('div', { className: 'TiMuList' });
  root.append(single, judge, multi, fill);
  return root;
}

module.exports = { El, buildMockPage };
