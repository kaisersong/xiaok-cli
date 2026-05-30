# xiaok Desktop

Native desktop surface for xiaok task delivery, scheduled automation, and KSwarm multi-agent projects.

## Current Release Focus

v1.3.9 focuses on making KSwarm dynamic workflow visible and usable from project tasks:

- Project task cards can create a task-scoped `po-generated-task-workflow` proposal. The proposal shows source task, budget hard caps, permissions, phases, and acceptance rubric before any agent is dispatched.
- Project-level workflows still live in the tab row as one "Run Workflow" menu. The project tab remains "Logs" because it contains both Swarm and Workflow activity.
- Workflow run details show hard budget limits, last material progress, blocking failures, run-internal stored node results, and recovery mode.
- The PO-generated path uses validated workflow IR. Desktop and KSwarm do not execute raw JavaScript or arbitrary user workflow scripts in this release.
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
