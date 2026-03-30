# xiaok Clio Wave 2 Workflow and Operator Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `xiaok` 增加 plan mode、task tools、ask-user、git workflow、hooks、operator commands、输入与状态栏增强。

**Architecture:** 复用第一轮 runtime，并把现有 YZJ task manager 抽成 shared task subsystem；CLI slash commands、safe tools、hook runner 与 permission UX 一起收敛成可控工作流层。

**Tech Stack:** TypeScript, Node.js, Commander, Vitest

---

## File Structure

- Create: `src/runtime/tasking/types.ts`
- Create: `src/runtime/tasking/store.ts`
- Create: `src/runtime/tasking/manager.ts`
- Create: `src/ai/tools/ask-user.ts`
- Create: `src/ai/tools/tasks.ts`
- Create: `src/runtime/hooks-runner.ts`
- Create: `src/runtime/keybindings.ts`
- Create: `src/commands/doctor.ts`
- Create: `src/commands/init.ts`
- Create: `src/commands/review.ts`
- Create: `src/commands/commit.ts`
- Create: `src/commands/pr.ts`
- Modify: `src/ai/permissions/manager.ts`
- Modify: `src/commands/chat.ts`
- Modify: `src/ui/input.ts`
- Modify: `src/ui/statusbar.ts`
- Modify: `src/channels/task-manager.ts`
- Modify: `src/channels/task-store.ts`
- Modify: `src/index.ts`
- Test: `tests/runtime/tasking/*.test.ts`
- Test: `tests/ai/tools/ask-user.test.ts`
- Test: `tests/ai/tools/tasks.test.ts`
- Test: `tests/runtime/hooks-runner.test.ts`
- Test: `tests/commands/doctor.test.ts`
- Test: `tests/commands/git-workflow.test.ts`
- Test: `tests/ui/input-undo-redo.test.ts`
- Test: `tests/ui/statusbar-config.test.ts`

## Task 1: Shared Task Subsystem

- [ ] Add tests for task create/update/list/get and progress messages
- [ ] Implement shared task types/store/manager under `src/runtime/tasking/*`
- [ ] Migrate YZJ task manager/store to the shared subsystem or thin wrappers
- [ ] Verify YZJ tests still pass after migration

## Task 2: Plan Mode and Ask-User

- [ ] Add tests for entering/exiting plan mode and denial semantics
- [ ] Implement explicit plan mode transitions in permission manager and chat command handling
- [ ] Add `ask-user` tool and blocking response flow in CLI runtime
- [ ] Verify agent can ask a question and resume execution

## Task 3: Task Tools

- [ ] Add safe tool tests for TaskCreate/Update/List/Get
- [ ] Implement tool wrappers around shared task manager
- [ ] Register task tools and expose them to system prompt/tool registry
- [ ] Verify task tools and YZJ task store do not diverge

## Task 4: Git Workflow Commands

- [ ] Add tests for `/commit`, `/review`, `/pr` command behavior with mocked git/gh execution
- [ ] Implement narrow command handlers with non-interactive git calls
- [ ] Wire commands into chat CLI slash-command handling or top-level commands
- [ ] Verify failure messaging when repo or `gh` is unavailable

## Task 5: Hooks and Permission UX

- [ ] Add tests for pre/post hook execution, timeout, and failure behavior
- [ ] Implement `hooks-runner.ts`
- [ ] Extend permission manager with CLI allow/deny injection and richer mode UX
- [ ] Add Shift+Tab mode cycling in input handler
- [ ] Verify pre hooks can block tool execution and post hooks only warn

## Task 6: Operator Commands and UI

- [ ] Add `/doctor`, `/settings`, `/context`, `/init` command tests
- [ ] Implement operator command handlers
- [ ] Add undo/redo and configurable keybindings in input handler
- [ ] Add configurable status bar fields and mode display
- [ ] Verify interactive UI remains stable on Windows terminal constraints

## Task 7: Verification

- [ ] Run: `npm test`
- [ ] Run: `npm run build`
- [ ] Manually verify:
- [ ] `/commit`
- [ ] `/review`
- [ ] ask-user round-trip
- [ ] Shift+Tab permission mode switching
- [ ] task inspection from CLI and YZJ paths

## Self-Review

- Spec coverage:
- tasking, plan mode, ask-user, git workflow, hooks, permission UX, operator commands, input/statusbar all mapped
- Placeholder scan:
- no unresolved placeholders
- Type consistency:
- shared tasking lives under `src/runtime/tasking/*`; YZJ keeps adaptor role only

