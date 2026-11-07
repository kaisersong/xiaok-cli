import { app } from "electron";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { dirname, resolve, join, basename, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { lstatSync, realpathSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
const target = process.env.XIAOK_DSH_A_RESULT;
if (
  typeof target !== "string" ||
  !isAbsolute(target) ||
  basename(target) !== "a1-result.json"
)
  throw Error("fixture_target_required");
const root = realpathSync(dirname(target)),
  stat = lstatSync(root);
if (
  stat.isSymbolicLink() ||
  !stat.isDirectory() ||
  stat.uid !== process.getuid() ||
  dirname(root) !== realpathSync(tmpdir()) ||
  !/^xiaok-artifact-runtime-e2e-[A-Za-z0-9]{6}$/.test(basename(root))
)
  throw Error("fixture_target_invalid");
app.on("window-all-closed", () => {});
app
  .whenReady()
  .then(async () => {
    let store, identity, error;
    const cleanupErrors = [],
      facts = {};
    try {
      const compiled = resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../../dist/main",
      );
      const { DesktopMultiAgentStore, readOriginalDshAdmissionPort } =
        await import(
          join(compiled, "desktop/electron/desktop-multi-agent-store.js")
        );
      const { ActivityNativeIdentityRepository } = await import(
        join(compiled, "src/runtime/conversation-activity/native-identity.js")
      );
      const frames = new WeakMap(),
        txFacts = [],
        file = join(root, "groups.sqlite");
      let db;
      const source = {
        resolve(frame, purpose) {
          const e = frames.get(frame);
          if (!e || e.purpose !== purpose)
            throw Error("original_private_source_required");
          return {
            data: e.data,
            assertCurrent() {
              const getter = Object.getOwnPropertyDescriptor(
                db,
                "isTransaction",
              );
              assert.equal(getter.configurable, false);
              assert.equal(typeof getter.get, "function");
              txFacts.push(Reflect.apply(getter.get, db, []));
            },
          };
        },
      };
      store = new DesktopMultiAgentStore(file, { dshAdmissionSource: source });
      db = store.db;
      assert.equal(
        Object.getOwnPropertyDescriptor(db, "isTransaction").configurable,
        false,
      );
      assert.equal(db.isTransaction, false);
      store.claimBootOwnership();
      const port = readOriginalDshAdmissionPort(store, source),
        issue = (purpose, data) => {
          const frame = Object.freeze(Object.create(null));
          frames.set(frame, { purpose, data });
          return frame;
        };
      assert.throws(() => readOriginalDshAdmissionPort({ ...store }, source));
      assert.throws(() => port.initialize({}, { requestSource: "user" }));
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 4);
      port.initialize(issue("initialize", { schemaVersion: 1 }), {
        requestSource: "user",
      });
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 5);
      facts.originalNativeFalseTrueFalse =
        txFacts.includes(false) &&
        txFacts.includes(true) &&
        db.isTransaction === false;
      assert.equal(facts.originalNativeFalseTrueFalse, true);
      const authScope = {
        tenantId: "tenant",
        workspaceId: "workspace",
        connectionId: "connection",
        providerAccountId: "account",
        repositoryId: "repo",
        credentialEpoch: 1,
      };
      port.establishSourceBinding(
        issue("bind_source", {
          bindingId: "binding",
          provider: "github",
          authScope,
          sourceBindingVersion: 1,
          roleMappingVersion: 1,
          provenanceVersion: 1,
        }),
        { requestSource: "user" },
      );
      const envelope = {
        thread: {
          sourceBindingId: "binding",
          tenantId: "tenant",
          workspaceId: "workspace",
          provider: "github",
          repositoryId: "repo",
          kind: "issue",
          threadId: "42",
        },
        authScope,
        providerEventId: null,
        objectKind: "issue",
        objectId: "42",
        providerRevision: "r1",
        contentHash: "a".repeat(64),
        receivedAt: "2026-11-06T00:00:00.000Z",
        objectAuthorId: null,
        actorEvidence: {
          kind: "verified_event",
          eventRef: "event",
          triggerActorId: "actor",
        },
        actorMappingVersion: 1,
        provenanceVersion: 1,
        actorEvidenceHash: "b".repeat(64),
        kind: "created",
        trust: "external_untrusted",
        snapshotRef: "owned-source-ref",
        completeness: "complete",
        paginationComplete: true,
        authorizationCheckedAt: "2026-11-06T00:00:00.000Z",
      };
      const input = {
        bindingId: "binding",
        expectedBindingRevision: 1,
        envelope,
        comparison: null,
      };
      const first = port.importVerifiedInput(issue("import_input", input), {
          requestSource: "scheduler",
        }),
        again = port.importVerifiedInput(issue("import_input", input), {
          requestSource: "scheduler",
        });
      assert.equal(first.input.inputId, again.input.inputId);
      assert.equal(db.prepare("SELECT count(*) n FROM dsh_a_inbox").get().n, 1);
      facts.originalCanonicalOnce = true;
      assert.throws(() =>
        port.importVerifiedInput(issue("import_input", input), {
          requestSource: "agent",
        }),
      );
      facts.agentDenied = true;
      store.registerThread({
        threadId: "ordinary",
        profileId: "profile",
        workspaceId: "workspace",
        cwd: root,
      });
      assert.equal(store.createGroup("ordinary").threadId, "ordinary");
      identity = new ActivityNativeIdentityRepository({
        profileId: "profile",
        kind: "desktop",
        path: file,
      });
      assert.equal(identity.getThread("ordinary").workspaceId, "workspace");
      facts.originalIdentityAndOrdinaryPreserved = true;
      const read = port.readSourceInput(
        issue("read", { bindingId: "binding", inputId: first.input.inputId }),
        { requestSource: "user" },
      );
      assert.equal(read.input.inputId, first.input.inputId);
      facts.authenticatedInboxRead = true;
    } catch (caught) {
      error = caught;
    }
    for (const value of [identity, store])
      if (value)
        try {
          value.close();
        } catch (caught) {
          cleanupErrors.push(String(caught));
        }
    const body = {
      processPid: process.pid,
      nativeAppReady: app.isReady(),
      facts,
      cleanupErrors,
      error: error ? String(error) : undefined,
      stack: error?.stack,
      qualification:
        "isolated actual Electron original Store protocol; controlled private Source is not provider/Main authority; no execution",
    };
    const pending = join(root, "a1-result.json.pending");
    writeFileSync(pending, JSON.stringify(body), { flag: "wx", mode: 0o600 });
    renameSync(pending, target);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
