# TODOS

## Runtime First Phase 1

- Done: route `custom` providers to `ClaudeAdapter` when the endpoint/model is Claude-compatible (`/claude-code`, `anthropic`, `claude|sonnet|opus|haiku`).
- Done: cover custom provider adapter selection with regression tests for both Claude-style and GPT-style endpoints.
- Done: prevent `yzj serve --dry-run` from starting the websocket client, so verification no longer fails on missing `yzjtoken`.
- Done: unify MCP stdio transport on `Content-Length` framing inside `src/ai/mcp/runtime`, replacing the plugin runtime's line-delimited JSON path.
- Done: unify LSP stdio transport inside `src/platform/lsp`, replacing the plugin runtime's duplicate request/notification loop.
- Done: add real spawned fixture verification for declared MCP/LSP plugin servers, not just mocked child-process tests.
- Done: support subagent `cleanup: delete` frontmatter and actually release isolated worktrees after execution.
- Done: route background subagent completion into an existing team mailbox when agent metadata declares a `team`.
- Done: prevent `listBackgroundJobs()` from falsely marking in-flight jobs as interrupted just by reading state.
- Done: honor subagent frontmatter `model` during execution by cloning adapters when the provider supports per-model overrides.
- Done: preserve the invoking registry `cwd` for shared subagents and background subagent payloads instead of silently falling back to `process.cwd()`.
- Done: reject pending MCP/LSP stdio requests when server processes exit or transports are disposed, instead of leaving hung promises.
- Done: dispose declared MCP/LSP child processes when initialization fails, so broken plugin servers do not leak after startup errors.
- Done: swallow background job notification failures so `notify()` errors do not escape as unhandled rejections or corrupt job state.
- Done: add longer-chain runtime context coverage for real plugin manifests, connected MCP/LSP fixture processes, persisted capability health, and degraded startup handling.
- Done: fix `ToolRegistry` option defaulting so omitted `onPrompt` no longer becomes `undefined` and crashes prompt flows.
- Done: treat `permission: safe` tools as non-interactive by default, so platform tools like `team_create`, `subagent`, and MCP tools can run through the normal registry path without spurious cancellation prompts.
- Done: add a longer-chain registry factory integration test covering real plugin manifests, MCP tool execution, team creation, background subagent dispatch, model override, team mailbox delivery, and cwd propagation in one flow.
- Done: extend registry factory long-chain coverage to real git worktree isolation, including both success and failure paths with `cleanup: delete` verified against actual `git worktree list`.
- Done: add CLI-level smoke coverage for `chat --auto --json` against a fake custom OpenAI-compatible provider, proving config isolation, provider routing, real HTTP streaming, and structured print output.
- Done: add CLI-level degraded capability smoke coverage, proving broken plugin capabilities surface in stderr while the chat result still completes successfully.
- Done: push verification one level higher with command-level interactive chat tests around slash skill fork execution and background job status rendering in interactive flows.

## Wave 2

- Done: finish git workflow commands for both chat slash handling and top-level `xiaok commit|review|pr`.
- Done: add and pass tests for git workflow command behavior, root registration, and failure cases.
- Done: implement `src/runtime/hooks-runner.ts` with tests for pre/post hook execution, timeout, and failure handling.
- Done: extend permission UX with persisted allow rules, interactive approval flows, and Shift+Tab mode cycling.
- Done: finish operator commands: `/doctor`, `/init`, `/settings`, `/context`, plus transcript inspection support.
- Done: add input/status bar enhancements: undo/redo, configurable keybindings, and configurable status bar fields.
- Done: replace the remaining manual chat checks with automated command-level interaction coverage for ask-user round-trip, Shift+Tab mode cycling, and task inspection; finish with full `npm test` + `npm run build` verification.

## Wave 3

- Done: land Runtime First Phase 1 foundations for background agents, worktree isolation, agent teams, plugin runtime, MCP runtime, LSP, and sandbox integration.
- Next: plan the follow-on wave only after we decide which product behaviors need to move beyond the current validated foundation.

## Notes

- Continue from latest `master` in a fresh worktree, not the dirty root workspace.
- Respect ownership rules in `AGENTS.md`, especially for `src/commands/chat.ts` and `src/types.ts`.
