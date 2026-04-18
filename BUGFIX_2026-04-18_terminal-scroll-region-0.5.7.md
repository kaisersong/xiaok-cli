# Terminal Scroll Region Bugfix Record - v0.5.7

Date: 2026-04-18
Scope: `xiaok` interactive terminal UI in the main workspace
Version: `0.5.7`

## Summary

The 0.5.7 terminal UI work stabilized the scroll-region layout used by `xiaok`.
The fixes converge prompt input, status footer, live activity, streamed markdown,
and submitted user input under `ScrollRegionManager` so the bottom rows stop
fighting for terminal cursor ownership.

Local validation must use the main workspace:

```text
/Users/song/projects/xiaok-cli
```

The globally linked command was verified as:

```text
0.5.7
/Users/song/.nvm/versions/node/v22.9.0/lib
└── xiaok@0.5.7 -> ./../../../../../projects/xiaok-cli
```

## Bugs And Fixes

### 1. Startup Cursor Appeared In The Welcome Card

Symptom:

- After starting `xiaok`, the cursor could appear inside the welcome card instead
  of the bottom input footer.

Root cause:

- Footer rendering reset the terminal scroll region, wrote the footer, positioned
  the cursor, and then restored the scroll region. Some terminals move the cursor
  when `DECSTBM` is applied, so the last scroll-region operation invalidated the
  cursor position.

Fix:

- `ScrollRegionManager.renderFooter()` now restores the scroll region before the
  final cursor-positioning operation.
- The final cursor operation places the cursor on the actual input row.

Coverage:

- `tests/ui/scroll-region.test.ts`
- `tests/e2e/tmux-e2e.py`

### 2. Input Background Leaked Or Did Not Fill The Row

Symptom:

- Typing in the input footer could leave the gray background active beyond the
  input row.
- The input background could fail to cover the full terminal width.

Root cause:

- The input footer wrote background styling without reliably padding to terminal
  width and resetting SGR state before the cursor move.

Fix:

- Input footer rows are padded to terminal width with the input background.
- Footer rendering resets attributes before restoring scroll-region cursor state.

Coverage:

- `tests/ui/scroll-region.test.ts`

### 3. Multiline Input Duplicated Prompt And Status Rows

Symptom:

- Entering multiline text such as:

```text
1
2
3
4
```

  could duplicate previous prompt rows and status-bar rows in the terminal.

Root cause:

- The footer renderer originally treated the input as a single fixed row and did
  not clear both the previous input footprint and the new expanded footprint.

Fix:

- The input editor now expands upward above the status row.
- The status row remains fixed at the bottom.
- Previous and current input editor rows are cleared before every redraw.
- Visible multiline input is rendered directly, not summarized as `[N lines]`.

Expected layout:

```text
❯ 1
  2
  3
  4
gpt-5.4 · 5% · master · xiaok-cli
```

Coverage:

- `tests/ui/scroll-region.test.ts`
- `tests/e2e/tmux-e2e.py`

### 4. First Submitted Input Removed The Welcome Separator

Symptom:

- Reopening `xiaok` and sending the first message could make the welcome card
  disappear immediately.
- Because terminal scrollback still contains content from the previous process,
  the first submitted input appeared visually attached to old terminal output.

Root cause:

- The first submit path called `clearContentArea()`, clearing the scroll region
  instead of letting the welcome card scroll naturally.

Fix:

- The first submitted input now keeps the startup welcome card above it.
- The welcome card acts as the visual separator between old terminal scrollback
  and the new session until normal scrolling moves it away.

Coverage:

- `tests/commands/chat-interactive-runtime.test.ts`
- `tests/e2e/tmux-e2e.py`

### 5. `Thinking` / `Working` Appeared In The Input Footer

Symptom:

- During a turn, `Thinking` or `working...` could render in the bottom input row
  instead of above it.

Root cause:

- `beginActivity()` and `clearLastInput()` used the footer input placeholder as
  the place to show working state.
- `renderActivity()` skipped rendering when the footer was visible, so activity
  could not occupy the row above the footer.

Fix:

- Activity renders on the dedicated activity row above the input footer.
- A blank gap row remains between activity and the `❯` input row.
- The input footer keeps its input placeholder instead of showing `working...`.
- `Thinking` starts immediately after submitted input is written, not only after
  prompt-building finishes.

Expected layout:

```text
⠋ Thinking · 1s

❯ Type your message...
gpt-terminal-e2e · auto · 0% · project
```

Coverage:

- `tests/ui/scroll-region.test.ts`
- `tests/commands/chat-interactive-runtime.test.ts`
- `tests/e2e/tmux-e2e.py`

### 6. Activity Line Repeated Footer Status Fields

Symptom:

- Once activity was correctly placed above the footer, it still included footer
  status data:

```text
⠋ Thinking · 1s · gpt-terminal-e2e · auto · 0% · project
```

Root cause:

- `StatusBar.getActivityLine()` reused `getLiveStatusLine()`, which appends the
  full footer status text.

Fix:

- `getActivityLine()` now generates a scroll-region activity-only line:

```text
⠋ Thinking · 1s
```

- Model, mode, token usage, branch, and project remain only in the bottom status
  footer.

Coverage:

- `tests/ui/statusbar.test.ts`
- `tests/e2e/tmux-e2e.py`

## Verification

Fresh verification used:

```bash
npm run test:sandbox:build
```

```bash
node -r ./tests/support/vite-net-use-patch.cjs ./node_modules/vitest/vitest.mjs run --config vitest.sandbox.config.mjs --configLoader runner .test-dist/tests/ui/statusbar.test.js .test-dist/tests/ui/scroll-region.test.js .test-dist/tests/commands/chat-interactive-runtime.test.js
```

Result:

```text
3 passed
77 tests passed
```

Build:

```bash
npm run build
```

Real terminal E2E:

```bash
python3 tests/e2e/tmux-e2e.py
```

Result:

```text
PASS: welcome screen and footer are visible
PASS: multiline input does not duplicate prompt or status
PASS: typed input and slash overlay are visible
PASS: first streamed response and footer are stable
PASS: multi-turn output remains visible without activity duplication
PASS: terminal e2e completed
```

## Release Notes

- Package version: `0.5.7`
- GitHub release target: `v0.5.7`
- Local command must remain linked from `/Users/song/projects/xiaok-cli`, not a
  feature worktree.
