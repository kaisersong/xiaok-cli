# xiaok-cli

[English](./README.md) | 简体中文

面向金蝶苍穹与云之家开发者的 AI 编程 CLI。它将本地终端代理、可扩展技能体系与云之家 IM 网关统一在同一套 agent runtime 之上，苍穹 CLI 和云之家 CLI 的集成正在进行中。

## 产品亮点

- **7 层 Prompt 架构**：CC 风格独立 section 函数，静态/动态分界，每 turn 动态注入 Session Guidance
- **多模型支持**：Claude 与 OpenAI 适配器，支持自动重试与指数退避（429/502/503/529）
- **Bash 安全分类器**：block/warn/safe 三级风险分类，拦截 `rm -rf /`、fork bomb、`curl|sh` 等危险命令
- **工具输入校验**：轻量 JSON Schema 验证器，每次工具调用前校验必填字段和类型
- **技能系统**：内置、全局、项目级技能分层加载，支持依赖解析与 allowed-tools 白名单约束
- **内置专业化 Agent**：Explore（只读探索）、Plan（只规划不编辑）、Verification（对抗式验证）
- **云之家 IM 接入**：终端与移动聊天共用同一套 agent runtime，支持异步任务与审批流
- **上下文管理**：工具结果微压缩（8K 阈值）、AI 驱动压缩（NO_TOOLS_PREAMBLE 保护）、记忆回注
- **云之家网关加固**：HTTP 错误码细分（401/403/429/5xx）+ 429 限流退避 + 出站 try-catch 保护
- **类型化记忆**：支持 `user`/`feedback`/`project`/`reference` 类型分类与过滤检索
- **增强 Hook 系统**：PreToolUse hook 支持 updatedInput / preventContinuation / additionalContext
- **平台运行时**：MCP/LSP 插件接入、worktree 隔离、后台 subagent 与持久状态

## 快速上手

```bash
# 安装与构建
npm install
npm run build

# 交互式对话
xiaok

# 单次任务
xiaok "review the current workspace changes"

# 启动云之家 IM 网关
xiaok yzj serve
```

## 环境要求

- Node.js 20+
- 可用的 Claude 或 OpenAI API Key
- 云之家机器人 `sendMsgUrl`（如需使用网关场景）

## 架构概览

```text
src/
  ai/
    prompts/
      sections/    7 个独立 section 函数
      assembler.ts 静态/动态 prompt 组装入口
      builder.ts   PromptSnapshot 生成与 cache 分段
    adapters/      Claude（含重试）和 OpenAI 模型适配器
    agents/        自定义 agent 加载器 + 内置 explore/plan/verification
    memory/        类型化文件记忆存储
    runtime/       agent runtime、compact runner、session graph
    skills/        skill 加载器、规划器、工具集成
    tools/         read/write/edit/bash（含安全）/grep/glob/web/skills/tasks
    permissions/   三层权限策略引擎
  auth/            认证与 token 存储
  channels/        渠道网关、任务/审批/会话抽象
  commands/        CLI 命令（chat/commit/review/pr/doctor/init/transcript）
  platform/        插件、MCP、LSP、sandbox、teams、worktrees
  runtime/         运行时 hooks 与任务原语
  ui/              终端 UI：流式 Markdown、状态栏、权限提示
  utils/           配置与辅助工具
```

## System Prompt 7 层架构

### 静态前缀（可缓存，跨 turn 稳定）

| 层 | Section | 语言 | 内容 |
|---|---------|------|------|
| 1 | Intro | 中文 | 角色定义 — 金蝶苍穹 + 云之家开发者助手 |
| 2 | System | 英文 | 运行时规则 — permission mode、prompt injection 防护 |
| 3 | DoingTasks | 英文 | 做任务哲学 — 不加多余功能、先读再改、OWASP 安全意识 |
| 4 | Actions | 英文 | 风险边界 — destructive 操作需确认 |
| 5 | UsingTools | 英文 | 工具语法 — read 不用 cat、无依赖工具并行 |
| 6 | ToneAndStyle | 英文 | 交互风格 — 简洁、file_path:line_number |
| 7 | OutputEfficiency | 英文 | 输出效率 — 先说结论不铺垫 |

### 动态后缀（每 turn 重建）

| Section | 条件 |
|---------|------|
| 会话上下文 | 始终 — cwd、enterprise、devApp |
| Session Guidance | 每 turn — 权限模式、工具限制、工具数量 |
| Memory | 每 turn — 前 K 条相关记忆 |
| Token Budget | 始终 — 剩余窗口百分比 |
| 自动上下文 | 始终 — CLAUDE.md、AGENTS.md、git 状态 |

## 核心命令

| 命令 | 说明 |
|---|---|
| `xiaok` / `xiaok chat` | 交互式对话 |
| `xiaok "task"` | 单次任务执行 |
| `xiaok chat --resume <id>` | 恢复历史会话 |
| `xiaok commit` | AI 辅助提交 |
| `xiaok review` | AI 辅助代码审查 |
| `xiaok pr` | AI 辅助拉取请求 |
| `xiaok doctor` | 检查健康状态 |
| `xiaok init` | 初始化项目设置 |
| `xiaok yzj serve` | 启动云之家网关 |

## 云之家 IM 命令

```text
/help                    显示帮助
/bind <cwd>              绑定工作区
/status [taskId]         查看任务状态
/approve <approvalId>    批准待审批动作
/deny <approvalId>       拒绝待审批动作
/cancel <taskId>         取消运行中任务
/skill <name> [args]     调用 skill
```

## 配置

全局配置：`~/.xiaok/config.json`
项目配置：`<repo>/.xiaok/settings.json`
快捷键：`~/.xiaok/keybindings.json`

## 开发

```bash
npm run build       # 构建
npm test            # 运行测试（582 个测试，132 个文件）
npm run test:watch  # 监听模式
npm run dev -- --help  # 从源码运行
```

## 更新日志

### v0.4.1 — 云之家网关加固
- HTTP 错误码细分：`YZJTransportError` 区分 401/403/429/5xx，带产品化诊断文本
- 429 限流指数退避重试（最多 3 次）
- 出站消息 try-catch 保护：发送失败不再导致入站处理崩溃
- Runtime notifier 发送失败改为日志记录

### v0.4.0 — 7 层 System Prompt 架构
- System prompt 重构为 7 个独立 section 函数，CC 风格静态/动态分界
- 新增 `assembler.ts` 作为 prompt 组装入口
- 动态 Session Guidance：权限模式、工具限制、Token Budget、MCP Instructions
- Memory 每 turn 注入（不仅 compact 后）
- 静态 section 用英文，提升模型稳定性和缓存效率

### v0.3.0 — 行为治理与安全加固
- Bash 命令安全分类器（block/warn/safe）
- 工具输入 JSON Schema 校验
- 内置 explore/plan/verification agent
- 增强 Hook 返回值（updatedInput、preventContinuation、additionalContext）

### v0.2.0 — 运行时加固与上下文智能
- API 指数退避重试（429/502/503/529）
- Skill allowed-tools 执行时生效
- 工具结果微压缩（8K 阈值）
- AI 驱动压缩 + NO_TOOLS_PREAMBLE 保护
- compact 后 Memory 回注
- 类型化 Memory 记录
- Prompt cache 静态/动态分段

## 许可

Private — 金蝶内部使用。
