# TODOS

## Wave 2

- Finish git workflow commands: `/commit`, `/review`, `/pr`.
- Add and pass tests for git workflow command behavior and failure cases.
- Implement `src/runtime/hooks-runner.ts` with tests for pre/post hook execution, timeout, and failure handling.
- Extend permission UX: CLI allow/deny injection and Shift+Tab mode cycling.
- Finish operator commands: `/doctor`, `/init`, and any remaining `/settings` or `/context` work from the plan.
- Add input/status bar enhancements: undo/redo, configurable keybindings, configurable status bar fields.
- Run full verification: `npm test`, `npm run build`, then manually verify `/commit`, `/review`, ask-user round-trip, Shift+Tab, and task inspection.

## Wave 3

- Start only after Wave 2 is complete.
- Implement in order: background agents, worktree isolation, agent teams, plugin system, MCP runtime, LSP, sandboxing.

## Notes

- Continue from latest `master` in a fresh worktree, not the dirty root workspace.
- Respect ownership rules in `AGENTS.md`, especially for `src/commands/chat.ts` and `src/types.ts`.
