# Repo Notes

## Worktrees

- The CLI runtime layer refactor has been integrated back into the main workspace.
- There is no active runtime refactor worktree for the current effort.
- Local validation of the `xiaok` command must use the main workspace at `/Users/song/projects/xiaok-cli`; do not `npm link` a feature worktree.
- If a future effort needs a worktree, create it only for isolated implementation and remove it after the change is integrated.

## Current Scope

- The completed refactor scope was the `xiaok chat` CLI runtime only.
- Do not fold `yzj` channel or webhook/websocket work into this runtime refactor.

## Current Release Notes

- `xiaok` is currently linked from the main workspace only and reports `0.6.7`.
- Terminal E2E verification uses `tests/e2e/tmux-e2e.py`, which starts a local OpenAI-compatible SSE server and a real tmux TTY.
- First submitted input keeps the startup welcome card above it until normal terminal scrolling moves it away; do not clear the content region on first submit.
- Live activity such as `Thinking` and `Working` renders on the activity row above the input footer, with a blank gap row between activity and `❯`; activity lines must not repeat footer status fields such as model, mode, tokens, or project.
- Verified after the 0.6.7 integration:
- `npm run build`
- `npm run test:sandbox:build`
- `npm run test:sandbox:run -- .test-dist/tests/ui/scroll-region.test.js .test-dist/tests/ui/tool-explorer.test.js .test-dist/tests/ui/permission-prompt.test.js`

## Current Roadmap Docs

- Wave 1 spec: `docs/superpowers/specs/2026-03-31-xiaok-clio-wave1-runtime-tools-design.md`
- Wave 1 plan: `docs/superpowers/plans/2026-03-31-xiaok-clio-wave1-runtime-tools.md`
- Wave 2 spec: `docs/superpowers/specs/2026-03-31-xiaok-clio-wave2-workflow-operator-design.md`
- Wave 2 plan: `docs/superpowers/plans/2026-03-31-xiaok-clio-wave2-workflow-operator.md`
- Wave 3 spec: `docs/superpowers/specs/2026-03-31-xiaok-clio-wave3-agent-platform-design.md`
- Wave 3 plan: `docs/superpowers/plans/2026-03-31-xiaok-clio-wave3-agent-platform.md`

## Local Verification Note

- In this Codex sandbox, raw `vitest` against TypeScript sources can fail with `spawn EPERM` because Vite/esbuild try to start child processes.
- Use `npm test` or `npm run test:sandbox`, which first compiles `src/` and `tests/` into `.test-dist/` and then runs Vitest against emitted JavaScript with `vitest.sandbox.config.mjs`.
- The reminder/daemon suites open real Unix sockets. In the restricted sandbox they can fail with `listen EPERM`; rerun `npm run test:sandbox` with unrestricted permissions when you need the full pass signal.
- The sandbox suite excludes subprocess-dependent tests such as `bash` and `grep`; run `npm run test:full` on an unrestricted machine for the complete suite.

## Docs Symlink Scope

- `docs` in this workspace is a symlink to `/Users/song/projects/mydocs/xiaok-cli`.
- Treat `docs/design/**` and related design/spec docs under `docs/**` as normal in-scope project files for this repo's work.
- Do not ask for extra confirmation just because a design-doc edit crosses that symlink boundary; update the smallest relevant doc set directly when the task requires it.
- Remember that `git status` in `/Users/song/projects/xiaok-cli` will not show those doc edits, because the actual files live in the `mydocs` repo.
