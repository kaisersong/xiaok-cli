# xiaok-cli

> Xiaok is a local-first AI workbench with a Desktop app and a CLI. It turns requests into finished work through tools, skills, SubAgent collaboration, persistent goals, and evidence-backed delivery.

Use Desktop for conversations, documents, knowledge, automations, and multi-agent projects; use the CLI for terminal workflows, coding, and scriptable task execution. Both share model, tool, skill, and runtime foundations.

[English](README.md) | [简体中文](README.zh-CN.md)

**Release target: 1.5.2 (September 8, 2026).** CLI and Desktop package metadata are aligned at **1.5.2**. This update adds SubAgent collaboration in the shared right-side panel, constellation codenames, independent foreground/background execution lanes, and bounded summary-stream recovery. The latest published Desktop release remains **1.5.1** until the new release build and asset checks succeed; a version bump is not an npm publication. See [Version History](#version-history).

---

## Live Demo

Start the CLI and give it a concrete task:

```bash
xiaok login
xiaok "Review the agent coordinator and registry lifecycle independently, then cross-check the tool entry point and summarize findings with file and line references."
```

When the available tools and task support independent work, Xiaok can delegate bounded tracks automatically. You do not need to name an agent or create a project first. Simple or tightly dependent work stays with the main agent.

The CLI shows **SubAgent**, its constellation codename, assignment, current activity, and a completion summary with tool-call counts and elapsed time. Names start with **Pisces, Libra**, then Aries through the remaining signs; the next cycle adds `-2`. Continuation keeps the same instance's name. Names share one accent color; terminal font support determines how italics appear.

You can steer the choice naturally: “Do this yourself,” “Ask me before delegating,” or “Review these two independent areas in parallel.” Material unresolved choices require an answer; cancellation or an empty answer is not approval.

In Desktop, start from a conversation, add materials, and inspect results in Preview / Canvas. The current source also provides a SubAgent panel for assignments, activity, messages, and results, separate from persistent KSwarm projects.

## Loop Engineering in Xiaok

A single prompt starts work. A useful loop also needs a trigger, an executor, durable state, a checker, and a visible outcome.

| Building block | Xiaok implementation |
|---|---|
| Automation | Scheduled tasks, user loops, and project/workflow triggers |
| Execution | CLI and Desktop agent runtimes with tools and skills |
| Work isolation | Separate SubAgent sessions, inherited tool policy, and optional worktrees |
| Connectors | MCP plugins, local files, Intent Broker, KSwarm, and optional message channels |
| Memory | Session state, SQLite stores, knowledge sources, workflow checkpoints, and loop records |
| Evidence | Readable artifacts, skill contracts, completion checks, review gates, and provenance |
| Diagnostics | Artifact Evidence Regression and KSwarm Service Health loops, run history, and failure details |

Create a loop by defining the work and output contract, choosing a trigger, preserving its state, and adding a check that distinguishes a useful deliverable from a successful-looking response. Reminders only notify; scheduled tasks execute AI work. Daily assistant features require opt-in, and proposed memory/knowledge changes remain reviewable before adoption.

**Current source highlights:**

- **SubAgent collaboration:** automatic delegation for useful independent tracks, explicit assignments, messages, follow-up on the same instance, interruption, close, and visible cleanup state.
- **Simpler system prompts:** repeated execution instructions and conflicting approval/output rules were consolidated. The CLI common layer is 5,993 characters, down from 20,687; the Desktop base is 3,239, down from 8,297. These are fixed-text measurements, not token, latency, or model-quality claims.
- **Goal Mode:** persistent objectives with status, pause/resume, budgets, evidence, and controlled continuation.
- **Room-first collaboration:** discuss with agents before creating a project; promote selected source messages through a user-confirmed path.
- **Artifact and knowledge workflows:** previews, editing, source ingestion, local retrieval, recording/transcription, and reusable skills.

## Swarm Projects

KSwarm handles persistent projects that need plans, assigned agents, parallel tasks, review, recovery, and final delivery. A project has its own durable state and artifacts; it is distinct from a conversation's SubAgent group.

The agent-facing `create_project` tool prepares a **proposal**. Formal creation uses the trusted user-confirmed Desktop path; ordinary content generation or automatic SubAgent delegation does not silently create a persistent project.

### Basic Dynamic Workflow

- **Durable runs:** phases, nodes, dependencies, parallel groups, checkpoints, status, and gate decisions live in KSwarm.
- **Built-in diagnosis:** inspect project state directly, or run agent-backed diagnosis and independent review.
- **Project and task scope:** High Quality project workflows coordinate project delivery; task-level proposals support explicitly selected tasks.
- **Controlled scripts:** trusted workflows use `phase`, `agent`, `parallel([() => agent(...), ...])`, and `pipeline`; the runtime validates and bounds execution.
- **Preview and continuation:** preview a plan before running; query by `workflowRunId`; resume a persisted run using `resumeWorkflowRunId` without re-pasting a different script.
- **Artifact-first review:** task results and final delivery must satisfy their format, source, and artifact contracts. A repair file goes back through review instead of forcing completion.
- **Visible progress:** Kanban, Graph, task details, and Logs show the persisted task/workflow state, parallel progress, blockers, recovery, and deliverables.

KSwarm owns project coordination. Xiaok and external agent runtimes execute tasks. Bundled renderers create formal reports and slides. Intent Broker transports handoffs and replies. Each layer's health and completion must be checked at its own boundary.

---

## Design Philosophy

### 1. Intent-First Task Delivery

Understand the deliverable, reuse existing skills and artifacts, and continue within the authorized scope. Keep multi-step progress accurate, but answer simple questions directly. The final reply should explain what was delivered, where it is, and what was verified.

### 2. Compact, Layered System Prompts

The current prompt structure replaces the old “7-layer” description with concise policies and separate runtime context:

| Surface | Stable policy | Runtime additions |
|---|---|---|
| CLI | Identity, execution, authorization, tools, communication, planning, verification, and intent handoff | Permission mode, skills catalog, deferred tools, workspace guidance, memory, and CLI-specific delegation policy |
| Desktop | Execution and evidence rules, reminders vs. scheduled tasks, materials, knowledge, project boundaries, and delivery formats | Current model, skills catalog, materials, and managed SubAgent policy/context |

Skills remain catalog-driven and loaded when needed. Workspace content and memories are context, not extra authority. Prompt wording does not replace service-level permissions or tool validation. See [CLI prompt assembly](src/ai/prompts/assembler.ts) and [Desktop base policy](desktop/electron/desktop-system-prompt.ts).

### 3. Safety First

| Layer | Boundary |
|---|---|
| Permission mode | `default` asks when needed; `auto` approves low-risk work while retaining high-risk checks; `plan` blocks writes and Bash |
| Bash classifier | `block`, `warn`, and `safe` classifications supplement permission checks; unclassified commands are not a blanket safety guarantee |
| Tool execution | Validate tool inputs, enforce active allowlists, and respect denied actions across equivalent tool paths |
| Agent mutation | Scope control and store mutations to the caller's ownership; a SubAgent cannot acquire broader access by delegation |
| Delivery | Verify artifacts and outcomes; “closed” alone is not proof that execution and resources have settled |

Computer Use uses its own permission and runtime path. It is macOS-only and cannot be replaced by shell-based screen/control fallbacks.

### 4. Stage-Scoped Context Management

Keep the durable intent ledger while narrowing active work to the current stage. Compact large tool results, retain references to spilled output, hand off explicit artifacts, and restore relevant memory after compaction. Freshly query transient state rather than treating an old summary as a live snapshot.

### 5. Typed Memory

CLI memory distinguishes `user`, `feedback`, `project`, and `reference` records. Desktop also provides persistent notebooks and a local Knowledge Base for documents, sources, and retrieval. Memory is background context; personal information is persisted when requested, and daily-assistant candidates require user adoption.

### 6. Non-Invasive Multi-Agent Collaboration

| Mechanism | Use it for |
|---|---|
| SubAgent | Bounded independent work inside the current conversation |
| KSwarm project | Persistent planning, task dispatch, independent review, recovery, and final delivery |
| Intent Broker / Rooms | Coordination between agent runtimes and durable conversations with membership and message history |

SubAgent tools include `spawn_agent`, `send_message`, `wait_agent`, `list_agents`, `followup_task`, `interrupt_agent`, and `close_agent` when allowed. Continuation reuses an instance; user opt-out, ask-first instructions, tool restrictions, and ownership boundaries still apply.

The CLI can ask about material delegation choices when interactive input is available. Headless CLI and the current Desktop agent loop do not have that interactive question transport: optional delegation falls back to main-agent execution; essential missing decisions are reported before unapproved work starts.

---

## Install

### Requirements

- **CLI:** Node.js **22 or later**.
- **Full source stack:** Node.js **22.22 or later** to satisfy KSwarm's engine requirement.
- **Published Desktop packages:** macOS Apple Silicon and Windows x64. The installed app includes its host runtime; it does not need a separately installed Node.js for normal use.
- Computer Use requires macOS and the relevant accessibility/screen permissions. Model and external-service credentials depend on the capabilities you use.

### Install from npm

```bash
npm install -g xiaokcode
xiaok login
xiaok
```

The package is `xiaokcode`; the command is `xiaok`. Update with `xiaok update`.

> **npm >= 11.16 users:** npm blocks dependency install/postinstall scripts by default. If you see a warning like `install scripts not yet covered by allowScripts`, install with:
>
> ```bash
> npm install -g --allow-scripts=nodejieba,onnxruntime-node xiaokcode
> ```
>
> The `onnxruntime-node` script places the native binaries required for local embedding inference; `nodejieba` provides Chinese word segmentation. When the scripts are blocked the CLI still starts, but those capabilities degrade silently (embeddings off, Chinese text indexed as whole segments). To allow them permanently: `npm config set allow-scripts=nodejieba,onnxruntime-node --location=user`. `xiaok login` offers provider selection and hidden key input, with optional live verification. If no provider is configured, interactive chat can offer the same setup flow.

### From Source (Development)

```bash
git clone https://github.com/kaisersong/xiaok-cli.git
cd xiaok-cli
npm ci
npm run build
node dist/index.js
```

This is sufficient for CLI development. Desktop source builds also use sibling repositories; follow [Related Projects](#related-projects) and [Development](#development). Use a new process after rebuilding; already running processes retain their loaded modules.

### Configuration

Default config: `~/.xiaok/config.json`. `XIAOK_CONFIG_DIR` overrides the configuration root. Project settings live in `<repo>/.xiaok/settings.json`; keybindings default to `~/.xiaok/keybindings.json`.

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
    },
    "firecrawl": {
      "type": "first_party",
      "protocol": "firecrawl",
      "apiKey": "",
      "baseUrl": "https://api.firecrawl.dev"
    }
  },
  "models": {
    "anthropic-default": {
      "provider": "anthropic",
      "model": "claude-opus-4-7",
      "label": "Anthropic Default",
      "capabilities": ["tools"]
    },
    "kimi-default": {
      "provider": "kimi",
      "model": "k3",
      "label": "Kimi K3",
      "capabilities": ["tools", "thinking"],
      "runtimeOptions": {
        "contextLimit": 262144,
        "reasoningEffort": "high"
      }
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

Version 1 configuration is migrated on load. Manage providers and models through login, configuration commands, or Desktop settings:

```bash
xiaok login --provider kimi
xiaok config set model kimi/k3
xiaok config get providers
xiaok config get models
xiaok doctor --check-keys
```

#### Kimi K3

The built-in exact profiles use `k3` and `k3-256k`. Current defaults use a 262,144-token context and `high` reasoning effort; available context and effort controls are model/profile-specific.

CLI and Desktop preserve K3 `reasoning_content` only in task-local provider conversation memory. Raw reasoning is excluded from durable task/session history, user-visible events, ordinary logs, and tool-facing context. Durable resume/continue/fork histories that already contain an assistant turn are rejected with `KIMI_K3_DURABLE_RESUME_UNSUPPORTED`; start a new conversation for that profile.

Explicit Kimi `prompt_cache_key` emission remains disabled by default. `XIAOK_EXPERIMENTAL_KIMI_PROMPT_CACHE=1` is a diagnostic opt-in, not a demonstrated performance benefit. Changing the model or reasoning effort requires a fresh provider conversation. See [model harness profiles](src/ai/providers/model-harness-profile.ts).

---

## Desktop App

Desktop is the main graphical workbench, built with Electron and React. Main-process services own durable state and execution; the renderer displays structured state and sends requests through narrow preload/IPC APIs.

### Download

Get the current published build from [GitHub Releases](https://github.com/kaisersong/xiaok-cli/releases/latest). The verified `desktop-v1.5.1` assets are:

- `xiaok-1.5.1-arm64.dmg` — macOS Apple Silicon installer.
- `xiaok-1.5.1-arm64-mac.zip` — macOS Apple Silicon archive.
- `xiaok-setup-1.5.1.exe` — Windows x64 installer.

The updater uses `latest-mac.yml` and `latest.yml`. Source-only changes listed here require a new source build or a subsequent published release.

### Features

- **Conversations and Goal Mode:** task history, prompt navigation, persistent objectives, pause/resume, and visible progress.
- **SubAgent panel:** current-source managed collaboration with stable constellation names, assignments, activity, messages, and results.
- **Preview / Canvas:** HTML, Markdown, PDF, report and slide previews, artifact editing, revisions, and task provenance; some advanced surfaces remain feature-gated.
- **Projects and Rooms:** user-confirmed project creation from conversations, Kanban, workflow Graph, review gates, and recovery.
- **Automations:** scheduled AI tasks, reminders, user loops, diagnostics, run history, and output previews.
- **Knowledge and recording:** local document ingestion/retrieval, notebooks, recording/transcription, and editable notes; ASR capabilities depend on configured providers or installed local models.
- **Plugins:** MCP tools, bundled report/slide/canvas/meeting capabilities, managed runtime readiness, component retry, and macOS Computer Use.
- **Settings and access:** model/provider, skill, channel and plugin configuration, Chinese/English UI, themes, updates, and optional mobile companion access.

### Desktop Development

Prepare the sibling repositories and dependencies first. From the repository root:

```bash
npm ci --prefix desktop
npm run build --prefix desktop
npm run dev:all --prefix desktop
```

A build alone does not replace an installed app. For unsigned local packaging and release prerequisites, see [Development](#development).

---

## Usage

### Commands

```bash
xiaok                              # Interactive chat
xiaok login                        # Provider/key setup
xiaok -c                           # Resume the last session, if supported by its model
xiaok --resume <session-id>         # Resume a specific session
xiaok "review workspace changes"   # Run a task
xiaok doctor --check-keys           # Diagnose credential resolution
xiaok update                       # Update the npm CLI
xiaok daemon status                # Inspect the local daemon
xiaok plugin search                # Browse plugins
xiaok transcript <session-id>      # Inspect execution history
xiaok yzjchannel serve             # Optional Yunzhijia gateway
```

### In-Session Commands

```text
/exit                         Exit chat
/clear                        Clear screen and redisplay the welcome page
/compact                      Compact earlier conversation context
/context                      Show loaded repository context
/mode [default|auto|plan]     Inspect or change permission mode
/models                       Switch model
/goal <objective>              Start a persistent goal
/goal status|pause|cancel      Inspect, pause, or cancel the goal
/goal resume [newTurnLimit]    Resume with an optional turn limit
/goal replace <objective>      Replace the active goal
/reminder <natural language>  Create a notification reminder
/reminder list                List reminders
/reminder cancel <id>         Cancel a reminder
/settings                     Show CLI settings
/skills-reload                Reload skills
/yzjchannel                   Connect the embedded channel
/help                         Show help
/<skill-name> [args]          Invoke a skill
```

Permission mode is separate from user intent: `auto` does not answer an unresolved question or override “ask before delegating.”

### Terminal Keys & Inline Images

- **Esc** requests interruption of the current running turn while preserving drafts and queued input.
- **Ctrl+O** opens the full transcript in `$PAGER` (default `less -R`) when idle. The temporary ANSI file is private and removed on exit; unsupported environments fall back to scrollback.
- Supported terminals display submitted images using kitty or iTerm2 protocols. Unsupported terminals, including tmux panes, use a placeholder.
- SubAgent names use a uniform accent; CJK italics depend on terminal/font fallback and are not guaranteed by ANSI styling alone.

### Yunzhijia IM Commands

```text
/help                    Show help
/bind <cwd>              Bind a workspace
/bind clear              Clear the workspace binding
/status [taskId]         Query task state
/approve <approvalId>    Approve a pending action
/deny <approvalId>       Deny a pending action
/cancel <taskId>         Cancel a running task
/skill <name> [args]     Invoke a skill
```

Yunzhijia is an optional adapter, not a prerequisite for local CLI or Desktop work.

### Typical Workflows

```bash
xiaok init
xiaok "implement the requested change and verify it"
xiaok review
xiaok commit
```

For reusable document work, install the relevant plugin and invoke its skill. For independent investigation, state the deliverables and constraints; the runtime can choose useful SubAgent work. For long-running objectives, use `/goal`. For recurring work, use Desktop Automations. For formal multi-agent project delivery, use a user-confirmed KSwarm project.

---

## Features

### Core

- Shared provider catalogs for Anthropic, OpenAI, Kimi, DeepSeek, GLM, MiniMax, Gemini, and custom endpoints.
- Compact system policies with runtime-specific context, tool validation, permission modes, and scoped agent controls.
- File/search/edit/shell tools, web search/scrape, LSP, durable goals, and session diagnostics.
- Separate status for execution, logical close, and resource cleanup; stalled cancellation is visible rather than reported as physical release.

### Skill System

- Built-in, global, project, and plugin-provided catalogs with dependency resolution and on-demand loading.
- `allowed-tools` enforcement and runtime catalog refresh after install/uninstall.
- Structured `required-references`, `required-scripts`, `required-steps`, and `success-checks` contracts.
- Execution bundles, artifact evidence, completion checks, and adherence evaluations for strict skills.

### Built-in Agents

| Agent | Role | Declared tools |
|---|---|---|
| Explore | Read-only repository investigation | read, grep, glob, bash, tool_search; its instructions restrict Bash to read-only inspection |
| Plan | Architecture and implementation planning | read, grep, glob, tool_search |
| Verification | Adversarial validation | read, grep, glob, bash, tool_search |

Named presets are optional. Inline SubAgents can receive a bounded assignment and an explicit tool allowlist. Preset instructions, available tools, and runtime permissions are distinct layers.

### LSP Code Intelligence

`lsp` supports `goToDefinition`, `findReferences`, `hover`, and `documentSymbol`. A structural outline can guide targeted reads; syntactic fallback is not a substitute for semantic definitions or references.

### Session Management

Automatic persistence, session IDs, resume where supported, scoped memory restoration, and honest cancellation preserve continuity. Model-specific history restrictions still apply, especially to strict Kimi K3 profiles.

### Performance & Large-Workload Reliability

- Incremental JSONL transcript analysis and explicit gzip archival: `xiaok transcript <session-id> --gzip --older-than-days 7`.
- Checksummed task journals and checkpoints instead of full-snapshot rewrites on every event.
- Deferred managed Python/plugin readiness work after the Desktop window becomes interactive.
- Coalesced renderer deltas and bounded tool output with retained artifact references.
- Reduced fixed system text while preserving skills, workspace guidance, permission boundaries, and delegation policy.

### Local Daemon & Reminders

A per-user daemon provides durable SQLite-backed reminders, recovery and retries. Multiple CLI sessions can share it; daemon availability and chat startup remain separate. Notification reminders do not execute AI tasks.

### Yunzhijia IM Integration

Embedded `/yzjchannel`, WebSocket/webhook inbound modes, workspace binding, task status, approval forwarding, and cancellation bridge optional IM access to the runtime.

### Intent Broker Integration

Lifecycle hooks register sessions and project context, publish work-state, transport actionable tasks/questions and informational notes, replay events, and support controlled continuation. Message delivery is not evidence that task execution succeeded.

### Evaluation System

Focused unit/contract suites cover prompts, tools, permissions, session history, cancellation, and artifact delivery. CLI process/TTY tests use a local SSE server; Desktop tests cover main services, IPC and renderer behavior. Live-model evaluations are separate from deterministic fixtures.

Use `npm run eval:intent-delegation`, `npm run eval:skill-quality`, `npm run eval:skill-adherence`, and the scripts under `scripts/evals/` for the corresponding evaluation surfaces. Historical autonomy benchmarks are not current model-to-model guarantees.

---

## Architecture

```text
xiaok-cli/
  src/
    ai/              Models, prompts, skills, tools, agents, permissions, memory
    commands/        CLI commands and chat/goal entry points
    platform/        Runtime registries, MCP/LSP, worktrees, background execution
    runtime/         Task host, goals, daemon, reminders, evidence and diagnostics
    ui/              Terminal transcript, input, progress and SubAgent display
    channels/        Optional channel adapters
  desktop/
    electron/        Main services, task/agent execution, stores, IPC and sidecars
    renderer/        Conversations, SubAgent panel, projects, knowledge and artifacts
    shared/          Shared Desktop contracts
  data/              Built-in skills, agents and domain resources
  tests/             CLI unit, contract and process/TTY tests
```

### Related Projects

| Repository | Responsibility | Xiaok boundary |
|---|---|---|
| [kswarm](https://github.com/kaisersong/kswarm) | Persistent project/task/workflow state, dispatch, review, recovery, artifact gates | Desktop main starts and calls the sidecar; agent runtimes execute its tasks |
| [intent-broker](https://github.com/kaisersong/intent-broker) | Participants, aliases, events, handoffs, approvals, Rooms and replay | Transports coordination; it does not fabricate task results or own KSwarm project state |
| [kai-xiaok-plugins](https://github.com/kaisersong/kai-xiaok-plugins) | Skills, MCP servers and bundled rendering/transcription resources | Supplies capabilities; Xiaok owns activation, permissions, task state and user-facing delivery |

The current plugin manifests list report `2.3.0`, slide `3.3.0`, infinity canvas `0.2.0`, meeting assistant `0.1.0`, and Computer Use `0.2.1`. The meeting plugin provides Whisper fallback and summarization; Desktop owns microphone capture and its other ASR integrations. Computer Use stays macOS-only.

Desktop source development expects sibling checkouts:

```text
projects/
  xiaok-cli/
  kswarm/
  intent-broker/
  kai-xiaok-plugins/
```

```bash
git clone https://github.com/kaisersong/kswarm.git
git clone https://github.com/kaisersong/intent-broker.git
git clone https://github.com/kaisersong/kai-xiaok-plugins.git
```

Run these from the parent of `xiaok-cli`. Update compatible checkouts together. The [release workflow](.github/workflows/desktop-release.yml) pins all three siblings to `desktop-v1.5.2`; changing local source does not update those release tags. [electron-builder.json](desktop/electron-builder.json) declares the packaged service/plugin resources.

---

## Development

From `xiaok-cli`:

```bash
npm ci
npm run build
npm test
npm run test:full
npm run test:skill:fast
npm run test:skill:release
npm run dev -- --help
```

The default suite compiles tests to `.test-dist` and runs the sandbox configuration plus evaluations. `test:full` includes subprocess-dependent coverage excluded by the sandbox suite. Socket/subprocess tests need an environment that permits them.

Prepare Desktop and sidecar dependencies:

```bash
npm ci --prefix ../kswarm
npm ci --prefix ../intent-broker
npm ci --prefix ../kai-xiaok-plugins/plugins/kai-report-creator/mcp-servers/report-renderer
npm run build --prefix ../kai-xiaok-plugins/plugins/kai-report-creator/mcp-servers/report-renderer
npm run build:bundle --prefix ../kai-xiaok-plugins/plugins/kai-report-creator/mcp-servers/report-renderer
npm ci --prefix desktop
npm run test --prefix desktop
npm run typecheck --prefix desktop
npm run build --prefix desktop
```

Plugin Python runtimes, wheels and other component dependencies must match the target platform and the plugin manifests. Follow the plugin repository's build instructions and the release workflow; copying another platform's wheelhouse is insufficient.

For an **unsigned local package** on macOS (after the build and plugin preparation):

```bash
cd desktop
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir \
  --config electron-builder.json \
  -c.mac.identity=null \
  -c.win.signAndEditExecutable=false
```

When changing related repositories, validate their own boundaries too:

| Change | Required checks |
|---|---|
| KSwarm project/runtime/workflow | `npm test` and `npm run test:all` in `kswarm` |
| Broker participant/adapter/collaboration | `npm test` and `npm run verify:collaboration` in `intent-broker` |
| Report renderer | Build, bundle, and MCP initialize smoke test in its package |
| Slide/Python plugin | Plugin tests, target-platform wheels and runtime verification |
| Packaged sibling resources | Desktop packaging contracts, build, and inspect an unpacked app |

From the `xiaok-cli` root, run Desktop packaging contracts:

```bash
npm run test --prefix desktop -- --run \
  tests/main/kswarm-contract.test.ts \
  tests/main/deploy-bundled-plugins.test.ts \
  tests/main/e2e-plugin-bundling.test.ts \
  tests/main/e2e-plugin-rendering.test.ts
```

Build freshness checks identify the owning generated resource; rebuild that owner instead of repeatedly retrying an unchanged package command. Formal releases additionally require matching pushed sibling snapshots, signing/notarization where applicable, and `npm run desktop:verify-release -- desktop-v<version>` after publication.

---

## Compatibility

| Platform | CLI | Published Desktop | Computer Use |
|---|---|---|---|
| macOS Apple Silicon | Supported | DMG / ZIP | Supported with permissions |
| macOS Intel | CLI/source use | No Intel asset in the verified latest release | macOS-only runtime requirements apply |
| Windows x64 | Supported; terminal/hook details vary | Installer | Unavailable |
| Linux | CLI/source use | Build targets exist; no asset in the verified latest release | Unavailable |

| Provider / protocol | Runtime support |
|---|---|
| Anthropic | Streaming, tools, supported model images/caching |
| OpenAI-compatible | Streaming, tool calls, custom endpoints and model-specific capabilities |
| OpenAI Responses | Native Responses adapter for configured profiles |
| Kimi K3 | Strict task-local reasoning/history contract; durable resume restrictions |

Capabilities follow the selected model and endpoint. A listed provider does not mean every model supports images, reasoning controls, context sizes, or resume in the same way.

---

## Version History

### v1.5.2 — Release preparation, September 8, 2026

CLI and Desktop package metadata are **1.5.2**. This release prepares the following changes:

- CLI/Desktop SubAgent spawning, messaging, waiting, and lifecycle controls with stable constellation codenames.
- One shared Task / SubAgent / Canvas floating surface, corrected scrolling, readable output, and a homepage collaboration prompt.
- Independent foreground/background execution lanes and explicit queued, approval, and execution status.
- One bounded, tool-free summary continuation after an eligible stream disconnect, preserving completed child results without replaying tools. Already-failed historical tasks are not automatically rerun.
- Registry/background-task lifecycle fixes and simplified system prompts. Non-cooperative in-process work remains visibly pending until resources actually settle.
- CUA session recovery preserves per-call cancellation and requires a fresh observation before retrying mutations; bundled Fantasy Rainbow slide layouts are refined.

Build, signing, notarization, and release-asset verification are separate gates. See [GitHub Actions](https://github.com/kaisersong/xiaok-cli/actions/workflows/desktop-release.yml) for the actual build result.

### Published baseline — v1.5.1

Login bootstrap, Room/Gate collaboration, hosted Room-history access, automation and project-state recovery, and reproducible sibling packaging. Downloaded assets and npm metadata were checked on September 7, 2026. See [GitHub Releases](https://github.com/kaisersong/xiaok-cli/releases) for release-specific artifacts and notes.

<details>
<summary>Earlier release history</summary>

Historical release summaries; these are not current test or performance results.

| Version | Main change |
|---|---|
| 1.5.0 | Room-first collaboration and user-confirmed project creation. |
| 1.4.32 | Conversation navigation, Goal controls, model catalog and evidence recovery. |
| 1.4.31 | Persistent Goal Mode and visible project-agent runtime recovery. |
| 1.4.28 | Opt-in daily assistant and project team recommendations. |
| 1.4.27 | Knowledge retrieval repair based on real corpus/query measurements. |
| 1.4.26 | Structured tool failures remain failures through runtime normalization. |
| 1.4.25 | Permission denials remain explicit failed tool calls. |
| 1.4.24 | Kimi K3 harness profiles and task-local reasoning/history contracts. |
| 1.4.23 | Task-owned Canvas artifact workspaces and preview layout. |
| 1.4.22 | Chinese-first recording workflow and Computer Use recovery. |
| 1.4.21 | Local AI recording entry point in the Knowledge Base. |
| 1.4.20 | Loop output previews and task-completion integration. |
| 1.4.19 | Explicit persisted loop contracts. |
| 1.4.18 | Cost visibility, MCP recovery, and staged-skill diagnostics. |
| 1.4.17 | Artifact persistence and release consistency. |
| 1.4.16 | Artifact editing and Loop Engineering evidence. |

**v1.4.9** — Knowledge Base and Automation refinement release: adds local-first Personal Knowledge Base with Collection/Source/Chunk model, PDF/docx/pptx/xlsx extraction, Chinese jieba segmentation search, and agent KB tools (kb_search, kb_get_source, kb_list_collections, kb_create_collection); loop edit/delete from the Automations panel; artifact preview fullscreen toggle with iframe allow-scripts and "send to chat"; clickable file paths in messages (Finder/Explorer); paste path detection fix; workflow status strip clipping fix; task_completion generic loops; cult-ui component foundation; direction-aware tabs animation; Kimi for Coding compatibility; and KSwarm stale service replacement on startup.

**v1.4.8** — Automations and Loop Engineering release: moves user loops, schedules, diagnostics, run history, and output preview into one Desktop Automations surface; adds repeatable user loop templates with schedule bindings, automatic output directory creation, cross-platform output filename guards, clickable output directories, and artifact-backed output previews. Scheduled task transcripts now hide injected system metadata from the visible prompt and show a light planned/actual execution notice, so users can distinguish scheduler timing from task content quality. Desktop also hardens timeout classification, stale KSwarm service replacement, and skill resource loading through lightweight manifests plus on-demand `skillFetchAssets`.

**v1.4.6** — Loop reliability follow-up: hardens the real desktop launch path around KSwarm/Intent Broker startup by sharing the KSwarm service start promise, preventing recursive stream-bridge close handling, packaging the compiled completion-evidence runtime guard, and pairing the desktop release with an Intent Broker replay fix for task-id-less approval/lifecycle events. The release gate covers focused KSwarm desktop tests, focused CLI completion-evidence/task-host tests, Intent Broker full tests, desktop build, live KSwarm/broker health checks, Computer Use live smoke, and the desktop `desktop-v1.4.6` release workflow.

**v1.4.5** — Loop reliability release: adds the built-in KSwarm Service Health Loop, classifies service startup and health-check failures with structured diagnostics, records suggested actions and log paths for Settings, keeps repeated notifications quiet, and hardens local artifact evidence validation with workspace containment and symlink escape protection. The release gate covers desktop full tests, CLI sandbox full tests, desktop build/typecheck, structured intent/skill evals, Computer Use live smoke, and the desktop `desktop-v1.4.5` release tag workflow.

**v1.4.2** — A2UI dashboard and interrupt release: Desktop can replay safe read-only A2UI dashboard artifacts inline, including metrics, lists, tables, and conclusion sections, with installed-app E2E coverage against `/Applications/xiaok.app` using natural user language instead of internal tool names. User-facing tool-step labels now show `dashboard [A2UI]`, raw dashboard payloads stay redacted, and the section validator accepts common aliases while avoiding the previous "未知 section" failure for valid dashboard requests. Terminal streaming turns can also be aborted with `ESC` while preserving drafts and queued input, emitting a user-aborted turn instead of a failed turn. Model adapters, runtime core, compact runner, subagents, and tool execution share abort signals and avoid retrying true `AbortError`s; Desktop KSwarm handoffs propagate cancellation through the runtime bridge and surface user aborts as `task_cancelled`.

**v1.4.1** — Desktop artifact preview fix: project deliverable artifacts (Markdown, HTML, plain text) now load correctly in the desktop preview panel. Introduced a dedicated raw-text IPC proxy (`kswarmProxyGetText`) for artifact content fetches, replacing the JSON-only proxy that caused "fetch failed" errors for all non-JSON artifact types. Also fixed macOS app packaging to use `ditto` for bundle installation.

**v1.4.0** — Multi-task parallel execution and interruption recovery: desktop worker agents now execute up to 3 tasks concurrently (configurable 1-10 via Settings > General > Task Concurrency), removing the previous single-task serialization bottleneck; system sleep/wake detection via Electron powerMonitor with graceful task suspension and automatic lease-refresh resume; crash-safe atomic state persistence; deferred recovery with 20s grace period for agents reconnecting after network interruption; stalled-run watchdog tolerance bumped to 5 minutes to accommodate sleep transitions; KSwarm v0.9.0 integration with parallel dispatch policy.

**v1.3.14** — Streaming and dynamic workflow reliability release: Anthropic, OpenAI Chat Completions, and OpenAI Responses adapters now treat `ERR_STREAM_PREMATURE_CLOSE`, `ECONNRESET`, `ETIMEDOUT`, `EPIPE`, `Premature close`, `socket hang up`, `terminated`, and `fetch failed` as retryable transport errors, but disable retry as soon as any chunk has been delivered so the user never sees duplicated streamed output; the OpenAI Chat Completions path also gains a 5-minute per-stream timeout. `InProcessTaskRuntimeHost.recoverTask` salvages tasks that are still marked `running` after a process restart and transitions them to `failed` with a `stale_running_task_recovered` summary instead of leaving the snapshot stuck. Desktop's `runKSwarmRuntimeTextTask` now retries once on retryable transport failures and surfaces the actual failure reason. A new `render_report_artifact` tool turns a complete `.report.md` IR into an HTML artifact for dynamic workflow final report nodes, and worker / final-output / generic node prompts require using the renderer instead of reading plugin internals or hand-writing HTML. AGENTS.md publishes cross-platform compatibility rules covering path joining, macOS / Windows platform guards, and `child_process` shell-syntax bans across xiaok-cli, kswarm, intent-broker, and kai-xiaok-plugins.

**v1.3.13** — Parallel dynamic workflow hardening release: dynamic workflow scripts can now resume the same KSwarm run by reusing completed primitive outputs, query status through a read-only KSwarm snapshot tool, and complete a professional `report_final_review` E2E that produces HTML/PDF artifacts while keeping workflow run, gate decision, project deliverable, artifact provenance, and task-board state consistent. KSwarm now records passed gate decisions for successful script workflows, and the design/adversarial review docs capture the remaining boundaries around automatic job replay and durable user-input pause/resume.

**v1.3.12** — Parallel dynamic workflow foundation release: trusted model-authored scripts can use thunk-based `parallel()` with durable KSwarm `parallelGroups`, branch metadata, script checkpoints, background execution, and project workflow status visibility. The bundled `report_final_review` template demonstrates the first professional parallel workflow shape, with focused tests and eval coverage for the script parser, runtime, KSwarm controller, and desktop bridge.

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

</details>
