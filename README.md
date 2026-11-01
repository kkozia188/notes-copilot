# Notes Copilot

一个用来精读 [Robotics_Tutorial](https://github.com/Michael-Jetson/Robotics_Tutorial) 机器人学笔记的个人学习工具：
左边读笔记，右边随时问 Claude，可以高亮、批注，并把好的回答「钉」回原文。

![layout](https://img.shields.io/badge/layout-目录%20%7C%20笔记%20%7C%20对话-blue)

## 功能

- **三栏布局**：笔记目录树（可搜索）/ 笔记正文（GFM 表格、KaTeX 公式、代码高亮）/ AI 对话与批注列表，可拖拽调整宽度
- **选中即操作**：选中文字后弹出工具条 —— 4 色高亮、批注、问 AI，以及「解释 / 推导 / 举例」一键提问
- **公式友好**：选中渲染后的公式会自动还原成 LaTeX 源码再发给 AI；选区不会把公式截成半个
- **上下文感知**：AI 能看到当前整篇笔记（Prompt Caching 缓存，同一篇连续追问很便宜）+ 你引用的片段
- **对话与批注打通**：AI 回答可一键「📌 钉到原文」变成该段的批注；点击对话中的引用跳回原文
- **稳健锚点**：高亮按 W3C Web Annotation 的 TextQuote 思路保存（原文 + 前后文 + 位置），上游笔记更新后自动模糊重定位
- **本地优先**：批注存在浏览器 localStorage，可一键导出 JSON

## 快速开始

```bash
git clone --recursive https://github.com/kkozia188/notes-copilot.git
cd notes-copilot
npm install
cp .env.example .env   # 填入 ANTHROPIC_API_KEY（必需，在 https://platform.claude.com/settings/keys 创建）
npm run dev            # 前端 http://localhost:5173 ，后端 :8787
```

已经 clone 但没带 `--recursive`：`git submodule update --init`。
更新笔记到上游最新版：`git submodule update --remote notes`。

## 架构

```
notes/                  ← git submodule：Robotics_Tutorial 原始 Markdown（不复制、不修改）
server/index.ts         ← Hono：目录树 / 笔记读取 / Claude 流式对话（API Key 只在服务端）
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
```

模型默认 `claude-opus-5-5`（effort `medium`），可在 `.env` 中用 `NOTES_COPILOT_MODEL` / `NOTES_COPILOT_EFFORT` 覆盖。

## Roadmap

- [ ] 全库检索（RAG）：回答「这个概念在别的专题哪里讲过」并给出可点击引用
- [ ] 自测模式：基于每篇的「前置自测」由 AI 出题、批改
- [ ] 阅读进度：每篇 / 每节标记 已读 · 已懂 · 需复习
- [ ] 对话按笔记持久化、批注线程化（每条批注可以继续追问）
- [ ] 批注同步到私有 GitHub 仓库

## 许可

- 本仓库代码：MIT
- 笔记内容（`notes/` 子模块）：© Pengfei Guo，[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)，仅限非商业使用并需署名。本项目不包含、不修改笔记内容，仅在运行时读取。
