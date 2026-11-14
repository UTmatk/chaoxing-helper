# 学习通答题助手（Edge / Chrome 插件）

一个 Manifest V3 浏览器扩展：**抓取学习通（超星）答题页的题目** → 调用你自己配置的 OpenAI 兼容模型 API 生成答案 → **由你确认后**再填充到页面。

> ⚠️ 本工具仅用于**自查、练习、整理错题**等场景。请遵守你所在学校与平台的规则，使用后果自负。

---

## 一、功能特性

- 支持题型：单选、多选、判断、填空、简答/主观题
- 自定义模型 API：`base_url` + `api_key` + `model` + 自定义提示词，可一键「获取模型列表」
- 抓题 → 调模型 → **人工确认后填入**（默认不自动提交）
- 题目在 **iframe 子页面**里也能抓（自动定位题目所在 frame）
- 绕过「禁用粘贴」：原生 setter + 完整事件链写入
- 兼容 UEditor / KindEditor 等 iframe 富文本编辑器
- 答案面板：单题「重答」「填入」、批量「全部填入」、复制全部答案、诊断页面结构
- 批量失败自动降级：整段解析不出来时按题单独补问

---

## 二、安装

### 方式 A：下载发行版（推荐，普通用户）

1. 打开 [Releases](https://github.com/UTmatk/chaoxing-helper/releases) 下载最新 `chaoxing-helper-v1.1.0.zip`
2. 解压到任意目录（解压后是一个 `chaoxing-helper` 文件夹，里面直接有 `manifest.json`）
3. 打开 `edge://extensions`（Chrome 为 `chrome://extensions`）→ 打开 **开发人员模式**
4. 点 **加载解压缩的扩展**，选中解压出来的 `chaoxing-helper` 文件夹

### 方式 B：源码加载

1. 打开 `edge://extensions`（Chrome 为 `chrome://extensions`）
2. 打开右上角 **开发人员模式**
3. 点 **加载解压缩的扩展**，选择本目录（含 `manifest.json` 的那一层）
4. 工具栏出现「答」字图标

---

## 三、配置模型 API

点插件图标 →「设置」，或右键图标 →「选项」：

| 字段 | 说明 | 示例 |
|------|------|------|
| API 地址 | 兼容 OpenAI 的 base_url，**不要**带 `/chat/completions` | `https://api.deepseek.com/v1` |
| API Key | 你的密钥 | `sk-...` |
| 模型名称 | 点「获取模型列表」可直接拉取真实可用模型 | `deepseek-chat` |
| 自定义提示词 | 可选，留空用默认 | `你是一名高校课程助教…` |

常见服务：

| 服务 | base_url | 模型示例 |
|------|----------|----------|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` / `deepseek-reasoner` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| Ollama（本地） | `http://localhost:11434/v1` | `qwen2.5:7b` |

> 配置只保存在本机 `chrome.storage.local`，不会上传到第三方。

---

## 四、使用

1. 打开学习通的作业 / 测验 / 考试答题页（题目已渲染出来）
2. 点插件图标 → **抓取当前题目**
3. 页面右上角出现答案面板（若题目在 iframe 里，面板出现在该子页面右上角）
4. 逐题点 **填入**，或点 **全部填入**
   - 选择题/判断题：自动点选对应选项（判断题支持 对/错、正确/错误、√/×、T/F）
   - 填空/简答：写入输入框或富文本编辑器
5. 答案不对就点 **重答**；全部填完**自己核对**后再提交

---

## 五、目录结构

```
chaoxing-helper/
├── manifest.json        # 扩展配置（MV3，all_frames 注入）
├── background.js        # 后台：调模型 API、批量/单题解析
├── content.js           # 内容脚本：抓题、填答、答案面板、诊断
├── popup.html/js        # 弹窗：状态 + 触发抓题（自动定位 frame）
├── options.html/js      # 设置页：配置 + 连接测试 + 获取模型列表
├── icons/               # 图标与收款码
├── gen_icons.py         # 图标生成脚本（可选）
└── test/                # 离线单测：微型 DOM 验证抓题与填答逻辑
    ├── micro-dom.js
    └── run-tests.js
```

---

## 六、本地测试

无需浏览器，验证「选项识别 / 判断题映射 / 字母越界 / 多空填空 / 答案切分」等核心逻辑：

```bash
node test/run-tests.js
```

期望输出：`结果：34 通过 / 0 失败`。

---

## 七、常见问题

**Q：点「抓取」提示"未识别到题目"？**
A：确认打开的是答题页且题目已渲染。点面板里的「诊断页面结构」，把复制到的报告发给开发者即可针对性加选择器（`content.js` 顶部 `QUESTION_SELECTORS`）。

**Q：答案写入不进去？**
A：先看诊断报告里的「可写入元素数」。若为 0，说明该题用了特殊编辑器（跨域 iframe / Canvas / 组件化输入框），需要额外适配。

**Q：模型答案格式乱？**
A：设置页里把「自定义提示词」写严格些；插件已内置「按题补问」兜底，仍有空项会单独重问。

**Q：测试连接失败？**
A：检查 base_url 是否少了 `/v1`、Key 是否有效、本地 Ollama 是否启动。401/403 会直接提示 Key 问题。

---

## 八、v1.1 修复记录

| # | 问题 | 影响 | 处理 |
|---|------|------|------|
| 1 | 内容脚本只在顶层 frame 注入 | 作业页题目在 iframe 里 → 永远抓不到题 | `all_frames: true` + popup 探查各 frame、定向发送 |
| 2 | 判断题按字母逻辑填 | 「正确/错误」被当字母，或文本匹配不到「对/错」 | 独立 `fillJudge`，支持 对/错/√/×/T/F，兜底按两选项顺序 |
| 3 | 字母只支持 A–D | 5–6 选项题答案 F 被丢弃 | 字母解析扩展到选项数量（A–Z） |
| 4 | 选项同时取 `li` 与 `.after` | 同一选项被记两次 → 字母整体错位 | 以 `li` 为唯一边界，去字母前缀后按文本去重 |
| 5 | 「重答」把 DOM 节点塞进 `sendMessage` | 结构化克隆失败 → 重答必失败 | 只传 `{stem, options, type}` |
| 6 | 纯字母选项原文（GET/TRUE）被当字母答案 | 点错选项 | 字母越界即回退按原文匹配 |
| 7 | 默认配置自相矛盾（openai 地址 + deepseek 模型） | 新装用户测试连接必失败 | 默认改为 `api.deepseek.com/v1` + `deepseek-chat` |
| 8 | 无超时、无失败降级 | 网络卡住无反馈；整段解析失败则全空 | 60s 超时；批量失败自动逐题补问 |
| 9 | 判断题解析 `正确` 优先 | 「不正确」被判为正确 | 先判否再判是 |
| 10 | 提交按钮选择器含 `.prev_next a:last-child` | 可能误点「下一题」 | 移除，改为可见性校验后的文本匹配 |
