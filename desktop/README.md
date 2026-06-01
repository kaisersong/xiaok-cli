# xiaok Desktop

Native desktop surface for xiaok task delivery, scheduled automation, and KSwarm multi-agent projects.

## Current Release Focus

v1.3.12 focuses on making KSwarm dynamic workflow script orchestration parallel, durable, and visible from project detail:

- Trusted model-authored dynamic workflow scripts can create phases, call `agent(...)`, and use thunk-based `parallel([() => agent(...), ...])` for branch fan-out.
- `parallel()` creates a durable KSwarm `parallelGroup` before dispatching branch nodes. Branches carry fan-out labels, required/schema/evidence metadata, and script checkpoints for snapshot-based observability.
- The conversation tool supports `previewOnly` so an assistant can show a workflow preview before starting the run. Confirmed runs start in a background job and return `workflowRunId` immediately.
- Project workflow details show parallel groups, branch completion counts, failure policy, branch labels, script checkpoints, blocking failures, and gate status from KSwarm snapshots.
- This is not yet a full user-authored workflow platform. Cross-process script job recovery, advanced failure policies, professional workflow templates, and quality evals remain staged follow-up work.
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
