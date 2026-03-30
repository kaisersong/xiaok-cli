# Repo Notes

## Worktrees

- Feature work should use project-local worktrees under `.worktrees/`.
- The main workspace at the repo root may contain unrelated local changes; avoid mixing feature implementation into the root workspace.
- The CLI runtime layer refactor for the current effort lives under `.worktrees/cli-runtime-layer`.

## Current Scope

- The active refactor scope is the `xiaok chat` CLI runtime only.
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

- Prefer small commits and `cherry-pick` across worktrees.
- Do not let two Codex instances make concurrent uncoordinated edits to the same file.
- If a shared file must change for both efforts, the single writer integrates both changes after reading the other commit.

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
