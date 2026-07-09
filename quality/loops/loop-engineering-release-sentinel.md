# Xiaok Loop Engineering Release Sentinel

## Run Metadata
- Time: 2026-07-09 06:03:24 CST (context) — 06:08 CST (commands complete)
- Trigger: User Loop "Loop Engineering 发布前哨检查" (read-only pre-release sentinel)
- Repository: `/Users/song/projects/xiaok-cli` (branch `master`, HEAD `0b92207f refactor(chat): extract strict skill adherence flow`)
- App Version: **1.4.19** (`/Applications/xiaok.app/Contents/Info.plist` `CFBundleShortVersionString` = `CFBundleVersion` = `1.4.19`)
- App Path: `/Applications/xiaok.app` (asar `Contents/Resources/app.asar`, 66 MiB, mtime **2026-07-08 15:56**)
- Report Path: `/Users/song/projects/xiaok-cli/quality/loops/loop-engineering-release-sentinel.md`
- Scope: read-only. No source/test/docs/config/package/lockfile/build artifact modified. No git add/commit/push.

## Executive Summary
1. **Service + build layer is green.** Intent Broker (`:4318`) and KSwarm (`:4400`) both return HTTP 200 healthy; sibling repos (kswarm, intent-broker, kai-xiaok-plugins) are clean; desktop typecheck is clean (Electron clean, Renderer baseline 0 diagnostics); the requested renderer test `desktop-settings-service-status` passes 2/2.
2. **xiaok-cli working tree is heavily dirty and ahead of HEAD.** 91 changed files on `master` are uncommitted, including **5 brand-new Loop Engineering modules + their tests** (`loop-command-allowlist.ts`, `loop-contract.ts`, `loop-evaluator.ts`, `loop-finalizer.ts`, `loop-project-claim-store.ts`) plus modified `loop-executor/loop-store/loop-types/DesktopSettings/locales`. This Loop Engineering work is unreleased.
3. **User-facing README is 2 versions behind source & app.** Both `README.md` and `README.zh-CN.md` "What's New" top out at **v1.4.17**, and neither contains any **v1.4.18** or **v1.4.19** entry, while `package.json` (desktop + root) and the installed Info.plist are all `1.4.19`. The Loop Engineering changes shipped in 1.4.18/1.4.19 are undocumented in the changelog.
4. **Loop product behavior matches design intent.** Loop diagnostics + user loops render under **Automations → Loops** (the `LoopsPane` is consumed by `AutomationsPage.tsx`); `SettingsTab` has no `loops` entry; `GeneralPane` contains **zero** loop-API calls; all user-loop copy flows through `t.desktopSettings.userLoop*` locale keys in both `zh.ts` and `en.ts`; no duplicate Refresh button-name collision was found.
5. **Verdict — not a clean go for a Loop Engineering release as-is.** Behavior, i18n, and services are release-ready; **block on the P1 changelog gap (1.4.18/1.4.19 undocumented) and on committing/releasing the unreleased loop modules** before tagging.

## Health Checks

| Check | Status | Evidence |
| --- | --- | --- |
| xiaok-cli git status | ⚠️ WARN | `master`, **91** changed files uncommitted; 5 untracked new loop modules + tests (`loop-command-allowlist`, `loop-contract`, `loop-evaluator`, `loop-finalizer`, `loop-project-claim-store`). HEAD `0b92207f`. |
| kswarm git status | ✅ OK | `git status --short` empty (clean). |
| intent-broker git status | ✅ OK | `git status --short` empty (clean). |
| kai-xiaok-plugins git status | ✅ OK | `git status --short` empty (clean). |
| intent-broker health (`:4318/health`) | ✅ OK | HTTP 200, `{"ok":true,"status":"healthy","degraded":false,"reasons":[]}`, updatedAt `2026-07-08T22:03:24Z`. |
| kswarm health (`:4400/health`) | ✅ OK | HTTP 200, `brokerConnected:true`, `projects:40`, features incl. `dynamic_workflows`, `workflow_proposals`, `workflow_progress_batch`, `po_generated_workflow_proposals`. |
| desktop renderer loop settings test | ✅ OK | `npm run test -- --run tests/renderer/desktop-settings-service-status.test.tsx --reporter=basic` → **2 passed**, exit 0, 1.31s. *(Note: the loop-specific `desktop-settings-loops.test.tsx` exists in the modified set but was **not** in the required command list — see Recommended Actions.)* |
| desktop typecheck | ✅ OK | `npm run typecheck` → "Electron typecheck clean. Renderer baseline gate clean: 0 current diagnostics, 0 resolved since baseline." Exit 0. |

## Loop Documentation Review

**Coverage (present):**
- `README.md` L22–47 and `README.zh-CN.md` L22–47 both open with a "Loop Engineering in Xiaok" section, including the **building-block table** (Automation / Work isolation / Skills / Connectors / Sub-agents / Memory / Evidence / Diagnostics) and the **"smallest useful Xiaok loop" 5-step recipe** (skill → trigger → memory → checker → visible failure). EN/ZH are structurally parallel.
- README documents the two built-in production loops (Artifact Evidence Regression Loop, KSwarm Service Health Loop) and explicitly states (L131 EN / L131 ZH): *"Loop diagnostics moved out of general settings"* and group under **Automations** — i.e. the user-facing doc does **not** describe diagnostics under "General Settings". No stale "General Settings" claim found in the README.
- `docs/design/` (symlink → `mydocs/xiaok-cli/design`) contains a deep Loop Engineering design corpus: `2026-06-12-loop-vs-project-vs-scheduled-task-boundary.md`, `2026-06-12-loop-run-record-and-evidence-contract.md`, `2026-06-15-loop-settings-diagnostics-i18n.md`, `2026-06-15-user-loop-template-scheduled-mvp.md`, `2026-06-19-desktop-loop-edit-delete-design.md`, plus `2026-06-15-desktop-automations-loop-schedule-projects-design.md`. `mydocs/xiaok-cli/` holds 7 Loop Engineering adversarial-review/improvement docs (v1–v4, Jun 24).
- The i18n/diagnostics design doc (`2026-06-15-loop-settings-diagnostics-i18n.md`) prescribes the Loops-page split, locale keys, and adversarial risks (duplicate polling, i18n gap, accessibility).

**Gaps:**
1. **P1 — No v1.4.18 / v1.4.19 changelog.** `grep -nE "1\.4\.18|1\.4\.19" README.md README.zh-CN.md` → empty in both. README "What's New" tops at v1.4.17; changelog footer tops at `**v1.4.9**` (with v1.4.0–v1.4.9 only). Source + app are 1.4.19. **The Loop Engineering work shipped in 1.4.18/1.4.19 is invisible in the changelog.**
2. **P2 — No click-by-click "create & verify a user Loop" walkthrough in README.** The 5-step recipe is conceptual; there is no Desktop UI tutorial ("open Automations → Loops → New Markdown Loop → … → Run now → open output"). Users must infer from UI + design docs.
3. **P3 — One design doc is stale vs. shipped surface.** `2026-06-15-loop-settings-diagnostics-i18n.md` says "Move … into `Settings > Loops`", but the shipped product lands loops under **Automations → Loops** (`SettingsTab` has no `loops` member). README is correct; only the internal design doc lags.

## Product Behavior Review

All checks are read-only against `desktop/renderer/src`.

- **Loop diagnostics location:** ✅ Correct. `SettingsTab` union = `model | skills | channels | mcp | tools | general | mobile | appearance | data | memory | about` — **no `loops` tab in Settings**. `GeneralPane` body contains **zero** `getLoopDefinitions`/`getLoopRuns`/`getEvidenceAnomalies`/`loopDiagnostics` references. `LoopsPane` (DesktopSettings.tsx L2064) is exported and consumed only by `automations/AutomationsPage.tsx` (L240 `sections="user"`, L252 `sections="diagnostics"`). Diagnostics live on the Loops surface, not General.
- **Loops UI copy i18n:** ✅ Driven by locale. In the LoopsPane region, copy overwhelmingly comes from `t.desktopSettings.userLoop*` / `t.desktopSettings.loopDiagnostics*`; heuristic scan for hardcoded English string literals in the region returned empty. `console.log('[LoopsPane] …')` calls exist (debug) but are not user-facing.
- **Chinese locale coverage:** ✅ Concepts present — `loopsTab:"循环"` (zh L1220), `userLoops:"用户循环"` (L1221), `newMarkdownLoop:"新建 Markdown 循环"` (L1225), `loopDiagnosticsRunNow:"立即运行"` (L1255), plus `userLoopScheduleSingle/Multiple/Active/OpenSchedules` (L1245–1248) and `scheduledApproveAuto:"允许自动执行"` (L2608). The literal probe terms "启用调度/关闭调度/批准自动运行" are **not** exact keys, but their semantics are covered by `userLoopSchedule*` and `scheduledApproveAuto` — this is an "equivalent key exists" situation, not a missing-coverage defect.
- **English locale parity:** ✅ `loopsTab:"Loops"` (en L1269), `newMarkdownLoop:"New Markdown Loop"` (L1274), `loopDiagnosticsRunNow:"Run now"` (L1304), `scheduledApproveAuto:"Approve auto"` (L2628). All required English counterparts present.
- **Duplicate Refresh button-name collision:** ✅ None found. The built-in diagnostics run-now uses the localized `loopDiagnosticsRunNow`; the user-loop run-now button uses a unique-per-loop slug `aria-label={`run-loop-${template.loopId}`}` (unique per loopId, so no same-name clash). AutomationsPage `RefreshCw` icons sit on overview cards via `title=` attributes, not as duplicate button names.
- **Minor a11y/i18n asymmetry (P3):** the user-loop run-now button's accessible name is a **non-localized machine slug** `run-loop-${loopId}`, whereas the built-in loop run-now button is localized ("立即运行"/"Run now"). Screen readers read a slug for user loops.
- **Minor cross-locale wording divergence (P2):** `scheduledApproveAuto` = "Approve auto" (en) vs "允许自动执行" / "allow auto execution" (zh) — same key, different verb polarity (approve vs allow).

## Adversarial Review

**Maker view (can a user understand & run a Loop today?):**
- A motivated user *can* create and run a Markdown user Loop today: the Automations → Loops → "新建 Markdown 循环 / New Markdown Loop" surface exists, is fully localized, supports manual run + schedule binding + output preview + edit/delete, and the conceptual "smallest useful loop" is explained in both READMEs.
- Most valuable signals for users: the building-block table, the explicit "diagnostics moved out of General Settings" note, and the clickable output preview.
- Blocking/irritating experience: **no release notes for 1.4.18/1.4.19** means a user upgrading from 1.4.17 cannot learn what Loop behavior changed; and there is no in-README step-by-step Loop tutorial.

**Checker view (are any conclusions under-evidenced?):**
- ✅ "Behavior matches design" is backed by real source reads (`SettingsTab` union, `GeneralPane` empty-of-loops, `AutomationsPage` consuming `LoopsPane`, locale key presence) — not inferred from a passing build.
- ⚠️ **"Typecheck/test green" must not be read as "the running app behaves correctly."** Typecheck + 1 renderer file only prove compile + service-status rendering; they do **not** exercise the new unreleased loop modules (`loop-command-allowlist`, `loop-contract`, `loop-evaluator`, `loop-finalizer`, `loop-project-claim-store`). Their dedicated tests exist in the working tree but were **not** run by this sentinel.
- ⚠️ **"Docs describe what's implemented" has a gap**: the changelog is 2 versions behind, so for 1.4.18/1.4.19 we **cannot** verify doc-vs-behavior at all — there is no doc to compare against.
- ⚠️ **ZS/EN asymmetry**: `scheduledApproveAuto` approve-vs-allow divergence is a real (minor) single-side-wording risk, not a missing key.
- ⚠️ **Silent-failure risk**: 91 uncommitted files including the loop-* modules mean the working tree is far ahead of the tagged/released state; if 1.4.19 was built from a different tree than this checkout, the running app's loop behavior is unverified against this source.

**Conflict resolution:** Maker and Checker agree on the *verdict* (not a clean go) but **disagree on severity of the changelog gap** — Maker treats missing 1.4.18/1.4.19 notes as cosmetic; Checker treats it as a release-sentinel blocker because the sentinel's whole job is to verify docs ↔ shipped loop behavior, and there is no doc for the last 2 versions. **Resolution: treat as P1** (Checker wins) — the changelog must exist before this sentinel can meaningfully pass again.

## Findings

### P0
None. No app-won't-start, loop-unusable, data-corruption, or destructive-execution evidence was found. Services are healthy, typecheck is clean, and the required test passes.

### P1
**P1-1 — README changelog missing v1.4.18 and v1.4.19 (EN + ZH).**
- Evidence: `package.json` (desktop+root) = `1.4.19`; Info.plist = `1.4.19`; `grep -nE "1\.4\.18|1\.4\.19" README.md README.zh-CN.md` → empty in both; README "What's New" tops at v1.4.17; changelog footer tops at `**v1.4.9**`.
- Impact: Users upgrading to the shipping version cannot learn what Loop Engineering changed in 1.4.18/1.4.19; this sentinel cannot verify "docs describe current loop behavior" because no docs exist for those versions.
- Suggested fix: Add v1.4.18 and v1.4.19 entries to **both** READMEs, covering the new loop modules (command-allowlist, contract, evaluator, finalizer, project-claim-store) and any loop-executor/store changes.
- Verification: `grep -nE "1\.4\.18|1\.4\.19" README.md README.zh-CN.md` returns entries in both files; EN/ZH entries are parallel.

### P2
**P2-1 — No step-by-step user Loop creation/verification walkthrough in README.**
- Evidence: README L41–47 (EN) / L41–47 (ZH) give the conceptual 5-step loop recipe; no Desktop UI click-through tutorial exists in either README.
- Impact: New users cannot create + validate a user Loop from the README alone; rely on UI affordances and internal design docs.
- Suggested fix: Add a short "Creating your first user Loop" section (Automations → Loops → New Markdown Loop → fields → Run now → open output → bind schedule).
- Verification: A doc reviewer can follow the steps end-to-end without consulting design docs.

**P2-2 — `scheduledApproveAuto` verb polarity diverges across locales.**
- Evidence: en.ts L2628 `"Approve auto"`; zh.ts L2608 `"允许自动执行"` (≈ "Allow auto execution").
- Impact: Minor cross-language UX inconsistency; same control reads as an *approval* in EN and an *allowance* in ZH.
- Suggested fix: Align — e.g. zh `"批准自动运行"` or en `"Allow auto"` — pick one verb and mirror it.
- Verification: Bilingual review confirms identical intent; both locale strings match the chosen verb.

### P3
**P3-1 — Design doc stale vs. shipped surface.**
- Evidence: `docs/design/2026-06-15-loop-settings-diagnostics-i18n.md` says "Move … into `Settings > Loops`"; shipped `SettingsTab` has no `loops` member and loops live under **Automations → Loops** (README correctly says Automations).
- Impact: Low (internal design doc); could mislead a future contributor.
- Suggested fix: Annotate the doc with "Final landing surface: Automations → Loops (Settings > Loops was superseded during implementation)."
- Verification: Doc carries the supersede note.

**P3-2 — User-loop run-now button accessible name is a non-localized slug.**
- Evidence: DesktopSettings.tsx user-loop run-now button `aria-label={`run-loop-${template.loopId}`}` (RefreshCw icon, no localized text); built-in diagnostics run-now uses `loopDiagnosticsRunNow` ("立即运行"/"Run now").
- Impact: Screen readers / Chinese users hear "run-loop-<id>" instead of a localized label; a11y + i18n asymmetry between built-in and user loops.
- Suggested fix: Add a localized visible/aria label (e.g. `userLoopRunNow`) and keep `run-loop-${id}` as `data-testid`.
- Verification: a11y audit reads localized text in both locales.

**P3-3 — `--reporter=basic` is deprecated (Vitest 3.2.4).**
- Evidence: Test run prints `DEPRECATED 'basic' reporter is deprecated and will be removed in Vitest v3.`
- Impact: Next Vitest upgrade will break the release-gate command.
- Suggested fix: Drop `--reporter=basic` or switch config to `reporters: [["default",{summary:false}]]`.
- Verification: Command runs with no deprecation warning.

**P3-4 — Unreleased Loop Engineering source is uncommitted in the working tree.**
- Evidence: `git status --short` shows 5 untracked loop modules + tests and modified loop-executor/store/types; 91 changed files total on `master`, HEAD `0b92207f`.
- Impact: Release reproducibility risk — if shipped without commit, the tagged tree cannot be reconstructed; also the running app (asar mtime 2026-07-08 15:56) provenance vs. this dirty checkout is unverified.
- Suggested fix: Commit the loop modules + tests (or move to a release branch) before tagging 1.4.20.
- Verification: `git status --short` clean for the loop-* files; tag points at a tree containing them.

## Recommended Next Actions
1. **[Block]** Commit the 5 new Loop Engineering modules + tests (`loop-command-allowlist`, `loop-contract`, `loop-evaluator`, `loop-finalizer`, `loop-project-claim-store`) and the modified loop-executor/store/types on `master` (or a release branch) so the released tree is reconstructible. *(P3-4, but gating for reproducibility.)*
2. **[Block]** Add **v1.4.18 and v1.4.19** changelog entries to **both** `README.md` and `README.zh-CN.md`, explicitly covering the new loop modules and loop-executor/store changes. *(P1-1)*
3. **[Run]** Execute the loop-focused tests not covered by this sentinel: `tests/renderer/desktop-settings-loops.test.tsx` and the new main-process tests (`loop-command-allowlist`, `loop-contract`, `loop-evaluator`, `loop-project-claim-store`) to confirm the Loops-page + General-clean assertions and the new modules' contracts hold. *(Evidence gap from Phase 4.)*
4. **[Align]** Reconcile `scheduledApproveAuto` wording across en/zh (approve vs allow). *(P2-2)*
5. **[Polish]** Localize the user-loop run-now button aria-label for screen-reader parity with the built-in loop run-now button. *(P3-2)*
6. **[Polish]** Annotate design doc `2026-06-15-loop-settings-diagnostics-i18n.md` to reflect the final Automations landing surface. *(P3-1)*
7. **[Hygiene]** Replace deprecated `--reporter=basic` in the release gate before the next Vitest upgrade. *(P3-3)*

## Evidence Appendix
Commands executed and condensed output (raw logs trimmed to essentials).

**A. Context**
```
$ date "+%Y-%m-%d %H:%M:%S %Z"
2026-07-09 06:03:24 CST

$ git -C /Users/song/projects/xiaok-cli rev-parse --abbrev-ref HEAD
master
$ git -C /Users/song/projects/xiaok-cli status --short | wc -l
91
# tail of status: untracked loop-command-allowlist.ts, loop-contract.ts,
# loop-evaluator.ts, loop-finalizer.ts, loop-project-claim-store.ts (+ tests);
# modified loop-executor/loop-store/loop-types/DesktopSettings/locales/zh.ts/en.ts.
$ git log --oneline -1
0b92207f refactor(chat): extract strict skill adherence flow

# sibling repos: git status --short -> empty (clean) for kswarm, intent-broker, kai-xiaok-plugins

$ plutil -p /Applications/xiaok.app/Contents/Info.plist | grep -i version
"CFBundleShortVersionString" => "1.4.19"
"CFBundleVersion" => "1.4.19"
$ ls -la /Applications/xiaok.app/Contents/Resources/app.asar
-rw-r--r-- ... 69005758 Jul  8 15:56 app.asar
```

**B. Health endpoints**
```
$ curl http://127.0.0.1:4318/health
HTTP 200  {"ok":true,"status":"healthy","degraded":false,"reasons":[],"channels":[]}

$ curl http://127.0.0.1:4400/health
HTTP 200  {"ok":true,"brokerConnected":true,"projects":40,
 "features":["dynamic_workflows","workflow_proposals","workflow_progress_batch",
 "workflow_task_strategy","po_generated_workflow_proposals",
 "workflow_budget_cache_recovery","workflow_script_generated_runs"]}
```

**C. Version consistency (P1-1 evidence)**
```
$ grep -m1 '"version"' desktop/package.json package.json   -> 1.4.19 / 1.4.19
$ grep -nE "1\.4\.18|1\.4\.19" README.md README.zh-CN.md    -> (empty)
$ grep -oE "\*\*v1\.4\.[0-9]+\*\*" README.md | sort -u
**v1.4.0** **v1.4.1** **v1.4.2** **v1.4.5** **v1.4.6** **v1.4.8** **v1.4.9**
# README "What's New" tops at v1.4.17; no v1.4.18/v1.4.19 anywhere.
```

**D. Product behavior (read-only source reads)**
```
# SettingsTab union has NO 'loops' member:
type SettingsTab = 'model'|'skills'|'channels'|'mcp'|'tools'|'general'
                  |'mobile'|'appearance'|'data'|'memory'|'about';

# GeneralPane contains zero loop references (awk range grep -> empty).
# LoopsPane (DesktopSettings.tsx:2064) consumed only by:
#   automations/AutomationsPage.tsx:240  <LoopsPane sections="user" />
#   automations/AutomationsPage.tsx:252  <LoopsPane sections="diagnostics" />

# locale keys (zh.ts):
loopsTab:"循环" | userLoops:"用户循环" | newMarkdownLoop:"新建 Markdown 循环"
loopDiagnosticsRunNow:"立即运行" | scheduledApproveAuto:"允许自动执行"
# locale keys (en.ts):
loopsTab:"Loops" | newMarkdownLoop:"New Markdown Loop"
loopDiagnosticsRunNow:"Run now" | scheduledApproveAuto:"Approve auto"

# user-loop run-now button: aria-label={`run-loop-${template.loopId}`} (non-localized slug)
# built-in loop run-now: uses loopDiagnosticsRunNow (localized)
# duplicate Refresh button-name collision: NONE found.
```

**E. Commands (Phase 4)**
```
$ npm run test -- --run tests/renderer/desktop-settings-service-status.test.tsx --reporter=basic
 RUN  v3.2.4
 DEPRECATED 'basic' reporter is deprecated and will be removed in Vitest v3.
 ✓ tests/renderer/desktop-settings-service-status.test.tsx (2 tests) 152ms
 Test Files  1 passed (1)
      Tests  2 passed (2)
 Duration  1.31s
 EXIT 0

$ npm run typecheck
> node scripts/typecheck-baseline.mjs
Electron typecheck clean. Renderer baseline gate clean: 0 current diagnostics, 0 resolved since baseline.
EXIT 0
```

---
*Sentinel produced read-only. No source/test/docs/config/package/lockfile/build artifact was modified; no git add/commit/push was performed.*
