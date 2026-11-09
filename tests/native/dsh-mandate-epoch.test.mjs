import {getNativeTestElectronExecutable} from './helpers/electron-executable.mjs';
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  require = createRequire(join(repo, "package.json"));
test(
  "actual Main user mandate revisions advance their epoch without rotating the domain issuer",
  { skip: process.platform !== "darwin", timeout: 60000 },
  async () => {
    const headers = process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS;
    assert.ok(headers);
    const root = mkdtempSync(join(tmpdir(), "dsh-mandate-epoch-")),
      result = join(root, "facts.json");
    const build = spawnSync(
      process.execPath,
      [
        join(repo, "native/root-resource-authority/build-main-bootstrap.mjs"),
        headers,
        join(root, "main_bootstrap.node"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(build.status, 0, build.stderr || build.stdout);
    writeFileSync(
      join(root, "groups.sqlite"),
      gunzipSync(
        readFileSync(
          join(repo, "tests/fixtures/dsh-a6-original/groups.sqlite.gz"),
        ),
      ),
    );
    await require("esbuild").build({
      entryPoints: [
        join(repo, "tests/native/fixtures/dsh-mandate-epoch-entry.ts"),
      ],
      outdir: root,
      entryNames: "entry",
      outExtension: { ".js": ".mjs" },
      splitting: true,
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      banner: {
        js: "import{createRequire as fixtureRequire}from'node:module';const require=fixtureRequire(import.meta.url);",
      },
    });
    symlinkSync(join(repo, "desktop/node_modules"), join(root, "node_modules"));
    const electron = await getNativeTestElectronExecutable(repo),
      env = { ...process.env, XIAOK_CONFIG_DIR: join(root, "config") };
    mkdirSync(env.XIAOK_CONFIG_DIR);
    delete env.NODE_OPTIONS;
    delete env.ELECTRON_RUN_AS_NODE;
    const args = [
        join(repo, "tests/native/fixtures/dsh-mandate-epoch-main.cjs"),
        join(root, "entry.mjs"),
        root,
        result,
      ],
      child = spawn(electron, args, { env, stdio: ["ignore", "pipe", "pipe"] }),
      row = {
        pid: child.pid,
        argv: [electron, ...args],
        signals: [],
        stdout: "",
        stderr: "",
      };
    writeFileSync(join(root, "birth.json"), JSON.stringify(row));
    child.stdout.on("data", (data) => (row.stdout += data));
    child.stderr.on("data", (data) => (row.stderr += data));
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        row.signals.push("SIGTERM");
        child.kill("SIGTERM");
      }
    }, 45000);
    try {
      await new Promise((yes, no) => {
        child.once("error", no);
        child.once("close", (code, signal) => {
          Object.assign(row, { code, signal, reaped: true });
          yes();
        });
      });
    } finally {
      clearTimeout(timer);
      writeFileSync(join(root, "run.json"), JSON.stringify(row));
    }
    console.log(JSON.stringify({ root, ...row }));
    assert.equal(row.code, 0, row.stderr);
    assert.deepEqual(row.signals, []);
    const facts = JSON.parse(readFileSync(result, "utf8"));
    assert.equal(facts.ok, true);
    assert.equal(facts.authorizationEpoch, 2);
    assert.equal(facts.issuerEpoch, 1);
  },
);
