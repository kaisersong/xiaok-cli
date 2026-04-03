# xiaok-cli

English | [简体中文](./README.zh-CN.md)

An AI coding CLI for Kingdee Yunzhijia developers. Local terminal agent, extensible skill system, and Yunzhijia IM gateway — all sharing the same agent runtime.

## Highlights

- **Multi-model**: Claude and OpenAI adapters with automatic retry and exponential backoff (429/502/503/529)
- **Skill system**: Built-in, global, and project skills with dependency resolution and allowed-tools enforcement
- **Yunzhijia IM**: Same agent runtime accessible from mobile chat with async tasks, approvals, and workspace binding
- **Smart context management**: AI-driven compaction with NO_TOOLS_PREAMBLE protection, tool result microcompaction (8K char limit), and memory re-injection after compact
- **Prompt cache optimization**: Static/dynamic system prompt segmentation for higher cache hit rates on Claude models
- **Typed memory**: Persistent memory store with `user`/`feedback`/`project`/`reference` type classification and filtered retrieval
- **Platform runtime**: MCP/LSP plugin wiring, worktree isolation, background subagent execution, and durable channel state

## Quick Start

```bash
# Install and build
npm install
npm run build

# Start interactive mode
xiaok

# Run a single task
xiaok "review the current workspace changes"

# Start Yunzhijia IM gateway
xiaok yzj serve
```

## Requirements

- Node.js 20+
- A valid Claude or OpenAI API key
- Yunzhijia robot `sendMsgUrl` for IM access (optional)

## Architecture

```text
src/
  ai/          agent runtime, model adapters, tools, skills, memory
  auth/        auth and token storage
  channels/    channel gateways, task/approval/session abstractions
  commands/    CLI commands (chat, commit, review, pr, doctor, init, transcript)
  platform/    shared runtime: plugins, MCP, LSP, sandbox, teams, worktrees
  runtime/     runtime event hooks, tasking primitives
  ui/          terminal UI: streaming markdown, status bar, permission prompts
  utils/       config and helper utilities
```

The terminal CLI and Yunzhijia gateway share the same core agent runtime. Channel integrations are boundary adapters under `src/channels/`. Workspace state lives in `<cwd>/.xiaok/state`; gateway state in `~/.xiaok/state/yzj`.

## Agent Runtime

### Model Adapters

| Adapter | Features |
|---------|----------|
| Claude | Streaming, prompt caching, image input, exponential backoff retry (429/500/502/503/529) |
| OpenAI | Streaming, compatible with any OpenAI-compatible endpoint |

### Context Management

The runtime manages context through three layers:

1. **Microcompaction** — Tool results exceeding 8,000 characters are truncated before entering the context window
2. **AI-driven compaction** — When context reaches 85% capacity, an AI summarization call (with `NO_TOOLS_PREAMBLE` to prevent tool invocation during summary) replaces old messages. Falls back to local string truncation on failure
3. **Memory re-injection** — After compaction, referenced memory records are re-injected into the session so key context is not lost

### Prompt Cache Boundary

The system prompt is split into static and dynamic segments:

- **Static** (role definition, behavior rules): marked with `cache_control: ephemeral`, stable across turns
- **Dynamic** (cwd, enterprise context, auto-loaded docs): changes each turn, no cache marking

This separation maximizes prompt cache hit rates on Claude models.

### Skill System

Skills are markdown files with YAML frontmatter loaded from three tiers:

- Built-in: `data/skills/`
- Global: `~/.xiaok/skills/`
- Project: `<repo>/.xiaok/skills/`

Features:
- Dependency resolution with cycle detection
- `allowed-tools` frontmatter enforced at runtime — `ToolRegistry` blocks tools not in the skill's whitelist
- User-invocable skills via `/skill-name` slash commands
- Install/uninstall with automatic catalog reload

### Memory Store

Persistent file-based memory with typed records:

```typescript
type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

interface MemoryRecord {
  id: string;
  scope: 'global' | 'project';
  type?: MemoryType;
  title: string;
  summary: string;
  tags: string[];
}
```

Retrieval supports scope filtering (global vs project), keyword matching, and optional `typeFilter` for targeted queries.

### Permission System

Three-layer rule evaluation: global → project → session. Modes:

- **default**: safe tools auto-allowed, others prompt
- **auto**: all tools allowed
- **plan**: write/edit/bash denied

Interactive approval prompt with persisted rules and `y!` to switch to auto mode.

## CLI Commands

| Command | Description |
|---------|-------------|
| `xiaok` / `xiaok chat` | Interactive chat mode |
| `xiaok "task"` | Single-shot task execution |
| `xiaok chat --resume <id>` | Resume a previous session |
| `xiaok chat --json` | JSON output mode |
| `xiaok commit` | AI-assisted git commit |
| `xiaok review` | AI-assisted code review |
| `xiaok pr` | AI-assisted pull request |
| `xiaok doctor` | Check CLI and runtime health |
| `xiaok init` | Initialize project settings |
| `xiaok transcript <id>` | Analyze a recorded session |
| `xiaok yzj serve` | Start Yunzhijia IM gateway |

### In-Session Commands

```text
/mode [default|auto|plan]     Switch permission mode
/tasks                        List active tasks
/task <id>                    Show task details
/skill-name [args]            Invoke a skill
```

## Yunzhijia IM Gateway

```bash
# Configure
xiaok yzj config set-send-msg-url "https://www.yunzhijia.com/gateway/robot/webhook/send?..."
xiaok yzj config set-inbound-mode websocket

# Start
xiaok yzj serve
```

### IM Commands

```text
/help                    Show available commands
/bind <cwd>              Bind workspace directory
/status [taskId]         Check task status
/approve <approvalId>    Approve a pending action
/deny <approvalId>       Deny a pending action
/cancel <taskId>         Cancel a running task
/skill <name> [args]     Invoke a skill
```

Durable state (sessions, tasks, approvals, dedupe) persists across restarts. Interrupted tasks are marked as such on recovery.

## Configuration

Config file: `~/.xiaok/config.json` (override with `XIAOK_CONFIG_DIR`)

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
  "channels": {
    "yzj": {
      "sendMsgUrl": "https://...",
      "inboundMode": "websocket"
    }
  }
}
```

Project settings: `<repo>/.xiaok/settings.json` — permissions, hooks, UI preferences.

Keybindings: `~/.xiaok/keybindings.json` — custom terminal key mappings.

## Development

```bash
npm run build       # Build
npm test            # Run tests (550 tests across 130 files)
npm run test:watch  # Watch mode
npm run dev -- --help  # Run from source
```

## What's New in v0.2.0

- **API retry with backoff**: `ClaudeAdapter` retries overload/502/503/529 errors with exponential backoff (up to 3 retries, max 16s delay)
- **Skill allowed-tools enforcement**: `ToolRegistry.setAllowedTools()` blocks tools not declared in a skill's `allowed-tools` frontmatter
- **Tool result microcompaction**: Results exceeding 8,000 characters are truncated before entering the context window
- **AI-driven compact**: Context compaction uses an AI summarization call instead of local string truncation, with `NO_TOOLS_PREAMBLE` to prevent tool invocation during summary
- **Memory re-injection after compact**: Referenced memory records are re-injected into the session after compaction
- **Typed memory records**: `MemoryRecord` gains a `type` field (`user`/`feedback`/`project`/`reference`) with filtered retrieval via `typeFilter`
- **Prompt cache boundary**: System prompt split into static (cacheable) and dynamic segments for higher prompt cache hit rates

## License

Private — Kingdee internal use.
