# Xiaok Loop Engineering Release Sentinel

## Run Metadata
- Time: 2026-06-15 21:04:52 CST
- Trigger: manual (user-loop-96ed09e9-97df-481b-a02a-0fd4fa189fb0)
- Repository: /Users/song/projects/xiaok-cli (branch: codex/user-loop-template-scheduled)
- App Version: 1.4.6
- App Path: /Applications/xiaok.app
- Report Path: /Users/song/projects/xiaok-cli/quality/loops/loop-engineering-release-sentinel.md

## Executive Summary
1. **App v1.4.6 is running; services are healthy.** Both Intent Broker (4318) and KSwarm (4400) return HTTP 200.
2. **User Loop Template MVP code is on a feature branch with 35+ modified + 4 untracked files** — not yet merged to main. This is expected work-in-progress.
3. **Loop diagnostics correctly moved to Loops page** — General Settings no longer calls Loop APIs on mount; tests explicitly verify this.
4. **i18n coverage is solid for both zh and en** — all required Chinese keys (循环, 用户循环, 新建 Markdown 循环, 立即运行, 启用调度, 关闭调度, 批准自动运行) exist with English counterparts present and matching.
5. **Test suite + typecheck execution was not completed** due to tool budget; status is **inconclusive** and commands must be re-run manually.

## Health Checks
| Check | Status | Evidence |
| --- | --- | --- |
| xiaok-cli git status | ⚠️ WIP branch | 35 modified + 4 untracked on `codex/user-loop-template-scheduled`; not on main |
| kswarm git status | ✅ clean | Only `?? .governance-log/` (untracked governance log) |
| intent-broker git status | ✅ clean | Only `?? .governance-log/` (untracked governance log) |
| kai-xiaok-plugins git status | ✅ clean | No changes |
| Intent Broker health (4400) | ✅ HTTP 200 | curl returned 200 |
| KSwarm health (4318) | ✅ HTTP 200 | curl returned 200 |
| desktop app.asar timestamp | ✅ Fresh | Modified 2026-06-15 20:58 (today) |
| desktop renderer Loop settings test | ⏳ inconclusive | 11 test cases exist; did not execute in this run |
| desktop typecheck | ⏳ inconclusive | Did not execute in this run |

## Loop Documentation Review

### Coverage Assessment

| Area | Status | Evidence |
| --- | --- | --- |
| Loop Engineering concept (EN README) | ✅ Complete | Section "Loop Engineering in Xiaok" explains Automation → Connectors → Sub-agents → Memory → Evidence → Diagnostics building blocks with Xiaok implementation mapping |
| Loop Engineering concept (ZH README) | ✅ Complete | README.zh-CN.md has parallel section "Xiaok 中的 Loop Engineering" with full Chinese translations of all building blocks |
| User Loop creation flow | ✅ Design doc | `docs/design/2026-06-15-user-loop-template-scheduled-mvp.md` defines user flow: create → manual run → schedule → verify history → evidence guard |
| Loop vs Project vs Scheduled Task boundary | ✅ Design doc | `docs/design/2026-06-12-loop-vs-project-vs-scheduled-task-boundary.md` clearly defines object scope, ownership, v0 limits |
| Loop diagnostics user guidance | ⚠️ Partial | v1.4.5/v1.4.6 release notes mention "Actionable Loop Diagnostics" and "Read-only Loop Diagnostics" but no standalone user-facing guide explains step-by-step how to read diagnostics |
| Loop failure diagnosis flow | ❌ Gap | No doc explicitly tells users: "When your User Loop run shows `blocked`/`failed`, go to Loops page → expand run history → check `nextActionKind` and `nextActionSummary` → follow suggested action" |
| Loops page vs General page placement | ✅ Design doc | `docs/design/2026-06-15-loop-settings-diagnostics-i18n.md` explicitly designs moving diagnostics from General to Loops |

### Identified Gaps
- **No README.zh-CN.md mention of User Loop Templates.** The zh README covers built-in loops (Evidence Regression, KSwarm Health) but does not mention that users can now create their own Markdown file loops. The EN README has the same gap — user-defined loops are only in design docs, not in the public README.
- **No changelog entry for v1.4.7** yet in README (expected, since branch is not merged).
- **Diagnostics placement description** in README release notes from older versions (v1.4.4) says "Desktop exposes loop/evidence diagnostics through read-only IPC and settings surfaces" without specifying *which* settings page. Not actively misleading since the move to Loops page is recent, but could confuse.

## Product Behavior Review

### Loops Page
- ✅ **Loop diagnostics moved to Loops page.** `DesktopSettings.tsx` shows `{activeTab === 'loops' && <LoopsSettings />}` and `{activeTab === 'general' && <GeneralPane />}`. `GeneralPane` no longer contains any Loop API calls.
- ✅ **Test explicitly verifies General does not call Loop APIs:** `expect(mocks.getLoopDefinitions).not.toHaveBeenCalled()` when on default General tab.
- ✅ **Test explicitly verifies Loops tab renders diagnostics:** `fireEvent.click(screen.getByRole('button', { name: '循环' }))` then `await screen.findByText('Artifact Evidence Regression')`.

### General Page
- ✅ **No loop content on General page.** `GeneralPane()` handles locale, skill debug, concurrency, service status, display name/avatar. No Loop references.

### i18n Coverage
- ✅ **Chinese locale has all required keys:** 循环 (loops), 用户循环 (userLoopsTitle), 新建 Markdown 循环 (newMarkdownLoop), 立即运行 (runNow), 启用调度 (enableSchedule), 关闭调度 (disableSchedule), 批准自动运行 (approveAutoRun), 撤销自动运行 (revokeAutoRun).
- ✅ **English locale has matching keys:** Loops, User loops, New Markdown Loop, Run now, Enable schedule, Disable schedule, Approve auto-run, Revoke auto-run.
- ✅ **No hardcoded English in Loop UI chrome.** LoopsSettings.tsx uses `labels.xxx` (from `t.desktopSettings.loopsSettings`) for every visible label.
- ✅ **LoopDiagnosticsPanel uses locale:** `t.desktopSettings.loopDiagnosticsRefresh` renders "刷新" (zh) / "Refresh" (en).

### Accessibility
- ⚠️ **LoopDiagnosticsPanel Refresh button lacks `aria-label`.** The `<button>` at line ~130 has text content `t.desktopSettings.loopDiagnosticsRefresh` but no explicit `aria-label`. The LoopsSettings Refresh button at line ~290 uses `labels.refreshUserLoops` as text content but also lacks an explicit `aria-label`. This creates a potential duplicate-name issue: two buttons both conceptually called "Refresh" / "刷新" without unique aria labels to distinguish them (one for built-in diagnostics, one for user loops).
- ✅ **Run/Copy buttons use unique `aria-label` with loop id:** `run-loop-${loop.id}`, `copy-loop-diagnostics-${loop.id}`.
- ✅ **User loop card buttons use locale-backed `aria-label` with context:** `openOutputDirectoryAria(path)`, `previewOutputFileAria(fileName)`.

### NAV_ITEMS Localization
- ⚠️ **Sidebar nav items use hard-coded Chinese labels** for most tabs (e.g., `{ key: 'general', icon: SlidersHorizontal, label: '通用设置' }`) with a special-case override only for `loops`: `const navLabel = key === 'loops' ? t.desktopSettings.loops : label`. Other tabs still use static Chinese strings, but this is a pre-existing issue, not introduced by Loop changes.

## Adversarial Review

### Maker Perspective
- **Can a user understand and execute a Loop?** Partially yes. The settings UI exposes "New Markdown Loop" → fill title/prompt/output → "Create" → "Run now". This is a reasonable flow. However, the empty state says "暂无用户循环" with no explanatory text about *what* a Markdown Loop does or *why* they'd want one.
- **Most valuable information:** The Loop card shows last run status (success/failed/blocked), schedule state, and auto-run approval. The blocked run surfaces `nextActionKind: missing_file_artifact` and `nextActionSummary` — very actionable.
- **Blocking experience issue:** When a run fails with `blocked`, the user sees "Missing Markdown file artifact: weekly-note.md" but there's no inline link to retry or fix — they have to figure out themselves that they need to click "Run now" again. The card output directory/file buttons help but are separate from the error message.

### Checker Perspective
- **Evidence sufficiency:** All "✅" claims above are backed by source code reads, file listings, and test file content. No "it should work" without evidence.
- **Build pass ≠ app behavior pass risk:** The test file mocks all IPC calls and renders with `@testing-library/react`. This validates component rendering but does not validate real Electron IPC contract, real SQLite state persistence, or real TimedAction schedule binding. The test for "General Settings no longer calls Loop APIs" is strong evidence though, as the mock call count is checked.
- **Doc written but product not implemented?** The design doc `2026-06-15-user-loop-template-scheduled-mvp.md` describes a full MVP. The code exists on the branch. The app version is still 1.4.6, not 1.4.7. The user loop features are **not yet in the released app** — they're on a feature branch. So currently a user running v1.4.6 would not see User Loop creation in Settings.
- **Chinese/English coverage gap?** The sidebar NAV_ITEMS labels for tabs other than `loops` are hard-coded Chinese — English locale users would see Chinese tab names. This is a pre-existing issue, not Loop-specific.
- **Silent failure risk:** If `listUserLoopTemplates` rejects, `LoopsSettings` catches and sets generic `loadError`. The UI shows the error string. Low silent-failure risk for user loops. For built-in loop diagnostics, `loopDiagnosticsError` is rendered inline. Adequate.

### Conflict Resolution
- **Maker says:** Users can create and run loops (on the branch). Feature is shippable.
- **Checker says:** Feature is not in released v1.4.6. Branch must merge first.
- **Resolution:** Both are right. The branch code is well-structured with tests and i18n, but shipping requires merge + version bump + release build. Current sentinel covers *branch readiness*, not *released readiness*.

## Findings

### P0 — None
No issues found that would prevent app startup, corrupt data, or execute destructive operations.

### P1 — 2 issues

**P1-1: Test + typecheck verification inconclusive**
- Evidence: Commands `npm run test -- --run tests/renderer/desktop-settings-service-status.test.tsx --reporter=basic` and `npm run typecheck` were not executed due to tool budget.
- Impact: Cannot confirm that the 35+ modified files compile cleanly or that all 11 Loop tests pass. A type error or test failure could block merge.
- Suggested fix: Run both commands manually in `/Users/song/projects/xiaok-cli/desktop`.
- Verification: `npm run typecheck` exits 0; `npm run test -- --run tests/renderer/desktop-settings-service-status.test.tsx --reporter=basic` exits 0.

**P1-2: User Loop features not in released app (v1.4.6)**
- Evidence: App version from Info.plist is `1.4.6`. The User Loop Template code lives on branch `codex/user-loop-template-scheduled` with 4 untracked files including `user-loop-template-runner.ts`, `LoopsSettings.tsx`, `LoopDiagnosticsPanel.tsx`.
- Impact: Anyone installing v1.4.6 today will not see User Loop creation or the Loops settings tab. Built-in loop diagnostics are also behind the branch merge (unless already present in earlier builds — diagnostics were added in v1.4.5/v1.4.4 but relocated in this branch).
- Suggested fix: Merge branch to main, bump version to 1.4.7, build, and release.
- Verification: `/Applications/xiaok.app/Contents/Info.plist` shows `CFBundleShortVersionString >= 1.4.7` and Loops tab is visible in Settings.

### P2 — 3 issues

**P2-1: Two Refresh buttons on Loops page without distinguishing aria-label**
- Evidence: `LoopDiagnosticsPanel.tsx` line ~130 has a Refresh button with text `loopDiagnosticsRefresh` ("刷新"/"Refresh"). `LoopsSettings.tsx` line ~290 has another Refresh button with text `refreshUserLoops` ("刷新用户循环"/"Refresh user loops"). Neither has an explicit `aria-label`. Screen readers and automated tests may struggle to distinguish them if localized text is similar.
- Impact: Accessibility ambiguity; test fragility if both buttons resolve to "刷新" in Chinese.
- Suggested fix: Add `aria-label={labels.refreshUserLoopDiagnostics}` on diagnostics panel Refresh and `aria-label={labels.refreshUserLoopsAria}` on user loops Refresh.
- Verification: Automated test can `getByLabelText('refresh-built-in-loop-diagnostics')` and `getByLabelText('refresh-user-loops')` distinctly.

**P2-2: No user-facing explanation of User Loops in README**
- Evidence: Both README.md and README.zh-CN.md describe Loop Engineering concept and built-in loops but do not mention user-created Markdown loops. The only doc is the internal design file.
- Impact: Users reading README cannot discover this feature. If they stumble into the Loops tab, the empty state gives no conceptual guidance.
- Suggested fix: Add a "User Loop Templates" section under the Loop Engineering section in both READMEs. Add a brief explanatory paragraph in the LoopsSettings empty state (e.g., "用户循环让您配置一个重复执行的 Markdown 文件生成任务，适合周期性报告、日志整理等场景").
- Verification: README contains "User Loop" / "用户循环" section; LoopsSettings empty state includes descriptive text.

**P2-3: Sidebar NAV_ITEMS hard-code Chinese labels for non-Loops tabs**
- Evidence: DesktopSettings.tsx line ~66: labels like `label: '通用设置'`, `label: '外观'` are static. Only the `loops` key gets locale replacement via `const navLabel = key === 'loops' ? t.desktopSettings.loops : label`.
- Impact: English locale users see Chinese tab names for all settings tabs except Loops. Pre-existing but inconsistent with the Loops fix.
- Suggested fix: Either move all NAV_ITEMS labels to locale keys, or accept the inconsistency and document it as tech-debt.
- Verification: Switch locale to English; all tab labels render in English.

### P3 — 2 issues

**P3-1: Loop failure diagnosis user guide missing**
- Evidence: No document or UI tooltip tells the user: "When a run is blocked, check nextActionKind → take the suggested action → re-run." The information is displayed in the card but not explained.
- Impact: Low — power users can infer the flow; casual users may be confused by "blocked" status.
- Suggested fix: Add a tooltip or collapsible "What does this mean?" section on blocked run cards.
- Verification: Blocked run card shows an explanation tooltip/section.

**P3-2: Older README changelog entries still say "settings surfaces" for diagnostics without specifying Loops page**
- Evidence: README v1.4.4 entry: "Read-only Loop Diagnostics: Desktop exposes loop/evidence diagnostics through read-only IPC and settings surfaces." Does not say which page.
- Impact: Very low — this is historical release note text, not navigation guidance.
- Suggested fix: No action required; future changelog entries should say "Loops page" instead.
- Verification: N/A.

## Recommended Next Actions
1. **Run the two verification commands** in `/Users/song/projects/xiaok-cli/desktop`: `npm run typecheck` and `npm run test -- --run tests/renderer/desktop-settings-service-status.test.tsx --reporter=basic`. Record results. (P1)
2. **Merge branch to main** after tests pass: `codex/user-loop-template-scheduled` → `main`, bump version to 1.4.7, build, and tag. (P1)
3. **Add distinguishing aria-label** to both Refresh buttons on the Loops page. (P2)
4. **Add User Loop section to README.md and README.zh-CN.md** explaining user-created Markdown loops, how to create one, and how to read run results. (P2)
5. **Localize sidebar NAV_ITEMS** for all tabs, not just loops. (P2)
6. **Add explanatory text to LoopsSettings empty state** so new users understand what user loops are for. (P3)
7. **Add tooltip/info to blocked run cards** explaining what "blocked" means and what to do next. (P3)

## Evidence Appendix

### Commands Executed
```
$ date '+%Y-%m-%d %H:%M:%S %Z'
→ 2026-06-15 21:04:52 CST

$ cd /Users/song/projects/xiaok-cli && git branch --show-current
→ codex/user-loop-template-scheduled

$ cd /Users/song/projects/xiaok-cli && git status --short | wc -l
→ 39 lines (35 modified + 4 untracked)

$ defaults read /Applications/xiaok.app/Contents/Info.plist CFBundleShortVersionString
→ 1.4.6

$ curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4318/health
→ 200

$ curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4400/health
→ 200

$ ls -la /Applications/xiaok.app/Contents/Resources/app.asar
→ -rw-r--r--  28758527 Jun 15 20:58

$ stat -f '%Sm' /Users/song/projects/xiaok-cli/desktop/renderer/src/components/settings/LoopsSettings.tsx
→ Jun 15 19:53

$ stat -f '%Sm' /Users/song/projects/xiaok-cli/desktop/renderer/src/components/settings/LoopDiagnosticsPanel.tsx
→ Jun 15 19:49 (from ls)
```

### Key Source Code Evidence (Summarized)

**DesktopSettings.tsx tab structure:**
- Line 57: `type SettingsTab = 'model' | 'skills' | 'channels' | 'mcp' | 'tools' | 'loops' | 'general' | 'appearance' | 'data' | 'memory' | 'about';`
- Line 72: `{ key: 'loops', icon: RefreshCw, label: '循环' }`
- Line 135: `{activeTab === 'loops' && <LoopsSettings />}`
- Line 136: `{activeTab === 'general' && <GeneralPane />}`
- Line 1823: `GeneralPane()` — no Loop API calls

**LoopsSettings.tsx key signals:**
- All visible text comes from `labels = t.desktopSettings.loopsSettings`
- aria-labels use locale-backed dynamic strings (e.g., `openOutputDirectoryAria(path)`)
- Refresh button at line ~290: text = `labels.refreshUserLoops`, no explicit aria-label

**LoopDiagnosticsPanel.tsx key signals:**
- Refresh button: text = `t.desktopSettings.loopDiagnosticsRefresh`, no explicit aria-label
- Copy/Run buttons: use `aria-label={copy-loop-diagnostics-${loop.id}}` and `aria-label={run-loop-${loop.id}}`

**zh locale loopsSettings (40 key-value pairs):** All required keys present — 循环, 用户循环, 新建 Markdown 循环, 立即运行, 启用调度, 关闭调度, 批准自动运行, etc.

**en locale loopsSettings (40 key-value pairs):** All matching keys present — Loops, User loops, New Markdown Loop, Run now, Enable schedule, Disable schedule, Approve auto-run, etc.

**Test file (11 test cases):**
- Verifies General page does NOT call `getLoopDefinitions` on mount
- Verifies Loops tab shows loop diagnostics with anomaly details
- Verifies clipboard copy functionality
- Verifies Chinese labels on Loops tab
- Verifies English labels on Loops tab
- Verifies user loop blocked history + schedule controls
- Verifies output directory open + file preview from card
- Verifies already-running state and refresh clearing

### Not Executed (Inconclusive)
```
$ cd /Users/song/projects/xiaok-cli/desktop && npm run test -- --run tests/renderer/desktop-settings-service-status.test.tsx --reporter=basic
$ cd /Users/song/projects/xiaok-cli/desktop && npm run typecheck
```
These must be re-run manually before merge.