# xiaok Clio Wave 1 Runtime and Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `xiaok chat` 补齐会话持久化、print mode、上下文治理、prompt caching、上下文自动加载、web tools 与文件工具分页截断。

**Architecture:** 在现有 `AgentRuntime` 之上新增 session store、model capability、context loader 与工具截断层；`chat.ts` 负责 CLI mode、resume/fork/print/image 输入入口，adapter 负责 provider-specific cache/image 映射。

**Tech Stack:** TypeScript, Node.js, Commander, Vitest

---

## File Structure

- Create: `src/ai/runtime/session-store.ts`
- Create: `src/ai/runtime/model-capabilities.ts`
- Create: `src/ai/runtime/context-loader.ts`
- Create: `src/ai/tools/web-fetch.ts`
- Create: `src/ai/tools/web-search.ts`
- Create: `src/ai/tools/truncation.ts`
- Modify: `src/commands/chat.ts`
- Modify: `src/ai/runtime/agent-runtime.ts`
- Modify: `src/ai/agent.ts`
- Modify: `src/ai/tools/read.ts`
- Modify: `src/ai/tools/glob.ts`
- Modify: `src/ai/tools/grep.ts`
- Modify: `src/ai/tools/bash.ts`
- Modify: `src/ai/tools/index.ts`
- Modify: `src/ai/models.ts`
- Modify: `src/ai/adapters/claude.ts`
- Modify: `src/ai/adapters/openai.ts`
- Test: `tests/ai/runtime/session-store.test.ts`
- Test: `tests/ai/runtime/model-capabilities.test.ts`
- Test: `tests/ai/runtime/context-loader.test.ts`
- Test: `tests/ai/tools/web-fetch.test.ts`
- Test: `tests/ai/tools/web-search.test.ts`
- Test: `tests/ai/tools/truncation.test.ts`
- Test: `tests/commands/chat-sessions.test.ts`
- Test: `tests/commands/chat-print-mode.test.ts`
- Test: `tests/ui/image-input.test.ts`

## Task 1: Session Persistence

- [ ] Add session storage tests for save/load/list/fork behavior
- [ ] Implement `session-store.ts` with file-backed persistence under xiaok config dir
- [ ] Wire runtime/session state serialization into `chat.ts`
- [ ] Add `--resume <id>` and `--fork-session <id>` command options
- [ ] Verify resumed sessions preserve message history and usage

## Task 2: Model-Aware Context and Prompt Caching

- [ ] Add capability tests for different providers/models
- [ ] Implement `model-capabilities.ts` with per-model context metadata
- [ ] Refactor `agent-runtime.ts` to source compact thresholds from capabilities
- [ ] Add cache-segment abstraction in runtime and adapter mapping in Claude/OpenAI adapters
- [ ] Verify unsupported adapters ignore cache metadata safely

## Task 3: Context Auto-Load

- [ ] Add tests for upward `CLAUDE.md` / `AGENTS.md` traversal and size limiting
- [ ] Implement `context-loader.ts`
- [ ] Extend `buildSystemPrompt()` call sites to include loaded prompt docs and git summary
- [ ] Verify docs and git state appear in system prompt with truncation

## Task 4: Web Tools and Smart Truncation

- [ ] Add tests for `WebFetch` text extraction and size cap
- [ ] Add tests for `WebSearch` result formatting
- [ ] Add tests for Read/Glob/Grep/Bash pagination and truncation helpers
- [ ] Implement `web-fetch.ts`, `web-search.ts`, and `truncation.ts`
- [ ] Refactor file/search/bash tools to use shared truncation policy
- [ ] Register new tools in `tools/index.ts`

## Task 5: Print Mode and Image Input

- [ ] Add chat print-mode tests covering plain text and JSON output
- [ ] Add image-path parsing tests for local file inputs
- [ ] Extend `chat.ts` with `-p` / `--json` behavior and non-interactive output shaping
- [ ] Add image block parsing in input path before adapter invocation
- [ ] Verify interactive mode behavior remains unchanged

## Task 6: Verification

- [ ] Run: `npm test`
- [ ] Run: `npm run build`
- [ ] Manually verify:
- [ ] `xiaok chat --resume <id>`
- [ ] `xiaok chat --fork-session <id>`
- [ ] `xiaok chat -p "say hi"`
- [ ] `xiaok chat -p --json "say hi"`

## Self-Review

- Spec coverage:
- session persistence, print mode, context governance, prompt caching, auto-loaded context, web tools, truncation, image input all mapped
- Placeholder scan:
- no TBD/TODO placeholders
- Type consistency:
- runtime additions stay under `src/ai/runtime/*`; tools stay under `src/ai/tools/*`

