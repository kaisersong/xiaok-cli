# Protected SQLite facade component

The original Native producer calls `ps_create_original_namespace(env, original_io)`
in the **same addon instance** as its fixed `assertOriginalNamespace` export. It
must supply a genuine `nr_root_store_io` born from the original installation
session. There is no JS path, fd, external-pointer, engine or verifier argument.

The fixed `index.cjs` composes that original core into a frozen API namespace:
`Database`, `Statement`, `databaseMethods`, `statementMethods`,
`transactionStateGetter` and negative `closeOwned`. Only the C producer can create
the core. `new api.Database()` accepts no arguments and opens once. Statements
come from `prepare`; callbacks are synchronous zero-argument scalar UDFs.

The consumer must replace its captured method bundle as well as its constructor;
Node's `DatabaseSync.prototype` methods cannot operate on these objects. The
transaction getter belongs to this component, not Node's builtin prototype.

Build the addon with this directory's `binding.gyp` and co-locate `index.cjs` with
`protected_sqlite.node`. A Native producer/checker compiled into another addon is
not interchangeable: no shared registry or N-API/V8 layout casting is assumed.
The production target exposes no test opener. Its fixed admission and budget
producers require the original Main issuer's private capsule; they accept no
caller path, file family, raw IO pointer or verifier. The component tests also
compile a checker-only sibling to verify separate registries; that sibling is
not the complete Main/Worker binding produced by `binding.gyp`.

The original Main Core now supplies the fixed admission bundle to
`desktop-multi-agent-store.ts`, and the original budget Store/Worker consumes its
own fixed family through `harness-protected-budget-worker.ts`. Real isolated
Electron Main warm/cold tests exercise both connections. These are bounded
component and lifecycle results; production qualification remains disabled.
Production genesis, legacy migration, other authority owners, complete process
containment and all14 validation remain separate original-owner contracts.
The component uses the original private VFS, never a default file VFS fallback.
WAL/ATTACH/disk-temp/extension routes are outside this finite API. Changing any
existing Store's WAL contract requires its own explicit protected profile and
migration; this component does not silently convert an old database.

The JavaScript compatibility layer captures its intrinsics at fixed module birth.
That capture cannot authenticate pre-import mutation. A qualified Main must load
the fixed component before untrusted code under its original protected startup
contract. The component tests establish neither that Main startup ordering nor
complete SDK/daemon/process quiescence: native-file close is one component only.

The Main/Worker C++ bridge targets Electron ABI 140. It uses the scalar
`SharedArrayBuffer::New` overload and retains the original buffer for private
data-address/length membership; it passes no `std::shared_ptr` across Electron's
Chromium C++ standard-library boundary. The real Main fixture checks undefined
V8/Node symbols against its exact copied Electron Framework before launch.
