// test/run-tests.js —— 用极简 DOM 验证 content.js 抓题/填答逻辑，并验证 background.js 解析逻辑
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { El, buildMockPage } = require('./micro-dom');

const DIR = path.resolve(__dirname, '..');
let pass = 0;
let fail = 0;

function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

// ---------- 1. content.js ----------
const root = buildMockPage();
const body = new El('body');

class HTMLTextAreaElement extends El {}

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  document: {
    documentElement: root,
    body,
    querySelector: (s) => root.querySelector(s),
    querySelectorAll: (s) => root.querySelectorAll(s),
    createElement: (t) => new El(t),
    execCommand: () => true
  },
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  location: { href: 'https://mooc1.chaoxing.com/mooc-ans/mooc2/work/view' },
  Event: class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
  KeyboardEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
  HTMLInputElement: El,
  HTMLTextAreaElement,
  chrome: {
    storage: { local: { get: async () => ({}) } },
    runtime: { onMessage: { addListener: () => {} }, sendMessage: async () => ({ ok: true, results: [] }) }
  },
  __CX_TEST_HOOK__: true
};
sandbox.window = { __cxHelperLoaded: false };
sandbox.window.top = sandbox.window;
sandbox.window.self = sandbox.window;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
const contentSrc = fs.readFileSync(path.join(DIR, 'content.js'), 'utf8');
vm.runInContext(contentSrc, sandbox, { filename: 'content.js' });

const cx = sandbox.__CX_TEST_INTERNALS__;
console.log('\n[content.js] 抓题');
const qs = cx.collectQuestions();
check('识别到 4 道题', qs.length === 4, 'got ' + qs.length);
const [single, judge, multi, fill] = qs;
check('题型识别 single/judge/multiple/fill',
  single.type === 'single' && judge.type === 'judge' && multi.type === 'multiple' && fill.type === 'fill',
  qs.map((q) => q.type).join(','));
check('单选题干已去掉【单选题】前缀', !/【单选题】/.test(single.stem), single.stem);
check('选项文本去掉 A. 前缀', JSON.stringify(single.options) === JSON.stringify(['服务器错误', '请求成功', '页面未找到', '重定向']),
  JSON.stringify(single.options));
check('6 个选项不重复不丢项', multi.options.length === 6, JSON.stringify(multi.options));
check('判断题选项 = 对/错', JSON.stringify(judge.options) === JSON.stringify(['对', '错']), JSON.stringify(judge.options));

console.log('\n[content.js] 填答');
const radios = single.node.querySelectorAll('input[type="radio"]');
check('单选填 B', cx.fillAnswer(single, 'B') === true);
check('B 被选中', radios[1].checked === true, 'checked=' + radios[1].checked);
check('单选互斥（只选中 1 个）', radios.filter((r) => r.checked).length === 1);

const jr = judge.node.querySelectorAll('input[type="radio"]');
check('判断题填「错误」', cx.fillAnswer(judge, '错误') === true);
check('「错误」选中下标 1（错）', jr[1].checked === true && jr[0].checked === false);
jr.forEach((r) => { r.checked = false; });
check('判断题填「正确」', cx.fillAnswer(judge, '正确') === true);
check('「正确」选中下标 0（对）', jr[0].checked === true);
jr.forEach((r) => { r.checked = false; });
check('判断题填「不正确」判为错', cx.fillJudge(judge, '不正确') === true && jr[1].checked === true);

const cr = multi.node.querySelectorAll('input[type="checkbox"]');
check('多选填 AF（含 6 选项不越界）', cx.fillAnswer(multi, 'AF') === true);
check('A 与 F 被选中', cr[0].checked === true && cr[5].checked === true && cr[1].checked === false);
cr.forEach((r) => { r.checked = false; });
check('多选按选项原文填', cx.fillAnswer(multi, 'GET') === true && cr[0].checked === true);

const blanks = fill.node.querySelectorAll('input[type="text"]');
check('填空多空按分号拆分', cx.fillAnswer(fill, '80；443') === true);
check('空1=80 空2=443', blanks[0].value === '80' && blanks[1].value === '443',
  blanks.map((b) => b.value).join('|'));

check('单选按选项原文填「请求成功」', cx.fillAnswer(single, '请求成功') === true && radios[1].checked === true);
check('空答案不误点', cx.fillAnswer(single, '') === false);

// ---------- 2. background.js ----------
const bg = {
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  fetch: async () => { throw new Error('no network in test'); },
  chrome: { storage: { local: { get: async () => ({}) } }, runtime: { onMessage: { addListener: () => {} } } }
};
bg.globalThis = bg;
vm.createContext(bg);
vm.runInContext(fs.readFileSync(path.join(DIR, 'background.js'), 'utf8'), bg, { filename: 'background.js' });

console.log('\n[background.js] 解析');
check('单选 F（第6项）', bg.parseAnswer('F', 'single', 6) === 'F');
check('单选取首个合法字母', bg.parseAnswer('答案是 C，因为……', 'single', 4) === 'C');
check('单选越界字母回退原文', bg.parseAnswer('Z', 'single', 4) === 'Z');
check('多选排序去重', bg.parseAnswer('B、A、B', 'multiple', 4) === 'AB');
check('判断题「不正确」→ 错误', bg.parseAnswer('不正确', 'judge') === '错误');
check('判断题「×」→ 错误', bg.parseAnswer('×', 'judge') === '错误');
check('判断题「√」→ 正确', bg.parseAnswer('√', 'judge') === '正确');
check('去掉 markdown 加重符', bg.parseAnswer('**B**', 'single', 4) === 'B');
check('去掉「答案：」前缀', bg.parseAnswer('答案：A', 'single', 4) === 'A');

const split = bg.splitByIndex('第1题：A\n第2题：BCD\n第3题：正确', 3);
check('批量切分「第N题：答案」', split[1] === 'A' && split[2] === 'BCD' && split[3] === '正确', JSON.stringify(split));
const split2 = bg.splitByIndex('1. A\n2、错', 2);
check('兜底切分「1. A / 2、错」', split2[1] === 'A' && split2[2] === '错', JSON.stringify(split2));

check('base_url 去尾斜杠', bg.normalizeBase('https://api.deepseek.com/v1/') === 'https://api.deepseek.com/v1');
check('base_url 兼容误填 chat/completions',
  bg.normalizeBase('https://api.deepseek.com/v1/chat/completions') === 'https://api.deepseek.com/v1');

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
