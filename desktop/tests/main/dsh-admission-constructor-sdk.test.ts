// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const cleanups: Array<() => void> = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  for (const fn of cleanups.splice(0).reverse()) fn();
});
it.each(["return", "throw"] as const)(
  "original constructor %s SDK fate holds actual raw before closing the original connection",
  async (kind) => {
    vi.resetModules();
    const root = mkdtempSync(join(tmpdir(), "dsh-a-ctor-")),
      file = join(root, "groups.sqlite");
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    let release!: () => void,
      originalDb: DatabaseSync | undefined,
      returnedStore: { close(): void } | undefined;
    const held = new Promise<void>((yes) => {
        release = yes;
      }),
      first = Error("original UDF wrapper", { cause: held }),
      original = DatabaseSync.prototype.function;
    const hook = vi
      .spyOn(DatabaseSync.prototype, "function")
      .mockImplementation(function (
        this: DatabaseSync,
        ...args: Parameters<typeof original>
      ) {
        const result = Reflect.apply(original, this, args);
        if (args[0] === "xiaok_main_dsh_source_ingress_v1") {
          originalDb = this;
          if (kind === "throw") throw first;
          return held as unknown as typeof result;
        }
        return result;
      });
    const { DesktopMultiAgentStore } = await import(
      "../../electron/desktop-multi-agent-store.js"
    );
    let rejected = false,
      cause: unknown;
    try {
      try {
        returnedStore = new DesktopMultiAgentStore(file, {
          dshAdmissionSource: {
            resolve() {
              throw Error("not invoked");
            },
          },
        });
      } catch (error) {
        rejected = true;
        cause = error;
      }
      expect(originalDb).toBeDefined();
      expect(originalDb!.prepare("SELECT 1 n").get()).toMatchObject({ n: 1 });
      expect(rejected).toBe(true);
      if (kind === "throw") expect(cause).toBe(first);
      release();
      await new Promise((done) => setImmediate(done));
      expect(() => originalDb!.prepare("SELECT 1")).toThrow(/closed|not open/);
    } finally {
      hook.mockRestore();
      release();
      await new Promise((done) => setImmediate(done));
      if (returnedStore) returnedStore.close();
      else
        try {
          originalDb?.close();
        } catch {}
    }
  },
);
it("original SQL row outcome inventories held raw and cannot rearm a later A request", async () => {
  vi.resetModules();
  const { StatementSync } = await import("node:sqlite"),
    root = mkdtempSync(join(tmpdir(), "dsh-a-row-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  let release!: () => void,
    armed = false;
  const held = new Promise<void>((yes) => {
      release = yes;
    }),
    get = StatementSync.prototype.get;
  const hook = vi
    .spyOn(StatementSync.prototype, "get")
    .mockImplementation(function (
      this: InstanceType<typeof StatementSync>,
      ...args: Parameters<typeof get>
    ) {
      const row = Reflect.apply(get, this, args);
      if (armed && row) {
        armed = false;
        return Object.assign(row, { sdkSidecar: held });
      }
      return row;
    });
  const { DesktopMultiAgentStore, readOriginalDshAdmissionPort } = await import(
    "../../electron/desktop-multi-agent-store.js"
  );
  const frames = new WeakMap(),
    source = {
      resolve(frame: object) {
        if (!frames.has(frame)) throw Error("private frame");
        return { data: { schemaVersion: 1 }, assertCurrent() {} };
      },
    },
    store = new DesktopMultiAgentStore(join(root, "groups.sqlite"), {
      dshAdmissionSource: source,
    });
  store.claimBootOwnership();
  const port = readOriginalDshAdmissionPort(store, source),
    frame = Object.freeze(Object.create(null));
  frames.set(frame, true);
  try {
    armed = true;
    expect(() => port.initialize(frame, { requestSource: "user" })).toThrow();
    let secondRejected = false;
    try {
      port.initialize(frame, { requestSource: "user" });
    } catch {
      secondRejected = true;
    }
    expect(secondRejected).toBe(true);
    release();
    await new Promise((done) => setImmediate(done));
    expect(() => port.initialize(frame, { requestSource: "user" })).toThrow();
  } finally {
    armed = false;
    hook.mockRestore();
    release();
    await new Promise((done) => setImmediate(done));
    store.close();
  }
});
