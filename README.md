# xiaok-cli

English | [简体中文](./README.zh-CN.md)

`xiaok-cli` is an AI coding CLI built for Kingdee Yunzhijia developers. It provides a local terminal agent, a skill system, and a Yunzhijia IM gateway so the same agent runtime can be used from both the terminal and mobile chat.

## What It Does

- Runs an interactive coding assistant in the terminal
- Supports Claude and OpenAI adapters
- Loads built-in, global, and project skills
- Executes file, search, and shell tools through a shared agent runtime
- Preserves sessions with resume and fork flows
- Auto-loads project instructions and git context into the runtime
- Supports print/json one-shot output, image input, and web fetch/search tools
- Connects to Yunzhijia IM through WebSocket or webhook
- Turns Yunzhijia messages into async tasks with status, approval, and workspace binding

## Current Capabilities

### Local CLI

- `xiaok` or `xiaok chat`
- interactive chat mode
- single-shot task mode
- `-p` / `--json` print modes
- `--resume <id>` / `--fork-session <id>`
- local image path input for multimodal models
- slash-triggered skills
- `/mode [default|auto|plan]`
- `/tasks`
- `/task <id>`
- tool execution with permission control
- `ask_user` tool for interactive operator questions
- session-scoped `task_create` / `task_update` / `task_list` / `task_get`
- model-aware context policy and prompt caching support
- auto-loaded `AGENTS.md`, `CLAUDE.md`, git branch, dirty state, and recent commits
- `web_fetch` / `web_search`
- shared truncation and pagination for read/glob/grep/bash output

### Yunzhijia IM Gateway

- `xiaok yzj serve`
- WebSocket inbound mode
- webhook fallback inbound mode
- async task creation for plain messages
- `/help`
- `/status [taskId]`
- `/cancel <taskId>`
- `/approve <approvalId>`
- `/deny <approvalId>`
- `/bind <cwd>`
- `/bind clear`
- `/skill <name> [args]`
- runtime progress notifications
- approval wait/resolve flow
- long-result summary formatting

## Requirements

- Node.js 20+
- Windows, macOS, or Linux
- a valid Claude or OpenAI API key
- Yunzhijia robot `sendMsgUrl` if you want IM access

## Install

```bash
npm install
npm run build
```

Run from source:

```bash
npm run dev -- --help
```

Run built CLI:

```bash
node dist/index.js --help
```

## Configuration

Config is stored in:

- Windows: `%USERPROFILE%\.xiaok\config.json`
- macOS/Linux: `~/.xiaok/config.json`

You can also override the config root with:

```bash
XIAOK_CONFIG_DIR=/path/to/config
```

Example config:

```json
{
  "schemaVersion": 1,
  "defaultModel": "claude",
  "models": {
    "claude": {
      "model": "claude-opus-4-6",
      "apiKey": "your-api-key"
    }
  },
  "defaultMode": "interactive",
  "contextBudget": 4000,
  "channels": {
    "yzj": {
      "sendMsgUrl": "https://www.yunzhijia.com/gateway/robot/webhook/send?...",
      "inboundMode": "websocket",
      "webhookPath": "/yzj/webhook",
      "webhookPort": 3001
    }
  }
}
```

## Authentication

The project includes auth commands and token storage for Yunzhijia-related flows. Depending on your setup, you will typically configure:

- model API keys in `config.json`
- Yunzhijia app identity and token storage for IM integration

## Basic Usage

Start interactive mode:

```bash
xiaok
```

Run one task:

```bash
xiaok "review the current workspace changes"
```

Show chat help:

```bash
xiaok chat --help
```

## Skills

Skills can be loaded from:

- built-in skill directories under `data/skills`
- global user skills under `~/.xiaok/skills`
- project skills under `<repo>/.xiaok/skills`

Examples:

```text
/review check whether current changes are safe to merge
/deploy prepare a release checklist
```

## Yunzhijia Gateway

Configure the Yunzhijia robot URL:

```bash
xiaok yzj config set-send-msg-url "https://www.yunzhijia.com/gateway/robot/webhook/send?..."
xiaok yzj config set-inbound-mode websocket
```

Inspect current config:

```bash
xiaok yzj config show
```

Start the gateway:

```bash
xiaok yzj serve
```

Or override the URL directly:

```bash
xiaok yzj serve "https://www.yunzhijia.com/gateway/robot/webhook/send?..."
```

Dry-run mode:

```bash
xiaok yzj serve "https://www.yunzhijia.com/gateway/robot/webhook/send?..." --dry-run
```

### Typical IM Commands

```text
/help
/bind D:\projects\workspace\xiaok-cli
check the current build failure
/status
/status task_3
/approve approval_2
/deny approval_2
/cancel task_3
/skill review evaluate the current diff
```

## Development

Build:

```bash
npm run build
```

Test:

```bash
npm test
```

Watch tests:

```bash
npm run test:watch
```

## Project Layout

```text
src/
  ai/          agent runtime, model adapters, tools, skills
  auth/        auth and token storage
  channels/    channel gateways, task/approval/session abstractions
  commands/    CLI commands
  runtime/     runtime event hooks
  ui/          terminal UI
  utils/       config and helper utilities
tests/
docs/
data/
```

## Architecture Notes

- The terminal CLI and Yunzhijia gateway share the same core agent runtime
- Channel integrations are implemented at the boundary layer under `src/channels`
- Shared tasking primitives live under `src/runtime/tasking`
- Yunzhijia and CLI workflow tasks are both in-memory for now
- Runtime events are reused for mobile-side progress notifications

## Known Limitations

- task state is process-local and not persisted across restarts
- `ask_user` is only available when the CLI is running interactively with a TTY
- the Yunzhijia integration currently focuses on text workflows, not rich cards
- in restricted Windows sandboxes, `vitest` may fail with `spawn EPERM`
- user config updates outside the workspace may require running commands locally

## Related Docs

- [YZJ remote-agent implementation record](./docs/analysis/2026-03-31-xiaok-yzj-remote-agent-implementation-record.md)
- [YZJ integration handoff](./docs/analysis/2026-03-31-xiaok-yzj-integration-handoff.md)
- [YZJ remote-agent plan](./docs/superpowers/plans/2026-03-31-xiaok-yzj-remote-agent.md)
- [YZJ remote-agent design](./docs/superpowers/specs/2026-03-31-xiaok-yzj-remote-agent-design.md)
