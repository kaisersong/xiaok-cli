# Xiaok Loop Engineering Release Sentinel

## Run Metadata
- **Time:** 2026-07-17T22:03:23Z
- **Trigger:** Manual / xiaok user Loop
- **Repository:** /Users/song/projects/xiaok-cli (branch `master`)
- **App Version:** /Applications/xiaok.app `CFBundleShortVersionString` = `1.4.21`; desktop source `package.json` = `1.4.23`
- **App Path:** /Applications/xiaok.app
- **Report Path:** /Users/song/projects/xiaok-cli/quality/loops/loop-engineering-release-sentinel.md

## Executive Summary
1. **Source code is in good shape:** Loop diagnostics have moved out of General Settings into `Automations > Loops / Diagnostics`, renderer tests pass, and desktop typecheck is clean.
2. **Documentation has a Chinese gap:** `README.zh.md` does not exist, even though the English README claims both English and Chinese READMEs document the Loop Engineering releases.
3. **Installed app is stale:** The local `/Applications/xiaok.app` is `1.4.21` / built 2026-07-12, while the working tree is `1.4.23`. Pre-release product behavior should not be validated against this installed binary.
4. **Loop UI is mostly localized:** Chinese and English locale files contain the key user-loop labels, but the Chinese description still says loops only write Markdown files even though `task_completion` loops are now supported.
5. **No live scheduler E2E was executed:** We only ran renderer unit tests and typecheck; an actual scheduled loop run was not observed in this sentinel.

## Health Checks

| Check | Status | Evidence |
| --- | --- | --- |
| xiaok-cli git status | clean except untracked | `master`, 1 modified (`quality/loops/loop-engineering-release-sentinel.md`), 3 untracked (`.artifacts/`, `artifact-cua-report.html`, `design-qa.md`) |
| kswarm git status | clean except untracked | 1 untracked `.governance-log/` file |
| intent-broker git status | clean except untracked | 3 untracked `.governance-log/` files |
| kai-xiaok-plugins git status | clean except untracked | 1 modified `.governance-log/` file, 1 untracked zip under `plugins/kai-slide-creator/themes/kingdee/assets/` |
| intent-broker health | healthy | `http://127.0.0.1:4318/health` → `HTTP 200`, `{"ok":true,"status":"healthy"}` |
| kswarm health | healthy | `http://127.0.0.1:4400/health` → `HTTP 200`, `brokerConnected:true, projects:40` |
| desktop renderer Loop settings test | passed | `tests/renderer/desktop-settings-service-status.test.tsx` → 2 passed |
| desktop typecheck | clean | `npm run typecheck` → `Renderer baseline gate clean: 0 current diagnostics` |
| additional loop/automation tests | passed | `desktop-settings-loops.test.tsx` (5) + `automations-navigation.test.tsx` (4) passed |

## Loop Documentation Review

| Scope | Finding | Evidence |
| --- | --- | --- |
| `README.md` | **Good.** Contains a dedicated "Loop Engineering in Xiaok" section that maps Loop, Harness, Automation, Work isolation, Connectors, Sub-agents, Memory, Evidence, and Diagnostics. It also states that loop diagnostics moved out of general settings into Automations. | Lines 22–39, 202, 229. |
| `README.zh.md` | **Missing.** File does not exist. | `test -f` returned `no`. |
| English/Chinese consistency | **Broken.** The English README explicitly claims (line 96) that "The English and Chinese READMEs now document v1.4.18, v1.4.19, and v1.4.20", but there is no Chinese README. | `README.md` line 96; `README.zh.md` absent. |
| `docs/design/` | **Good.** Loop-related design docs exist: `2026-06-15-loop-settings-diagnostics-i18n.md` (moves diagnostics to Automations, i18n requirements), `2026-06-15-desktop-loop-generic-task-completion-design.md` (`task_completion` kind), `2026-06-15-desktop-automations-loop-schedule-projects-design.md` (Automations IA). | File listing. |
| `mydocs/xiaok-cli` | **Good.** Contains loop-engineering analysis and improvement docs, e.g., `analysis/2026-06-12-loop-engineering-for-xiaok.md`, `2026-06-24-loop-engineering-improvements-v2.md`. | File search. |
| Outdated "General Settings" wording | **Not found.** README and design docs now describe `Automations > Loops / Diagnostics`, not Settings. | Grep for `Settings > Loops` returned only the migration design doc and the README line noting the move out of general settings. |

## Product Behavior Review

- **Loops page vs General Settings:** `GeneralSettings.tsx` no longer references loop diagnostics or user loops. `AutomationsPage.tsx` renders the `LoopsPane` under the `loops` tab and diagnostics under the `diagnostics` tab. ✅
- **UI labels use locale:** `LoopsPane` consistently uses `t.desktopSettings.*` and `t.automations*` keys. No hardcoded English strings like "New Markdown Loop" / "Run now" / "Schedule" were found in the component source. ✅
- **Chinese locale coverage:** `zh.ts` contains `循环`, `用户循环`, `新建 Markdown 循环`, `立即运行`, `新建循环`, `查看结果`, `后台自动运行已开启` / `暂停后台自动运行`. It does **not** contain exact phrases `启用调度`, `关闭调度`, or `批准自动运行`; per-loop schedule approval is handled inside the existing `ScheduledPage` / schedule editor, not via those specific labels.
- **English locale coverage:** `en.ts` contains `User loops`, `New Markdown Loop`, `Run now`, `Schedule`, `Background auto-run`, etc. ✅
- **Duplicate accessibility names:** No obvious collision. The diagnostics refresh button is text-only (`t.desktopSettings.loopDiagnosticsRefresh` = `刷新`); the Mobile pairing refresh button uses `aria-label={t.desktopSettings.mobilePairingRefresh}`. Run/edit/delete buttons in `LoopsPane` are scoped by `loopId` (`aria-label="run-loop-{id}"`, `edit-loop-{id}`, `delete-loop-{id}`). ✅
- **Minor label issues:** `userLoopsDesc` still says "Create and run user loops that write Markdown files" even though `task_completion` loops produce no file. `loopDiagnostics` is rendered as `Loop 诊断` in Chinese (English word mixed into Chinese UI).

## Adversarial Review

### Maker perspective
- **Can a user understand and execute a Loop?** Yes, in the English UI. The Chinese UI is also usable for core actions. However, the missing Chinese README and the stale Markdown-only description make onboarding harder for Chinese users who want to understand *why* loops exist and how to design one.
- **Most valuable:** The Automations page gives a single home for loops, schedules, diagnostics, and constraints; the tests prove the page renders Chinese labels and uses `loopId`-based output APIs rather than passing raw paths back to the main process.
- **Blockers:** The stale installed app (`1.4.21`) means we cannot trust it as a release artifact. The missing Chinese README is a documentation blocker for a Chinese-first product. The outdated `userLoopsDesc` is a small but real product lie.

### Checker perspective
- **Evidence gaps:** We did not run the live desktop app, only renderer tests and typecheck. We did not execute a real scheduled loop or inspect actual loop run evidence in the running app. The health checks only prove the broker and KSwarm are running, not that loop execution end-to-end works.
- **Build pass ≠ app behavior pass:** Tests mock `api.*` and `desktop.xiaokDesktop`. A passing test suite does not guarantee the Electron main process, scheduler, SQLite stores, and preload contract all agree in a packaged build.
- **Docs vs implementation mismatch:** The English README claims a Chinese README exists; it does not. The design docs describe `Automations > Loops` and `Automations > Diagnostics`; the code matches. The `task_completion` kind is implemented in the store/runner but the loop description text still says Markdown-only.
- **Chinese/English coverage:** Core labels are covered, but some Chinese strings mix English (`Loop 诊断`). There is no dedicated Chinese label for per-loop schedule approval, though the global "background auto-run" gate is present.
- **Silent failure risk:** If a loop schedule binding is invalid or the global auto-run gate is disabled, the UI is supposed to show diagnostics. We did not verify this in a live app. The scheduler design requires that skipped runs create structured `TimedActionRunRecord`s, which is not directly observable from renderer tests.

### Conflict between the two perspectives
- **Maker:** The feature is ready enough to validate; tests and typecheck pass and the UI surfaces are correct.
- **Checker:** Without a live-app smoke test and a Chinese README, we cannot say users can actually execute and understand a loop.
- **Resolution:** Treat the build/tests as necessary but not sufficient. Before tagging a release, run a live scheduled loop smoke test and restore the Chinese README; fix the Markdown-only description.

## Findings

### P0
None.

### P1
1. **Chinese README missing while English README claims it exists**
   - **Evidence:** `README.zh.md` not found; `README.md` line 96 says "The English and Chinese READMEs now document v1.4.18, v1.4.19, and v1.4.20."
   - **Impact:** Chinese users cannot read the Loop Engineering concept docs; the claim is false and undermines release hygiene.
   - **Suggested fix:** Create `README.zh.md` with the Loop Engineering section and release notes, or remove the claim from the English README.
   - **Verification:** `test -f /Users/song/projects/xiaok-cli/README.zh.md` should succeed.

2. **Installed app version is stale relative to the source tree**
   - **Evidence:** `/Applications/xiaok.app/Contents/Info.plist` → `1.4.21`; `desktop/package.json` → `1.4.23`; `app.asar` modified 2026-07-12.
   - **Impact:** Any manual app-level validation would test a 1.4.21 build, not the current Loop Engineering code. Risk of shipping an old binary.
   - **Suggested fix:** Rebuild and reinstall the app from the current `master` branch before final validation; verify `Info.plist` matches `package.json`.
   - **Verification:** `PlistBuddy` reads `1.4.23` after install.

3. **Loop description still claims loops only write Markdown files**
   - **Evidence:** `desktop/renderer/src/locales/en.ts` `userLoopsDesc` = "Create and run user loops that write Markdown files"; `zh.ts` similarly. But `task_completion` loops are supported (`desktop/renderer/src/components/DesktopSettings.tsx` line 2688, tests for `task_completion` at `desktop/tests/renderer/desktop-settings-loops.test.tsx` line 219).
   - **Impact:** Users may be surprised they can create a generic task-completion loop; the description is misleading.
   - **Suggested fix:** Update `userLoopsDesc` to "Create and run user loops that generate files or complete tasks" and the Chinese equivalent.
   - **Verification:** Search for the old phrase in `en.ts` and `zh.ts`; update the corresponding renderer tests if they assert the old text.

### P2
4. **Chinese UI mixes English word into loop diagnostic label**
   - **Evidence:** `zh.ts` `loopDiagnostics: "Loop 诊断"`.
   - **Impact:** Slight inconsistency in a Chinese-first UI; all other tabs use pure Chinese (`循环`, `计划`, `诊断`).
   - **Suggested fix:** Change to `循环诊断` or `自动化诊断`.
   - **Verification:** `grep loopDiagnostics zh.ts` returns the localized Chinese string.

5. **No per-loop schedule enable/disable/approve auto-run labels in the Loops page itself**
   - **Evidence:** The Loops page only shows schedule binding counts and a global "background auto-run" gate. Locale search for `启用调度`, `关闭调度`, `批准自动运行` returns nothing.
   - **Impact:** Users must navigate to the generic schedule editor to enable/disable or approve a specific loop schedule. This matches the design doc (schedule truth lives in `TimedAction`), but the product surface does not expose those exact affordances on the loop card.
   - **Suggested fix:** Either add scoped labels to the loop card or document that schedule approval happens in `Automations > Schedules`.
   - **Verification:** Manual UI review or new test asserting loop-card schedule actions.

6. **Built-in loop status badge shows raw status string**
   - **Evidence:** `DesktopSettings.tsx` line 3178 renders `{loopStatus}` directly (`'active'` / `'paused'`). User loops use the same raw badge.
   - **Impact:** Not a functional bug, but inconsistent with the rest of the localized settings UI.
   - **Suggested fix:** Localize the status badge, e.g., `active` → `活跃` / `Active`, `paused` → `已暂停` / `Paused`.
   - **Verification:** Add a renderer test asserting the badge text is localized.

7. **No live end-to-end loop execution was exercised in this sentinel**
   - **Evidence:** We only ran unit tests and typecheck. The health checks only verify service availability.
   - **Impact:** Silent failures in the scheduler, IPC, SQLite stores, or runner finalizer would not be caught.
   - **Suggested fix:** Run a live smoke test: create a `task_completion` loop, click Run Now, verify it reaches `success` and the result is viewable; create a scheduled loop and verify the scheduler creates a `LoopRun`.
   - **Verification:** Manual or Playwright E2E script records a successful loop run.

### P3
8. **Diagnostics refresh button has no `aria-label`**
   - **Evidence:** `DesktopSettings.tsx` diagnostics refresh button uses visible text only.
   - **Impact:** Low; tests can locate by text, but explicit `aria-label` improves robustness.
   - **Suggested fix:** Add `aria-label={t.desktopSettings.loopDiagnosticsRefresh}`.
   - **Verification:** Existing a11y test or grep.

9. **README release notes do not explicitly tie v1.4.21–1.4.23 to Loop Engineering validation**
   - **Evidence:** The top of `README.md` documents v1.4.23 (Canvas/recording), v1.4.22 (recording), v1.4.21 (recording), and v1.4.20 (Loop Engineering). Loop-specific validation is only listed under v1.4.20.
   - **Impact:** Minor; it is unclear whether newer releases re-ran loop tests or only earlier releases did.
   - **Suggested fix:** Add a one-line note under each recent release stating that loop/automation tests remain in the release gate.
   - **Verification:** Readme review.

## Recommended Next Actions
1. **Create or restore `README.zh.md`** and align the English README claim about Chinese documentation (P1).
2. **Rebuild and reinstall the desktop app** from `master` so the installed `xiaok.app` version matches `desktop/package.json` (P1).
3. **Update `userLoopsDesc`** in both locales to mention `task_completion` loops, not just Markdown files (P1).
4. **Run a live end-to-end loop smoke test** (create, run now, schedule, view result) in the rebuilt app before tagging the release (P2).
5. **Localize loop status badges** and change `Loop 诊断` to pure Chinese in `zh.ts` (P2/P3).
6. **Add `aria-label` to the diagnostics refresh button** and consider adding per-loop schedule enable/disable labels if the product wants those affordances on the loop card (P2/P3).
7. **Update README release notes** to confirm loop/automation tests are part of the v1.4.21–1.4.23 gates (P3).

## Evidence Appendix

```bash
# Run time
date -u +"%Y-%m-%dT%H:%M:%SZ"
# 2026-07-17T22:03:23Z

# xiaok-cli git branch/status
cd /Users/song/projects/xiaok-cli
git branch --show-current  # master
git status --short
# M quality/loops/loop-engineering-release-sentinel.md
# ?? .artifacts/
# ?? artifact-cua-report.html
# ?? design-qa.md

# App version
/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" /Applications/xiaok.app/Contents/Info.plist
# 1.4.21
stat -f "%Sm %N" /Applications/xiaok.app/Contents/Resources/app.asar
# Jul 12 18:42:26 2026 /Applications/xiaok.app/Contents/Resources/app.asar

# Health
curl -s http://127.0.0.1:4318/health
# {"ok":true,"status":"healthy","degraded":false}
# HTTP 200
curl -s http://127.0.0.1:4400/health
# {"ok":true,"brokerConnected":true,"projects":40,...}
# HTTP 200

# Renderer tests (requested)
cd /Users/song/projects/xiaok-cli/desktop
npm run test -- --run tests/renderer/desktop-settings-service-status.test.tsx --reporter=basic
# Test Files  1 passed (1) / Tests 2 passed (2)

# Typecheck
cd /Users/song/projects/xiaok-cli/desktop
npm run typecheck
# Electron typecheck clean. Renderer baseline gate clean: 0 current diagnostics

# Additional loop/automation tests
cd /Users/song/projects/xiaok-cli/desktop
npm run test -- --run tests/renderer/desktop-settings-loops.test.tsx tests/renderer/automations-navigation.test.tsx --reporter=basic
# Test Files  2 passed (2) / Tests 9 passed (9)
```
