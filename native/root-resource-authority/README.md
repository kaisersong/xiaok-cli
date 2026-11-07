# Native resource reservation protocol

This unpublished Darwin N-API component owns the original resource schema's
single Native SQLite connection. Its fixed methods are `openOriginal`,
`installFresh`, `readPolicy`, `enqueue`, `claimNext`, `consumeLaunch`,
`readRecord`, `cancelQueued`, `close`, and detached `buildInfo`.

The production and fixture targets compile the same enqueue state machine;
a Clang AST regression checks that boundary. Only the fixture constructor and
controlled SDK-failure seam are conditional. There is **no production business
subject factory, qualified Main issuer, physical finish, recovery or Main
installation**. `nativeQualified` stays false. This is a resource SQL protocol
component, not an enabled global N domain.

Production derives its fixed account path from `getpwuid_r`. The runtime accepts
no path, HOME override, epoch, SQL or verifier. The separately compiled fixture
has an immutable compiled root, reported by fixture-only `compiledFixtureRoot`
for test diagnostics before open. Neither this field nor detached data grants
authority. Opaque sessions/children require original addon/thread/env/session
membership before dereferencing, and children retain the parent session.

Only the original session's successful fresh installation permits mutation.
Every existing-floor cold open is read-only/reconciliation-required, including
queued-only databases. Enqueue cannot rearm cold eligibility. Native eligibility
survives JS subject GC independently, and replay does not refresh it. Close/GC
only close local handles; they never delete resource rows or refund capacity.

Same-key/hash enqueue is idempotent. Claims count all four active states against
fixed capacity 5, apply FIFO within priority and a maximum human burst of 3 before
background work, and atomically CAS resource/outbox/receipt/fairness. Launch
consumption uses the same-session private reservation once; replay returns the
original receipt without another claim. This does not itself launch a Host.

`cancelQueued` authenticates the same original subject and owned queued row
independently of the positive claim deadline. It atomically records
`cancelled_before_launch` and an immutable receipt without changing policy,
fairness, claim sequence or outbox. Exact receipt history does not rearm work.
Already claimed work is refused and continues occupying capacity; this is not
physical finish or refund. A full queued slot becomes available for another
subject without consuming the original irreversible claim.
The C guard checks complete typed OLD/NEW cells against a private transaction
write set, each write once, with physical readback before normal COMMIT.
It is INNOCUOUS, not DIRECTONLY or DETERMINISTIC, under trusted_schema OFF.
The semantic digest is SHA-256 of `reservation-contract.json` bytes. The earlier
`floor-component-contract.json` is retained history, not an accepted migration.

All output fields use own data definitions. Observed identity loss and unknown
commit/projection outcomes remain unconfirmed; committed resource facts survive
an unreturned capability. Fixture-only `armCommitWrapperFailure` fails its
controlled claim, consume or queued-cancel wrapper **after real successful COMMIT**. This tests committed truth;
it does not claim to reproduce a system fsync failure. Production exports neither
this seam nor `fixtureSubject`.

The fixture's finite subject metadata comes from the real old metadata journal
API, compiled into a separate test target; its SHA and bytes are compared with
actual SQLite rows. It is not an actual Main/business subject bridge. Atomic VFS
custody, sidecar inventory, unrestricted same-UID DDL/fake UDF/file isolation,
precompiled old-writer migration, all real root classes, M/P, physical exit,
installed artifact allowlists and Windows remain open qualification requirements.

Build the optional production component without signing or installing:

```sh
npx --yes --package=node-gyp@11.5.0 node-gyp rebuild --directory native/root-resource-authority
```

For a separate fixture gyp target, set `root_resource_fixture_header` to a build
input defining `NR_FIXTURE_ROOT` as the dedicated test parent's canonical root.
A finite subject test may also define `NR_FIXTURE_FACTS_HEADER`; it contains the
canonical metadata/key arrays, priorities, and `NR_FIXTURE_FACT_COUNT`. No header
or root is selected at runtime. Native compiler headers are read-only SDK inputs,
not runtime account/database configuration.

```sh
node --experimental-sqlite --test tests/native/root-resource-authority.test.mjs
# Run the Desktop reservation test under the isolated test account, supplying
# XIAOK_NATIVE_TEST_INCLUDE_DIR only to select cached Node compiler headers.
```

Tests record direct synchronous child PID/status and attempt every cleanup while
preserving the body failure. Those records do not certify all process descendants
or product physical drain. Non-Darwin gyp targets remain unavailable (`type:none`)
and ordinary Desktop startup does not import this optional module.
