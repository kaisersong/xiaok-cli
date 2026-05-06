# xiaok-cli

> xiaok-cli is a local-first AI task-delivery workbench. It turns user intent into finished results by matching skills, staging execution, and recovering when runs drift. Coding, document/report/slide generation, and optional channel adapters like Yunzhijia all run on the same runtime.

A local-first AI CLI for reliable skill execution across coding and document-heavy workflows.

[English](README.md) | [简体中文](README.zh-CN.md)

---

## Live Demo

**Benchmark Results (v0.7.0):**

| Metric | xiaok v0.7.0 | Claude Code | Improvement |
|--------|-------------|-------------|-------------|
| **Autonomy Score** | 100% | 100% | — |
| **Simple Q&A Latency** | 3.8s | 7.5s | **-49%** |
| **Rename Task Latency** | 27.6s | 180.8s | **-85%** |
| **Token Efficiency** | 100% | 250% | **-60%** |

**What's New in v0.7.0:**

- **Scheduled Tasks**: Create recurring tasks with flexible frequency (hourly, daily, weekly, cron)
- **Desktop App v0.5.0**: Native macOS app with sidebar, canvas preview, auto-update support
- **Compact Fix**: `/compact` now correctly preserves tool_use/tool_result pairs
- **UI Improvements**: "Recent tasks" label, selection highlighting, fixed race condition on task switching

**Typical Use Cases:**

1. Local terminal interactive chat: `xiaok`
2. Resume last session: `xiaok -c`
3. Single-shot task: `xiaok "review the changes"`
4. Generate reports, briefs, or slides through installed skills
5. Start local daemon: `xiaok daemon start`
6. Optional Yunzhijia / mobile access: `xiaok yzjchannel serve`, `/yzjchannel`

---

## Design Philosophy

### 1. Intent-First Task Delivery

xiaok is designed to feel like a task agent, not a workflow dashboard.

- Substantial requests are treated as intents with a deliverable, not just chat turns.
- Skills are matched against the current intent and stage, then re-ranked with runtime evidence.
- Multi-step work is staged internally so the user sees progress, not template mechanics.
- Final output should feel like delivered work, not a process transcript.

### 2. 7-Layer Prompt Architecture

System Prompt follows CC-style 7-layer design with explicit static/dynamic boundary:

**Static Prefix (cacheable, stable across turns):**

| Layer | Section | Content |
|-------|---------|---------|
| 1 | Intro | Role & identity — task-delivery AI skill workbench; Cosmic/Yunzhijia as domain strengths |
| 2 | System | Runtime rules — permission mode, prompt injection防护 |
| 3 | DoingTasks | Task philosophy — no extra features, read before edit |
| 4 | Actions | Risk boundary — destructive ops need confirmation |
| 5 | UsingTools | Tool grammar — read not cat, parallel calls |
| 6 | ToneAndStyle | Interaction style — concise, file_path:line_number |
| 7 | OutputEfficiency | Brevity — lead with answer, skip preamble |

**Dynamic Suffix (per-turn rebuild):**
- Session context, Session Guidance, Memory injection, Token Budget, Auto context

### 3. Safety First

**Bash Safety Classifier** (3 risk levels):

| Level | Commands | Behavior |
|-------|----------|----------|
| Block | `rm -rf /`, `mkfs`, `curl|sh` | Reject |
| Warn | `rm -rf`, `git reset --hard`, `DROP TABLE` | Require confirmation |
| Safe | Other commands | Execute directly |

**Tool Input Validation** — JSON Schema validator checks required fields and types before every tool call.

### 4. Stage-Scoped Context Management

Long tasks should not become one giant drifting transcript. xiaok keeps the full ledger in session state, but narrows the model context to the active stage:

1. **Microcompaction** — Tool results over 8K chars auto-truncated
2. **Fresh handoff** — completed stages can hand off artifacts into a fresh context instead of dragging the whole run forward
3. **Memory re-injection** — relevant memories re-injected after compact / handoff

### 5. Typed Memory

Persistent file-based memory store with type classification:

- `user` — User preferences, role, knowledge
- `feedback` — User corrections/confirmations
- `project` — Project progress, decisions, bugs
- `reference` — External resource pointers

### 6. Non-Invasive Multi-Agent Collaboration

Via Intent Broker lifecycle hooks:
- SessionStart / UserPromptSubmit / Stop
- session_id / transcript_path context injection
- auto-continue for multi-agent workflows

---

## Install

### Install from npm

```bash
npm install -g xiaokcode
```

Update to latest version:

```bash
npm update -g xiaokcode
```

After installation, run:

```bash
xiaok
```

The npm package name is `xiaokcode`, while the CLI command stays `xiaok`.

### From Source (Development)

```bash
git clone https://github.com/kaisersong/xiaok-cli ~/.xiaok-cli
cd ~/.xiaok-cli
npm install
npm run build
```

Use the source install path only if you are developing on `xiaok-cli` itself or need a local git-backed checkout.

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

## Desktop App

xiaok Desktop is a native macOS app that provides a GUI for the xiaok runtime. It shares the same backend as the CLI, but offers a sidebar for task history, canvas preview for generated files, and settings management.

### Download

Download from [GitHub Releases](https://github.com/kaisersong/xiaok-cli/releases):

- **xiaok-0.5.0-arm64.dmg** — macOS DMG installer (Apple Silicon)
- **xiaok-0.5.0-arm64-mac.zip** — macOS ZIP package (Apple Silicon)

### Features

- **Task Sidebar**: Browse recent tasks, switch between them with selection highlighting
- **Canvas Preview**: Auto-open generated files (HTML, MD, PDF) in a side panel
- **Scheduled Tasks**: Create recurring tasks (hourly, daily, weekly, cron)
- **Settings UI**: Configure model providers, skills, channels, MCP servers
- **Auto-Update**: Automatic update notifications when new versions are released

### Development

To build the desktop app locally:

```bash
cd desktop
npm install
npm run build
npx electron-builder --mac --arm64
```

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
xiaok yzjchannel serve
```

### In-Session Commands

```text
/exit                         Exit chat
/clear                        Clear the screen
/compact                      Compact the current conversation context
/context                      Show loaded repo context
/mode [default|auto|plan]     Show or switch permission mode
/models                       Switch model
/reminder <natural language>  Create a reminder
/reminder list                List reminders
/reminder cancel <id>         Cancel a reminder
/settings                     Show active CLI settings
/skills-reload                Reload installed skills
/yzjchannel                   Connect the embedded Yunzhijia channel
/help                         Show help
/<skill-name> [args]          Invoke a skill
```

### Yunzhijia IM Commands

```text
/help                    Show help
/bind <cwd>              Bind workspace
/bind clear              Clear workspace binding
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

**Yunzhijia Integration (optional channel adapter):**

```bash
# Configure
xiaok yzjchannel config set-webhook-url "https://..."

# Start gateway
xiaok yzjchannel serve

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
- **Structured skill contracts** — `required-references`, `required-scripts`, `required-steps`, and `success-checks`
- **Strict execution reliability** — execution bundles, evidence tracking, completion gates, and adherence evals

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
npm test            # Default sandbox + eval suite
npm run test:skill:fast     # Fast skill regression suite
npm run test:skill:release  # Release-only skill execution suite
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

**v0.6.21** — Terminal stdout EPIPE recovery and second-turn footer preservation: reproduced the installed-package failure from the user's transcript, where `[xiaok] UI 输出已停用：stdout_stream_error (Error: write EPIPE)` ended the scroll region and left follow-up `Thinking` frames without the input/status footer; stdout EPIPE now falls back to the original stderr stream instead of suspending the TUI, with a red/green injected-EPIPE chat runtime regression, a short-viewport `file:///... report-creator` follow-up test, the 26-scenario tmux E2E suite, and updated bugfix documentation covering the incorrect test approaches that missed this path.

**v0.6.20** — Terminal footer fallback ordering and stricter real-TTY invariants: fixed the non-scroll-region `TerminalFrame` path that rendered completed `Intent` summaries below the input prompt when footer lines contained `[summary,status]`, now rendering `summary -> two blank guard rows -> prompt -> status`; added a red regression for that exact order, hardened tmux E2E so any screen with `Intent` below the prompt or status not directly below the prompt fails, and documented the 12th footer/input fix round with the reason prior tests missed this path.

**v0.6.18** — Terminal soft-wrap follow-up and path-first intent recovery: reproduced the user's still-broken narrow terminal case in real tmux before changing code, fixed `MarkdownRenderer.flush()` so a streamed pending line that soft-wraps across multiple physical rows clears every occupied row before the formatted final render, fixed intent planning for work requests that start with an absolute local path such as `/Users/... 生成报告，然后生成幻灯片`, and added red/green markdown, planner, chat-runtime, and E2E regressions for those paths.

**v0.6.17** — Terminal footer gap closure and real-TTY regression hardening: eliminated the activity-only intermediate frame that could show `Finalizing response` without the input/status footer, increased the protected footer gap, fixed markdown wrapped-newline cursor accounting, truncated long footer status lines to one terminal row, and locked the screenshot-shaped failures with focused scroll-region regressions plus the 23-scenario real tmux E2E suite.

**v0.6.14** — Skill execution reliability and release-gated validation: upgraded strict skills from prompt-only instructions to structured contracts with required references/scripts/steps and success checks, added execution bundles plus runtime evidence/completion gating, persisted adherence outcomes for follow-up tuning, and split skill verification into a fast everyday suite plus a slower release-only suite for inline and fork strict execution paths.

**v0.6.8** — Windows tmux terminal stabilization and config-path consistency: stabilized the pending/permission footer in real Windows tmux by using a safer footer width budget and stronger permission-flow redraw assertions, made custom agents and skills resolve from the active `xiaok` config directory instead of a hardcoded home path, normalized install-source detection for Windows and npm-global layouts, and hardened Windows smoke-test temp cleanup retries.

**v0.6.7** — Permission approval transcript preservation and concrete command summaries: preserved renderer transcript rows around permission confirmations so recent tool lines stay visible, normalized permission-option styling so the menu text keeps a consistent weight, and changed generic bash `Ran` blocks to retain the concrete command instead of collapsing to a placeholder summary.

**v0.6.6** — Update command groundwork: added the first self-update foundation with install-source detection for git-backed checkouts, `npm link`, and npm-global `xiaokcode` installs, and locked the behavior down with a focused regression suite so later `xiaok update` work starts from a single normalized source-classification layer.

**v0.6.5** — Permission prompt cleanup, runtime control-plane groundwork, and local crash capture: fixed the non-renderer permission menu clear path so closing approvals no longer leaves title rows behind or erases adjacent transcript output, introduced a resolved provider/model/auth control plane before adapter construction, added session-store interface extraction plus a SQLite + FTS5 local session store foundation, and now writes crash reports for top-level chat/runtime failures.

**v0.6.4** — Terminal transcript preservation and input layout refinement: preserved the last assistant line across turns in the real tmux flow by returning separator writes to the tracked content cursor before appending the next submitted input, tightened real-terminal regression coverage for multiline reply tails, and shipped the content/input spacing polish with a thinner submitted-input block and a fuller input footer background.

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
