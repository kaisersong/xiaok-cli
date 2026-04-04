# xiaok-cli

English | [简体中文](./README.zh-CN.md)

An AI coding CLI for Kingdee Cosmic (苍穹) and Yunzhijia (云之家) developers. Local terminal agent, extensible skill system, and Yunzhijia IM gateway — all sharing the same agent runtime. Cosmic CLI and Yunzhijia CLI integration is in progress.

## Highlights

- **7-layer prompt architecture**: CC-style system prompt with independent section functions, static/dynamic boundary, and per-turn session guidance
- **Multi-model**: Claude and OpenAI adapters with automatic retry and exponential backoff (429/502/503/529)
- **Bash security**: Command safety classifier (block/warn/safe) prevents destructive operations like `rm -rf /`, fork bombs, and `curl|sh` pipe execution
- **Skill system**: Built-in, global, and project skills with dependency resolution and allowed-tools enforcement
- **Yunzhijia IM**: Same agent runtime accessible from mobile chat with async tasks, approvals, and workspace binding
- **Smart context management**: AI-driven compaction with NO_TOOLS_PREAMBLE protection, tool result microcompaction (8K char limit), and memory re-injection after compact
- **Built-in agents**: Explore (read-only), Plan (architecture-only), and Verification (adversarial testing) specialized agents
- **Typed memory**: Persistent memory store with `user`/`feedback`/`project`/`reference` type classification
- **Platform runtime**: MCP/LSP plugin wiring, worktree isolation, background subagent execution, and durable channel state
- **LSP tool**: Built-in `lsp` tool for code intelligence — go to definition, find references, hover docs, and document symbols

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
  ai/
    prompts/
      sections/    7 independent section functions (intro, system, doing-tasks, actions, using-tools, tone-and-style, output-efficiency)
      assembler.ts static/dynamic prompt assembly entry point
      builder.ts   PromptSnapshot generation with cache segmentation
    adapters/      Claude (with retry) and OpenAI model adapters
    agents/        custom agent loader + built-in explore/plan/verification agents
    context/       backward-compat yzj-context wrapper
    memory/        typed file-based memory store
    runtime/       agent runtime, compact runner, session graph, model capabilities
    skills/        skill loader, planner, tool integration
    tools/         read, write, edit, bash (with safety), grep, glob, web, skills, tasks, lsp
    permissions/   3-layer permission policy engine
  auth/            auth and token storage
  channels/        channel gateways, task/approval/session abstractions
  commands/        CLI commands (chat, commit, review, pr, doctor, init, transcript)
  platform/        shared runtime: plugins, MCP, LSP, sandbox, teams, worktrees
  runtime/         runtime event hooks (CC-aligned), tasking primitives
  ui/              terminal UI: streaming markdown, status bar, permission prompts
  utils/           config and helper utilities
```

## System Prompt Architecture

The system prompt follows a CC-style 7-layer design with explicit static/dynamic boundary:

### Static Prefix (cacheable, stable across turns)

| Layer | Section | Language | Content |
|-------|---------|----------|---------|
| 1 | Intro | Chinese | Role & identity — Kingdee Cosmic + Yunzhijia developer assistant |
| 2 | System | English | Runtime reality — permission mode, system-reminder tags, prompt injection awareness, context compression |
| 3 | DoingTasks | English | Task philosophy — no unnecessary features, read before edit, no time estimates, OWASP awareness |
| 4 | Actions | English | Risk boundary — destructive/hard-to-reverse/shared-state confirmation rules |
| 5 | UsingTools | English | Tool grammar — read not cat, edit not sed, glob not find, parallel when independent |
| 6 | ToneAndStyle | English | Interaction style — no emoji, concise, file_path:line_number format |
| 7 | OutputEfficiency | English | Brevity — lead with answer, skip preamble, one sentence over three |

### Dynamic Suffix (per-turn, not cached)

| Section | Condition |
|---------|-----------|
| Session context | Always — cwd, enterprise, devApp |
| Skills list | When skills installed |
| Session guidance | Per-turn — permission mode, active tool restrictions, tool count |
| MCP instructions | When MCP servers connected |
| Memory | Per-turn — top-K relevant memories (not just after compact) |
| Token budget | Always — remaining context window with simplification hint |
| Deferred tools | When available |
| Agents / Plugins / LSP | When configured |
| Auto context | Always — CLAUDE.md, AGENTS.md, git state |
| API overview + CLI help | Budget-managed — API overview priority over CLI help |

Each static section is an independent function in `src/ai/prompts/sections/`, testable and modifiable in isolation.

## Agent Runtime

### Model Adapters

| Adapter | Features |
|---------|----------|
| Claude | Streaming, prompt caching, image input, exponential backoff retry (429/500/502/503/529) |
| OpenAI | Streaming, compatible with any OpenAI-compatible endpoint |

### Context Management

Three-layer context management:

1. **Microcompaction** — Tool results exceeding 8,000 characters are truncated before entering the context window
2. **AI-driven compaction** — When context reaches 85% capacity, an AI summarization call (with `NO_TOOLS_PREAMBLE`) replaces old messages. Falls back to local truncation on failure
3. **Memory re-injection** — After compaction, referenced memory records are re-injected into the session

### Bash Security

Command safety classifier (`src/ai/tools/bash-safety.ts`) with three risk levels:

- **Block** (rejected): `rm -rf /`, `mkfs`, `dd if=`, fork bombs, `curl|sh` pipe execution, `chmod -R 777 /`
- **Warn** (needs confirmation): `rm -rf`, `git reset --hard`, `git push --force`, `DROP TABLE`, `kill -9`
- **Safe**: all other commands

### Tool Input Validation

Lightweight JSON Schema validator runs before every tool call — checks required fields and type constraints. Unknown fields are allowed (model may pass extra params).

### LSP Tool

The `lsp` tool provides code intelligence backed by a language server. Configure LSP servers in `.xiaok/plugins/` and the tool becomes available automatically.

| Operation | Description |
|-----------|-------------|
| `goToDefinition` | Jump to where a symbol is defined |
| `findReferences` | List all references to a symbol |
| `hover` | Show documentation / type info at a position |
| `documentSymbol` | List all symbols in a file |

All operations take `file_path`, `line`, and `character` (1-based). The tool converts to LSP 0-based coordinates internally.

### Built-in Agents

| Agent | Role | Tools |
|-------|------|-------|
| Explore | Read-only code exploration — no file creation/modification | read, grep, glob, bash (ls/git only) |
| Plan | Architecture only — outputs step-by-step plans without editing | read, grep, glob |
| Verification | Adversarial testing — tries to break code, outputs PASS/FAIL/PARTIAL | read, grep, glob, bash |

### Skill System

Skills are markdown files with YAML frontmatter loaded from three tiers:

- Built-in: `data/skills/`
- Global: `~/.xiaok/skills/`
- Project: `<repo>/.xiaok/skills/`

Features: dependency resolution, `allowed-tools` enforcement, slash commands, install/uninstall with catalog reload.

### Hook System

Pre/post tool hooks with structured JSON return values:

- `updatedInput` — modify tool input before execution
- `preventContinuation` — stop the agent loop after this tool
- `additionalContext` — append context to the tool result

Hooks support CC-aligned event types: PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, SessionStart, SessionEnd, and more.

### Permission System

Three-layer rule evaluation: global → project → session. Modes: default (prompt), auto (allow all), plan (deny writes). Interactive approval with persisted rules.

### Memory Store

Persistent file-based memory with typed records (`user`/`feedback`/`project`/`reference`). Retrieval supports scope filtering, keyword matching, and `typeFilter`.

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
npm test            # Run tests (582 tests across 132 files)
npm run test:watch  # Watch mode
npm run dev -- --help  # Run from source
```

## Changelog

### v0.4.2 — LSP Code Intelligence Tool
- `lsp` built-in tool: go-to-definition, find-references, hover, document-symbols
- LSP client extended with full query methods (`goToDefinition`, `findReferences`, `hover`, `documentSymbols`)
- `PlatformRuntimeContext` exposes `lspClient` for use by tools
- `registry-factory` registers `lsp` tool automatically when an LSP server is connected
- Fixed pre-existing `yzj-runtime-notifier` type errors (`void | Promise<void>` catch)
- 34 tests covering LSP tool operations, location formatting, and error paths

### v0.4.1 — Yunzhijia Transport Hardening
- HTTP error classification: `YZJTransportError` with separate handling for 401/403/429/5xx
- 429 rate-limit retry with exponential backoff (up to 3 retries)
- Outbound message try-catch protection: delivery failures no longer crash inbound processing
- Runtime notifier send failures logged instead of propagated
- 582 tests passing across 132 files

### v0.4.0 — 7-Layer System Prompt Architecture
- System prompt refactored into 7 independent section functions with CC-style static/dynamic boundary
- New `assembler.ts` as prompt assembly entry point
- Dynamic session guidance: permission mode, tool restrictions, token budget, MCP instructions
- Memory injected every turn (not just after compact)
- Static sections in English for model stability and cache efficiency

### v0.3.0 — Behavior Governance & Security Hardening
- Bash command safety classifier (block/warn/safe)
- Tool input JSON Schema validation
- Built-in explore/plan/verification agents
- Enhanced hook return values (updatedInput, preventContinuation, additionalContext)
- CC-aligned hook event types

### v0.2.0 — Runtime Hardening & Context Intelligence
- API retry with exponential backoff (429/502/503/529)
- Skill allowed-tools enforcement
- Tool result microcompaction (8K char limit)
- AI-driven compact with NO_TOOLS_PREAMBLE
- Memory re-injection after compact
- Typed memory records
- Prompt cache boundary (static/dynamic segments)

## License

Private — Kingdee internal use.
