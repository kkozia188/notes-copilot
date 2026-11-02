# 这台电脑上的 Notes Copilot

已创建独立项目：`/home/kkozia/projects/notes-copilot-codex`。

- 仓库：<https://github.com/kkozia188/notes-copilot>
- 分支：`feat/codex-local`
- 环境：Windows + WSL Ubuntu 22.04，Node.js 24。
- 固定入口：<http://127.0.0.1:8787>
- 默认后端：Codex CLI。
- 模型：默认读取 `~/.codex/config.toml`。
- 本机推理强度：`low`，可在 `.env` 修改。
- 笔记：原仓库的 `Robotics_Tutorial` 子模块，共 430 篇。

## 使用

1. 双击 Windows 桌面的 **Notes Copilot (Codex)**。
2. 启动器会先启动 WSL 服务，再打开浏览器。
3. 在左侧目录选择笔记，或搜索 `Kalman`。
4. 在右侧提问，或选中文字后点「问 AI」。
5. 批注和对话自动保存在当前浏览器。

服务已运行时，也可直接打开 <http://127.0.0.1:8787>。
启动器源码保存在 `scripts/start-windows.ps1`。
桌面快捷方式指向 Windows 用户目录下的启动器副本。

每篇笔记有独立对话。续聊复用 Codex 线程。
电脑迁移不会自动带上 Mac 浏览器的批注。
如需迁移，请在 Mac 导出批注 JSON。
应用目前只提供批注导出，没有 JSON 导入功能。

## 后台运行

已安装用户服务 `notes-copilot-codex.service`。
服务在 WSL 用户服务启动时自动运行。
关闭当前终端不会停止服务。
Windows 重启后，双击桌面快捷方式即可启动 WSL。
WSL 关闭期间，浏览器入口不可用。

查看状态：

```bash
systemctl --user status notes-copilot-codex
```

重新启动：

```bash
systemctl --user restart notes-copilot-codex
```

查看日志：

```bash
journalctl --user -u notes-copilot-codex -n 80 --no-pager
```

停止：

```bash
systemctl --user stop notes-copilot-codex
```

服务模板保存在 `scripts/notes-copilot-codex.service`。
模板使用当前项目路径。项目移动后必须更新服务。

## 手动启动或开发

手动启动前，先停止后台服务，避免占用同一端口。

```bash
cd ~/projects/notes-copilot-codex
npm ci
npm run build
npm start
```

开发模式使用 `npm run dev`，浏览器入口为 `http://localhost:5173`。
`5173` 和 `8787` 的浏览器数据分别保存。
日常学习固定使用 `8787`。

代码修改后，重建前端并重启服务：

```bash
cd ~/projects/notes-copilot-codex
npm run build
systemctl --user restart notes-copilot-codex
```

## AI 配置

`.env` 已设置 Codex 后端和可执行文件路径。
`.env` 不提交到 Git。
应用复用当前 Linux 用户的 Codex 登录和供应商配置。
应用不会更改全局 Codex 配置。
导师子进程使用只读沙箱和 `never` 审批策略。
应用为每次导师调用禁用无关 MCP、hooks 和多代理。

如需覆盖模型，在 `.env` 写入：

```dotenv
NOTES_COPILOT_MODEL=你的可用模型名称
NOTES_COPILOT_EFFORT=low
```

Codex 登录失效时，在 WSL 终端执行 `codex login`。
回答通常需要几秒至几十秒。
单次调用超过 180 秒时，应用结束调用并提示重试。

## 验证

- `npm run typecheck` 和 `npm run build`。
- `npm test`：对话历史、续聊、错误、超时和停止。
- 真实 Codex 首轮回答、续聊记忆和跨章节查阅。
- 浏览器公式渲染、目录搜索和 AI 回答。
- 刷新后保留对话。
- 高亮工具条在正文边缘可点击，刷新后保留高亮。
- Windows 侧可访问 `127.0.0.1:8787`。
