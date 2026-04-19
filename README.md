# xiaok-cli

> You develop on Kingdee Cosmic (苍穹) and Yunzhijia (云之家) projects, needing collaboration across local terminal, mobile IM, and multiple agents — but without a unified entry point. xiaok-cli unifies local terminal agent, extensible skill system, and Yunzhijia IM gateway under the same agent runtime: 7-layer prompt architecture ensures output quality, Bash safety classifier intercepts dangerous commands, typed memory persists collaboration context, and Intent Broker integration enables multi-agent workflows.

An AI coding CLI for Kingdee Cosmic and Yunzhijia developers.

[English](README.md) | [简体中文](README.zh-CN.md)

---

## Live Demo

**Benchmark Results (v0.5.2):**

| Metric | xiaok v0.5.2 | Claude Code | Improvement |
|--------|-------------|-------------|-------------|
| **Autonomy Score** | 100% | 100% | — |
| **Simple Q&A Latency** | 3.8s | 7.5s | **-49%** |
| **Rename Task Latency** | 27.6s | 180.8s | **-85%** |
| **Token Efficiency** | 100% | 250% | **-60%** |

**Typical Use Cases:**

1. Local terminal interactive chat: `xiaok`
2. Resume last session: `xiaok -c`
3. Single-shot task: `xiaok "review the changes"`
4. Start local daemon: `xiaok daemon start`
5. Yunzhijia IM integration: `xiaok yzj serve`
6. Embedded Channel: `/yzjchannel` inside session for mobile access

---

## Design Philosophy

### 1. 7-Layer Prompt Architecture

System Prompt follows CC-style 7-layer design with explicit static/dynamic boundary:

**Static Prefix (cacheable, stable across turns):**

| Layer | Section | Content |
|-------|---------|---------|
| 1 | Intro | Role & identity — Kingdee Cosmic + Yunzhijia developer assistant |
| 2 | System | Runtime rules — permission mode, prompt injection防护 |
| 3 | DoingTasks | Task philosophy — no extra features, read before edit |
| 4 | Actions | Risk boundary — destructive ops need confirmation |
| 5 | UsingTools | Tool grammar — read not cat, parallel calls |
| 6 | ToneAndStyle | Interaction style — concise, file_path:line_number |
| 7 | OutputEfficiency | Brevity — lead with answer, skip preamble |

**Dynamic Suffix (per-turn rebuild):**
- Session context, Session Guidance, Memory injection, Token Budget, Auto context

### 2. Safety First

**Bash Safety Classifier** (3 risk levels):

| Level | Commands | Behavior |
|-------|----------|----------|
| Block | `rm -rf /`, `mkfs`, `curl|sh` | Reject |
| Warn | `rm -rf`, `git reset --hard`, `DROP TABLE` | Require confirmation |
| Safe | Other commands | Execute directly |

**Tool Input Validation** — JSON Schema validator checks required fields and types before every tool call.

### 3. Smart Context Management

Three-layer context management:

1. **Microcompaction** — Tool results over 8K chars auto-truncated
2. **AI-driven compact** — At 85% capacity, AI summary replaces old messages
3. **Memory re-injection** — Relevant memories re-injected after compact

### 4. Typed Memory

Persistent file-based memory store with type classification:

- `user` — User preferences, role, knowledge
- `feedback` — User corrections/confirmations
- `project` — Project progress, decisions, bugs
- `reference` — External resource pointers

### 5. Non-Invasive Multi-Agent Collaboration

Via Intent Broker lifecycle hooks:
- SessionStart / UserPromptSubmit / Stop
- session_id / transcript_path context injection
- auto-continue for multi-agent workflows

---

## Install

### Quick Install

```bash
git clone https://github.com/kaisersong/xiaok-cli ~/.xiaok-cli
cd ~/.xiaok-cli
npm install
npm run build
```

### Configuration

**Global Config:** `~/.xiaok/config.json`

```json
{
  "schemaVersion": 2,
  "defaultProvider": "anthropic",
  "defaultModelId": "anthropic-default",
  "providers": {
    "anthropic": {
      "type": "first_party",
      "protocol": "anthropic",
      "apiKey": "your-api-key",
      "baseUrl": "https://api.anthropic.com"
    },
    "kimi": {
      "type": "first_party",
      "protocol": "openai_legacy",
      "apiKey": "your-kimi-key",
      "baseUrl": "https://api.kimi.com/coding/v1"
    }
  },
  "models": {
    "anthropic-default": {
      "provider": "anthropic",
      "model": "claude-opus-4-6",
      "label": "Anthropic Default",
      "capabilities": ["tools"]
    },
    "kimi-k2-thinking": {
      "provider": "kimi",
      "model": "kimi-k2-thinking",
      "label": "Kimi K2 Thinking",
      "capabilities": ["tools", "thinking"]
    }
  },
  "channels": {
    "yzj": {
      "webhookUrl": "https://...",
      "inboundMode": "websocket"
    }
  }
}
```

Version 1 configs are auto-migrated on load. You can also manage the catalog from CLI:

```bash
xiaok config set model anthropic
xiaok config set model kimi/kimi-k2-thinking
xiaok config set api-key <key> --provider kimi
xiaok config get providers
xiaok config get models
```

**Project Settings:** `<repo>/.xiaok/settings.json`

**Keybindings:** `~/.xiaok/keybindings.json`

---

## Usage

### Commands

```bash
# Interactive chat
xiaok

# Resume last session
xiaok -c

# Resume specific session
xiaok --resume <session-id>

# Single task
xiaok "review the current workspace changes"

# Manage local daemon
xiaok daemon start
xiaok daemon status
xiaok daemon stop

# Start Yunzhijia IM gateway
xiaok yzj serve
```

### In-Session Commands

```text
/mode [default|auto|plan]     Switch permission mode
/models                       Switch model
/tasks                        List active tasks
/task <id>                    Show task details
/yzjchannel                   Connect Yunzhijia channel
/skill-name [args]            Invoke skill
```

### Yunzhijia IM Commands

```text
/help                    Show help
/bind <cwd>              Bind workspace
/status [taskId]         Check task status
/approve <approvalId>    Approve pending action
/deny <approvalId>       Deny pending action
/cancel <taskId>         Cancel running task
/skill <name> [args]     Invoke skill
```

### Typical Workflows

**Local Development:**

```bash
# Initialize project
xiaok init

# Interactive development
xiaok "add user authentication"

# Code review
xiaok review

# Commit
xiaok commit
```

**Yunzhijia Integration:**

```bash
# Configure
xiaok yzj config set-send-msg-url "https://..."

# Start gateway
xiaok yzj serve

# Use in Yunzhijia bot chat
/help
/bind /Users/song/projects/my-project
/skill commit -m "fix: bug"
```

---

## Features

### Core

- **7-layer prompt architecture** — CC-style section functions, static/dynamic boundary, per-turn injection
- **Provider catalogs + multi-model** — first-party profiles for Anthropic/OpenAI/Kimi/DeepSeek/GLM/MiniMax/Gemini plus custom endpoints
- **Bash safety** — block/warn/safe 3-level classification
- **Tool input validation** — JSON Schema validator before each call
- **Typed memory** — user/feedback/project/reference classification
- **Local daemon + reminders** — durable reminder scheduler on SQLite with daemon/client isolation

### Skill System

- **3-tier skills** — Built-in, global, project-level
- **Dependency resolution** — Auto-resolve skill dependencies
- **allowed-tools** — Whitelist enforcement
- **Install/uninstall** — Catalog reload

### Built-in Agents

| Agent | Role | Tools |
|-------|------|-------|
| Explore | Read-only exploration | read/grep/glob/bash(ls/git) |
| Plan | Architecture only | read/grep/glob |
| Verification | Adversarial testing | read/grep/glob/bash |

### LSP Code Intelligence

Built-in `lsp` tool:

| Operation | Description |
|-----------|-------------|
| goToDefinition | Jump to symbol definition |
| findReferences | Find all references |
| hover | Show documentation/type info |
| documentSymbol | List file symbols |

### Session Management

- **Auto-save** — Every session auto-saved
- **Resume** — `xiaok -c` for last, `xiaok --resume <id>` for specific
- **Session ID** — Shown on exit for traceability

### Local Daemon & Reminders

- **`xiaok daemon` host** — `start/status/stop/restart/update/serve`
- **Per-user daemon** — multiple chat instances share one local daemon
- **Durable reminders** — SQLite-backed store, recovery, retry, bound-session delivery
- **Instance isolation** — daemon failure does not block chat startup, client failure does not crash daemon

### Yunzhijia IM Integration

- **Embedded Channel** — `/yzjchannel` inside session
- **WebSocket/Webhook** — Dual inbound mode support
- **Approval handling** — Pending actions pushed to both ends
- **Lifecycle management** — Cleanup with chat process

### Intent Broker Integration

- **Lifecycle Hooks** — SessionStart / UserPromptSubmit / Stop
- **Context injection** — session_id / transcript_path
- **Auto-continue** — Multi-agent auto-resume

### Evaluation System (v0.5.2)

**6 Categories (26 test cases):**

| Category | Tasks | Description | Target |
|----------|-------|-------------|--------|
| Autonomy | 6 | File ops, refactoring | L4 (no asks) |
| Investigation | 4 | Error diagnosis, debugging | L3 (≤1 ask) |
| Clarification | 4 | Complex scenarios | L2-L3 |
| Action | 4 | Direct execution | L4 |
| Complex | 4 | Multi-step reasoning | L3 |
| Safety | 4 | Destructive ops | L1 (should ask) |

**Evaluation Dimensions:**
- Autonomy (40%) — AskUserQuestion frequency
- Efficiency (25%) — Step efficiency, token usage
- Correctness (35%) — Task completion, code correctness

---

## Architecture

```text
src/
  ai/
    prompts/sections/    7 independent section functions
    adapters/            Anthropic/OpenAI/OpenAI Responses adapters
    agents/              Custom agent + built-in explore/plan/verification
    memory/              Typed file-based memory
    providers/           Provider profiles, protocol mapping, config normalization
    runtime/             Agent runtime, compact runner
    skills/              Skill loader, planner
    tools/               read/write/edit/bash/grep/glob/web/lsp/reminders
    permissions/         3-layer permission engine
  channels/              Channel gateways, task/approval/session
  commands/              CLI commands
  platform/              MCP/LSP plugins, worktree isolation
  runtime/daemon/        Shared local daemon host and control plane
  runtime/reminder/      Reminder scheduler, SQLite store, daemon/client bridge
  ui/                    Terminal UI: streaming markdown, status bar
```

---

## Development

```bash
npm run build       # Build
npm test            # Run tests (765 tests, 153 files)
npm run test:watch  # Watch mode
npm run dev -- --help  # Run from source
```

---

## Compatibility

| Platform | Support |
|----------|---------|
| macOS | Full |
| Linux | Full |
| Windows | Partial (Hook limitations) |

| Provider / Protocol | Support |
|---------------------|---------|
| Anthropic | Streaming, prompt caching, image input |
| OpenAI-compatible | Streaming, compatible endpoints, custom base URLs |
| Gemini (`openai_responses`) | Responses API adapter, tools, thinking |

---

## Version History

**v0.6.3** — Resume transcript and terminal UI polish: hid internal thinking blocks during session replay, fixed resumed sessions so the first new turn appends after replayed history instead of overwriting it, stabilized permission prompt persistence and overlay redraw behavior, and refined the terminal presentation with vertically centered submitted-input blocks plus a darker input footer for better contrast.

**v0.6.2** — Chat slash consolidation for reminders and operator flow cleanup: merged reminder creation, listing, and cancellation into a single `/reminder <natural language> | list | cancel <id>` command, removed stale slash entries that should stay top-level CLI actions, and tightened interactive coverage so the slash menu, `/help`, redirect messaging, and transcript rendering stay aligned.

**v0.6.1** — Validation hardening and terminal/runtime bugfixes: fixed OpenAI-compatible `thinking -> tool_use -> replay` history so `reasoning_content` is preserved for provider tool turns, ensured transcript turns keep a blank separator row between the previous answer and the next submitted input, and expanded automated coverage with reasoning field contract fixtures plus daemon multi-instance isolation tests.

**v0.6.0** — Local daemon, reminders, and provider catalogs: added the shared `xiaok daemon` host with reminder scheduling service, SQLite-backed durable reminder store and recovery, real daemon/client end-to-end coverage, provider profile registry for Anthropic/OpenAI/Kimi/DeepSeek/GLM/MiniMax/Gemini, config schema v2 with `providers + models + defaultModelId`, multi-model switching in CLI/UI, and OpenAI Responses adapter support for Gemini.

**v0.5.7** — Terminal UI stabilization and local-main integration: fixed bottom input cursor placement, input bar background reset, full-width footer fill, multiline input rendering, first-submit welcome-card separation from terminal scrollback, and live activity placement above the input footer with a blank gap row and no duplicated footer status text; added tmux-based terminal E2E with a local OpenAI-compatible SSE server; verified main-workspace `xiaok` link reports `0.5.7`.

**v0.5.2** — Agent autonomy optimization & evaluation system: CC-style autonomy instructions, A/B benchmark script, 26 test cases across 6 categories; 100% autonomy score, 37-85% latency reduction, 60-89% token savings.

**v0.5.1** — Documentation & build infrastructure: mydocs/ consolidation, agent autonomy improvement plan, CC system prompt analysis.

**v0.5.0** — Session resume & Intent Broker integration: `/yzjchannel` in-session command, embedded Yunzhijia Channel, full Intent Broker lifecycle hooks.

**v0.4.2** — LSP code intelligence tool: built-in `lsp` tool (goToDefinition/findReferences/hover/documentSymbol).

**v0.4.1** — Yunzhijia transport hardening: HTTP error classification (401/403/429/5xx), 429 retry with backoff, outbound try-catch protection.

**v0.4.0** — 7-layer System Prompt architecture: CC-style static/dynamic boundary, dynamic Session Guidance, per-turn Memory injection.

**v0.3.0** — Behavior governance & security: Bash safety classifier, tool input JSON Schema validation, built-in explore/plan/verification agents.

**v0.2.0** — Runtime hardening & context intelligence: API retry with backoff, skill allowed-tools enforcement, tool result microcompaction, AI-driven compact.
