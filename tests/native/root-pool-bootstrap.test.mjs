import {getNativeTestElectronExecutable} from './helpers/electron-executable.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(repo, 'package.json'));
async function child(root, fixture, args, stage) {
  const electron = await getNativeTestElectronExecutable(repo);
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_RUN_AS_NODE;
  const argv = [fixture, ...args],
    p = spawn(electron, argv, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const row = {
    pid: p.pid,
    argv: [electron, ...argv],
    stdout: '',
    stderr: '',
    signals: [],
  };
  writeFileSync(join(root, stage + '-birth.json'), JSON.stringify(row));
  p.stdout.on('data', (b) => {
    row.stdout += b;
  });
  p.stderr.on('data', (b) => {
    row.stderr += b;
  });
  const timer = setTimeout(() => {
    if (p.exitCode === null) {
      row.signals.push('SIGTERM');
      p.kill('SIGTERM');
    }
  }, 30000);
  try {
    await new Promise((yes, no) => {
      p.once('error', no);
      p.once('close', (code, signal) => {
        Object.assign(row, { code, signal, reaped: true });
        yes();
      });
    });
  } finally {
    clearTimeout(timer);
    writeFileSync(
      join(root, stage + '-run.json'),
      JSON.stringify(row, null, 2),
    );
  }
  console.log(JSON.stringify({ root, stage, ...row }));
  assert.equal(row.code, 0, row.stderr);
  assert.deepEqual(row.signals, []);
}
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-native-root-pool-')),
    domain = join(root, 'domain');
  mkdirSync(domain);
  const addon = join(root, 'root_resource_authority_main.node');
  const built = spawnSync(
    process.execPath,
    [
      join(repo, 'native/root-resource-authority/build-main-session.mjs'),
      process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS,
      addon,
      domain,
      'embedded',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(built.status, 0, built.stderr || built.stdout);
  return { root, domain, addon };
}
test(
  'original Main pool bootstrap API is a fixed Native member entry',
  { skip: process.platform !== 'darwin', timeout: 45000 },
  async () => {
    const { root, domain, addon } = await setup();
    const result = join(root, 'facts.json');
    await child(
      root,
      join(repo, 'tests/native/fixtures/root-pool-bootstrap.cjs'),
      [addon, domain, result, join(root, 'userData'), 'fresh'],
      'fresh',
    );
    assert.equal(JSON.parse(readFileSync(result, 'utf8')).bootstrap, 'fresh');
    await child(
      root,
      join(repo, 'tests/native/fixtures/root-pool-bootstrap.cjs'),
      [addon, domain, result, join(root, 'userData'), 'cold'],
      'cold',
    );
    assert.equal(
      JSON.parse(readFileSync(result, 'utf8')).bootstrap,
      'restored',
    );
  },
);
test(
  'original complete Main Owner reopens the SAME Root pool and actually executes original readonly SDK',
  { skip: process.platform !== 'darwin', timeout: 90000 },
  async () => {
    const { root, domain } = await setup();
    symlinkSync(join(repo, 'desktop/node_modules'), join(root, 'node_modules'));
    const bundle = join(root, 'component.mjs');
    await require('esbuild').build({
      entryPoints: [
        join(
          repo,
          'tests/native/fixtures/original-process-composition-entry.ts',
        ),
      ],
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      banner: {
        js: "import {createRequire as fixtureRequire} from 'node:module';const require=fixtureRequire(import.meta.url);",
      },
    });
    const source = readFileSync(
      join(repo, 'tests/native/fixtures/original-process-composition.cjs'),
      'utf8',
    );
    const old =
      'assert.deepEqual(leafProbe.go,[{reserved:1,intents:1,bindings:1}]);';
    assert.equal(source.split(old).length, 2);
    const fixture = join(root, 'root-pool-owner.cjs');
    // The original production composition and algorithms are unchanged. Only
    // the test's first-run receipt total is generalized for its same DB restart.
    writeFileSync(
      fixture,
      source
        .replace(
          'runner: input => hostRun(input)',
          'runner: input => hostRun(input), createTaskId: () => `pool-task-${process.pid}`',
        )
        .replace(
          old,
          '{assert.equal(leafProbe.go.length,1);assert.equal(leafProbe.go[0].reserved,1);assert.equal(leafProbe.go[0].intents,leafProbe.go[0].bindings);}',
        ),
    );
    writeFileSync(
      join(root, 'readonly-leaf-sdk-probe.cjs'),
      readFileSync(
        join(repo, 'tests/native/fixtures/readonly-leaf-sdk-probe.cjs'),
      ),
    );
    const args = [
      bundle,
      domain,
      join(root, 'facts.json'),
      join(root, 'userData'),
      resolve(repo, '../intent-broker/src/broker/service.js'),
      resolve(repo, '../intent-broker/src/http/server.js'),
      'glob',
    ];
    for (const stage of ['first', 'cold'])
      await child(root, fixture, args, stage);
    assert.equal(
      JSON.parse(readFileSync(join(root, 'facts.json'), 'utf8')).actualMain,
      true,
    );
  },
);

async function runNative(state, mode, stage = mode) {
  await child(
    state.root,
    join(repo, 'tests/native/fixtures/root-pool-bootstrap.cjs'),
    [
      state.addon,
      state.domain,
      join(state.root, 'facts.json'),
      join(state.root, 'userData'),
      mode,
    ],
    stage,
  );
}
function mutate(state, sql) {
  const db = new (require('node:sqlite').DatabaseSync)(
    join(state.domain, 'root-resource-v1.sqlite'),
  );
  try {
    const triggers = db
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE type='trigger' ORDER BY name",
      )
      .all();
    for (const row of db
      .prepare("SELECT name FROM sqlite_schema WHERE type='trigger'")
      .all())
      db.exec('DROP TRIGGER "' + row.name + '"');
    db.exec(sql);
    for (const row of triggers) db.exec(row.sql);
  } finally {
    db.close();
  }
}
for (const [seed, cold] of [
  ['seed_held', 'held_cold'],
  ['seed_queue', 'queue_cold'],
  ['seed_gang', 'gang_cold'],
]) {
  test(
    'original second Main ' +
      cold +
      ' preserves held capacity and never remints old eligibility',
    { skip: process.platform !== 'darwin', timeout: 45000 },
    async () => {
      const state = await setup();
      await runNative(state, seed);
      await runNative(state, cold);
    },
  );
}
const corruptions = [
  ['identity uid', 'UPDATE root_pool_identity SET owner_uid=owner_uid+1'],
  [
    'identity integer storage class',
    'UPDATE root_pool_identity SET database_inode=CAST(database_inode AS BLOB)',
  ],
  [
    'identity pool nonce',
    "UPDATE root_pool_identity SET pool_id='not-a-native-nonce'",
  ],
  ['N policy sequence', 'UPDATE root_resource_policy SET next_seq=next_seq+1'],
  ['N fairness counter', 'UPDATE root_resource_policy SET human_burst=2'],
  ['N claim counter', 'UPDATE root_resource_policy SET claim_seq=claim_seq+1'],
  [
    'N metadata digest',
    "UPDATE root_resources SET metadata_json='{}' WHERE enqueue_seq=1",
  ],
  [
    'N receipt BLOB',
    "UPDATE root_resource_receipts SET receipt_json=CAST(receipt_json AS BLOB) WHERE kind='reserved'",
  ],
  [
    'N receipt NUL suffix',
    "UPDATE root_resource_receipts SET receipt_json=receipt_json||char(0) WHERE kind='reserved'",
  ],
  [
    'N outbox state',
    "UPDATE root_launch_outbox SET state='pending' WHERE revision=1",
  ],
  [
    'missing N receipt',
    "DELETE FROM root_resource_receipts WHERE kind='launch_consumed'",
  ],
  [
    'M counter',
    'UPDATE root_physical_policy SET claim_seq=claim_seq+1 WHERE kind=1',
  ],
  [
    'P counter',
    'UPDATE root_physical_policy SET next_seq=next_seq+1 WHERE kind=2',
  ],
  [
    'P intent NUL suffix',
    "UPDATE root_physical_receipts SET receipt_json=receipt_json||char(0) WHERE kind='process_intent_v1'",
  ],
  [
    'P child parent relationship',
    "UPDATE root_physical_resources SET parent_record_id=(SELECT record_id FROM root_physical_resources WHERE allocation_role='workflow_vm') WHERE allocation_role='workflow_child_attempt'",
  ],
  [
    'P slot generation',
    "UPDATE root_physical_resources SET generation=generation+1 WHERE allocation_role='workflow_child_slot'",
  ],
  [
    'unknown P receipt family',
    "UPDATE root_physical_receipts SET kind='caller_terminal' WHERE kind='capacity_reserved'",
  ],
];
for (const [name, sql] of corruptions) {
  test(
    'original cold bootstrap rejects ' +
      name +
      ' without modifying any historical row',
    { skip: process.platform !== 'darwin', timeout: 45000 },
    async () => {
      const state = await setup();
      await runNative(state, 'seed_gang');
      mutate(state, sql);
      const file = join(state.domain, 'root-resource-v1.sqlite'),
        before = readFileSync(file);
      await runNative(state, 'reject:RESTORE_UNCONFIRMED', 'rejected');
      assert.deepEqual(readFileSync(file), before);
    },
  );
}
test(
  'existing empty database and lock cannot become fresh merely because schema is empty',
  { skip: process.platform !== 'darwin', timeout: 45000 },
  async () => {
    const state = await setup();
    writeFileSync(join(state.domain, 'issuer.lock'), '');
    writeFileSync(join(state.domain, 'root-resource-v1.sqlite'), '');
    await runNative(state, 'reject:FRESH_BIRTH_REQUIRED', 'rejected');
  },
);
test(
  'deleted database cannot become fresh under its old lock namespace',
  { skip: process.platform !== 'darwin', timeout: 45000 },
  async () => {
    const state = await setup();
    await runNative(state, 'fresh');
    const fs = require('node:fs');
    fs.unlinkSync(join(state.domain, 'root-resource-v1.sqlite'));
    await runNative(state, 'reject:FRESH_BIRTH_REQUIRED', 'rejected');
  },
);
test(
  'replaced lock cannot restore the old database identity',
  { skip: process.platform !== 'darwin', timeout: 45000 },
  async () => {
    const state = await setup();
    await runNative(state, 'fresh');
    const fs = require('node:fs');
    fs.unlinkSync(join(state.domain, 'issuer.lock'));
    await runNative(state, 'reject:RESTORE_UNCONFIRMED', 'rejected');
  },
);
for (const version of [5, 6]) {
  test(
    'exact old v' +
      version +
      ' floor remains history-only and gains no fresh identity anchor',
    { skip: process.platform !== 'darwin', timeout: 45000 },
    async () => {
      const state = await setup();
      await runNative(state, 'seed_held');
      const digest =
        version === 6
          ? '1e04b496364184acbdb96b17473e83356b1c70859da0d81c9409fc6eb6f0930f'
          : '92b39b7b584bb3f8dbb4ef450bae0b3fd06d01817d6b03dd43c05d293e57939b';
      // Controlled floor-gate fixture, not an assertion that this is an old binary.
      mutate(
        state,
        `UPDATE root_resource_floor SET profile='ordinary_runtime_root_resource_reservation_writer_v${version}',schema_version=2,semantic_digest='${digest}',guard_abi='xiaok_root_resource_reservation_writer_v${version - 1}'`,
      );
      const file = join(state.domain, 'root-resource-v1.sqlite'),
        before = readFileSync(file);
      await runNative(
        state,
        'reject:LEGACY_POOL_IDENTITY_UNCONFIRMED',
        'rejected',
      );
      assert.deepEqual(readFileSync(file), before);
    },
  );
}

test(
  'actual content-addressed old v6 Native database is refused intact without anchoring or releasing holds',
  { skip: process.platform !== 'darwin', timeout: 45000 },
  async () => {
    const state = await setup(),
      fs = require('node:fs'),
      zlib = require('node:zlib'),
      crypto = require('node:crypto');
    const manifest = JSON.parse(
      readFileSync(
        join(repo, 'tests/native/fixtures/root-pool-v6-original.json'),
        'utf8',
      ),
    );
    const compressed = readFileSync(
      join(repo, 'tests/native/fixtures/root-pool-v6-original.sqlite.gz'),
    );
    assert.equal(
      crypto.createHash('sha256').update(compressed).digest('hex'),
      manifest.gzipSha256,
    );
    const bytes = zlib.gunzipSync(compressed);
    assert.equal(
      crypto.createHash('sha256').update(bytes).digest('hex'),
      manifest.databaseSha256,
    );
    const file = join(state.domain, 'root-resource-v1.sqlite');
    writeFileSync(file, bytes);
    writeFileSync(join(state.domain, 'issuer.lock'), '');
    await runNative(
      state,
      'reject:LEGACY_POOL_IDENTITY_UNCONFIRMED',
      'rejected',
    );
    assert.deepEqual(readFileSync(file), bytes);
  },
);
for (const sql of [
  'DROP TRIGGER nr_guard_8_0',
  'CREATE TABLE caller_extra(value TEXT)',
]) {
  test(
    'exact original cold schema rejects ' + sql,
    { skip: process.platform !== 'darwin', timeout: 45000 },
    async () => {
      const state = await setup();
      await runNative(state, 'fresh');
      const file = join(state.domain, 'root-resource-v1.sqlite');
      const db = new (require('node:sqlite').DatabaseSync)(file);
      try {
        db.exec(sql);
      } finally {
        db.close();
      }
      const before = readFileSync(file);
      await runNative(state, 'reject:RESTORE_UNCONFIRMED', 'rejected');
      assert.deepEqual(readFileSync(file), before);
    },
  );
}

for (let point = 1; point <= 6; point++) {
  test(
    'original bootstrap write/COMMIT failure point ' +
      point +
      ' never returns ready',
    { skip: process.platform !== 'darwin', timeout: 45000 },
    async () => {
      const state = await setup();
      await runNative(state, 'fault:' + point, 'fault');
      const db = new (require('node:sqlite').DatabaseSync)(
        join(state.domain, 'root-resource-v1.sqlite'),
        { readOnly: true },
      );
      try {
        const n = db
          .prepare(
            "SELECT count(*) n FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",
          )
          .get().n;
        if (point <= 5)
          assert.equal(
            n,
            0,
            'every prior successful native write rolled back with DDL',
          );
        else assert.ok(n > 0, 'actual COMMIT is not pretended undone');
      } finally {
        db.close();
      }
      if (point <= 5)
        await runNative(state, 'reject:FRESH_BIRTH_REQUIRED', 'restart');
      else await runNative(state, 'cold', 'restart');
    },
  );
}
