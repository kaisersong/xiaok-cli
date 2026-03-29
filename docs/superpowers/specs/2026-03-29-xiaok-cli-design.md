# xiaok CLI — Design Spec

**Date:** 2026-03-29
**Status:** Approved

---

## Overview

xiaok is an AI-powered coding CLI for yunzhijia.com (云之家) developers — the Claude Code / Codex equivalent in the 云之家 developer ecosystem. It pairs with **yzj CLI** (the `gh`-equivalent platform resource management tool) and calls it as one of its tools.

| Tool | Analogy | Responsibility |
|------|---------|----------------|
| xiaok CLI | Claude Code / Codex | AI coding assistant |
| yzj CLI | GitHub CLI (gh) | Platform resource management |

---

## Target Users

All categories of 云之家 developers:
- External ISV / integrators building apps on the 云之家 open platform
- Internal Kingdee developers building 云之家 features
- Enterprise IT developers customizing 云之家 for their organization

---

## Core Design Decisions

- **Language:** TypeScript / Node.js — best AI-assisted development experience, Claude Code and Codex generate highest-quality TypeScript, `npm install -g xiaok` distribution
- **Model support:** Multi-model, user-configurable (Claude, OpenAI, custom endpoints)
- **Auth:** Browser-based OAuth 2.0 (`xiaok auth login`), shared credentials with yzj CLI via `~/.xiaok/credentials.json`
- **Architecture:** Monolith CLI with module-based internal structure — single `xiaok` binary, no plugin installation required

---

## Architecture

### Directory Structure

```
xiaok-cli/
├── src/
│   ├── index.ts                  # CLI entry point, command registration
│   ├── auth/
│   │   ├── login.ts              # OAuth 2.0 browser flow
│   │   ├── token-store.ts        # Token storage (read/write credentials.json)
│   │   └── identity.ts           # Developer app identity (appKey, appSecret for yzj open platform)
│   ├── ai/
│   │   ├── agent.ts              # AI Agent main loop
│   │   ├── models.ts             # Multi-model adapter layer
│   │   ├── tools/
│   │   │   ├── bash.ts           # Shell command execution (incl. yzj CLI)
│   │   │   ├── read.ts           # File read
│   │   │   ├── write.ts          # File write
│   │   │   ├── edit.ts           # Precise file edit (string replace)
│   │   │   ├── grep.ts           # Content search
│   │   │   └── glob.ts           # File pattern matching
│   │   └── context/
│   │       └── yzj-context.ts    # 云之家 API docs + yzj CLI help injected into system prompt
│   ├── commands/
│   │   ├── auth.ts               # xiaok auth login/logout/status
│   │   ├── chat.ts               # xiaok / xiaok chat (interactive agent)
│   │   └── config.ts             # xiaok config get/set
│   └── utils/
│       ├── config.ts             # Config file read/write (~/.xiaok/config.json)
│       └── ui.ts                 # Terminal rendering (streaming, markdown)
├── package.json
└── tsconfig.json
```

### Core Data Flow

```
User input
  → Build messages (system prompt + history + user input)
  → Call model API (streaming)
  → Parse tool_use → Execute tool
  → Append tool result to messages
  → Loop until model returns plain text (no tool calls)
  → Output result, wait for next input
```

---

## Commands

### Phase 1 (Core Skeleton)

```bash
# Auth
xiaok auth login          # Open browser OAuth flow, store token
xiaok auth logout         # Clear credentials
xiaok auth status         # Show current account and enterprise

# AI Agent (main feature)
xiaok                     # Start interactive agent (default)
xiaok chat                # Same as above, explicit
xiaok "task desc"         # Single-shot task mode
xiaok chat --auto         # Non-interactive mode, no confirmation prompts (CI/scripting)
xiaok chat --dry-run      # Print tool calls without executing (testing/debugging)

# Config
xiaok config set model claude-opus-4-6
xiaok config set model openai/gpt-4o
xiaok config set model custom --base-url https://... --api-key ...
xiaok config set api-key <key>               # Set API key for current model provider
xiaok config set api-key <key> --provider claude   # Set per-provider key
xiaok config get model
```

### Phase 2+ (Platform Resource Management via yzj CLI)

All platform operations (messaging, apps, org structure, workflows, logs) are handled by **yzj CLI** and invoked by xiaok's AI agent via the `bash` tool. xiaok itself does not re-implement these commands.

---

## Modules

### 1. Auth Module

**OAuth 2.0 Flow Details:**
- Callback server: binds to a random available port (e.g., 49152–65535); the exact port is included in the `redirect_uri` sent to the OAuth server at authorization time
- The 云之家 OAuth app registration must allow dynamic redirect URIs matching `http://localhost:*` (or xiaok registers a fixed port like `51000` as a reserved callback port — to be confirmed with 云之家 OAuth platform team before implementation)
- PKCE (RFC 7636) is required — xiaok is a public client (no secret stored in binary)
- Requested scopes: `openid profile` plus any yzj CLI–required scopes (exact scope list to be confirmed with 云之家 open platform docs)
- Token refresh: lazy refresh on 401 response; xiaok checks `expiresAt` before each request and proactively refreshes if token expires within 5 minutes
- **Schema owner:** xiaok owns `credentials.json`. yzj CLI is a read-only consumer of this file. yzj CLI never writes to it.

**Token Storage:**
- `~/.xiaok/credentials.json` is stored as **plaintext JSON** (no encryption in Phase 1)
- File permissions set to `0600` (owner read/write only) on Unix; on Windows, stored in `%APPDATA%\xiaok\credentials.json` with ACL restricted to current user
- Rationale: OS-level file permissions provide adequate protection for developer tokens; adding encryption requires a key derivation strategy that adds complexity without meaningful security benefit for this threat model
- Future: migrate to OS keychain (macOS Keychain, Windows Credential Manager) in Phase 2

**SSO with yzj CLI:**
- yzj CLI reads `~/.xiaok/credentials.json` (read-only) to obtain `accessToken`
- yzj CLI uses only `accessToken` and `enterpriseId` fields; it does not read or write `refreshToken` or `expiresAt`
- Token refresh is xiaok's responsibility — yzj CLI should fail gracefully on 401 and instruct the user to run `xiaok auth login`
- No file locking is required in Phase 1 (refresh is infrequent; yzj CLI is read-only)

**Developer App Identity (`identity.ts`):**
- Distinct from login identity. Represents the developer's own app registration on the 云之家 open platform (appKey + appSecret), used when the developer is building integrations that call 云之家 APIs on behalf of their app
- Stored in `~/.xiaok/config.json` under `devApp: { appKey, appSecret }`
- Injected into the system prompt so the AI agent knows the developer's app context when generating integration code

### 2. AI Agent Module (Core)

- Interactive mode: streaming output, markdown rendering, multi-turn conversation
- Conversation history is **in-memory only** — not persisted to disk in Phase 1. History is lost when the session ends (Ctrl-C or EOF). Future Phase 2 will add session persistence.
- Single-shot mode: `xiaok "write a script to call 云之家 messaging API"`
- **Signal handling:** On SIGINT (Ctrl-C):
  - If a tool is mid-execution: send SIGTERM to the child process, wait up to 2 seconds, then SIGKILL; no file rollback (tools are responsible for atomic writes where needed)
  - If no tool is running: exit cleanly
  - Partial output already written to files is left as-is; the user is responsible for reviewing uncommitted changes
- **`--dry-run` flag:** Prints each tool call (name + arguments) to stdout without executing it. Used for testing and debugging. No model API calls are skipped — only tool execution is suppressed.

**Permission Model:**
- **Safe tools** (never prompt): `read`, `grep`, `glob`
- **Write tools** (prompt in default mode, auto-execute in `--auto`): `write`, `edit`
- **Bash tool** (always prompt in default mode, auto-execute in `--auto`): all bash commands are treated as potentially destructive regardless of content — xiaok does not attempt to parse bash intent
- **Mid-session "yes to all":** User can type `y!` at any confirmation prompt to switch the current session to `--auto` mode without restarting

### 3. Multi-Model Adapter Layer

**TypeScript interface:**

```typescript
interface ModelAdapter {
  // Stream a chat completion; yields chunks as they arrive
  stream(messages: Message[], tools: ToolDefinition[]): AsyncIterable<StreamChunk>;
}

type StreamChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'done' };

interface Message {
  role: 'user' | 'assistant' | 'tool_result';
  content: string | ToolResultContent[];
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}
```

Each provider adapter (Claude, OpenAI, custom) implements `ModelAdapter`. The agent only depends on this interface.

**Streaming normalization:** Each adapter maps provider-specific SSE events to the `StreamChunk` union. Tool call parsing differences (Claude `tool_use` blocks vs OpenAI `tool_calls` array) are fully encapsulated inside each adapter.

**Rate limiting and retry:** Each adapter handles its own retry logic (exponential backoff on 429/5xx). The agent does not retry at the loop level.

**API key precedence per provider:**

```
Environment variable (XIAOK_API_KEY or XIAOK_<PROVIDER>_API_KEY)
  > ~/.xiaok/config.json models[provider].apiKey
  > Error: key required
```

Config schema for multi-model:
```json
{
  "schemaVersion": 1,
  "defaultModel": "claude",
  "models": {
    "claude": { "model": "claude-opus-4-6", "apiKey": "..." },
    "openai": { "model": "gpt-4o", "apiKey": "..." },
    "custom": { "baseUrl": "https://...", "apiKey": "..." }
  },
  "devApp": { "appKey": "...", "appSecret": "..." },
  "defaultMode": "interactive"
}
```

There is no built-in free tier — users must provide an API key. If no key is configured, xiaok exits with a clear message directing to `xiaok config set api-key`.

### 4. 云之家 Context Injection

The system prompt includes the following, assembled at session start:

1. **Bundled 云之家 API overview** (~2000 tokens): a curated, versioned summary of key 云之家 open APIs, bundled with the xiaok package. Updated via xiaok releases. Not fetched at runtime.

2. **yzj CLI reference** (if installed): runs `yzj --help` and `yzj <top-level-command> --help` for known command groups at session start. Timeout: 3 seconds per call; skipped silently if yzj CLI is not installed or times out.

3. **Current session context**: logged-in enterprise ID, developer app name (from identity.ts), current working directory.

**Token budget:** Total context injection is capped at 4000 tokens. If the bundled docs + yzj help exceeds this, yzj help is truncated first, then the API overview is truncated. The cap can be overridden via `xiaok config set context-budget <tokens>`.

### 5. Built-in Tool Set

| Tool | Permission class | Description |
|------|-----------------|-------------|
| `bash` | Always prompt (or `--auto`) | Execute shell commands, including yzj CLI calls |
| `read` | Safe | Read file contents |
| `write` | Write | Write/create files |
| `edit` | Write | Precise string replacement in files |
| `grep` | Safe | Search file contents by regex |
| `glob` | Safe | Match files by pattern |

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Token expired | Lazy refresh attempt; if refresh fails, prompt `xiaok auth login` |
| Model API 429/5xx | Exponential backoff in adapter, up to 3 retries, then surface error |
| Tool execution failure | Return error text to model for self-correction |
| yzj CLI not installed | AI context injection skipped; bash tool still works; install hint shown once |
| No API key configured | Exit immediately with message: `Run: xiaok config set api-key <key>` |
| stdin is not a TTY (CI) | Treat as `--auto` mode implicitly; log a warning |

---

## Testing Strategy

- **Unit tests:** Model adapter layer (each provider), token storage read/write, config read/write, tool permission logic
- **Integration tests:** Mock 云之家 OAuth endpoint, mock model API streaming responses
- **E2E tests:** Real agent loop with `--dry-run` flag to verify tool call sequences without side effects

---

## Configuration Files

`~/.xiaok/config.json` (schema version 1):
```json
{
  "schemaVersion": 1,
  "defaultModel": "claude",
  "models": {
    "claude": { "model": "claude-opus-4-6", "apiKey": "sk-ant-..." },
    "openai": { "model": "gpt-4o", "apiKey": "sk-..." },
    "custom": { "baseUrl": "https://...", "apiKey": "..." }
  },
  "devApp": { "appKey": "...", "appSecret": "..." },
  "defaultMode": "interactive",
  "contextBudget": 4000
}
```

`~/.xiaok/credentials.json` (shared with yzj CLI, owned by xiaok):
```json
{
  "schemaVersion": 1,
  "accessToken": "...",
  "refreshToken": "...",
  "enterpriseId": "...",
  "userId": "...",
  "expiresAt": "2026-03-29T12:00:00Z"
}
```

**Schema versioning:** Both files include `schemaVersion: 1`. On startup, xiaok checks the version; if it reads a file with an unknown version, it renames the old file to `*.bak` and starts fresh. Automatic migration between versions is a future concern.

---

## Out of Scope (Phase 1)

- GUI / web interface
- Plugin installation system
- Built-in platform resource commands (delegated to yzj CLI)
- Local model inference
- Conversation history persistence (in-memory only in Phase 1)
- OS keychain integration (plain file with `0600` permissions in Phase 1)
- Automatic migration of config/credentials schema versions
