# xiaok Clio Wave 3 Agent Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `xiaok` 引入 background agents、worktree isolation、agent teams、plugin system、LSP、完整 MCP runtime 与 sandboxing 强化，形成平台层能力。

**Architecture:** 保持现有 `AgentRuntime` 为单 agent 内核，在其外增加 platform orchestration 层；插件、MCP、LSP、sandbox 都作为 capability provider 接入，而不是侵入 chat 核心循环。

**Tech Stack:** TypeScript, Node.js, Commander, Git worktrees, Vitest

---

## File Structure

- Create: `src/platform/agents/background-runner.ts`
- Create: `src/platform/worktrees/manager.ts`
- Create: `src/platform/teams/store.ts`
- Create: `src/platform/teams/service.ts`
- Create: `src/platform/plugins/manifest.ts`
- Create: `src/platform/plugins/loader.ts`
- Create: `src/platform/lsp/client.ts`
- Create: `src/platform/lsp/manager.ts`
- Create: `src/platform/sandbox/policy.ts`
- Create: `src/platform/sandbox/enforcer.ts`
- Create: `src/ai/mcp/runtime/client.ts`
- Create: `src/ai/mcp/runtime/server-process.ts`
- Modify: `src/ai/agents/loader.ts`
- Modify: `src/ai/mcp/client.ts`
- Modify: `src/ai/tools/index.ts`
- Modify: `src/commands/chat.ts`
- Modify: `src/index.ts`
- Test: `tests/platform/agents/*.test.ts`
- Test: `tests/platform/worktrees/*.test.ts`
- Test: `tests/platform/teams/*.test.ts`
- Test: `tests/platform/plugins/*.test.ts`
- Test: `tests/platform/lsp/*.test.ts`
- Test: `tests/platform/sandbox/*.test.ts`
- Test: `tests/ai/mcp/runtime/*.test.ts`

## Task 1: Background Agents

- [ ] Add tests for background agent job lifecycle and completion notification
- [ ] Implement background runner with persisted job metadata
- [ ] Expose background execution option to agent invocation path
- [ ] Verify jobs survive caller completion and surface final status

## Task 2: Worktree Isolation

- [ ] Add tests for worktree creation, reuse, cleanup metadata, and path validation
- [ ] Implement worktree manager
- [ ] Integrate sub-agent execution with optional isolated worktree selection
- [ ] Verify worktree paths remain inside configured project boundary

## Task 3: Agent Teams

- [ ] Add tests for team create/delete/send-message and member lookup
- [ ] Implement team store/service
- [ ] Add safe tools for team lifecycle and inter-agent messaging
- [ ] Verify background agents can exchange messages through team channel

## Task 4: Plugin System

- [ ] Add manifest parsing and collision tests
- [ ] Implement plugin loader with skills/agents/hooks/commands/MCP declarations
- [ ] Integrate plugin loading order with builtin/project/global config
- [ ] Verify plugins cannot silently override core capabilities without explicit precedence

## Task 5: LSP and MCP Runtime

- [ ] Add tests for Content-Length framing, diagnostics capture, and MCP stdio lifecycle
- [ ] Implement LSP client/manager
- [ ] Expand MCP support from schema normalization to full process runtime
- [ ] Verify diagnostics and MCP tools can be surfaced to runtime without crashing agent loop

## Task 6: Sandboxing

- [ ] Add tests for path, env, network, and resource policy enforcement
- [ ] Implement sandbox policy/enforcer modules
- [ ] Integrate sandbox checks with bash/file tools and worktree manager
- [ ] Verify policy decisions are explainable in CLI output and tests

## Task 7: Verification

- [ ] Run: `npm test`
- [ ] Run: `npm run build`
- [ ] Manually verify:
- [ ] background agent completion notifications
- [ ] isolated worktree execution
- [ ] plugin loading
- [ ] MCP server tool invocation
- [ ] LSP diagnostics injection

## Self-Review

- Spec coverage:
- background agents, worktrees, teams, plugins, LSP, MCP runtime, sandbox all mapped
- Placeholder scan:
- no unresolved placeholders
- Type consistency:
- platform-level code is isolated under `src/platform/*` and does not bloat `src/ai/runtime/*`

