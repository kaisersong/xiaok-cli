# xiaok Desktop

Native desktop surface for xiaok task delivery, scheduled automation, and KSwarm multi-agent projects.

## Current Release Focus

v1.4.3 fuses the dynamic workflow surface into the project kanban, so workflow progress lives where users already manage tasks:

- Each task card on the project kanban now shows a slim multi-segment workflow progress bar (completed / running / failed) plus a `工作流执行` chip and the latest workflow primary message. Users can read task health directly from the board instead of switching to a separate workflow panel.
- Clicking any task card opens a right-side `TaskDetailDrawer` that consolidates task description, assigned agent, execution strategy, pipeline progress, the full workflow node list grouped by phase (with parallel groups, fan-out labels, failure policy, and per-node agent / status / error), review feedback, and artifacts. The drawer reuses the same KSwarm workflow snapshot used by the strip and refreshes alongside project polling.
- The top-of-page `WorkflowStatusStrip` is demoted to a small text-only badge (e.g. `工作流 · Review gate passed`) next to the dedicated `运行工作流` button. Clicking the badge still opens the full workflow detail dialog, which now anchors to the right edge so it stays inside the viewport in the compact layout.
- Shared workflow rendering helpers — status icon, tone class, status label, progress formatter, public-view normalizer, and generic workflow view builder — are extracted into `desktop/renderer/src/components/projects/workflowUtils.ts`. New helpers `findWorkflowRunForTask` (matches a task to its workflow run via `task.execution.workflowRunId` / `scope.taskId` / `sourceTask.id`) and `computeTaskPipelineProgress` reduce a `KSwarmWorkflowRun` to a `TaskPipelineProgress` summary used by both card and drawer.
- This release does not change the KSwarm data model, project APIs, or task semantics. It restructures the desktop renderer surface only, building on the v1.3.13 dynamic workflow script foundation (parallel groups, fan-out labels, failure policy, script checkpoints) that KSwarm already exposes through `getProjectFullDetail`.

Earlier dynamic workflow foundation (v1.3.13):

- Trusted model-authored dynamic workflow scripts can create phases, call `agent(...)`, and use thunk-based `parallel([() => agent(...), ...])` for branch fan-out, with `parallelGroup` and `scriptCheckpoints` persisted in KSwarm.
- The `run_dynamic_workflow_script` tool supports `previewOnly` for confirm-before-run, and `resumeWorkflowRunId` for same-run primitive reuse. `get_dynamic_workflow_status` reports run/node/parallel/checkpoint/gate/delivery state from KSwarm snapshots.
- Parallel runtime has foundation semantics for `required_all`, `collect_errors`, and `quorum`; KSwarm persists quorum group completion when enough branches pass.
- Desktop release packaging must include the matching `kswarm`, `intent-broker`, and `kai-xiaok-plugins` sibling repositories.

Troubleshooting:

- If the workflow menu says the service version is too old, close the old Xiaok app or stale KSwarm process and launch the current Desktop build again.
- If a workflow dialog appears over text with a transparent background, treat it as a regression. Menus and dialogs should use opaque `bg-[var(--c-bg-card)]` surfaces.
- If a task workflow appears to finish instantly without details, open the workflow detail chip and check budget, cache/recovery, last progress, node output, and gate status. A valid run should not only say "completed".

## Local Validation

Install dependencies:

```bash
npm install --prefix desktop
```

Run tests:

```bash
npm run test --prefix desktop
```

Typecheck:

```bash
npm run typecheck --prefix desktop
```

Build main process and renderer:

```bash
npm run build --prefix desktop
```

Build a local unpacked app directory for local launch:

```bash
npm run pack:dir --prefix desktop
```

The unpacked outputs are written to:

```text
desktop/release/mac-arm64/xiaok.app
desktop/release/win-unpacked/xiaok.exe
```

The first `pack:dir` run may download the Electron runtime.

Build customer-facing desktop artifacts from the repo root:

```bash
npm run desktop:pack
```

Before shipping, ensure the sibling repositories are committed and current because `electron-builder.json` packages resources from:

```text
../../kswarm
../../intent-broker
../../kai-xiaok-plugins
```

After a tagged desktop release finishes, verify that the updater feed and
release assets are usable:

```bash
npm run desktop:verify-release -- desktop-v<version>
```

The release is not considered complete until this check passes. It verifies
GitHub Latest, `latest-mac.yml`, `latest.yml`, and the macOS/Windows installer
asset names against the desktop package version.

On Windows this produces:

```text
desktop/release/xiaok-setup-<version>.exe
desktop/release/xiaok-portable-<version>.exe
```

On Windows, run the root launcher to pack on demand and start the unpacked app:

```bash
npm run desktop:launch
```

On Windows, run the root install command to build and install the current-user desktop app:

```bash
npm run desktop:install
```
