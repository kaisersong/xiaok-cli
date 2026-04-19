# Repo Notes

## Worktrees

- The CLI runtime layer refactor has been integrated back into the main workspace.
- There is no active runtime refactor worktree for the current effort.
- Local validation of the `xiaok` command must use the main workspace at `/Users/song/projects/xiaok-cli`; do not `npm link` a feature worktree.
- If a future effort needs a worktree, create it only for isolated implementation and remove it after the change is integrated.

## Current Scope

- The completed refactor scope was the `xiaok chat` CLI runtime only.
- Do not fold `yzj` channel or webhook/websocket work into this runtime refactor.

## Active Ownership

- Owner A: CLI runtime refactor
- Owned files and directories:
- `src/ai/agent.ts`
- `src/ai/runtime/*`
- `tests/ai/runtime/*`
- `tests/commands/chat-runtime-integration.test.ts`
- test sandbox config files such as `package.json`, `tsconfig.tests.json`, `vitest.sandbox.config.mjs`, `tests/support/*`

- Owner B: channel and `yzj` work
- Owned files and directories:
- `src/channels/*`
- `src/commands/yzj.ts`
- related channel tests

## Single-Writer Files

- Only one Codex should be the final writer for each shared file.
- Current single-writer files for this effort:
- `package.json`: Owner A
- `AGENTS.md`: Owner A
- `src/types.ts`: ask before editing
- `src/commands/chat.ts`: ask before editing

## Conflict Protocol

- If you need to edit a file owned by another Codex, stop and leave a note instead of silently changing it.
- If a non-owner already changed an owner file, report it before more edits happen.
- Conflict reports must include all of the following:
- conflicting file paths
- whether the other change is committed or still local
- the commit hash if available
- which side should be treated as the base version
- one-line description of what each side changed

Use this exact format when reporting a conflict:

```text
Conflict files:
- src/ai/agent.ts
- package.json

Other change status:
- committed: abc123

Resolution preference:
- keep other version, adapt mine

Summary:
- other side changed agent initialization
- my side changed runtime facade
```

## Integration Rule

- Prefer small commits and main-workspace integration once a worktree effort is complete.
- Do not let two Codex instances make concurrent uncoordinated edits to the same file.
- If a shared file must change for both efforts, the single writer integrates both changes after reading the other commit.

## Current Release Notes

- `xiaok` is currently linked from the main workspace only and reports `0.6.1`.
- Terminal E2E verification uses `tests/e2e/tmux-e2e.py`, which starts a local OpenAI-compatible SSE server and a real tmux TTY.
- First submitted input keeps the startup welcome card above it until normal terminal scrolling moves it away; do not clear the content region on first submit.
- Live activity such as `Thinking` and `Working` renders on the activity row above the input footer, with a blank gap row between activity and `❯`; activity lines must not repeat footer status fields such as model, mode, tokens, or project.
- Verified after the 0.5.7 integration:
- `npm run build`
- targeted sandbox Vitest suite for terminal UI, sandbox expansion, and AskUserQuestion lifecycle
- `python3 tests/e2e/tmux-e2e.py`
- tmux cursor smoke check: startup cursor is on the bottom input bar, and typing keeps it there.

## Current Roadmap Docs

- Wave 1 spec: `docs/superpowers/specs/2026-03-31-xiaok-clio-wave1-runtime-tools-design.md`
- Wave 1 plan: `docs/superpowers/plans/2026-03-31-xiaok-clio-wave1-runtime-tools.md`
- Wave 2 spec: `docs/superpowers/specs/2026-03-31-xiaok-clio-wave2-workflow-operator-design.md`
- Wave 2 plan: `docs/superpowers/plans/2026-03-31-xiaok-clio-wave2-workflow-operator.md`
- Wave 3 spec: `docs/superpowers/specs/2026-03-31-xiaok-clio-wave3-agent-platform-design.md`
- Wave 3 plan: `docs/superpowers/plans/2026-03-31-xiaok-clio-wave3-agent-platform.md`

## Local Verification Note

- In this Windows sandbox, raw `vitest` against TypeScript sources can fail with `spawn EPERM` because Vite/esbuild try to start child processes.
- Use `npm test` or `npm run test:sandbox`, which first compiles `src/` and `tests/` into `.test-dist/` and then runs Vitest against emitted JavaScript with `vitest.sandbox.config.mjs`.
- The sandbox suite excludes subprocess-dependent tests such as `bash` and `grep`; run `npm run test:full` on an unrestricted machine for the complete suite.
