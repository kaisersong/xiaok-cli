# xiaok Desktop

Native desktop surface for xiaok task delivery, scheduled automation, and KSwarm multi-agent projects.

## Current Release Focus

v1.3.3 focuses on Swarm project reliability:

- Xiaok seed PO/Worker agents run through the full Desktop agent runtime, so project execution has the same model, tools, MCP plugins, web-search/fetch, report renderer, and slide renderer as normal Xiaok conversations.
- KSwarm task handoff uses durable files and artifact-first result manifests instead of long broker text payloads.
- Project execution, review, retry, recovery, artifact preview, and final delivery are visible from the desktop project board.
- Desktop release packaging must include the matching `kswarm`, `intent-broker`, and `kai-xiaok-plugins` sibling repositories.

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
