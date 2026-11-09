import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
test('the actual C accepted codec preserves fixed big-endian bytes, the original checksum domain and component isolation', { skip: process.platform !== 'darwin' }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'main-root-codec-')), out = join(root, 'codec');
    try {
        const build = spawnSync('/usr/bin/clang', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-Wno-deprecated-declarations', '-I', resolve('native/main-installation'), resolve('tests/native/fixtures/main-enrollment-codec.c'), '-o', out], { encoding: 'utf8' });
        console.log(JSON.stringify({ kind: 'owned-codec-compile', pid: build.pid, status: build.status, signal: build.signal }));
        assert.equal(build.status, 0, build.stderr);
        const encoded = spawnSync(out, ['encode-vector']);
        console.log(JSON.stringify({ kind: 'owned-codec-encode', pid: encoded.pid, status: encoded.status, signal: encoded.signal }));
        assert.equal(encoded.status, 0, encoded.stderr?.toString());
        const bytes = encoded.stdout;
        assert.equal(bytes.length, 2080);
        assert.equal(bytes.subarray(0, 8).toString(), 'XMACPT01');
        assert.equal(bytes.subarray(20, 24).toString('hex'), '01020304');
        assert.equal(bytes.subarray(24, 32).toString('hex'), '0000000100000002');
        assert.equal(bytes.subarray(688, 696).toString('hex'), '0000000100000002');
        assert.deepEqual(bytes.subarray(2048), createHash('sha256').update('xiaok-main-root-accepted-projection-v1\0').update(bytes.subarray(0, 2048)).digest());
        for (const [mode, input, expected] of [['decode-component', bytes, 0], ['decode-production', bytes, 65], ['decode-component', bytes.subarray(0, 2079), 65]]) {
            const decoded = spawnSync(out, [mode], { input });
            console.log(JSON.stringify({ kind: 'owned-codec-decode', pid: decoded.pid, status: decoded.status, mode }));
            assert.equal(decoded.status, expected, decoded.stderr?.toString());
        }
        const codec = await import(pathToFileURL(resolve('dist/runtime/verification/main-root-enrollment-codec.js')).href);
        const decoded = codec.decodeMainRootAcceptedProjection(bytes, 'component');
        assert.deepEqual(codec.encodeMainRootAcceptedProjection(decoded), bytes);
        assert.equal(decoded.uid, 0x01020304);
        assert.equal(decoded.epoch, '4294967298');
        assert.equal(decoded.sourceFacts[0].device, '4294967298');
        const core = spawnSync(out, ['core-hash-component'], { input: bytes });
        console.log(JSON.stringify({ kind: 'owned-core-hash', pid: core.pid, status: core.status }));
        assert.equal(core.status, 0);
        assert.equal(core.stdout.toString('hex'), codec.mainRootActivationClaimCoreHash(bytes));
        const consumed = spawnSync(out, ['encode-consume-vector']);
        console.log(JSON.stringify({ kind: 'owned-consume-encode', pid: consumed.pid, status: consumed.status }));
        assert.equal(consumed.status, 0);
        const consume = codec.decodeMainRootConsumeReceipt(consumed.stdout, 'component');
        assert.equal(consume.nonce, 'bc'.repeat(32));
        assert.deepEqual(codec.encodeMainRootConsumeReceipt(consume), consumed.stdout);
        for (const mode of ['decode-consume-component', 'decode-consume-production']) {
            const r = spawnSync(out, [mode], { input: codec.encodeMainRootConsumeReceipt(consume) });
            console.log(JSON.stringify({ kind: 'owned-consume-decode', pid: r.pid, status: r.status, mode }));
            assert.equal(r.status, mode === 'decode-consume-component' ? 0 : 65);
        }
        for (const at of [0, 16, 264, 584, 588, 992, 1264, 2048]) {
            const changed = Buffer.from(bytes);
            changed[at] ^= 1;
            const decoded = spawnSync(out, ['decode-component'], { input: changed });
            console.log(JSON.stringify({ kind: 'owned-codec-mutation', pid: decoded.pid, status: decoded.status, offset: at }));
            assert.equal(decoded.status, 65);
        }
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
