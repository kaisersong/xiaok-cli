# xiaok Desktop

Desktop MVP surface for the xiaok Intent Cockpit.

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

Build a local macOS app directory:

```bash
npm run pack:dir --prefix desktop
```

The packaged app is written to:

```text
desktop/release/mac-arm64/xiaok.app
```

The first `pack:dir` run may download the Electron runtime.
