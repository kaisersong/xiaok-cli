# Xiaok Loop Engineering Release Sentinel

> Pre-release sentinel check for the Loop Engineering surface.
> Read-only: no source, tests, config, lockfile, or build artifacts were modified.
> Only this Markdown artifact was written.

## Run Metadata
- Time: 2026-06-29 06:03 CST (epoch 1782684202)
- Trigger: Xiaok user Loop — "Loop Engineering 发布前哨检查" sentinel
- Repository: /Users/song/projects/xiaok-cli (branch `master`, HEAD at tag `desktop-v1.4.16`)
- App Version (installed): **1.4.14** (CFBundleShortVersionString=1.4.14, CFBundleVersion=1.4.14)
- App Version (source): **1.4.16** (`desktop/package.json` version=1.4.16; git tag `desktop-v1.4.16` at HEAD)
- App Path: /Applications/xiaok.app (app.asar modified 2026-06-29 00:01:45)
- Report Path: /Users/song/projects/xiaok-cli/quality/loops/loop-engineering-release-sentinel.md

## Executive Summary
1. **Source is at the released `desktop-v1.4.16` tag, but the locally installed app reports v1.4.14** — the running build is one release behind the tagged/documented code. The sentinel cannot assert the machine matches the documented release until 1.4.16 is rebuilt + reinstalled here.
2. **No P0 blockers found.** Health, build, and the required loop-settings test are all green; loop diagnostics are correctly mounted on the Loops/Automations page, not General.
3. **Services healthy:** Intent Broker (4318) healthy, KSwarm (4400) healthy with `brokerConnected=true`, 36 projects loaded, dynamic-workflow features advertised.
4. **Verification is build-green, not behavior-green.** The required test (`desktop-settings-service-status`, 2/2 pass) and `npm run typecheck` (0 diagnostics) prove integrity/settings status, but neither runs a user loop end-to-end — a live loop smoke is still needed before calling the release behavior-validated.
5. **Doc gap:** English README has a strong Loop Engineering section, but `README.zh.md` is missing; the required literal UI phrases (`启用调度/关闭调度/批准自动运行`) exist only as functional equivalents. Net: **proceed to ship v1.4.16 source, but block "release-validated on this machine" until the build is reinstalled and a live loop smoke passes.**

## Health Checks

| Check | Status | Evidence |
| --- | --- | --- |
| xiaok-cli git status | ⚠️ WARN | `master`, HEAD at tag `desktop-v1.4.16`; 6 uncommitted files (all mobile-related: `desktop/electron/mobile-snapshot.ts`, `desktop/tests/main/mobile-snapshot.test.ts`, `mobile/ios/XiaokMobile/ContentView.swift`, `mobile/ios/XiaokMobile/MobileGatewayClient.swift`, `mobile/ios/XiaokMobileTests/*`, `mobile/ios/XiaokMobileUITests/*`). Not loop-related, but working tree is dirty on top of the release tag. |
| kswarm git status | ✅ PASS | clean; last commit `5be29cb 2026-06-24 docs: 更新 README 至 v0.9.2` |
| intent-broker git status | ✅ PASS | clean; last commit `1fd6166 2026-06-23 docs: 同步 README 集成说明至 Xiaok Desktop v1.4.11` |
| kai-xiaok-plugins git status | ✅ PASS | clean; last commit `4c107b6 2026-06-29 docs: update plugin baseline for desktop v1.4.16` (baseline targets v1.4.16 → consistent with source, inconsistent with installed 1.4.14) |
| intent-broker health (4318) | ✅ PASS | HTTP 200, `{"ok":true,"status":"healthy","degraded":false}`, 0.0008s |
| kswarm health (4400) | ✅ PASS | HTTP 200, `{"ok":true,"brokerConnected":true,"projects":36,"features":["dynamic_workflows","workflow_proposals","workflow_progress_batch","workflow_task_strategy","po_generated_workflow_proposals","workflow_budget_cache_recovery","workflow_script_generated_runs"]}`, 0.0005s |
| desktop renderer Loop settings test | ✅ PASS | `npm run test -- --run tests/renderer/desktop-settings-service-status.test.tsx` → **2 passed (2)**, 161ms |
| desktop typecheck | ✅ PASS | `npm run typecheck` → "Electron typecheck clean. Renderer baseline gate clean: 0 current diagnostics, 0 resolved since baseline." |

## Loop Documentation Review

**Coverage (good):**
- `README.md` §"Loop Engineering in Xiaok" (lines 22–47): maps all seven building blocks — **Automation, Work isolation, Skills, Connectors, Sub-agents, Memory, Evidence, Diagnostics** — to concrete Xiaok implementations. ✓
- A 5-step "smallest useful Xiaok loop" recipe (write skill → add trigger → persist memory → add checker → make failure visible). ✓ (architectural, not a UI walkthrough)
- README explicitly states **"Loop diagnostics moved out of general settings"** (line 122) and describes actionable diagnostics with anomaly kind / owner / suggested action / log paths (line 141). ✓
- README documents the full user-loop lifecycle: templates, manual run, schedule linkage, output dir auto-creation, clickable outputs, edit/delete (lines 123–124, 107). ✓
- Canonical design doc exists: `docs/design/2026-06-15-desktop-automations-loop-schedule-projects-design.md` (Chinese, multi-agent adversarial review ACCEPT, no P0/P1). Defines the rule: *"Automations 是入口；Loop 是业务定义；Schedule 是触发器；Project 是上下文；Run/Evidence 是执行事实。"* ✓
- Supporting design docs: `2026-06-15-user-loop-card-output-actions.md`, `2026-06-15-desktop-loop-generic-task-completion-design.md` (+ 4 review rounds), `2026-06-22-loop-self-improving-feedback-design-v2.md`. ✓

**Gaps:**
- ❌ **`README.zh.md` is missing** (`ls` → No such file). No Chinese top-level onboarding for a Chinese-primary product.
- ⚠️ **No end-user "create → run → verify → read diagnostics" walkthrough.** The README recipe is conceptual; the actual UI navigation (Automations → Loops → New Markdown Loop → Run now → open output → Diagnostics tab) is only inferable from changelog entries.
- ⚠️ **No "if your loop fails, where do I look" troubleshooting** as a user-facing doc. Diagnostics are described as a feature, not as a user flow.
- ⚠️ **Version drift in the doc itself:** README opens "Xiaok Desktop v1.4.16 ships…" and lists v1.4.16 "What's New", but the installed binary is v1.4.14. A user reading README against a 1.4.14 install will see feature claims the running build may lack (HTML artifact editor, save-permission fix, URI/paths bypass fix).
- ⚠️ **Mixed-language doc corpus:** canonical Loop design is Chinese; README is English.

## Product Behavior Review

**Loop diagnostics location — ✅ correct.**
- `renderer/src/components/automations/AutomationsPage.tsx` defines `AutomationsTab = 'overview' | 'schedules' | 'loops' | 'constraints' | 'diagnostics'`; the `diagnostics` tab renders `<LoopsPane sections="diagnostics" />`.
- `renderer/src/components/settings/GeneralSettings.tsx` has **zero** references to `loop` or `diagnostic`.
- `getNavItems()` in `DesktopSettings.tsx` lists only: general, mobile, model, skills, channels, mcp, tools, appearance, data, memory, about — **no loops/diagnostics entry in the Settings sidebar.** Migration out of General is verified in code, not just doc.

**i18n — ✅ symmetric and locale-driven.**
- No hardcoded English literals found in `LoopsPane` (DesktopSettings.tsx:2063+) or `AutomationsPage.tsx`; all visible text flows through `t.desktopSettings.*` / `t.automations*`. AutomationsPage uses 29 `t.*` references.
- zh.ts contains the required terms: `loopsTab: "循环"`, `userLoops: "用户循环"`, `newMarkdownLoop: "新建 Markdown 循环"`, `loopDiagnosticsRunNow: "立即运行"`, `createLoop: "创建循环"`, `newLoop: "新建循环"`, `deleteLoopConfirm`, `loopDiagnostics: "Loop 诊断"`, etc.
- **Locale parity: en.ts and zh.ts each have 3030 top-level keys; 46/46 loop-related keys in both.** No missing-key drift.

**Terminology nuance (partial):**
- Required literal phrases `启用调度` / `关闭调度` (per-loop schedule enable/disable) are **not** present as exact labels; loops bind to existing scheduled tasks (`createScheduleForLoop: "+ 为此循环创建定时任务"`), so per-loop enable/disable is expressed through the linked schedule, not a loop-scoped toggle.
- `批准自动运行` (approve auto-run) exists as the functional equivalent `scheduledApproveAuto: "允许自动执行"` with `scheduledApproveAutoNeedsReview` gating. Behavior matches; exact phrase differs.

**Accessibility — ✅ no duplicate-name conflict.**
- Per-loop run buttons use unique aria-labels (`aria-label={`run-loop-${template.loopId}`}`), as do edit/delete (`edit-loop-{id}`, `delete-loop-{id}`).
- There is a single global diagnostics Refresh button (`t.desktopSettings.loopDiagnosticsRefresh`). No two buttons share the same accessible name.
- Minor semantic note (not a conflict): the `RefreshCw` icon is reused for the per-loop "run now" action, while a separate RefreshCw reloads diagnostics — visually similar affordances for different actions.

## Adversarial Review

**Maker view (does the current state let a user understand and run a loop?):**
- Capability set is complete: create a markdown/task-completion loop, run now or via schedule, preview/open output, edit/delete, read diagnostics, review self-improving constraints. Nothing in the code blocks a user from executing a loop.
- Most valuable surface: the unified Automations page (loops + schedules + constraints + diagnostics + failures), which removes the old Settings/Loops confusion.
- **Blocking experience #1:** the installed app (1.4.14) lags the documented 1.4.16 — a user following README's v1.4.16 instructions on a 1.4.14 install can hit drift (e.g., HTML editor, save-permission fix).
- **Blocking experience #2:** Chinese-only users have no `README.zh.md` and must infer the UI flow from English changelog entries.

**Checker view (is any conclusion under-evidenced?):**
- ⚠️ **"Test passed + typecheck clean" ≠ "loops work in the real app."** The required test (`desktop-settings-service-status`) asserts settings/service-status behavior, not loop execution. We have proven build integrity and settings status, not loop behavior. This is the single biggest evidence gap.
- ✅ Doc-vs-product alignment on the diagnostics migration is real and verified in code (GeneralSettings clean, nav has no loops entry). Not a false claim.
- ✅ i18n code-layer symmetry is real (3030/3030 keys). But the **doc layer** is asymmetric (English README only) — do not let code-layer symmetry mask doc-layer asymmetry.
- ⚠️ **Silent-failure risk:** if the running build is genuinely 1.4.14, it predates the v1.4.16 evidence-guard test alignment and the URI/paths bypass fix, so diagnostics themselves could be computed by older guard logic than the source claims. The diagnostics loop could be "healthy" on a build whose evidence rules are stale.
- ⚠️ A non-zero possibility: `app.asar` was modified 2026-06-29 00:01:45 (recent) yet `Info.plist` still reports 1.4.14 — either a stale plist on a freshly packed build, or a genuine 1.4.14 install. Either way the running app self-identifies as 1.4.14; treat it as 1.4.14 until re-verified.

**Conflict & resolution:** Maker says "capability complete, ready"; Checker says "build-green ≠ behavior-green, and installed build lags source." **Resolution order:** (1) reinstall 1.4.16 so the running binary matches source, then (2) run a live loop to convert build-green into behavior-green, before declaring the release sentinel "behavior-validated."

## Findings

### P0 — None.
No app-won't-start, loop-completely-broken, data-corruption, or destructive-misexecution issues found. Services healthy; build + settings test + typecheck green; diagnostics correctly routed.

### P1

**P1-1 · Installed app (1.4.14) lags tagged/released source (1.4.16)**
- Evidence: `defaults read …/Info.plist CFBundleShortVersionString` → `1.4.14`; `desktop/package.json` version=`1.4.16`; `git describe` → `desktop-v1.4.16` at HEAD; `git tag` shows `desktop-v1.4.16` exists; kai-xiaok-plugins baseline targets v1.4.16.
- Impact: sentinel runs against a build one release behind the documented code; v1.4.16 fixes (HTML artifact editor, save-permission fix, URI/paths bypass fix, evidence-guard test alignment) may not be present in the running app; README claims do not match the installed binary.
- Suggested fix: rebuild + reinstall 1.4.16 locally (`npm run build:main && npm run build:renderer && npm run pack:dir`, or the release tag workflow), then re-confirm.
- Verification: `defaults read …/Info.plist CFBundleShortVersionString` == `1.4.16` AND a live loop run on the rebuilt app.

**P1-2 · `README.zh.md` is missing**
- Evidence: `ls /Users/song/projects/xiaok-cli/README.zh.md` → No such file; only `README.md` (89 KB) exists.
- Impact: Chinese-primary users have no localized top-level onboarding for Loop Engineering; contradicts the product's strong zh-locale investment (3030 keys).
- Suggested fix: author `README.zh.md` mirroring README.md (esp. the Loop Engineering section + "What's New"), or add a `docs/i18n` landing page that points to localized guides.
- Verification: file exists, non-empty, covers Automation/Work isolation/Skills/Connectors/Sub-agents/Memory/Evidence/Diagnostics mapping and the diagnostics-on-Loops-page statement.

**P1-3 · Verification is build-only, not behavior**
- Evidence: required test = `desktop-settings-service-status.test.tsx` (settings service status, 2/2 pass); `npm run typecheck` = 0 diagnostics. Neither test creates/runs a user loop or asserts a loop output artifact.
- Impact: cannot assert "loops actually produce artifacts and diagnostics in the real app"; "build-green" could mask a runtime regression.
- Suggested fix: add (or run an existing) live-loop smoke: create a markdown loop → Run now → assert the output `.md` exists under the configured output dir AND a loop-run + diagnostics row appears.
- Verification: smoke produces a real `.md` artifact and an open/seen diagnostics record against the rebuilt 1.4.16 app.

### P2

**P2-1 · Loop UI terminology partial coverage**
- Evidence: required literal phrases `启用调度` / `关闭调度` are absent as exact labels; only global `automationsGlobalAutoRunPause/Enable` exists. `批准自动运行` exists only as `scheduledApproveAuto: "允许自动执行"`.
- Impact: docs/tests/specs written against the exact phrases won't match the UI; minor user confusion when following literal instructions.
- Suggested fix: either add the literal per-loop labels, or update the spec/docs to use the actual labels (`允许自动执行`, linked-schedule model).
- Verification: `grep` zh.ts/en.ts for the chosen canonical phrases; UI matches doc.

**P2-2 · No end-user "first loop" walkthrough in README**
- Evidence: README's 5-step recipe is architectural; concrete UI navigation only appears in changelog entries (lines 107, 122–124).
- Impact: new users must infer the Automations → Loops → New → Run → Diagnostics flow from release notes.
- Suggested fix: add a short "Your first loop" guide (create → schedule → run → read diagnostics → clear failure) to README or `docs/`.
- Verification: a new reader can complete a loop using only the doc.

**P2-3 · Working tree dirty on top of the release tag**
- Evidence: `git status --short` shows 6 modified files, all mobile-related (`mobile-snapshot.ts`, its test, and `mobile/ios/*`).
- Impact: not loop-blocking, but a release sentinel should ideally run on a clean tree; mobile and desktop changes are interleaved in one workspace.
- Suggested fix: commit or stash the mobile changes separately before any further release tagging.
- Verification: `git status --short` empty (or mobile changes on their own branch).

### P3

**P3-1 · `RefreshCw` icon reused for "run now"**
- Evidence: per-loop run-now button uses `<RefreshCw>` (DesktopSettings.tsx:2597) with aria-label `run-loop-{id}`; diagnostics reload also uses RefreshCw (2706).
- Impact: visual affordance overlap (refresh icon = run now); not an a11y conflict (aria-labels are unique).
- Suggested fix: consider a `Play` icon for run-now to disambiguate.
- Verification: visual review of the Loops pane.

**P3-2 · Mixed-language canonical design doc**
- Evidence: `2026-06-15-desktop-automations-loop-schedule-projects-design.md` is Chinese; README is English.
- Impact: English-only contributors can't read the canonical Loop design without translation.
- Suggested fix: add an English summary header or cross-link from README.
- Verification: doc index has parity entries for both languages.

## Recommended Next Actions

1. **Rebuild & reinstall desktop v1.4.16 locally** (`npm run pack:dir` or the release-tag workflow); confirm `Info.plist == 1.4.16`. The sentinel must run against the actual released build, not 1.4.14. *(P1-1)*
2. **Run a live end-to-end user-loop smoke on the installed app:** create a markdown loop → Run now → assert the output `.md` exists and a diagnostics row appears. Convert build-green into behavior-green. *(P1-3)*
3. **Author `README.zh.md`** mirroring the Loop Engineering section, or add a `docs/i18n` landing page for Chinese users. *(P1-2)*
4. **Add a "First loop" user walkthrough** (create → schedule → run → read diagnostics → clear failure) to README/docs. *(P2-2)*
5. **Align doc/required phrases with actual UI labels** (`启用调度/关闭调度/批准自动运行` vs `允许自动执行` + linked-schedule model), or add the literal labels. *(P2-1)*
6. **Commit/stash the mobile-related uncommitted changes** so the release tree is clean before the next tag. *(P2-3)*
7. **Minor:** switch the per-loop "run now" icon from `RefreshCw` to `Play` for clearer affordance. *(P3-1)*

## Evidence Appendix

Commands actually executed (read-only; no writes except the report file). Outputs trimmed.

**Stage 1 — context**
```
date                            → 2026-06-29 06:03:22 CST (epoch 1782684202)
xiaok-cli: git branch           → master
xiaok-cli: git log -1           → dc98818c 2026-06-29 01:53 fix(desktop): render artifact cards and persist HTML edits on Windows
xiaok-cli: git status --short   →  M desktop/electron/mobile-snapshot.ts
                                    M desktop/tests/main/mobile-snapshot.test.ts
                                    M mobile/ios/XiaokMobile/ContentView.swift
                                    M mobile/ios/XiaokMobile/MobileGatewayClient.swift
                                    M mobile/ios/XiaokMobileTests/XiaokMobileModelTests.swift
                                    M mobile/ios/XiaokMobileUITests/XiaokMobileUITests.swift
xiaok-cli: git describe         → desktop-v1.4.16   (HEAD at release tag)
xiaok-cli: git tag (recent)     → desktop-v1.4.16, v1.4.15, v1.4.14, …
kswarm:      git status         → clean (5be29cb 2026-06-24)
intent-broker: git status       → clean (1fd6166 2026-06-23)
kai-xiaok-plugins: git status   → clean (4c107b6 2026-06-29)
Info.plist CFBundleShortVersionString → 1.4.14
Info.plist CFBundleVersion             → 1.4.14
app.asar mtime                        → Jun 29 00:01:45 2026
desktop/package.json version          → 1.4.16
curl 4318/health → 200 {"ok":true,"status":"healthy","degraded":false}
curl 4400/health → 200 {"ok":true,"brokerConnected":true,"projects":36,"features":[dynamic_workflows,workflow_proposals,...]}
```

**Stage 2 — docs**
```
ls README.md        → 89045 bytes (present)
ls README.zh.md     → No such file or directory
docs symlink        → ../mydocs/xiaok-cli (valid)
README.md §22-47    → "Loop Engineering in Xiaok" with 8-row building-block table + 5-step minimal loop
README.md:122       → "Loop diagnostics moved out of general settings"
README.md:123-124   → user loop templates + clickable outputs
docs/design/2026-06-15-desktop-automations-loop-schedule-projects-design.md → canonical, Chinese, ACCEPT after qoder/xiaok/cc/codex review
```

**Stage 3 — product behavior (read-only)**
```
GeneralSettings.tsx grep loop|diagnostic          → (no matches)  ← diagnostics NOT in General
AutomationsPage.tsx tabs                          → overview|schedules|loops|constraints|diagnostics; diagnostics → <LoopsPane sections="diagnostics"/>
DesktopSettings.tsx getNavItems()                 → general,mobile,model,skills,channels,mcp,tools,appearance,data,memory,about (NO loops/diagnostics entry)
LoopsPane defined in                              → DesktopSettings.tsx:2063 (used only by AutomationsPage)
zh.ts required terms                              → 循环, 用户循环, 新建 Markdown 循环, 立即运行, 创建循环, 新建循环  ✓
scheduledApproveAuto (zh)                         → "允许自动执行"  (functional equiv. of 批准自动运行)
en.ts/zh.ts key counts                            → 3030 / 3030  (parity)
en.ts/zh.ts loop-related key counts               → 46 / 46      (parity)
hardcoded English literals in LoopsPane/AutomationsPage → none found
per-loop run aria-label                           → `run-loop-${loopId}` (unique); single global diagnostics Refresh button → no duplicate-name conflict
```

**Stage 4 — verification commands**
```
cd desktop && npm run test -- --run tests/renderer/desktop-settings-service.test.tsx --reporter=basic
  → Test Files 1 passed (1) | Tests 2 passed (2) | Duration 1.40s
  (note: 'basic' reporter deprecation warning only; node v26.0.0, npm 11.12.1)

cd desktop && npm run typecheck
  → "Electron typecheck clean. Renderer baseline gate clean: 0 current diagnostics, 0 resolved since baseline."
```

**Environment note:** the default shell `PATH` did not include npm/node; commands were run with `PATH=/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/v24.15.0/bin` prepended. Node resolved to v26.0.0 (nvm v24.15.0 dir contains v26). Re-runnable on a clean machine by sourcing nvm first.

---

*Sentinel status: structural checks PASS; build/settings/typecheck PASS; release-validated-on-this-machine = BLOCKED pending 1.4.16 reinstall + live loop smoke (see P1-1, P1-3).*
