// options.js —— 设置页逻辑
const DEFAULT_CFG = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  prompt: '',
  autoSubmit: false
};

const DEFAULT_MODELS = ['deepseek-chat', 'deepseek-reasoner', 'gpt-4o-mini', 'qwen-plus', 'moonshot-v1-8k'];

const $ = (id) => document.getElementById(id);

// 已知可选模型（可被"获取模型列表"动态覆盖）
let KNOWN_MODELS = DEFAULT_MODELS.slice();

function syncModelUI(model) {
  const sel = $('modelSelect');
  const input = $('model');
  if (KNOWN_MODELS.includes(model)) {
    sel.value = model;
    input.style.display = 'none';
  } else {
    sel.value = '__custom__';
    input.style.display = 'block';
    input.value = model || '';
  }
}

function getModelValue() {
  const sel = $('modelSelect');
  if (sel.value === '__custom__') {
    return $('model').value.trim();
  }
  return sel.value;
}

$('modelSelect').addEventListener('change', () => {
  if ($('modelSelect').value === '__custom__') {
    $('model').style.display = 'block';
  } else {
    $('model').style.display = 'none';
  }
});

// 拉取模型列表并刷新下拉框
async function fetchModels() {
  const baseUrl = $('baseUrl').value.trim();
  const apiKey = $('apiKey').value.trim();
  if (!baseUrl) { showMsg('请先填写 API 地址', false); return; }
  if (!apiKey) { showMsg('请先填写 API Key', false); return; }

  const btn = $('btnFetchModels');
  btn.disabled = true;
  btn.textContent = '获取中…';
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'LIST_MODELS',
      cfg: { baseUrl, apiKey }
    });
    if (res && res.ok && res.models.length) {
      KNOWN_MODELS = res.models;
      const sel = $('modelSelect');
      const current = getModelValue();
      // 重建下拉选项
      sel.innerHTML = '';
      res.models.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        sel.appendChild(opt);
      });
      const customOpt = document.createElement('option');
      customOpt.value = '__custom__';
      customOpt.textContent = '自定义其他模型…';
      sel.appendChild(customOpt);
      // 若当前模型在列表中则选中，否则回退到第一个
      if (res.models.includes(current)) {
        sel.value = current;
        $('model').style.display = 'none';
      } else {
        sel.value = res.models[0];
        $('model').style.display = 'none';
      }
      $('modelDesc').textContent = `已获取 ${res.models.length} 个可用模型`;
      showMsg(`成功获取 ${res.models.length} 个模型`, true);
    } else {
      showMsg('获取失败：' + (res && res.error ? res.error : '未知错误'), false);
    }
  } catch (e) {
    showMsg('请求异常：' + e.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = '获取模型列表';
  }
}

async function load() {
  const { cfg } = await chrome.storage.local.get('cfg');
  const c = { ...DEFAULT_CFG, ...(cfg || {}) };
  $('baseUrl').value = c.baseUrl;
  $('apiKey').value = c.apiKey;
  syncModelUI(c.model);
  $('prompt').value = c.prompt || '';
  $('autoSubmit').checked = !!c.autoSubmit;
}

function showMsg(text, ok) {
  const m = $('msg');
  m.textContent = text;
  m.className = 'msg ' + (ok ? 'ok' : 'bad');
  setTimeout(() => (m.className = 'msg'), 3000);
}

async function save() {
  const cfg = {
    baseUrl: $('baseUrl').value.trim(),
    apiKey: $('apiKey').value.trim(),
    model: getModelValue(),
    prompt: $('prompt').value.trim(),
    autoSubmit: !!$('autoSubmit').checked
  };
  if (!cfg.model) { showMsg('请选择或填写模型名称', false); return; }
  if (!/^https?:\/\//i.test(cfg.baseUrl)) { showMsg('API 地址需以 http:// 或 https:// 开头', false); return; }
  await chrome.storage.local.set({ cfg });
  showMsg('配置已保存', true);
}

async function test() {
  const baseUrl = $('baseUrl').value.trim();
  const apiKey = $('apiKey').value.trim();
  const model = getModelValue();
  if (!apiKey) { showMsg('请先填写 API Key', false); return; }
  if (!model) { showMsg('请选择或填写模型名称', false); return; }

  const btn = $('btnTest');
  btn.disabled = true;
  btn.textContent = '测试中…';
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'TEST_API',
      cfg: { baseUrl, apiKey, model }
    });
    if (res && res.ok) {
      showMsg(`连接成功，模型响应：${res.reply}`, true);
    } else {
      showMsg('连接失败：' + (res && res.error ? res.error : '未知错误'), false);
    }
  } catch (e) {
    showMsg('请求异常：' + e.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = '测试连接';
  }
}

$('btnSave').addEventListener('click', save);
$('btnTest').addEventListener('click', test);
$('btnFetchModels').addEventListener('click', fetchModels);

// 清除已保存配置（带二次确认）
$('btnClear').addEventListener('click', async () => {
  if (!confirm('确定要清除已保存的 API 地址、Key、模型等所有配置吗？此操作不可恢复。')) return;
  await chrome.storage.local.remove('cfg');
  // 重置输入框
  $('baseUrl').value = DEFAULT_CFG.baseUrl;
  $('apiKey').value = '';
  $('prompt').value = '';
  $('autoSubmit').checked = false;
  // 重置模型下拉框为默认选项
  KNOWN_MODELS = DEFAULT_MODELS.slice();
  const sel = $('modelSelect');
  sel.innerHTML = '';
  KNOWN_MODELS.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    sel.appendChild(opt);
  });
  const customOpt = document.createElement('option');
  customOpt.value = '__custom__';
  customOpt.textContent = '自定义其他模型…';
  sel.appendChild(customOpt);
  sel.value = DEFAULT_CFG.model;
  $('model').style.display = 'none';
  $('model').value = '';
  $('modelDesc').textContent = '不确定模型名就点「获取模型列表」，会从你的 API 拉取真实可用模型';
  showMsg('已清除所有配置', true);
});

// 捐款弹窗
const donateMask = $('donateMask');
$('btnDonate').addEventListener('click', () => {
  donateMask.style.display = 'flex';
});
$('donateClose').addEventListener('click', () => {
  donateMask.style.display = 'none';
});
donateMask.addEventListener('click', (e) => {
  if (e.target === donateMask) donateMask.style.display = 'none';
});

load();
