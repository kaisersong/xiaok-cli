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
│   │   ├── token-store.ts        # Encrypted local token storage
│   │   └── identity.ts           # Developer identity (appKey, enterprise ID)
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
xiaok auth login     # Open browser OAuth flow, store token
xiaok auth logout    # Clear credentials
xiaok auth status    # Show current account and enterprise

# AI Agent (main feature)
xiaok                # Start interactive agent (default)
xiaok chat           # Same as above, explicit
xiaok "task desc"    # Single-shot task mode

# Config
xiaok config set model claude-opus-4-6
xiaok config set model openai/gpt-4o
xiaok config set model custom --base-url https://... --api-key ...
xiaok config get model
```

### Phase 2+ (Platform Resource Management via yzj CLI)

All platform operations (messaging, apps, org structure, workflows, logs) are handled by **yzj CLI** and invoked by xiaok's AI agent via the `bash` tool. xiaok itself does not re-implement these commands.

---

## Modules

### 1. Auth Module

- Browser OAuth 2.0 flow: open 云之家 authorization URL, receive callback on local HTTP server
- Store tokens encrypted at `~/.xiaok/credentials.json`
- **SSO with yzj CLI**: yzj CLI reads the same credentials file — users log in once via `xiaok auth login`, yzj CLI works automatically

### 2. AI Agent Module (Core)

- Interactive mode: streaming output, markdown rendering, multi-turn conversation
- Single-shot mode: `xiaok "write a script to call 云之家 messaging API"`
- Permission modes:
  - Default: confirm before executing write/destructive operations
  - `--auto`: execute all tools without confirmation (for CI/scripting)
- Tool execution errors are fed back to the model for self-correction

### 3. Multi-Model Adapter Layer

Unified interface across providers. Switching models requires only config change, no code change.

```
XIAOK_API_KEY env var > ~/.xiaok/config.json > defaults
```

Supports CI/CD: inject credentials via environment variables, no interactive login required.

### 4. 云之家 Context Injection

The system prompt automatically includes:
- 云之家 API overview and key concepts
- yzj CLI usage reference (dynamically loaded if yzj CLI is installed)
- Current logged-in enterprise context (corp ID, developer app info)

### 5. Built-in Tool Set

| Tool | Description |
|------|-------------|
| `bash` | Execute shell commands, including yzj CLI calls |
| `read` | Read file contents |
| `write` | Write/create files |
| `edit` | Precise string replacement in files |
| `grep` | Search file contents by regex |
| `glob` | Match files by pattern |

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Token expired | Prompt user to run `xiaok auth login` |
| Model API failure | Show error, do not crash, offer retry |
| Tool execution failure | Return error to model for self-correction |
| yzj CLI not installed | Show install instructions, other features unaffected |

---

## Testing Strategy

- **Unit tests:** Model adapter layer, token storage, config read/write
- **Integration tests:** Mock 云之家 OAuth endpoint, mock model API
- **E2E tests:** Real agent loop with `--dry-run` flag to verify tool call sequences without side effects

---

## Configuration File

`~/.xiaok/config.json`:
```json
{
  "model": "claude-opus-4-6",
  "apiKey": "...",
  "defaultMode": "interactive"
}
```

`~/.xiaok/credentials.json` (shared with yzj CLI):
```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "enterpriseId": "...",
  "expiresAt": "..."
}
```

---

## Out of Scope (Phase 1)

- GUI / web interface
- Plugin installation system
- Built-in platform resource commands (delegated to yzj CLI)
- Local model inference
