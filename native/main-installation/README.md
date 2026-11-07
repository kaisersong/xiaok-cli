# Original Main installation transport and RootIO v2

This Darwin component is a fixed launcher and filesystem service. It does not
open SQLite, own business policy, issue business permissions, create an N/M/P
pool, or install itself. Its internal C wire/keys/FDs are not JavaScript APIs.

The v2 protocol retains the 88-byte one-use birth and 104-byte MACed frame.
The helper spawns its compiled fixed entry; the entry drops to the original
account, closes inherited descriptors and reconstructs the read-only birth pipe
at FD 198. The Native client must consume it before application JavaScript.
The helper authenticates the actual accepted peer PID/UID/executable/birth.
Two independently sequenced channels derive separate HKDF keys from the birth,
both random nonces, release digest, build kind and domain. Frame payloads are
bounded at 64 KiB; partial frames have an absolute five-second deadline and
an authenticated idle channel has no idle deadline. No caller path, UID,
public key, role, FD or verifier selects an authority.

`root-store-state.h` and `root-store-io.h` implement the helper's filesystem
state. `namespace.bin` is a 320-byte protected anchor. `birth.receipts` appends
fixed 512-byte hash-chained records. The 424-byte authenticated identity has
CREATED/CLAIMED/BOUND states, helper-selected pool/claim IDs and exact file facts.
The directory nlink is the **anchor's actual birth audit**, not the current
APFS directory entry count; live directory identity compares dev/ino/UID/mode.
Database and issuer files still require nlink=1. The helper transport profile
hash identifies this IO format; it does not substitute for RootC's SQL schema
and semantic digest.

Creation requires the same original directory and two exclusive database/lock
births. Files/directories are synced before the anchor/CREATED receipt. CLAIM
appends and syncs the selected IDs before ACK. BIND accepts only the fixed
Native tuple; RootC must have independently committed and validated its complete
SQL graph. The helper does not parse SQL or trust a JavaScript COMMIT boolean.
Missing/v1 catalogs, incomplete records and extra receipt tails are refused,
never truncated or converted into a new fresh pool. A complete unacknowledged
claim remains CLAIMED on restart and cannot receive another fresh claim.
The append log has an explicit component bound of 1,048,576 records (512 MiB);
there is no compaction, quota reset or automatic replacement pool in this slice.

Journal CREATE records and syncs its exact inode and monotonic generation.
Every actual OPEN/CREATE gets a new per-open ticket; all journal IO carries the
40-byte generation/ticket prefix. Journal writes therefore split data into
at most 65,496-byte chunks, while read replies can carry 65,536 bytes. READONLY
handles cannot write/truncate. CLOSE actually closes that FD before its durable
receipt, but retains its identity for the following DELETE. A new OPEN retires
old tickets. DELETE syncs an intent before exact unlink, syncs the directory,
then syncs the completion before ACK. On restart, an original durable delete
intent can finish only the same inode or its already-missing result. A replaced
inode, missing expected journal or orphan file is never silently deleted or
re-signed. Original hot journals can reopen read-only and then read-write.

The helper owns only fixed database/journal/issuer slots and FS metadata.
Issuer flock is a lifetime outer lock, not SQLite RESERVED state. The private
VFS maintains SQLite locks. Fixed WAL/SHM names must actually be absent before
positive IO; this slice cannot open or delete them. No generic file path, SQL,
or default VFS fallback is exposed. Root-IO CLOSE and original journal CLOSE
remain negative paths after unknown; they do not reset unknown or authorize
another effect. Metadata RW descriptors are included in lease shutdown. A file
lease ACK is not proof that the helper/guest/business resource tree has ended.

Production installation certification and first-pool/canonical authorization
are separate facts. The latter has no shipped producer, so the production build
refuses namespace/DB birth before those SDKs. The compile-time fixture kind is
wire/KDF isolated and cannot certify production. It exercises the **same actual
C helper/wire** with real files and the original Native client/system SQLite.
No test here deploys a privileged helper or launches Electron.

Still OPEN: actual installer/root authorization, early Main wiring, complete
code/signature/fuse closure, raw-fork secret cleanup, all authority databases and
SQLite bindings/WAL/file control, migration/old descriptors/external rollback
anchor, guest containment, Windows and all14/P4. A RootDB component does not
protect A/B/Broker/budget databases or create another wallet. Same-process native
memory compromise is not solved by private channel keys. No capability is
granted merely because the image, helper or private VFS exists.

Run on Darwin, Node >=22.14:

```
node --test tests/native/main-installation-helper.test.mjs
node --test tests/native/original-root-io-vfs.test.mjs
```

Tests compile original sources in private temporary roots, capture source hashes
before/after and artifact hashes, record/join their own PIDs, and never extract
or install into shared system paths. Fault fixtures first call the actual fsync
SDK then return controlled EIO; they cannot compile as a production helper.
Their unknown responses do not count as physical or business success.

## Fixed authority-family extension (v2)

The RootNMP op1–20 and 424/320/512-byte formats remain unchanged. Added Native
op21 OPEN takes only a fixed family ID and the private producer's scope digest;
op22 REQUEST wraps an original file operation in a 52-byte token/operation/slot/
offset/amount/length prefix; op23 RELEASE closes that exact lease. A 24-byte
result separates OK, known denial, unknown-held and busy-held. Outer nonzero
status, invalid MAC/sequence/framing or peer is a channel fault, never a business
receipt. The maximum family DB write is 65,484 bytes, journal write 65,444, and
read reply 65,512. The shared Native client must chunk and serialize the one
original root_io sequence; no synchronous Worker IO waits for a Main JS handler.

Family IDs 2–5 select only admission/groups.sqlite, budget/harness-optimization.sqlite,
kswarm/state.sqlite and broker/broker.sqlite. Each private scope uses its own
helper-constructed lowerhex directory and durable birth/claim/profile/receipt/
journal. Scope digests, family enums and successful transport do not authorize
business access. Non-Root claims cite the **same already-BOUND Root pool**; they
never create another NMP pool or wallet. They cannot open before Root is bound.
A session permits at most 64 family leases, checks its FD limit before new IO,
and never recycles failed/closed rows. Same-session repeat OPEN returns the same
active token; after release it cannot revive. Cold recovery reuses the same
Root pool, family and scope, with complete receipts and original file identity.

The per-family transport profile is SHA256 of ASCII
`xiaok-authority-family-io-v1` followed by NUL, BE32 family and 32 scope bytes.
This is not the owner's business schema digest. Known invalid tokens/operations
are denied before target IO. A real observed identity/IO fault remains unknown
for that original lease even if bytes or permissions are restored; another
family's own valid lease can still close or operate. Global close seals all
positive entry and attempts every family's files, metadata and directories plus
Root files. A failed or unknown family prevents a successful global close; its
error and entered descriptors remain held. Neither RELEASE nor close clears
unknown, capacity, cost or held business ledger rows.

Unknown here follows original v2: sticky for the current Native/helper lifetime,
not a new durable boolean. A later helper requires same pool/family/scope and
complete original ledger/receipts/hot-journal recovery. Missing business cold
proof must deny; this file protocol does not certify balances or reissue a
request. Source/Worker/owned-child private birth validation and actual SQL
migration are separate implementations. Ordinary SQLite and WAL are never
silently converted. Existing WAL/SHM or partial/corrupt catalog is preserved and
refused, not deleted or replaced by a new namespace.

Production family canonical genesis/migration enrollment has no shipped producer;
the helper denies before any family directory/DB birth. The finite component
fixture explicitly enables only two compiled scopes (32 bytes of 0x11 or 0x22)
under `MI_FIXTURE_BUILD` plus `MI_FIXTURE_AUTHORITY_SCOPES`. This is actual file
protocol testing, not installed qualification. Main's required early Core
bootstrap and last-Core-close order is separately owned by the composition;
the current helper tests do not claim that product wiring has shipped.
