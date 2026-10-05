import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { collectWorkspaceHealth } from '../../scripts/check-repo-hygiene.js';
const roots = [];
afterEach(() => { for (const p of roots.splice(0))
    rmSync(p, { recursive: true, force: true }); });
function git(cwd, ...args) { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function workspace() { const root = mkdtempSync(join(tmpdir(), 'xiaok-hygiene-')); roots.push(root); for (const name of ['xiaok-cli', 'kswarm', 'intent-broker', 'kai-xiaok-plugins']) {
    const remote = join(root, name + '.git');
    mkdirSync(remote);
    git(remote, 'init', '--bare', '--initial-branch=main');
    const repo = join(root, name);
    git(root, 'clone', remote, repo);
    git(repo, 'config', 'user.name', 'Fixture');
    git(repo, 'config', 'user.email', 'fixture@example.invalid');
    writeFileSync(join(repo, 'README'), 'baseline');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'baseline');
    git(repo, 'push', '-u', 'origin', 'main');
    git(repo, 'remote', 'set-head', 'origin', '-a');
} return root; }
test('fetches all four real repos with default main and preserves local work', () => { const root = workspace(); const repo = join(root, 'xiaok-cli'); git(repo, 'switch', '-c', 'feature/test'); writeFileSync(join(repo, 'local'), 'keep'); const r = collectWorkspaceHealth({ cwd: repo }); assert.equal(r.repositories.length, 4); assert.equal(r.freshnessVerified, true); assert.equal(r.ok, true); assert.equal(r.repositories[0].defaultBranch, 'main'); assert.match(r.repositories[0].warnings.join(), /active worktree/); assert.equal(git(repo, 'branch', '--show-current'), 'feature/test'); });
test('reports a missing sibling without skipping the other repositories', () => { const root = workspace(); rmSync(join(root, 'kswarm'), { recursive: true }); const r = collectWorkspaceHealth({ cwd: join(root, 'xiaok-cli') }); assert.equal(r.ok, false); assert.equal(r.repositories.length, 4); assert.match(r.repositories[1].issues.join(), /missing|not.*repo/i); assert.equal(r.repositories[3].fetchSucceeded, true); });
test('fetch failure is not fresh success; no-fetch explicitly stays unverified', () => { const root = workspace(); const repo = join(root, 'intent-broker'); git(repo, 'remote', 'set-url', 'origin', join(root, 'not-found.git')); let r = collectWorkspaceHealth({ cwd: join(root, 'xiaok-cli') }); assert.equal(r.ok, false); assert.equal(r.freshnessVerified, false); assert.equal(r.repositories[2].fetchSucceeded, false); r = collectWorkspaceHealth({ cwd: join(root, 'xiaok-cli'), fetch: false }); assert.equal(r.freshnessVerified, false); assert.equal(r.repositories[0].fetchSucceeded, null); });
test('fetch detects a new remote commit and a detached HEAD is rejected', () => { const root = workspace(); const repo = join(root, 'kswarm'); const writer = join(root, 'writer'); git(root, 'clone', join(root, 'kswarm.git'), writer); git(writer, 'config', 'user.name', 'Fixture'); git(writer, 'config', 'user.email', 'fixture@example.invalid'); writeFileSync(join(writer, 'new'), 'remote change'); git(writer, 'add', '.'); git(writer, 'commit', '-m', 'new'); git(writer, 'push'); git(join(root, 'intent-broker'), 'checkout', '--detach'); const r = collectWorkspaceHealth({ cwd: join(root, 'xiaok-cli') }); assert.equal(r.repositories[1].behind, 1); assert.equal(r.repositories[1].ok, false); assert.match(r.repositories[2].issues.join(), /detached/i); });
