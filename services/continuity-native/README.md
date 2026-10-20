# Dedicated native Harness

This package builds the pinned upstream Codex app-server with an immutable tool/RPC ceiling. It does not enable Desktop Harness switching by itself. Desktop's execution gate stays closed until the original main tool owner, pending input journal, handoff and physical closure paths qualify together.

No container, global CLI replacement, global Rust installation, copied subscription credentials or user configuration is required. Supply an existing private Rust 1.95.0 toolchain and a private build directory:

```sh
node script/build.mjs --build-root /absolute/private/build-directory \
  --cargo /absolute/private/toolchain/bin/cargo \
  --rustc /absolute/private/toolchain/bin/rustc
```

The builder creates its own child directory, verifies the official source archive and patch hashes, applies the exact patch, builds with `--locked`, runs the original registry policy test and actual binary qualification, and writes `artifact.json` only after success. Default builds use the release profile; `--profile dev` is for local verification. `--archive` accepts a previously downloaded archive with the same required hash. Optional `--cargo-home` reuses an explicitly supplied private dependency cache beneath `--build-root`. Compiled targets always use a fresh private directory: the compiler host, explicit target triple and Mach-O architecture must agree before the private binary copy is tested. Shared/global dependency directories are never selected automatically. Every spawned PID and exit is recorded in `build-processes.json`.

Current build qualification targets macOS arm64. Other platforms fail closed until separately verified. Test invocation requires the actual binary:

```sh
XIAOK_NATIVE_TEST_BINARY=/absolute/private/target/debug/codex-app-server npm test
```

Tests use private temporary homes, a local mock Responses endpoint and synthetic authentication only. They verify hidden builtin dispatch rejection, the sole `xiaok.invoke` dynamic callback, sibling RPC restrictions, executable lifecycle canaries and upstream helper entry rejection. They do not establish physical completion of arbitrary main tools or real subscription interoperability.

AuthOwner has a separate fixed build role and reproducible recipe:

```sh
npm run build:auth-owner -- --build-root /absolute/private/build-root --cargo /absolute/pinned/compiler/bin/cargo --rustc /absolute/pinned/compiler/bin/rustc --archive /absolute/verified/upstream.tar.gz --profile dev
```

The recipe checks the upstream archive, the existing sampling patch, the additional `auth-owner.patch`, and every affected source hash before compiling. The additional patch includes the earlier snapshot primitive; apply it directly after `restricted.patch`, without also applying `auth-snapshot.patch`. It runs the original boundary unit tests and the actual auth-role protocol tests in isolated namespaces. It creates an artifact under the requested build root and does not install it.

`auth-owner.json` records the current protocol-only scope: fixed raw/typed ceiling, the original account-auth queue and connection/context checks, opaque snapshot output before outbound enqueue, and synthetic browser callback error redaction. Real managed OAuth, private File vault/lifetime locking, worker credential leases, the final worker stdin gate, and full Harness qualification remain separate requirements. The existing sampling build entry is unchanged. The new recipe has syntax/argument checks; the current artifact was built and tested with the equivalent pinned commands recorded in the evidence directory, while an end-to-end run of this new recipe remains pending.
