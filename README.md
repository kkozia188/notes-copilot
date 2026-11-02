# Notes Copilot

一个用来精读 [Robotics_Tutorial](https://github.com/Michael-Jetson/Robotics_Tutorial) 机器人学笔记的个人学习工具：
左边读笔记，右边随时问 AI，可以高亮、批注，并把好的回答「钉」回原文。本分支默认使用本机 Codex CLI，也保留 Claude Code 和 Anthropic API 后端。支持 macOS、Linux 和 Windows 的 WSL 环境。

![layout](https://img.shields.io/badge/layout-目录%20%7C%20笔记%20%7C%20对话-blue)

## 功能

- **三栏布局**：笔记目录树（可搜索）/ 笔记正文（GFM 表格、KaTeX 公式、代码高亮）/ AI 对话与批注列表，可拖拽调整宽度
- **选中即操作**：选中文字后弹出工具条 —— 4 色高亮、批注、问 AI，以及「解释 / 推导 / 举例」一键提问
- **公式友好**：选中渲染后的公式会自动还原成 LaTeX 源码再发给 AI；选区不会把公式截成半个
- **一章一个对话**：每篇笔记有独立、持久保存的对话；可随时切回其他章节的对话继续
- **上下文感知**：AI 已读当前整章 + 你引用的片段；CLI 后端下还能自己检索、阅读笔记库中的其他章节（只读），回答里的章节链接可点击跳转
- **Claude 风格对话界面**：衬线体回答、查阅过程折叠显示、开场建议（概括本章 / 前置知识 / 出题考我 / 易错点）
- **对话与批注打通**：AI 回答可一键「📌 钉到原文」变成该段的批注；点击对话中的引用跳回原文
- **稳健锚点**：高亮按 W3C Web Annotation 的 TextQuote 思路保存（原文 + 前后文 + 位置），上游笔记更新后自动模糊重定位
- **本地优先**：批注存在浏览器 localStorage，可一键导出 JSON

## 快速开始

需要 Node.js 22.6+，以及已安装并登录的 [Codex CLI](https://github.com/openai/codex)（本机验证版本：0.163.0）。

```bash
git clone --recursive --branch feat/codex-local https://github.com/kkozia188/notes-copilot.git notes-copilot-codex
cd notes-copilot-codex
npm ci
cp .env.example .env
codex login status     # 未登录时运行 codex login
npm run build
npm start              # 阅读和 AI 对话统一使用 http://127.0.0.1:8787
```

开发时运行 `npm run dev`：前端 `http://localhost:5173`，后端 `:8787`。批注和对话保存在浏览器中，不同地址/端口的记录互相独立。日常学习固定使用 `http://127.0.0.1:8787`。

本机项目目录和后台服务见 [LOCAL_SETUP.md](LOCAL_SETUP.md)。

### 对话后端

| 后端 | 设置 | 说明 |
|---|---|---|
| `codex`（默认） | 本机安装并登录 Codex CLI | 使用 `codex exec --json` 和按章节的线程续聊；复用本机登录、供应商和默认模型。导师使用只读沙箱，禁用本机无关的 MCP、hooks 和多代理；可跨章节查阅 |
| `cli` | `.env` 设置 `NOTES_COPILOT_BACKEND=cli`，并安装、登录 [Claude Code](https://claude.com/claude-code) | 使用 `claude -p`，工具限制为 Read/Grep/Glob，工作目录为 `notes/` |
| `api` | `.env` 中设置 `NOTES_COPILOT_BACKEND=api` 和 `ANTHROPIC_API_KEY` | 直接调用 Anthropic API，首字更快；适合以后部署 |

可用 `NOTES_COPILOT_CODEX_BIN` 指定 Codex 路径，用 `NOTES_COPILOT_MODEL` 覆盖模型，用 `NOTES_COPILOT_EFFORT` 设置推理强度。登录方式和费用规则跟随本机 Codex 配置；应用不会把 CLI 凭据发送到浏览器。Codex 的 JSONL 事件通常按回答片段返回，首次回答可能需要等待几秒至几十秒。

已经 clone 但没带 `--recursive`：`git submodule update --init`。
更新笔记到上游最新版：`git submodule update --remote notes`。

## 架构

```
notes/                  ← git submodule：Robotics_Tutorial 原始 Markdown（不复制、不修改）
server/index.ts         ← Hono：目录树 / 笔记读取 / 对话路由
server/prompt.ts        ← 导师 system prompt（按章节构建，保持稳定以利用缓存）
server/backends/codex.ts ← Codex CLI（JSONL、线程续聊、只读沙箱、取消和超时）
server/backends/cli.ts  ← claude -p 无头模式（stream-json、--resume 续接会话、只读工具）
server/backends/api.ts  ← Anthropic SDK 流式调用
src/
  components/
    NoteView.tsx        ← 正文渲染、选区工具条、高亮绘制（CSS Custom Highlight API）、批注弹窗
    ChatPanel.tsx       ← 对话、引用卡片、钉到原文
    AnnotationList.tsx  ← 本篇批注列表、导出
    NoteTree.tsx / Markdown.tsx
  lib/
    anchor.ts           ← TextQuote 锚点的生成与重定位
    selection.ts        ← 选区 → LaTeX、所在小节提取
    store.ts            ← 批注存储（localStorage）
    chats.ts            ← 按章节的对话存储（含后端会话 ID）
    latex.ts            ← 回答中的 \( \) / \[ \] 统一为 $ / $$
```



## Roadmap

- [x] 跨章节检索（Codex CLI / Claude Code 只读查阅笔记库）
- [ ] 回答引用定位：`[§小节]` 引用点击后左侧滚动并高亮原文（借鉴 DeepTutor reading 的 `reader_goto`）
- [ ] 自测卡片：基于每篇的「前置自测」出题，选项打乱、作答后显示解析，每题可单独追问（借鉴 DeepTutor quiz / follow-up）
- [ ] 掌握度与复习提醒：按章节记录答题表现，按间隔重复在目录树标记「待复习」（借鉴 DeepTutor learning/mastery）
- [ ] 阅读进度：每篇 / 每节标记 已读 · 已懂 · 需复习
- [x] 对话按章节持久化
- [ ] 批注线程化（每条批注可以继续追问）
- [ ] 批注同步到私有 GitHub 仓库

## 致谢

- 部分导师提示词规则与交互思路借鉴自 [HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor)（Apache-2.0），包括 mastery/reading/learning 模块的提示词与 LaTeX 规范化思路；相关代码处均有注明。

## 许可

- 本仓库代码：MIT
- 笔记内容（`notes/` 子模块）：© Pengfei Guo，[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)，仅限非商业使用并需署名。本项目不包含、不修改笔记内容，仅在运行时读取。
