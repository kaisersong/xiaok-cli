# Xiaok Loop Engineering Release Sentinel

> Read-only pre-release sentinel run. No source, tests, config, lockfile, build
> artifact, or git state was modified. Only this Markdown report was written.

## Run Metadata
- Time: 2026-06-23 07:22:25 CST (ts=1782170545; system date 2026-06-22 UTC)
- Trigger: Xiaok user Loop — "Loop Engineering 发布前哨检查"
- Repository: `/Users/song/projects/xiaok-cli` (branch `master`)
- App Version: 1.4.12 (`CFBundleShortVersionString` = `CFBundleVersion` = `1.4.12`, id `com.xiaok.desktop`)
- App Path: `/Applications/xiaok.app` (app.asar mtime observed 2026-06-23 07:22, 65,539,107 bytes)
- Report Path: `/Users/song/projects/xiaok-cli/quality/loops/loop-engineering-release-sentinel.md`

## Executive Summary
1. **Green-light for continued verification.** All four repos are clean, both service health endpoints return 200/healthy, the targeted renderer test passes (2/2), and the desktop typecheck/baseline gate is clean (0 diagnostics). No P0 blockers found.
2. **Loop Engineering narrative is strong in the English README.** It explicitly maps Automation / Work isolation / Connectors / Sub-agents / Memory / Evidence / Diagnostics to Xiaok building blocks, and correctly states loop diagnostics moved out of general settings into the **Automations** surface.
3. **Product wiring matches the docs.** `LoopsPane` is rendered only under Automations (Overview / Schedules / Loops / Diagnostics tabs). The live settings nav has no `loops`/`developer` entry, and `GeneralPane` contains zero loop/diagnostic references — diagnostics is not mis-located in General.
4. **i18n is real and bidirectional.** Loop UI strings flow through `t.*` keys; no hardcoded English literals were found in `LoopsPane`. Chinese and English locale files both cover the core loop vocabulary.
5. **Residual risks are P2/P3 only:** English-only README (no `README.zh.md`), orphaned loop-diagnostics code in an unmounted `DeveloperSettings`, a few task-expected verbatim locale phrases that exist only under different wording, and minor a11y/log-hygiene nits. None block release.

## Health Checks

| Check | Status | Evidence |
| --- | --- | --- |
| xiaok-cli git status | ✅ clean | branch `master`; `git status --short` empty (rc=0) |
| kswarm git status | ✅ clean | `git status --short` empty (rc=0) |
| intent-broker git status | ✅ clean | `git status --short` empty (rc=0) |
| kai-xiaok-plugins git status | ⚠️ untracked only | `?? docs/` and `?? plugins/kai-canvas-creator/` (untracked, no modified tracked files; rc=0) |
| intent-broker health (4318) | ✅ healthy | HTTP 200, 0.000625s; `{"ok":true,"status":"healthy","degraded":false,"reasons":[]}` |
| kswarm health (4400) | ✅ healthy | HTTP 200, 0.000672s; `brokerConnected:true`, `projects:35`, 7 workflow features listed |
| desktop renderer Loop settings test | ✅ pass | `desktop-settings-service-status.test.tsx` → 2 passed (1.56s), exit 0 |
| desktop typecheck | ✅ clean | `Electron typecheck clean. Renderer baseline gate clean: 0 current diagnostics, 0 resolved since baseline.` (exit 0) |

## Loop Documentation Review

Scope checked: `README.md` (858 lines), `README.zh.md` (absent), `docs/` symlink → `mydocs/xiaok-cli` (112 entries incl. `design/`).

**Coverage (present and accurate):**
- **Building-block relationships** — README §"Loop Engineering in Xiaok" (lines 22–39) maps Automation, Work isolation, Connectors, Sub-agents, Memory, Evidence, Diagnostics to concrete Xiaok implementations. ✅
- **"Smallest useful loop" recipe** — README lines 41–47: skill → trigger → memory → checker → diagnostics. Conceptually complete. ✅
- **Current product location** — README line 49 & line 96 explicitly state loops/diagnostics moved out of general settings into the Automations surface; schedule↔loop↔run relationships described. ✅ Matches code.
- **Loop failure / diagnostics** — README lines 37, 114–115, 121–123 describe read-only loop/evidence diagnostics, anomaly kind/owner/suggested-action/log paths, and copyable diagnostic summary. ✅
- **Design-record trail** — `design/2026-06-15-desktop-automations-loop-schedule-projects-design.md`, `2026-06-15-user-loop-card-output-actions.md`, `2026-06-15-desktop-loop-generic-task-completion-{cc,qoder}-review.md`, `2026-06-22-loop-self-improving-feedback-design-v2.md`. Consensus design (qoder/xiaok/cc/codex ACCEPT, no P0/P1). ✅

**Gaps:**
- **No Chinese README.** `README.zh.md` does not exist; the Loop Engineering narrative is English-only even though the product UI is fully bilingual (zh + en). The Chinese design docs exist in `mydocs`, but the primary repo README has no zh counterpart → see P2-1.
- **No end-to-end UI walkthrough.** README gives the architectural recipe but not a concrete "create a user loop in Automations → run → inspect diagnostics" click-through. The UI flow is only described inside per-version changelog notes (v1.4.7/v1.4.8) → see P3-1.
- **Historical changelog wording.** v1.4.4/v1.4.5 notes still say loop diagnostics are exposed via "settings surfaces" (lines 115, 123), which was the point-in-time truth before the v1.4.8 move. Accurate as changelog, but a skimmer could misread current state → see P3-2. The current-state description (v1.4.8+, §Loop Engineering) is correct.

## Product Behavior Review

All checks are read-only (no code changes).

**1. Loop diagnostics location — correct.**
- `LoopsPane` is imported and rendered ONLY by `automations/AutomationsPage.tsx` (lines 218 `<LoopsPane sections="user" />`, 224 `<LoopsPane sections="diagnostics" />`).
- `DesktopSettings` nav (`getNavItems`, lines 84–97) = general / model / skills / channels / mcp / tools / appearance / data / memory / about. **No `loops` or `developer` tab.**
- `GeneralPane` (line 2691) handles locale, skill debug, concurrency, service status — **zero loop/diagnostic references.** `GeneralSettings.tsx` grep for loop/diagnostic/循环/诊断 = empty.
- ✅ Diagnostics lives on the Loops/Automations page, not General.

**2. i18n — real, no hardcoded literals.**
- `AutomationsPage.tsx` uses `t.automations*` keys throughout; a targeted scan of `LoopsPane` (DesktopSettings.tsx 1925–2400) for hardcoded `"Word word"` literals (excluding className/console/t.*) returned **empty**.
- Chinese locale covers: 循环 (30), 用户循环 (5), 新建 Markdown 循环 (1), 立即运行 (1), Loop 诊断 (3), 自动化 (9).
- English locale covers: Loop (47), New Markdown Loop (1), Run now (1), Loop Diagnostics (1), Automations (2).
- ⚠️ **Verbatim-term soft mismatch** (concepts exist under different wording):
  - 启用调度 / 关闭调度 / Enable schedule / Disable schedule — **not present**; the closest are global `automationsGlobalAutoRunEnable/Pause` ("启用/暂停后台自动运行") and per-loop `userLoopOpenSchedules` ("查看计划"/"View schedules"). Schedule = "计划", not "调度". There is no per-loop schedule enable/disable toggle text.
  - 批准自动运行 / Approve auto-run — verbatim absent; concept present as `scheduledApproveAuto` zh="允许自动执行" / en="Approve auto".
  - 立即运行 / Run now — present via `loopDiagnosticsRunNow`. The per-user-loop **run** button additionally carries a unique `aria-label={run-loop-${id}}`.
  - → see P2-3.

**3. Refresh / Run button accessible names — low collision risk.**
- Per-loop run buttons carry unique `aria-label={run-loop-${loopId}}` / `edit-loop-${id}` / `delete-loop-${id}` (lines 2440/2450/2459) — ✅ uniquely locatable.
- The diagnostics **Refresh** button (line 2534) has no explicit `aria-label`; its accessible name is the visible text `loopDiagnosticsRefresh` ("Refresh"/"刷新"). It is the only refresh control on the diagnostics tab, so no same-view collision — but a bare "Refresh" could collide with other settings refresh controls out of context → see P3-3.

**4. Orphaned loop-diagnostics code (dead surface).**
- `settings/DeveloperSettings.tsx` still contains a full loop-diagnostics implementation (state, load/copy/run handlers, lines 91/132–282/444/574) and is exported from `settings/index.ts`.
- It is **not reachable**: no import in `App.tsx`/layouts, no nav key, no route. `getNavItems` does not include it. → see P2-2 (maintainer-confusion / dead-duplicate risk; not user-facing).

## Adversarial Review

### Maker perspective (can a user understand and run a loop?)
- **Yes, for an English-reading power user.** The README's building-block table + smallest-loop recipe + Automations-surface note give a coherent mental model, and the UI surfaces create/run/edit/delete/schedule/preview/diagnostics in one place.
- **Most valuable signals:** the explicit "diagnostics moved out of general settings" statement, and the run-button evidence contract ("done = inspectable output").
- **Likely blockers for a normal user:** (a) no Chinese README despite a Chinese-localized app; (b) no step-by-step "create your first loop" UI walkthrough; (c) schedule/approve terminology differs between docs-mental-model ("调度"/"批准自动运行") and actual UI ("计划"/"允许自动执行") — a user matching docs to buttons may hesitate.

### Checker perspective (are conclusions over-claimed?)
- **Build-pass ≠ behavior-pass risk:** explicitly avoided. I did NOT infer runtime behavior from the green typecheck; I traced component wiring (where `LoopsPane` is imported/rendered, what `GeneralPane` contains, which nav keys exist) to conclude diagnostics is not in General. The health endpoints were hit live (200 bodies captured).
- **Evidence sufficiency:** the "no per-loop schedule enable/disable toggle" claim is grounded in locale + component scans; I did NOT claim it is a bug, only a verbatim-term mismatch. Flagged honestly as P2-3.
- **Doc-says-but-unimplemented check:** the only candidate was loop diagnostics "in settings surfaces" (README 115/123) — verified the live nav has no such entry, so this is historical changelog text, not a live false claim.
- **zh/en asymmetry:** caught — README is English-only (P2-1); UI locale is symmetric for the core loop terms; the task's verbatim checklist is asymmetric to actual wording (P2-3).
- **Silent-failure risk:** orphaned `DeveloperSettings` loop-diagnostics code could silently diverge from the live `LoopsPane` diagnostics logic (two copies of `buildLoopDiagnosticsSummary`/`getOpenLoopAnomalies` consumers) and mislead a future maintainer or a test that targets the wrong copy — flagged P2-2. Also noted: `console.log` left in `LoopsPane` edit/delete/create paths (P3-4).

### Conflict between perspectives
- **No hard conflict.** Maker wants a Chinese README + UI walkthrough; Checker confirms those are gaps, not defects. Resolution order: ship-blocker = none; address P2 (Chinese README, dead-code removal, term alignment) before broader non-English user rollout; P3 as cleanup.

## Findings

### P0 — None
No app-startup, loop-unavailable, data-corruption, or destructive-execution issues found. Repos clean, services healthy, tests/typecheck green.

### P1 — None
Diagnostics entry is correct (Automations), targeted test passes, no key doc actively misleads current behavior, no obviously missing critical test for the Loop settings path (`desktop-settings-loops.test.tsx` exists alongside the passing `desktop-settings-service-status.test.tsx`).

### P2
**P2-1 — No Chinese README for the Loop Engineering narrative**
- Evidence: `ls /Users/song/projects/xiaok-cli/README.zh.md` → No such file; only `README.md` (English). UI locale `zh.ts` is fully Chinese.
- Impact: Chinese-speaking users get a fully Chinese app UI but an English-only architectural README; the "diagnostics moved to Automations" guidance is unreachable in zh at the doc layer.
- Suggested fix: add `README.zh.md` mirroring at least the "Loop Engineering in Xiaok" section + current-state note, or add a zh summary block.
- Verification: `README.zh.md` exists, non-empty, contains 循环/Automations/诊断 in zh.

**P2-2 — Orphaned loop-diagnostics code in unmounted `DeveloperSettings`**
- Evidence: `settings/DeveloperSettings.tsx` imports `buildLoopDiagnosticsSummary`/`getOpenLoopAnomalies` from `./loopDiagnostics` and renders a diagnostics UI (lines 91, 132–282, 444, 574); exported via `settings/index.ts`; but NOT imported by `App.tsx`/layouts, not in `getNavItems`, no route. `DesktopSettings.LoopsPane` is the only live diagnostics surface (rendered in `AutomationsPage`).
- Impact: two consumers of the diagnostics helpers; the dead copy can silently drift from live behavior and trap future tests/maintainers targeting the wrong component.
- Suggested fix: remove the loop-diagnostics block from `DeveloperSettings` (or delete the unmounted component) and keep a single diagnostics implementation in `LoopsPane`.
- Verification: `grep -rn "loopDiagnostics" renderer/src/components/settings/DeveloperSettings.tsx` returns nothing; typecheck + tests still green.

**P2-3 — Task-expected verbatim loop terms absent; concepts exist under different wording**
- Evidence: `zh.ts`/`en.ts` have no 启用调度 / 关闭调度 / 批准自动运行 (zh) nor Enable schedule / Disable schedule / Approve auto-run (en). Concepts exist as `automationsGlobalAutoRunEnable/Pause`, `userLoopOpenSchedules` ("查看计划"), `scheduledApproveAuto` (zh="允许自动执行", en="Approve auto"). Schedule is consistently "计划", not "调度".
- Impact: external docs/scripts/tests expecting the literal phrases will fail to locate controls; minor user confusion mapping docs to buttons.
- Suggested fix: either (a) align doc/test vocabulary to the actual UI strings, or (b) if "调度/批准自动运行" are intended user-facing labels, add them as locale keys and wire them. Decide which is the source of truth.
- Verification: re-run the verbatim grep against both locale files; expected matches after fix.

**P2-4 — Diagnostics Refresh button lacks an explicit accessible name**
- Evidence: `DesktopSettings.tsx:2534` Refresh button has no `aria-label`; name = visible `loopDiagnosticsRefresh` ("Refresh"/"刷新"). Per-loop run buttons DO have unique `aria-label` (line 2440).
- Impact: a bare "Refresh" can collide with other settings refresh controls in cross-page test selectors / screen readers.
- Suggested fix: add `aria-label={t.desktopSettings.loopDiagnosticsRefresh}` (or a more specific key) to the diagnostics refresh button.
- Verification: a11y/selector scan finds a unique name for the diagnostics refresh control.

### P3
**P3-1 — No concrete "create your first user loop" UI walkthrough in README**
- Evidence: README 41–47 is architectural; UI creation/edit/schedule/preview/diagnostics flow is only in changelog notes (v1.4.7/v1.4.8).
- Impact: new users must discover the click-path empirically.
- Suggested fix: add a short numbered UI walkthrough under the Loop Engineering section.
- Verification: README contains a step list referencing Automations → Loops → New → Run → Diagnostics.

**P3-2 — Historical changelog says diagnostics are in "settings surfaces"**
- Evidence: README 115 (v1.4.5) and 123 (v1.4.4) say loop diagnostics exposed via "settings surfaces"; v1.4.8+ and §Loop Engineering say it moved to Automations.
- Impact: historically accurate, but a skimmer may misread current location.
- Suggested fix: leave changelog as-is (point-in-time truth) but ensure the top/current-state section is unambiguous (it is); optionally add "(now in Automations)" pointer.
- Verification: current-state section still authoritative; no edit required to remain correct.

**P3-3 — Bare "Refresh" diagnostics button (cross-context name) — see P2-4**
Grouped under P2-4 for action; listed here only as a reminder it is low-severity.

**P3-4 — `console.log` statements left in `LoopsPane` mutation paths**
- Evidence: `DesktopSettings.tsx` 2076/2084/2088 (save edit), 2098/2100/2103 (delete loop), 2181/2186 (create from template).
- Impact: log noise in production renderer console.
- Suggested fix: gate behind debug flag or remove.
- Verification: `grep -n "console.log" DesktopSettings.tsx` in LoopsPane returns nothing (or only debug-gated).

## Recommended Next Actions
1. **(P2-2) Remove the dead loop-diagnostics block from unmounted `DeveloperSettings`** so there is a single diagnostics implementation; re-run typecheck + loops tests. Highest value: eliminates silent-drift risk before release.
2. **(P2-1) Author `README.zh.md`** (or a zh summary block) covering the Loop Engineering section + the "diagnostics now in Automations" current-state note; unblocks Chinese users at the doc layer.
3. **(P2-3) Decide the schedule/approve vocabulary source of truth** and align either docs/tests to the actual UI strings ("计划"/"允许自动执行") or add the expected locale keys — prevents future test/doc drift.
4. **(P2-4) Add an explicit `aria-label` to the diagnostics Refresh button** for unique test/a11y targeting.
5. **(P3-4) Strip or debug-gate the `console.log` calls in `LoopsPane`** edit/delete/create paths.
6. **(P3-1) Add a concrete UI walkthrough** (Automations → Loops → New → Run → Diagnostics) to the README for first-time users.
7. **Before tag:** run the broader loop suite (`desktop-settings-loops.test.tsx` + loop store/executor/runner tests) and a live smoke of create→run→diagnostics in the installed 1.4.12 app to confirm end-to-end behavior (this sentinel only ran the targeted service-status test + typecheck).

## Evidence Appendix

Executed commands and trimmed summaries (each was read-only; nothing was committed/modified).

**Context**
```
date            -> 2026-06-23 07:22:25 CST (ts=1782170545)
xiaok-cli       -> branch master; git status --short: (empty), rc=0
kswarm          -> git status --short: (empty), rc=0
intent-broker   -> git status --short: (empty), rc=0
kai-xiaok-plugins-> git status --short: ?? docs/  ?? plugins/kai-xiaok-plugins/, rc=0
Info.plist      -> CFBundleShortVersionString=1.4.12, CFBundleVersion=1.4.12, id=com.xiaok.desktop
app.asar        -> 65539107 bytes, mtime 2026-06-23 07:22
curl 4318/health-> HTTP 200; {"ok":true,"status":"healthy","degraded":false,"reasons":[]}
curl 4400/health-> HTTP 200; {"ok":true,"brokerConnected":true,"projects":35,...}
```

**Docs**
```
README.md       -> 858 lines; §"Loop Engineering in Xiaok" lines 22-39 (building-block map);
                   smallest-loop recipe 41-47; "moved to Automations" 49 & 96; diagnostics 114-115/121-123
README.zh.md    -> No such file or directory
docs symlink    -> /Users/song/projects/xiaok-cli/docs -> ../mydocs/xiaok-cli (112 entries)
design docs     -> 2026-06-15 automations/loop/schedule/projects design (consensus ACCEPT, no P0/P1);
                   2026-06-15 user-loop-card-output-actions; 2026-06-22 loop-self-improving-feedback-v2
```

**Product wiring**
```
getNavItems (DesktopSettings 84-97) -> general/model/skills/channels/mcp/tools/appearance/data/memory/about
                                     (NO loops, NO developer)
LoopsPane rendered only at: automations/AutomationsPage.tsx:218 (sections="user"), :224 (sections="diagnostics")
GeneralPane (2691) / GeneralSettings.tsx -> grep loop|diagnostic|循环|诊断 = empty
DeveloperSettings.tsx -> has loopDiagnostics impl (91/132-282/444/574); NOT imported by App/layouts,
                         not in nav, no route -> orphaned
LoopsPane hardcoded-literal scan (1925-2400, excl className/console/t.*) -> empty (i18n clean)
run-loop button aria-label -> `run-loop-${loopId}` (unique); edit-loop-${id}; delete-loop-${id}
diagnostics Refresh button (2534) -> no aria-label; name = "Refresh"/"刷新"
console.log in LoopsPane -> lines 2076/2084/2088/2098/2100/2103/2181/2186
```

**Locale term counts (verbatim)**
```
zh.ts: 循环=30 用户循环=5 新建 Markdown 循环=1 立即运行=1 Loop 诊断=3 自动化=9
       启用调度=0 关闭调度=0 批准自动运行=0  (concepts present as 计划 / 允许自动执行)
en.ts: Loop=47 New Markdown Loop=1 Run now=1 Loop Diagnostics=1 Automations=2
       User Loop=0 (userLoops="User loops" present) Enable schedule=0 Disable schedule=0 Approve auto-run=0
       (concept: scheduledApproveAuto="Approve auto", automationsGlobalAutoRunEnable/Pause)
```

**Verification commands**
```
npm run test -- --run tests/renderer/desktop-settings-service-status.test.tsx --reporter=basic
  -> Test Files 1 passed (1); Tests 2 passed (2); Duration 1.56s; exit 0
  (note: vitest warns 'basic' reporter deprecated; non-blocking)
npm run typecheck
  -> Electron typecheck clean. Renderer baseline gate clean:
     0 current diagnostics, 0 resolved since baseline. exit 0
```
