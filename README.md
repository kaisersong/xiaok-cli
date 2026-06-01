# xiaok-cli

> xiaok-cli is a local-first AI task-delivery workbench. It turns user intent into finished results by matching skills, staging execution, and recovering when runs drift. Coding, document/report/slide generation, and optional channel adapters like Yunzhijia all run on the same runtime.

A local-first AI CLI for reliable skill execution across coding and document-heavy workflows.

[English](README.md) | [简体中文](README.zh-CN.md)

---

## Live Demo

**Benchmark Results:**

| Metric | xiaok v1.0.0 | Claude Code | Improvement |
|--------|-------------|-------------|-------------|
| **Autonomy Score** | 100% | 100% | — |
| **Simple Q&A Latency** | 3.8s | 7.5s | **-49%** |
| **Rename Task Latency** | 27.6s | 180.8s | **-85%** |
| **Token Efficiency** | 100% | 250% | **-60%** |

**What's New in v1.3.12:**

- **Parallel Dynamic Workflow Scripts**: Xiaok Desktop now supports the first parallel dynamic workflow script path. Trusted workflow scripts can use `parallel([() => agent(...), ...])` to fan out independent agent branches while keeping orchestration outside the main conversation.
- **Durable KSwarm Parallel State**: `parallel()` no longer exists only as an in-memory `Promise.all`. KSwarm persists `parallelGroups`, branch node metadata, and `scriptCheckpoints`, so project detail, logs, and API snapshots can explain which branches ran and how they completed.
- **Conversation Preview Before Run**: The `run_dynamic_workflow_script` tool now supports `previewOnly`, allowing the assistant to generate a workflow preview for user confirmation before starting the run. Confirmed runs start in the background and immediately return a `workflowRunId`.
- **Professional Report Review Template**: The tool now ships a `report_final_review` script template that runs fact, evidence, and format/contract review branches in parallel, then reduces them into a final gate recommendation.
- **Failure Policy Foundations**: Parallel runtime now supports `required_all`, `collect_errors`, and `quorum` semantics, with KSwarm quorum group reduction covered by workflow tests.
- **Workflow Status Visibility**: Project workflow details now show parallel groups, branch completion counts, failure policy, branch labels, and script checkpoint progress from KSwarm snapshots instead of inferring state from the chat transcript.
- **Focused Test, E2E, and Eval Coverage**: The release covers parser rejection for eager parallel calls, runtime branch annotation, KSwarm parallel group persistence, HTTP contract routing, background tool startup, a dynamic workflow eval case, and an end-to-end dynamic workflow script that completes through KSwarm and the desktop runtime bridge.

This is a foundation release for dynamic workflow orchestration, not a full user-authored workflow platform yet. Script job recovery across app restarts, broader negative E2E coverage, and comparative professional quality evals remain staged follow-up work.

**What's New in v1.3.11:**

- **Basic Dynamic Workflow Script Runtime**: Xiaok Desktop can now run a trusted dynamic workflow script through KSwarm, Intent Broker, and the Desktop agent runtime bridge. The script can create phases, fan out `agent(...)` calls, collect node outputs, and complete a durable `script_generated` workflow run
- **Real Agent Node Execution**: Script-generated workflow agent nodes now execute the node prompt itself instead of falling back to project diagnosis. Ordinary `script-agent-*` nodes receive an artifacts directory, write real files, and return structured artifact manifests
- **Project Delivery Synchronization**: When a script workflow completes, KSwarm can deliver the project from the final artifact-producing agent node, mark the board tasks done, and attach deliverable provenance to the project and task results
- **Output Contract Guardrails**: Dynamic workflows no longer treat markdown/json side output as sufficient when the final task requires HTML. Missing required terminal outputs block project delivery with explicit `missing` details instead of silently marking the project complete
- **End-to-End Workflow Coverage**: The release includes a real E2E test that starts Intent Broker and KSwarm, registers a desktop worker through the runtime bridge, runs a dynamic script workflow, creates dynamic agent nodes, writes an artifact, and verifies project delivery plus task-board completion

**What's New in v1.3.10:**

- **Project-Level High Quality Workflow**: High Quality execution is now a project-scoped `po-generated-project-workflow` run. One workflow owns planning, dispatch, review, and final synthesis for the project deliverable instead of starting isolated task-level workflow runs
- **Execution Mode Propagation**: Fast, Smart, and High Quality execution modes stay on the project contract and are carried into KSwarm dispatch, so a High Quality project no longer silently falls back to quick worker prompts
- **Artifact-First Workflow Gates**: Workflow finalization now rejects missing, unreadable, outside-workspace, or non-file task artifacts. Evidence references are rebuilt from submitted files, so a workflow only passes when a real deliverable is attached
- **Desktop Workflow Verification Fixes**: Workflow approval, reviewer diagnosis, and final status display were hardened. Reviewer dialogs use solid backgrounds, hide internal budget/permission/max-node fields, and workflow runs end in readable running/completed/failed states

**What's New in v1.3.9:**

- **Task-Level Dynamic Workflow**: Project task cards now expose "Run with Workflow" for task-scoped execution. KSwarm creates a pending workflow proposal with `scope.taskId`, source task metadata, budget hard limits, permissions, and acceptance rubric before any agent is dispatched
- **Controlled PO-Generated Workflow Proposals**: The first `po-generated-task-workflow` path validates a PO-authored workflow IR for a task, shows the proposal in a confirmation card, and only starts the run after user approval. This is deliberately validated IR, not raw JavaScript execution
- **Budget, Cache, Recovery, and Progress Visibility**: Workflow runs now show budget hard caps, last material progress, blocking failures, run-internal stored node results, and recovery mode in the project workflow detail panel
- **Workflow UX Hardening**: Workflow menus and dialogs keep opaque backgrounds, stay in the project tab row instead of becoming a large top panel, and logs remain the fused Swarm + Workflow timeline

**What's New in v1.3.8:**

- **Basic Dynamic Workflow**: Xiaok Desktop now ships the first project-level dynamic workflow path in KSwarm. Projects can create durable workflow runs, execute built-in quick diagnosis, and launch an agent-backed review diagnosis that routes through a Worker agent, an adversarial Reviewer agent, and a review gate reducer
- **Workflow-Orchestrated Agent Mode**: The project control layer stays in KSwarm while workflow execution happens at the agent layer, giving Xiaok two clear project execution paths: quick/direct orchestration for lightweight project control, and workflow orchestration for structured multi-step agent runs
- **Workflow Logs in Project Timeline**: The project detail page keeps the tab as "Logs", adds one clear "Run Workflow" menu, and fuses `Workflow` and `Swarm` events into the same chronological timeline without duplicating raw `workflow.*` activity events
- **Dynamic Workflow Roadmap Docs**: The design docs now spell out the staged evolution toward a fuller dynamic workflow engine, including budget confirmation, resumable subagent caching, typed progress aggregation, and reviewer/adversarial agent gates

**What's New in v1.3.7:**

- **Slide Renderer Recovery**: Packaged Desktop installs now replace stale symlinked bundled plugins with the packaged `kai-slide-creator`, preventing old development plugin directories or wrong-platform wheelhouses from breaking `slide-renderer` MCP startup

**What's New in v1.3.6:**

- **Auto Mode Guardrails**: `/mode auto` now auto-approves only low-risk tool calls. High-risk Bash commands still require confirmation, and catastrophic commands remain blocked
- **CUA Attribution Fix**: Desktop no longer runs `cua-driver doctor` from Xiaok health checks, preventing Xiaok itself from triggering macOS Screen Recording prompts
- **Computer Use Shell Lockdown**: Tasks can no longer self-start or repair CUA through Bash commands such as `open -a CuaDriver`, `cua-driver serve`, socket deletion, `screencapture`, `cliclick`, or UI-driving `osascript`
- **Interactive Shell Handoff**: Local shell escapes pause and resume the terminal UI cleanly so interactive commands do not corrupt the chat input state
- **CUA Recovery Hardening**: Computer Use daemon stale-state recovery is covered by focused tests and keeps recovery inside the product-managed CUA flow

**What's New in v1.3.5:**

- **Computer Use Enablement**: `xiaok_computer_use` is now a stable product tool. When CUA is not ready it returns structured recoverable errors and the chat UI shows an inline Computer Use action card instead of exposing raw MCP failures
- **CUA Permission and Recovery Flow**: Desktop now separates first-time user enablement from later auto-recovery, launches CUA through `CuaDriver.app` for correct macOS TCC attribution, detects empty capture output, and only auto-recovers on trusted packaged installs
- **Targeted Plugin Reconnect**: Enabling Computer Use only reconnects the `cua-driver` MCP server and no longer restarts report or slide renderer plugins
- **Shell Fallback Guardrails**: Screen automation fallbacks such as `screencapture`, `cliclick`, `cua-driver`, and UI-driving `osascript` now require approval instead of silently bypassing Computer Use
- **Packaged Runtime Reliability**: KSwarm and Intent Broker background services now use the packaged Electron runtime as Node when needed, so installed apps do not depend on a user shell `node` in `PATH`
- **Desktop Update and Branding Fixes**: Update installation now marks the app as quitting before `quitAndInstall`, reports install errors, and packaged macOS dock icons prefer the bundle `icon.icns`
- **Build Loop and Smoke Coverage**: Desktop packaging keeps clean builds for release while preserving incremental `build:main` for development; the smoke suite covers 84 files and 587 tests

**What's New in v1.3.4:**

- **Swarm Project Reliability**: KSwarm projects now route Xiaok seed PO/Worker work into the real Desktop agent runtime instead of a reduced sidecar worker, preserving model, tool, MCP, web-search, report, and slide capabilities
- **File-Based Handoff**: Large task context and artifact contracts are passed through handoff files instead of long broker text payloads, reducing truncation and making project resume/retry auditable
- **Evidence-Aware Planning and Review**: Recent/monthly research tasks carry current-date guidance, external-source evidence requirements, and calibrated quality gates so PO review does not demand future or arbitrary item counts
- **User-Facing Deliverables**: Final project outputs use formal project/goal-based filenames, keep review notes out of submit-ready artifacts, and prefer report/slide renderers when the user asks for reports or presentations
- **Desktop Project UX Fixes**: Project cards, task boards, artifact lists, HTML preview, scheduled recovery tasks, and agent status indicators now expose clearer state, timestamps, failures, and recoverable actions
- **Release Packaging Sync**: Desktop release builds now require the current Xiaok, KSwarm, Intent Broker, and bundled plugin sources to be checked out and packaged together

**What's New in v1.3.2:**

- **Desktop Update Recovery**: Fixed the `electron-updater` CJS/ESM interop bug that made "Check for Updates" silently do nothing in affected desktop builds
- **Proactive Upgrade Reminder**: The sidebar footer now shows a clear upgrade/download/install reminder next to the Settings icon when a new desktop version is available
- **Scheduled Task Recovery**: Desktop scheduled tasks now heal missing `nextRunAt`, keep auto-run results linked to their task thread, and remove deleted tasks from the main-process scheduler state
- **KSwarm Plan Retry Reassignment**: "重新制定计划" now checks whether the stored PO is missing, archived, invalid, stale, or the legacy `xiaok` singleton; it reassigns to the best Xiaok PO and sends the full project context before restarting planning
- **Release Guardrail**: Desktop release CI now marks the desktop tag as GitHub Latest and verifies `latest-mac.yml`, `latest.yml`, and installer assets before a release is considered valid
- **Manual One-Time Recovery**: Desktop `0.5.6` and `1.3.1` can have the broken updater loader locally, so affected users must install `1.3.2` manually once; future updates can then use the in-app updater

**What's New in v1.3.1:**

- **KSwarm Reliability Release**: Runtime health probing, stalled-run watchdogs, capability-aware routing, and automatic cooldown for agents that are online but cannot execute correctly
- **Recoverable Project Planning**: If Xiaok/Desktop or the PO agent stops while a project plan is being drafted, the project detail page exposes "重新制定计划" so work can continue instead of getting stuck
- **Deliverable Contracts**: Explicit PPTX/HTML/Markdown requests are validated before PO review; markdown-only output no longer passes as a slide deck
- **Local Executor Registry**: Explicit PPTX presentation tasks can fall back to a deterministic registered executor when no healthy agent advertises PPTX output capability
- **Desktop Configuration Preservation**: Desktop launch and release flow are aligned around the real user HOME so model, skill, plugin, and channel settings remain visible
- **Release Packaging Refresh**: macOS and Windows desktop artifacts are built from the same 1.3.1 source and plugin bundle baseline

**What's New in v1.2.0:**

- **KSwarm Swarm-Style Projects**: Create multi-agent collaborative projects from chat — Agent auto-selects PO + members, distributes tasks, and delivers as a team
- **Long-Term Memory**: Agent remembers user preferences, names, and habits across sessions via `notebook_write`/`notebook_read` tools
- **Memory Management UI**: View, add, and delete persistent memories from the Settings panel
- **Agent Settings Panel**: Configure agent persona, spawn profiles, and LLM provider bindings per agent
- **Model Config Enhancements**: Improved provider settings with protocol selection and advanced JSON config support
- **Smarter Task Delivery**: Progress reporting with step-by-step TaskPanel, agent autonomously plans and tracks multi-step work

**What's New in v1.1.0:**

- **Artifact Canvas Editing**: Click "修订" on HTML previews to annotate elements, send edit instructions to Agent with full DOM context
- **Auto-refresh Preview**: Canvas preview automatically reloads when Agent modifies the artifact file
- **Artifact Cards**: Claude-style file cards with type icon, title, and "打开" button for clear artifact identification
- **Welcome Page Revamp**: Personalized typewriter greeting, quick-start prompt pills for enterprise workflows
- **Profile Settings**: Editable display name and avatar in General Settings (localStorage, with system username fallback)
- **Plugin Bundling Design**: Complete plugin lifecycle spec for desktop distribution (esbuild + Python venv)

**What's New in v1.0.0:**

- **Full i18n Support**: Complete Chinese/English internationalization across all desktop UI components with runtime locale switching
- **KSwarm Multi-Agent**: Orchestrate multiple AI agents collaboratively on complex tasks with status monitoring
- **Project Management**: Kanban board, requirement tracking, agent assignment, activity timeline, and deliverable views
- **Scheduled Tasks**: Create recurring tasks with cron expressions, pause/resume, and automatic execution
- **Plugin System**: Install, manage, and configure MCP server plugins from GitHub or local sources
- **Desktop v1.0.0**: Native macOS/Windows app with sidebar, canvas preview, settings UI, and auto-update

**Typical Use Cases:**

1. Local terminal interactive chat: `xiaok`
2. Resume last session: `xiaok -c`
3. Single-shot task: `xiaok "review the changes"`
4. Generate reports, briefs, or slides through installed skills
5. Start local daemon: `xiaok daemon start`
6. Optional Yunzhijia / mobile access: `xiaok yzjchannel serve`, `/yzjchannel`

---

## Swarm Projects

xiaok Desktop includes KSwarm project delivery for work that needs planning, parallel execution, review, and final synthesis. A project has a human-approved plan, a PO agent, worker agents, a task board, artifacts, and final deliverables.

### Basic Dynamic Workflow

v1.3.12 expands the basic dynamic workflow capability on top of KSwarm projects. This is not yet a general user-authored workflow builder, but it is a real durable workflow runtime slice:

- **Durable workflow runs**: KSwarm records workflow runs with phases, nodes, status, progress, gate decisions, and timestamps so Desktop can refresh, resume display, and audit what happened.
- **Quick diagnosis workflow**: a built-in control workflow inspects project state, blockers, dispatchable tasks, and recommended next actions without calling an agent.
- **Agent-backed review diagnosis**: Xiaok can launch a structured workflow that dispatches a Worker agent for project diagnosis, sends the result to a Reviewer/PO agent for adversarial review, then reduces the review decision through a gate.
- **Project-level High Quality workflow**: High Quality project execution creates a single `po-generated-project-workflow` run at project scope. The workflow owns task dispatch, review gates, and final deliverable submission instead of fragmenting the project into unrelated task-level workflows.
- **Task-level manual workflow execution**: task cards can still open a `po-generated-task-workflow` proposal for the selected task when the user explicitly wants to re-run or inspect one task. The proposal is task-scoped, budgeted, permission-bounded, and requires confirmation before dispatch.
- **Controlled PO-generated proposals**: KSwarm can generate a validated workflow IR from project/task context. The current version is a controlled template that proves the proposal and approval path; it does not execute raw model-authored JavaScript or arbitrary user scripts.
- **Controlled dynamic script execution**: trusted model-authored workflow scripts can run through a restricted desktop runtime. Scripts can create phases, call `agent(...)`, use thunk-based `parallel(...)`, return terminal results, or block the run with a structured reason.
- **Durable parallel orchestration**: parallel script branches are persisted as KSwarm `parallelGroups`, with branch node identity, fan-out labels, required/schema/evidence metadata, and script checkpoints. Xiaok can show parallel progress without relying on chat transcript state.
- **Conversation-first preview**: the dynamic script tool can return a `previewOnly` workflow plan before starting a run. After confirmation, the run starts in the background and returns a `workflowRunId` for snapshot-based status checks.
- **Professional report final review**: the bundled script example shows a real professional workflow shape: inventory the deliverable, run fact/evidence/format-contract checks in parallel, then reduce the result into a final gate recommendation.
- **Artifact-first delivery gates**: completed workflow tasks must submit readable in-workspace files or valid artifact references. Finalization rebuilds evidence from those files and blocks delivery when artifacts are missing, unreadable, outside the workspace, or only textual summaries.
- **Budget, cache, recovery, and progress UI**: workflow details show hard budget caps, last material progress, blocking failures, run-internal stored node results, and the recovery mode for resumable runs.
- **Clear UI semantics**: the right-side action is now one "Run Workflow" menu, while the project tab remains "Logs" because it contains both Swarm and Workflow activity.
- **Fused log timeline**: Workflow runs and Swarm activity share one chronological project log, with source tags instead of separate top-level sections.

This establishes the product direction for dynamic workflow in Xiaok: KSwarm remains the project control layer, while workflow orchestration runs at the agent layer and can evolve from today's built-in and controlled PO-generated workflows toward richer, dynamically generated execution plans.

The v1.3.4 Swarm path is designed around clear responsibility boundaries:

- **KSwarm owns project lifecycle**: project state, plan approval, phase dispatch, task status, retries, review records, delivery manifests, and recovery decisions.
- **Agents own task execution**: Xiaok PO/Worker seed agents run through the full Desktop agent runtime, while external agents such as Claude, Codex, or Qoder run through their own broker-compatible adapters.
- **Renderers own formal output**: report and slide requests should produce renderer-backed HTML artifacts when available; Markdown/PPTX are only forced when the user explicitly asks for those formats.
- **Artifacts are the source of truth**: completed tasks must submit real files or referenced artifacts, not just textual summaries.
- **Quality gates are contextual**: hard gates cover objective contracts such as missing artifacts, wrong output type, missing source evidence, or invalid renderer shell; content expectations such as "how many market updates are enough" are guided by project-type knowledge instead of global hardcoded thresholds.

This makes Swarm projects suitable for research reports, product analysis, technical talk preparation, document production, and other multi-step deliverables where users need visible progress and recoverable execution.

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

- **xiaok-1.3.10-arm64.dmg** — macOS DMG installer (Apple Silicon)
- **xiaok-1.3.10-arm64-mac.zip** — macOS ZIP package (Apple Silicon)
- **xiaok-setup-1.3.10.exe** — Windows installer (x64)

### Features

- **Task Sidebar**: Browse recent tasks, switch between them with selection highlighting
- **Canvas Preview**: Auto-open generated files (HTML, MD, PDF) in a side panel
- **Project Management**: Kanban board with drag-and-drop, agent assignment, activity timeline
- **KSwarm Multi-Agent**: Create, approve, recover, review, and deliver multi-agent projects from the UI
- **Basic Dynamic Workflow**: Run project quick diagnosis, agent-backed review diagnosis, project-scoped High Quality workflows, and task-scoped manual workflow proposals as durable workflow runs with budget, cache, recovery, progress, Reviewer, artifact, and gate metadata
- **Scheduled Tasks**: Create recurring tasks (hourly, daily, weekly, cron)
- **Plugin System**: Install and manage MCP server plugins with enable/disable controls
- **i18n**: Full Chinese/English support with runtime locale switching
- **Settings UI**: Configure model providers, skills, channels, MCP servers
- **Auto-Update**: Automatic update notifications when new versions are released, with a sidebar upgrade reminder next to Settings

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

`auto` mode auto-approves low-risk tool calls. It still asks for confirmation before high-risk Bash commands such as recursive deletion, hard resets, force pushes, database drops, and screen-automation shell fallbacks. Catastrophic Bash commands remain blocked by the Bash safety classifier.

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

**v1.3.10** — Project-level workflow release: High Quality execution now creates one `po-generated-project-workflow` at project scope, so planning, task dispatch, review, and final synthesis are owned by the workflow for the whole project. Fast/Smart/High Quality execution mode is preserved through KSwarm dispatch. Workflow delivery is artifact-first: finalization rejects missing, unreadable, outside-workspace, or non-file artifacts and rebuilds evidence references from submitted files before the project can be delivered. Desktop workflow approval and reviewer diagnosis dialogs were hardened, and workflow runs now show readable running/completed/failed states.

**v1.3.9** — Task-level dynamic workflow release: project task cards can create `po-generated-task-workflow` proposals scoped to the selected task, with visible source task, budget hard caps, permissions, and acceptance rubric before dispatch. Workflow run details now show hard budget limits, last material progress, blocking failures, run-internal stored node results, and recovery mode. The PO-generated path uses validated workflow IR rather than raw JavaScript, keeping KSwarm as the control plane and agent runtimes as the execution layer.

**v1.3.8** — Basic dynamic workflow release: KSwarm projects now have durable workflow runs, built-in quick diagnosis, and an agent-backed review diagnosis path that routes through Worker diagnosis, adversarial Reviewer/PO review, and a gate reducer. Desktop exposes this as one "Run Workflow" menu while keeping project activity under the "Logs" tab, fusing `Workflow` and `Swarm` events into one chronological timeline and filtering duplicate raw workflow activity events. The accompanying design docs define the staged path toward a fuller dynamic workflow engine with budget prompts, subagent result caching, progress aggregation, and reviewer fleets.

**v1.3.7** — Slide renderer hotfix: packaged Desktop installs now replace stale symlinked bundled plugins with the packaged `kai-slide-creator`, preventing old development plugin directories or wrong-platform wheelhouses from breaking `slide-renderer` MCP startup.

**v1.3.6** — Auto-mode and Computer Use hardening release: `/mode auto` auto-approves low-risk tool calls while preserving confirmation for high-risk Bash commands and hard blocks for catastrophic commands; Desktop no longer probes CUA with `cua-driver doctor` under Xiaok's TCC attribution; Bash shell fallbacks are denied for CUA self-start/repair, screen capture, pointer automation, and UI-driving AppleScript; interactive shell handoff now pauses and resumes the terminal UI cleanly.

**v1.3.4** — Swarm project reliability release: routes Xiaok seed PO/Worker tasks through the full Desktop agent runtime instead of a reduced sidecar worker; moves KSwarm task handoff to durable files with artifact-first result manifests; calibrates recent/monthly research quality gates around current-date and source evidence instead of arbitrary counts; keeps user goals/requirements intact while putting planning detail into the plan; formalizes final deliverable filenames and hides review/revision notes from submit-ready artifacts; fixes project task states, timestamps, intervention loops, artifact preview/download/export, and release packaging of KSwarm, Intent Broker, and bundled plugins.

**v1.3.2** — Desktop recovery release: fixes the `electron-updater` CJS/ESM import regression that made "Check for Updates" silently no-op in affected builds, adds a clear sidebar upgrade/download/install reminder next to Settings, restores scheduled task execution when `nextRunAt` is missing or tasks are deleted, and makes KSwarm plan retry repair stale PO assignments by reassigning to the best Xiaok PO before sending a full `assign_po` payload. The release gate verifies GitHub Latest plus macOS/Windows updater metadata and assets. Users already on affected desktop `0.5.6` or `1.3.1` builds need a one-time manual install of `1.3.2`; later updates can flow through the repaired in-app updater.

**v1.3.1** — Reliability release for Desktop + KSwarm: runtime probes and health cooldowns for CLI agents, stalled-run watchdog telemetry, capability-aware retry routing, hard deliverable validation for PPTX/HTML/Markdown tasks, deterministic local executor fallback for explicit PPTX presentation tasks, recoverable project planning when the PO planning phase is interrupted before a plan is submitted, and a desktop release workflow fix that checks out KSwarm before packaging.

**v1.2.0** — KSwarm swarm-style multi-agent project delivery from chat, persistent long-term memory with notebook_write/notebook_read tools and Settings UI management, agent settings panel for persona/spawn/provider configuration, model config enhancements with protocol selection and advanced JSON, progress reporting TaskPanel for multi-step autonomous work tracking.

**v1.0.0** — First major release: full i18n (Chinese/English) across all desktop UI with runtime locale switching, KSwarm multi-agent orchestration with status monitoring, project management with Kanban board and agent assignment, scheduled tasks with cron expressions, MCP plugin system with install/uninstall/enable/disable, desktop app v1.0.0 with all features integrated.

**v0.7.4** — Terminal mouse tracking fix and tool result spill: disabled mouse tracking sequences on raw mode entry to prevent Ghostty/iTerm2 from polluting the input bar, fully consume unrecognized CSI escape sequences, spill large tool results to disk instead of silently truncating, and improve desktop reminder handling.

**v0.7.3** — Parallel task execution and desktop v0.5.5: multiple tasks run concurrently across threads, desktop MCP plugin integration, skill auto-match, multi-turn context, and Windows release via GitHub Actions.

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
