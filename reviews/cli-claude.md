# KualityForge Review: xiaok-cli Desktop Task Robustness & KSwarm Routing

**Runner:** `cli-claude`
**Date:** 2026-06-03
**Diff scope:** 36 files, +1310 / −146 lines across desktop main, preload, renderer, src runtime-host, dist adapters, and tests.

---

## Summary

This changeset delivers three interconnected capabilities:

1. **Dynamic workflow script resume** — interrupted `script_generated` workflows can be resumed without re-pasting the script, by recovering the persisted `scriptSource` from the durable KSwarm run. Includes startup scan (`recoverInterruptedScriptWorkflows`), one-click renderer resume (`resumeOneScriptWorkflow`), and hash-validated restore.
2. **Streaming retry hardening** — all three AI adapters (Claude, OpenAI, OpenAI-Responses) now track `emittedAny` to prevent duplicate output after mid-stream failures, with broader retryable error detection and 5-minute stream timeouts.
3. **Task runtime hardening** — incremental event subscription via `sinceIndex`, task watchdog timer (30 min), empty delivery detection (`degraded` flag), and stale running task recovery on `recoverTask`.

Secondary: sidebar update reminder redesigned as a GitHub releases popover (ad-hoc signing safe), kanban board surfaces pending tasks as active during dynamic workflows, and build-info merge conflict resolved.

---

## Findings

### F1 — `dist/` tracked in git (Severity: Low)

**Files:** `dist/ai/adapters/claude.js`, `dist/ai/adapters/openai.js`, `dist/ai/adapters/openai-responses.js`, `dist/runtime/task-host/task-runtime-host.js`, et al.

602 compiled files under `dist/` are tracked by git despite `dist/` being in `.gitignore`. The streaming retry changes in `src/ai/adapters/*.ts` are present in source and compiled into `dist/`, but only the `dist/` mutations show in the diff because the `src/` files were committed earlier. This is a latent hygiene issue — compiled output should not be version-controlled alongside its source. Not introduced by this changeset but surfaced by it.

**Risk:** Merge conflicts in generated files; reviewers must verify `dist/` matches `src/`.

### F2 — Untracked test file not staged (Severity: Medium)

**File:** `desktop/tests/main/subscribe-task-incremental-ipc.test.ts` (untracked, ??)

A 95-line IPC integration test for `sinceIndex` passthrough exists on disk but is not staged. This test directly validates the `desktop:subscribeTask` → `services.subscribeTask(taskId, { sinceIndex })` passthrough that is central to the incremental subscription feature. It should be added.

**Risk:** The IPC layer's `sinceIndex` routing has no committed test — if the harness is lost, the most fragile part of the incremental subscription path loses regression coverage.

### F3 — Stray compiled files at repo root (Severity: Low)

**Files:** `main.js`, `desktop-services.js`, `preload.cjs` (untracked, ??)

Compiled equivalents of `desktop/electron/main.ts`, `desktop/electron/desktop-services.ts`, `desktop/electron/preload.cjs` are present at the repo root. Not tracked, but their presence suggests a build step that outputs to `./` instead of `dist/`. Should be gitignored or cleaned up.

### F4 — `build-info.ts` had merge conflict markers committed (Severity: Low)

**File:** `src/build-info.ts`

The diff shows `<<<<<<< HEAD` / `=======` / `>>>>>>>` markers being replaced with a clean value. The conflict markers were present in the working tree (either committed or staged). This indicates a merge or rebase was completed without resolving the conflict marker — the fix is present in this diff, which is good, but the root cause (how markers entered the repo) should be investigated.

### F5 — `recoverInterruptedScriptWorkflows` maxRestarts cap is hardcoded (Severity: Low)

**File:** `desktop/electron/desktop-services.ts:2657`

The `maxRestarts = 20` cap is a local constant. If a user has >20 interrupted script workflows across projects, some will silently not be recovered. For a desktop app this is almost certainly fine, but the magic number should ideally be documented with a comment explaining the rationale for the specific cap.

### F6 — Sidebar update popover uses hardcoded GitHub URL (Severity: Low)

**File:** `desktop/renderer/src/components/Sidebar.tsx:30`

`GITHUB_RELEASES_URL = 'https://github.com/kaisersong/xiaok-cli/releases/latest'` is a compile-time constant. If the distribution channel changes (e.g., custom domain, ClawHub), this needs a code change. The comment explains the ad-hoc signing constraint, which is good context. Acceptable for now.

### F7 — `ProjectDetailPage` uses `as any` for desktop API access (Severity: Medium)

**File:** `desktop/renderer/src/components/projects/ProjectDetailPage.tsx:713`

```ts
const api = getDesktopApi() as any;
const result = await api?.kswarmResumeWorkflowRun?.?.({ projectId, workflowRunId });
```

The `kswarmResumeWorkflowRun` method is fully typed in `DesktopApi` (preload-api.ts:437), and `bridge.ts` exposes it. The renderer should import from the typed bridge instead of casting through `getDesktopApi() as any` with optional chaining. This bypasses TypeScript's type safety for the new IPC channel.

**Risk:** If the API shape changes, this call site won't catch it at compile time.

### F8 — `extractKSwarmJsonObject` now silently swallows parse failures (Severity: Medium)

**File:** `desktop/electron/desktop-services.ts:2480-2496`

Previously, malformed JSON from LLM output in a workflow node would throw `structured_json_missing`. Now it falls back to `{}` (empty object). The calling code then proceeds with an empty `parsed` record. For `review` nodes this means `reviewDecision` will be `undefined`, and for agent nodes the output becomes `summary` only.

The new test verifies this for the agent case (markdown summary preserved). But the review-node code path (`if (handoff.nodeKind === 'review')`) also runs with `parsed = {}`, and there's no test for that branch with the fallback. If a review node returns non-JSON, the decision extraction silently fails.

**Risk:** Review nodes with malformed LLM output may produce incorrect workflow routing without any error signal.

### F9 — Streaming retry `emittedAny` guard is sound (Severity: Info — Positive)

**Files:** `src/ai/adapters/claude.ts`, `openai.ts`, `openai-responses.ts`

The `emittedAny` flag prevents mid-stream retries that would duplicate already-yielded chunks. This is a correct and important fix — without it, a transient network error after partial output would cause the consumer to see duplicated content. The 5-minute stream timeout with `AbortController` is also a sensible guard against hung connections.

### F10 — `sinceIndex` incremental subscription is well-designed (Severity: Info — Positive)

**Files:** `src/runtime/task-host/task-runtime-host.ts`, `desktop/electron/ipc.ts`, `desktop/renderer/src/components/ChatShell.tsx`

The `sinceIndex` approach uses the append-only `events` array as an implicit cursor, which is simple and correct. The clamping logic (`Math.max(0, Math.min(requested, snapshot.events.length))`) safely handles out-of-range values. The ChatShell correctly tracks `lastSubSinceIndex` from the replay snapshot's event count and rebinds tool-step refs to avoid spawning duplicate tool-step messages.

---

## Test Coverage Assessment

| Layer | Tests Added | Coverage |
|-------|-------------|----------|
| Main services | 12 (recover + resume + markdown fallback + system prompt) | Good |
| Workflow script tool | 5 (script-less resume, hash mismatch, source unavailable, empty create, schema) | Good |
| Contract / hashing | 2 (preload routing + shared vectors) | Good |
| E2E | 1 (script source persistence verification) | Adequate |
| Renderer kanban | 3 (dynamic workflow progress display) | Good |
| Renderer intervention | 1 (resume-workflow draft) | Good |
| Renderer sidebar | 3 (popover, GitHub link, no auto-install) | Good |
| Runtime host | 3 (sinceIndex incremental, out-of-range, backward compat) | Good |

**Total new tests: ~30 across all layers.**

Missing coverage:
- `extractKSwarmJsonObject` fallback for `nodeKind === 'review'` (F8)
- IPC `sinceIndex` passthrough test (untracked file, F2)
- `recoverStaleRunningTask` edge cases (e.g., already-active execution)

---

## Architecture Boundary Compliance

| Rule | Status |
|------|--------|
| Main owns durable state | ✅ Resume and recovery logic in desktop-services/main |
| Renderer is display-only | ✅ Intervention UI, kanban display; no persistence |
| Preload exposes narrow API | ✅ New `kswarmResumeWorkflowRun` is semantic, not generic |
| IPC contract synchronized | ✅ preload-api.ts ↔ preload.cjs ↔ ipc.ts ↔ bridge.ts all updated |
| No renderer fact persistence | ✅ |
| No dual ownership of business facts | ✅ Recovery is single-owner in main |
| Contract tests updated | ✅ preload-contract.test.ts updated |

---

## Verdict

This is a well-structured changeset that addresses real production issues (interrupted workflows, streaming failures, stale tasks). The layer separation is clean, IPC contracts are properly extended, and test coverage is comprehensive. The medium-severity findings (F2 untracked test, F7 `as any` cast, F8 silent review-node fallback) should be addressed before or shortly after merge.

```kualityforge-review
{
  "runnerId": "cli-claude",
  "status": "completed",
  "contextRead": {
    "projectBrief": true,
    "userQualityPrinciples": false
  },
  "contextConfidence": "high",
  "contextGaps": [
    "user-quality-principles.json does not exist — review uses project CLAUDE.md rules and architecture boundaries as primary quality criteria"
  ],
  "principleAlignment": {
    "desktop-main-owns-state": "aligned",
    "preload-narrow-api": "aligned",
    "ipc-contract-sync": "aligned",
    "test-first-for-contracts": "aligned (with gap: F2 untracked test)",
    "no-dual-ownership": "aligned",
    "renderer-display-only": "aligned (with gap: F7 any-cast)"
  },
  "findings": [
    {
      "id": "F1",
      "severity": "low",
      "title": "602 dist/ files tracked in git despite .gitignore",
      "file": "dist/",
      "description": "Compiled output is version-controlled. Not introduced by this changeset but makes diff review harder."
    },
    {
      "id": "F2",
      "severity": "medium",
      "title": "subscribe-task-incremental-ipc.test.ts not staged",
      "file": "desktop/tests/main/subscribe-task-incremental-ipc.test.ts",
      "description": "95-line IPC test for sinceIndex passthrough exists on disk but is untracked. The most fragile part of incremental subscription lacks committed coverage."
    },
    {
      "id": "F3",
      "severity": "low",
      "title": "Stray compiled files at repo root",
      "file": "main.js, desktop-services.js, preload.cjs",
      "description": "Untracked compiled equivalents of electron source files at repo root. Should be gitignored or removed."
    },
    {
      "id": "F4",
      "severity": "low",
      "title": "build-info.ts had committed merge conflict markers",
      "file": "src/build-info.ts",
      "description": "Diff replaces <<<<<<< HEAD markers. Root cause (how markers entered the repo) should be checked."
    },
    {
      "id": "F7",
      "severity": "medium",
      "title": "ProjectDetailPage casts DesktopApi as any for kswarmResumeWorkflowRun",
      "file": "desktop/renderer/src/components/projects/ProjectDetailPage.tsx:713",
      "description": "New IPC call uses getDesktopApi() as any instead of typed bridge, bypassing compile-time safety for the new channel."
    },
    {
      "id": "F8",
      "severity": "medium",
      "title": "extractKSwarmJsonObject silent fallback for review nodes",
      "file": "desktop/electron/desktop-services.ts:2480-2496",
      "description": "Parse failures now return {} instead of throwing. Agent nodes handle this correctly (markdown fallback), but review nodes will silently fail to extract reviewDecision with no test coverage for that path."
    }
  ]
}
```
