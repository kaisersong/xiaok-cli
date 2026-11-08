import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync, renameSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const darwin = { skip: process.platform !== 'darwin' };
function fixture() {
    const outer = mkdtempSync(join(tmpdir(), 'main-enrollment-file-'));
    const root = join(outer, 'metadata');
    mkdirSync(root, { mode: 0o700 });
    const bin = join(outer, 'driver');
    const build = spawnSync('/usr/bin/clang', [
        '-std=c11', '-Wall', '-Wextra', '-Werror', '-Wno-deprecated-declarations',
        '-DMI_ENROLLMENT_COMPONENT_BUILD=1', '-I', resolve('native/main-installation'),
        resolve('tests/native/fixtures/main-enrollment-consume.c'),
        '-framework', 'Security', '-o', bin,
    ], { encoding: 'utf8' });
    console.log(JSON.stringify({ kind: 'owned-consume-file-compile', pid: build.pid, status: build.status }));
    assert.equal(build.status, 0, build.stderr);
    return {
        root,
        close() { rmSync(outer, { recursive: true, force: true }); },
        run(mode = 'existing', fault = 'none') {
            const r = spawnSync(bin, [root, mode, fault], { encoding: 'utf8' });
            console.log(JSON.stringify({
                kind: 'owned-consume-file-driver', pid: r.pid, status: r.status,
                mode, fault, stderr: r.stderr, stdout: r.stdout,
            }));
            assert.equal(r.status, 0, r.stderr);
            return r.stdout.trim() ? JSON.parse(r.stdout) : undefined;
        },
    };
}
test('metadata consumption persists one original nonce and cold-replays only the same physical file', darwin, () => { const f = fixture(); try {
    const first = f.run('create');
    assert.equal(first.good, true);
    assert.equal(first.status, 1);
    const file = join(f.root, first.name), before = readFileSync(file);
    const second = f.run();
    assert.equal(second.good, true);
    assert.equal(second.status, 2);
    assert.ok(second.fsyncs >= 2, 'cold acknowledgement must confirm the original record and metadata directory durability');
    assert.deepEqual(readFileSync(file), before);
    assert.equal(existsSync(join(f.root, 'authority')), false);
}
finally {
    f.close();
} });
test('an absent or replaced actual accepted file cannot consume a caller-supplied in-memory projection', darwin, () => { const f = fixture(); try {
    const absent = f.run();
    assert.equal(absent.good, false);
    assert.equal(absent.status, 3);
    assert.equal(absent.closes, 0);
    f.run('write-accepted');
    const accepted = join(f.root, 'main-root-family.enrollment'), original = readFileSync(accepted);
    const changed = Buffer.from(original);
    changed[264] ^= 1;
    writeFileSync(accepted, changed);
    const replacement = f.run();
    assert.equal(replacement.good, false);
    assert.equal(existsSync(join(f.root, 'enrollment-consume-' + original.subarray(232, 264).toString('hex') + '.bin')), false);
}
finally {
    f.close();
} });
test('a symlink accepted source is refused before creating consumption metadata', darwin, () => { const f = fixture(); try {
    const other = join(f.root, 'not-accepted');
    writeFileSync(other, Buffer.alloc(2080), { mode: 0o600 });
    symlinkSync(other, join(f.root, 'main-root-family.enrollment'));
    const result = f.run();
    assert.equal(result.good, false);
    assert.equal(result.closes, 0);
}
finally {
    f.close();
} });
test('partial or foreign consume bytes remain unchanged and sticky unknown', darwin, () => { const f = fixture(); try {
    const first = f.run('create'), file = join(f.root, first.name), partial = readFileSync(file).subarray(0, 17);
    writeFileSync(file, partial);
    const result = f.run();
    assert.equal(result.good, false);
    assert.equal(result.unknown, true);
    assert.equal(result.reason, 'MI_CONSUME_PARTIAL_PRESENT');
    assert.deepEqual(readFileSync(file), partial);
}
finally {
    f.close();
} });
test('a post-call close error preserves first errno, attempts remaining real descriptors and retains the original metadata root', darwin, () => { const f = fixture(); try {
    const result = f.run('create', 'close');
    assert.equal(result.good, false);
    assert.equal(result.unknown, true);
    assert.equal(result.firstErrno, 5);
    assert.ok(result.closes >= 2);
    assert.equal(result.rootRetained, true);
}
finally {
    f.close();
} });
test('post-fsync unknown preserves the durable original consume instead of generating another nonce', darwin, () => { const f = fixture(); try {
    const first = f.run('create', 'fsync');
    assert.equal(first.good, false);
    assert.equal(first.unknown, true);
    const file = join(f.root, first.name), before = readFileSync(file);
    const next = f.run();
    assert.equal(next.status, 2);
    assert.deepEqual(readFileSync(file), before);
    assert.equal(existsSync(join(f.root, 'authority')), false);
}
finally {
    f.close();
} });
test('same accepted bytes in a replacement inode cannot revive the old consumed relation', darwin, () => { const f = fixture(); try {
    const first = f.run('create'), file = join(f.root, first.name), before = readFileSync(file), accepted = join(f.root, 'main-root-family.enrollment'), next = accepted + '.replacement';
    writeFileSync(next, readFileSync(accepted), { mode: 0o600, flag: 'wx' });
    renameSync(next, accepted);
    const result = f.run();
    assert.equal(result.good, false);
    assert.equal(result.unknown, true);
    assert.equal(result.reason, 'MI_CONSUME_FOREIGN_PRESENT');
    assert.deepEqual(readFileSync(file), before);
}
finally {
    f.close();
} });
test('a complete foreign record with a valid checksum is not another permission or fresh attempt', darwin, async () => { const f = fixture(); try {
    const first = f.run('create'), file = join(f.root, first.name), codec = await import(pathToFileURL(resolve('dist/runtime/verification/main-root-enrollment-codec.js')).href), record = codec.decodeMainRootConsumeReceipt(readFileSync(file), 'component');
    const foreign = codec.encodeMainRootConsumeReceipt({ ...record, poolId: 'fa'.repeat(32) });
    writeFileSync(file, foreign);
    const result = f.run();
    assert.equal(result.good, false);
    assert.equal(result.unknown, true);
    assert.equal(result.reason, 'MI_CONSUME_FOREIGN_PRESENT');
    assert.deepEqual(readFileSync(file), foreign);
}
finally {
    f.close();
} });
test('close failure with errno zero still has first-error presence and attempts both original descriptors', darwin, () => { const f = fixture(); try {
    const result = f.run('create', 'close-zero');
    assert.equal(result.good, false);
    assert.equal(result.unknown, true);
    assert.equal(result.errorPresent, true);
    assert.equal(result.firstErrno, 0);
    assert.ok(result.closes >= 2);
    assert.equal(result.rootRetained, true);
}
finally {
    f.close();
} });

test('cold durability failure keeps the same original consume file and borrowed root unknown', darwin, () => {
    const f = fixture();
    try {
        const first = f.run('create'), file = join(f.root, first.name), before = readFileSync(file);
        const failed = f.run('existing', 'fsync');
        assert.equal(failed.good, false);
        assert.equal(failed.unknown, true);
        assert.equal(failed.errorPresent, true);
        assert.equal(failed.firstErrno, 5);
        assert.ok(failed.closes >= 2);
        assert.equal(failed.rootRetained, true);
        assert.deepEqual(readFileSync(file), before);
    } finally {
        f.close();
    }
});

test('the actual production-compiled missing-migration and missing-restore branches deny before O_EXCL', darwin, () => {
    const root = mkdtempSync(join(tmpdir(), 'main-enrollment-production-deny-'));
    try {
        const metadata = join(root, 'metadata'); mkdirSync(metadata, { mode: 0o700 });
        const bin = join(root, 'deny');
        const built = spawnSync('/usr/bin/clang', [
            '-std=c11', '-Wall', '-Wextra', '-Werror', '-Wno-deprecated-declarations',
            '-I', resolve('native/main-installation'),
            resolve('tests/native/fixtures/main-enrollment-production-deny.c'),
            '-framework', 'Security', '-o', bin,
        ], { encoding: 'utf8' });
        console.log(JSON.stringify({ kind: 'owned-production-deny-compile', pid: built.pid, status: built.status }));
        assert.equal(built.status, 0, built.stderr);
        for (const [mode, reason] of [['migration', 'MI_MIGRATION_NOT_IMPLEMENTED'], ['restore', 'MI_CONSUME_RESTORE_MISSING'], ['planned-migration', 'MI_MIGRATION_NOT_IMPLEMENTED'], ['planned-restore', 'MI_CONSUME_RESTORE_MISSING']]) {
            const r = spawnSync(bin, [metadata, mode], { encoding: 'utf8' });
            console.log(JSON.stringify({ kind: 'owned-production-deny-driver', pid: r.pid, status: r.status, mode, stdout: r.stdout, stderr: r.stderr }));
            assert.equal(r.status, 0, r.stderr);
            assert.deepEqual(JSON.parse(r.stdout), { scope: 'production-metadata-negative-only', good: false, status: 3, unknown: false, reason, openatCalls: 0, createCalls: 0, closeKnown: true });
            assert.deepEqual(readdirSync(metadata), []);
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
