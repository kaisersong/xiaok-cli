import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createInputStager } from '../../../src/runtime/isolated-execution/staging.js';

describe.skipIf(process.platform === 'win32')('actual granted-file staging, not OS authority qualification', () => {
  const nativeRoot = mkdtempSync(join(tmpdir(), 'staging-native-'));
  const readerExecutable = join(nativeRoot, 'secure-read');
  beforeAll(() => { const result = spawnSync('/usr/bin/cc', ['-O2', '-Wall', '-Wextra', '-Werror', resolve('src/runtime/verification/native/secure-read.c'), '-o', readerExecutable], { encoding: 'utf8' }); expect(result.stderr).toBe(''); expect(result.status).toBe(0); });
  afterAll(() => rmSync(nativeRoot, { recursive: true, force: true }));
  it('freezes exactly granted bytes and rejects forged/cross-factory plans and later revocation', () => {
    const root = mkdtempSync(join(tmpdir(), 'isolated-staging-'));
    try {
      const workspace = join(root, 'workspace'); mkdirSync(workspace); writeFileSync(join(workspace, 'a.txt'), 'edited');
      const grant = Object.freeze({}); let revoked = false;
      const hash = createHash('sha256').update('edited').digest('hex');
      const access = { assertLive(g: object) { if (g !== grant || revoked) throw Error('test_grant_revoked'); }, assertRead(g: object, file: { canonicalPath: string; expectedContentHash: string }) { this.assertLive(g); if (file.canonicalPath !== realpathSync(join(workspace, 'a.txt')) || file.expectedContentHash !== hash) throw Error('test_grant_scope'); } };
      const stager = createInputStager({ readerExecutable, root: join(root, 'stage'), access });
      const input = { purpose: 'isolated-validation' as const, grant, workspaceRoot: workspace, files: [{ path: 'a.txt', expectedContentHash: hash, byteLimit: 100 }], editedFile: { path: 'a.txt', afterHash: hash }, invocation: { sessionIdentity: 's', compoundOperationId: 'o', validationInvocationId: 'v' }, command: { argv: ['/bin/sh', '-c', 'cat a.txt'], cwdRelative: '.' } };
      const result = stager.prepareValidationInput(input);
      writeFileSync(join(workspace, 'a.txt'), 'later');
      expect(stager.readFile(result.materializedInput, 'a.txt').toString()).toBe('edited');
      expect(() => stager.readFile({} as any, 'a.txt')).toThrow('staging_plan_identity');
      const other = createInputStager({ readerExecutable, root: join(root, 'stage2'), access });
      expect(() => other.readFile(result.materializedInput, 'a.txt')).toThrow('staging_plan_identity');
      revoked = true;
      expect(() => stager.readFile(result.materializedInput, 'a.txt')).toThrow('test_grant_revoked');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('refuses outside links, missing edited material, wrong hashes and reads outside exact scope', () => {
    const root = mkdtempSync(join(tmpdir(), 'isolated-staging-deny-'));
    try {
      const workspace = join(root, 'workspace'); mkdirSync(workspace); writeFileSync(join(workspace, 'a.txt'), 'edited');
      writeFileSync(join(root, 'secret'), 'secret'); symlinkSync(join(root, 'secret'), join(workspace, 'link'));
      const hash = createHash('sha256').update('edited').digest('hex');
      const access = { assertLive() {}, assertRead() {} }; // File safety test, no authorization claim.
      const stager = createInputStager({ readerExecutable, root: join(root, 'stage'), access });
      const input = { purpose: 'isolated-validation' as const, grant: Object.freeze({}), workspaceRoot: workspace, files: [{ path: 'a.txt', expectedContentHash: hash, byteLimit: 100 }], editedFile: { path: 'a.txt', afterHash: hash }, invocation: { sessionIdentity: 's', compoundOperationId: 'o', validationInvocationId: 'v' }, command: { argv: ['/bin/sh', '-c', 'cat a.txt'], cwdRelative: '.' } };
      expect(() => stager.prepareValidationInput({ ...input, files: [] })).toThrow('staging_edited_file_missing');
      expect(() => stager.prepareValidationInput({ ...input, files: [{ ...input.files[0], expectedContentHash: 'a'.repeat(64) }] })).toThrow('staging_content_changed');
      expect(() => stager.prepareValidationInput({ ...input, files: [...input.files, { path: 'link', expectedContentHash: 'a'.repeat(64), byteLimit: 100 }] })).toThrow('staging_source_link');
      const plan = stager.prepareValidationInput(input).materializedInput;
      expect(() => stager.readFile(plan, '../secret')).toThrow('staging_file_scope');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('does not follow an ancestor exchanged for a symlink inside the authority callback', () => {
    const root = mkdtempSync(join(tmpdir(), 'isolated-staging-race-'));
    try {
      const workspace = join(root, 'workspace'); mkdirSync(join(workspace, 'sub'), { recursive: true });
      mkdirSync(join(root, 'outside')); writeFileSync(join(workspace, 'sub', 'a'), 'same'); writeFileSync(join(root, 'outside', 'a'), 'same');
      const hash = createHash('sha256').update('same').digest('hex');
      const stager = createInputStager({ readerExecutable, root: join(root, 'stage'), access: { assertLive() {}, assertRead() { renameSync(join(workspace, 'sub'), join(workspace, 'old')); symlinkSync(join(root, 'outside'), join(workspace, 'sub')); } } });
      expect(() => stager.prepareValidationInput({ purpose: 'isolated-validation', grant: {}, workspaceRoot: workspace, files: [{ path: 'sub/a', expectedContentHash: hash, byteLimit: 4 }], editedFile: { path: 'sub/a', afterHash: hash }, invocation: { sessionIdentity: 's', compoundOperationId: 'o', validationInvocationId: 'v' }, command: { argv: ['/bin/true'], cwdRelative: '.' } })).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
