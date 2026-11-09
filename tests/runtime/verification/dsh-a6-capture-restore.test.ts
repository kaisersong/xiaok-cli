import { afterAll, beforeAll, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  realpathSync,
  statSync,
  rmSync,
} from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startProfileSourceCapture } from "../../../src/runtime/verification/profile-source-capture.js";
import { iterateCapturedSQLiteGroupsSources } from "../../../src/runtime/verification/captured-sqlite-groups.js";
import { iterateCapturedProfileDeclarations } from "../../../src/runtime/verification/captured-profile-mapper.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "dsh-a6-capture-")));
const directoryHelper = join(root, "directory"),
  sqliteHelper = join(root, "sqlite");
const origin = resolve("tests/fixtures/dsh-a6-original");
const manifest = JSON.parse(
  readFileSync(join(origin, "manifest.json"), "utf8"),
);
const bytes = gunzipSync(readFileSync(join(origin, "groups.sqlite.gz")));
let serial = 0;
const ownerCloses:Array<()=>Promise<void>>=[];
const hash = (raw: Uint8Array) =>
  createHash("sha256").update(raw).digest("hex");
beforeAll(() => {
  expect(hash(bytes)).toBe(manifest.databaseSha256);
  const sqlite = resolve("node_modules/better-sqlite3/deps/sqlite3"),
    object = join(root, "sqlite.o");
  execFileSync(
    "clang",
    [
      "-O2",
      "-DSQLITE_THREADSAFE=0",
      "-DSQLITE_OMIT_LOAD_EXTENSION=1",
      "-DSQLITE_TEMP_STORE=3",
      "-DSQLITE_ENABLE_DBPAGE_VTAB=1",
      "-c",
      join(sqlite, "sqlite3.c"),
      "-o",
      object,
    ],
    { timeout: 30000 },
  );
  execFileSync("clang", [
    "-Wall",
    "-Wextra",
    "-Werror",
    "-std=c11",
    "-I",
    sqlite,
    resolve("src/runtime/verification/native/source-sqlite-custody.c"),
    object,
    "-o",
    sqliteHelper,
  ]);
  execFileSync("clang", [
    "-Wall",
    "-Wextra",
    "-Werror",
    "-std=c11",
    resolve("src/runtime/verification/native/source-lock-custody.c"),
    "-o",
    directoryHelper,
  ]);
}, 40000);
afterAll(async () => {let first:unknown;for(const close of ownerCloses)try{await close();}catch(error){first??=error;}rmSync(root,{recursive:true,force:true});if(first)throw first;});
function restore() {
  const folder = join(root, String(++serial));
  mkdirSync(folder);
  const path = join(folder, "groups.sqlite");
  writeFileSync(path, bytes);
  return path;
}
async function capture(path: string) {
  const directory = statSync(dirname(path), { bigint: true }),
    database = statSync(path, { bigint: true });
  const owner = await startProfileSourceCapture({
    uid: process.getuid!(),
    directoryHelper,
    sqliteHelper,
    sources: [
      {
        sourceId: "original-a6",
        kind: "sqlite-db",
        snapshotFormat: "multi-agent-groups-sqlite-v1",
        directory: {
          canonicalPath: dirname(path),
          device: String(directory.dev),
          inode: String(directory.ino),
        },
        database: {
          basename: basename(path),
          device: String(database.dev),
          inode: String(database.ino),
        },
      },
    ],
    signal: new AbortController().signal,
  });
  ownerCloses.push(()=>owner.close());
  try {
    const token = await owner.capture();
    return {
      events: [...iterateCapturedSQLiteGroupsSources(owner, token)],
      owner,
      token,
    };
  } catch (error) {
    await owner.close();
    throw error;
  }
}
it("captures all nonempty original A6 tables and physically restores identical history bytes", async () => {
  const path = restore(),
    { events, owner, token } = await capture(path);
  try {
    expect(events[0]).toMatchObject({ kind: "source-start", userVersion: 6 });
    const rows = events.filter((event) => event.kind === "row");
    for (const table of [
      "dsh_a_domains",
      "dsh_a_mandates",
      "dsh_a_control_operations",
      "dsh_a_windows",
      "dsh_a_assessment_attempts",
      "dsh_a_assessments",
      "dsh_a_decisions",
      "dsh_a_work_bindings",
      "dsh_a_command_outbox",
      "dsh_a_owner_receipts",
      "dsh_a_source_snapshots",
    ])
      expect(
        rows.some((row) => row.table === table),
        table,
      ).toBe(true);
    expect(events.at(-1)?.kind).toBe("complete");
    const declarations = [];
    for await (const event of iterateCapturedProfileDeclarations(owner, token))
      declarations.push(event);
    expect(declarations.at(-1)).toMatchObject({
      kind: "complete",
      enumerationComplete: true,
    });
    expect(hash(readFileSync(path))).toBe(manifest.databaseSha256);
  } finally {
    await owner.close();
  }
  const second = await capture(restore());
  try {
    expect(
      second.events
        .filter((event) => event.kind === "row")
        .map((event) => event.parsed),
    ).toEqual(
      events
        .filter((event) => event.kind === "row")
        .map((event) => event.parsed),
    );
  } finally {
    await second.owner.close();
  }
}, 30000);

// External fixture corruption deliberately drops/reinstalls the exact trigger
// SQL. It is not evidence that an ordinary writer can bypass the owner floor.
it.each([
  "selection_assessment",
  "command_epoch",
  "owner_command",
  "control_head",
  "control_receipt",
  "checkpoint_scan",
  "mandate_body",
  "domain_tuple",
  "setup_selection",
] as const)(
  "rejects restored original A6 %s corruption even with fresh canonical row hashes",
  async (change) => {
    const path = restore(),
      db = new DatabaseSync(path);
    const { dshAJson, dshAHash } = await import(
      "../../../src/runtime/multi-agent/dsh-admission-data.js"
    );
    const table =
      change === "selection_assessment"
        ? "dsh_a_selection_heads"
        : change === "command_epoch"
          ? "dsh_a_command_outbox"
          : change === "owner_command"
            ? "dsh_a_owner_receipts"
            : change === "control_head"
              ? "dsh_a_control_heads"
              : change === "control_receipt"
                ? "dsh_a_control_domain_receipts"
                : change === "checkpoint_scan"
                  ? "dsh_a_source_content_checkpoints"
                  : change === "mandate_body"
                    ? "dsh_a_mandates"
                    : change === "setup_selection" ? "dsh_a_source_setups" : "dsh_a_domains";
    const triggers = db
      .prepare(
        "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name=?",
      )
      .all(table);
    try {
      for (const trigger of triggers)
        db.exec('DROP TRIGGER "' + String(trigger.name) + '"');
      const stored = db
        .prepare("SELECT rowid,* FROM " + table + " ORDER BY rowid LIMIT 1")
        .get()!;
      const body = JSON.parse(String(stored.data_json));
      const extra: Record<string, unknown> = {};
      if (change === "selection_assessment")
        body.assessmentHash = "f".repeat(64);
      else if (change === "command_epoch") {
        body.command.authorizationEpoch++;
        body.authorityEpoch++;
      } else if (change === "owner_command")
        body.receipt.command.inputId = "other-original-input";
      else if (change === "control_head") {
        body.epoch++;
        extra.epoch = body.epoch;
      } else if (change === "control_receipt") {
        body.canonicalHash = "e".repeat(64);
        extra.receipt_hash = dshAHash(body);
      } else if (change === "checkpoint_scan") {
        const old = db
          .prepare(
            "SELECT read_set_id FROM dsh_a_source_read_sets WHERE read_set_id != ? LIMIT 1",
          )
          .get(stored.read_set_id)!;
        expect(old).toBeDefined();
        body.selectedReadSetId = old.read_set_id;
        extra.read_set_id = old.read_set_id;
      } else if (change === "mandate_body")
        body.projection.document.allowedActions = ["not_a_local_permission"];
      else if (change === "setup_selection") {
        body.configuration.selection.kind = "all_permissions";
        body.configurationHash = dshAHash(body.configuration);
        extra.configuration_hash = body.configurationHash;
      } else {
        body.storageScope.profileId = "c".repeat(64);
        extra.profile_id = body.storageScope.profileId;
      }
      if (change === "owner_command") {
        const plain = { ...body.receipt };
        delete plain.recordDigest;
        body.receipt.recordDigest = dshAHash(["dsh-record-v1", plain]);
        extra.receipt_hash = body.receipt.recordDigest;
        // Keep the embedded original record internally self-consistent too.
        body.basis.commandReceipt = body.receipt;
      }
      const raw = dshAJson(body),
        hash =
          change === "checkpoint_scan"
            ? dshAHash(["dsh-source-checkpoint-v1", body])
            : dshAHash(["dsh-a-authority-row-v1", table, body]);
      const values = {
        data_json: raw,
        body_hash: hash,
        logical_bytes: Buffer.byteLength(raw),
        ...extra,
      };
      const columns = Object.keys(values);
      db.prepare(
        "UPDATE " +
          table +
          " SET " +
          columns.map((column) => column + "=?").join(",") +
          " WHERE rowid=?",
      ).run(
        ...(columns.map(
          (column) => values[column as keyof typeof values],
        ) as never[]),
        stored.rowid as number,
      );
    } finally {
      for (const trigger of triggers) db.exec(String(trigger.sql));
      db.close();
    }
    await expect(capture(path)).rejects.toThrow();
  },
  30000,
);
