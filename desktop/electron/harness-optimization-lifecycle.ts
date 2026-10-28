import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import type { HarnessOwnerLock } from './harness-optimization-owner-lock.js';
export interface HarnessOwnerWitness {
  schemaVersion: 1; ownerId: string; initOperationId: string; canonicalRoot: string; identity: string;
  initialized: boolean; initPhase: 'owner_created' | 'ready';
}
export interface HarnessCloseIntent {
  ownerId: string; operationId: string; scope: 'all' | 'research'; manifestId?: string;
  disable: boolean; knownSends: string[];
  ownerEpoch: number;
}
async function syncDirectory(path: string) { const handle = await fs.open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); } }
async function present(path: string) {
  try { const stat = await fs.lstat(path); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('owner_file_invalid'); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
export async function writeHarnessFile(path: string, value: unknown, exclusive = false): Promise<void> {
  const target = exclusive ? path : `${path}.${randomUUID()}.tmp`;
  const handle = await fs.open(target, 'wx', 0o600);
  try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  if (!exclusive) await fs.rename(target, path);
  await syncDirectory(dirname(path));
}
export class HarnessOptimizationLifecycle {
  readonly witnessPath: string;
  readonly dbPath: string;
  readonly lifecyclePath: string;
  readonly journalDir: string;
  constructor(readonly lock: HarnessOwnerLock) {
    this.witnessPath = join(lock.root, 'harness-optimization-owner.json');
    this.dbPath = join(lock.root, 'harness-optimization.sqlite');
    this.lifecyclePath = join(lock.root, 'harness-optimization-lifecycle.json');
    this.journalDir = join(lock.root, 'harness-optimization-journal');
  }
  async prepare(): Promise<{ witness: HarnessOwnerWitness; initializing: boolean; previousDirty: boolean }> {
    if (!this.lock.held()) throw new Error('owner_lock_lost');
    const hasWitness = await present(this.witnessPath), hasDb = await present(this.dbPath);
    let witness: HarnessOwnerWitness;
    if (!hasWitness) {
      if (hasDb || await present(this.lifecyclePath) || (await this.journals()).length) throw new Error('owner_witness_missing');
      witness = { schemaVersion: 1, ownerId: randomUUID(), initOperationId: randomUUID(), canonicalRoot: this.lock.root,
        identity: this.lock.identity, initialized: false, initPhase: 'owner_created' };
      await writeHarnessFile(this.witnessPath, witness, true);
    } else {
      const contents = await fs.readFile(this.witnessPath, 'utf8');
      try { witness = JSON.parse(contents) as HarnessOwnerWitness; }
      catch { throw new Error('owner_witness_invalid'); }
    }
    if (witness.schemaVersion !== 1 || typeof witness.initialized !== 'boolean'
      || !/^[a-f0-9-]{36}$/.test(witness.ownerId) || !/^[a-f0-9-]{36}$/.test(witness.initOperationId)
      || witness.canonicalRoot !== this.lock.root || witness.identity !== this.lock.identity
      || witness.initPhase !== (witness.initialized ? 'ready' : 'owner_created')) throw new Error('owner_witness_invalid');
    const initializing = !witness.initialized;
    if (!initializing && !hasDb) throw new Error('owner_database_missing');
    let previousDirty = false;
    if (initializing) {
      if (await present(this.lifecyclePath) || (await this.journals()).length) throw new Error('initialization_has_activity');
    } else {
      try {
        if (!(await present(this.lifecyclePath))) previousDirty = true;
        else { const previous = JSON.parse(await fs.readFile(this.lifecyclePath, 'utf8')); previousDirty = previous.dirty !== false || previous.ownerId !== witness.ownerId || previous.identity !== witness.identity; }
      } catch { previousDirty = true; }
    }
    return { witness, initializing, previousDirty };
  }
  async ready(witness: HarnessOwnerWitness) {
    if (!witness.initialized) await writeHarnessFile(this.witnessPath, { ...witness, initialized: true, initPhase: 'ready' });
    await writeHarnessFile(this.lifecyclePath, { ownerId: witness.ownerId, identity: witness.identity, dirty: true });
  }
  async clean(witness: HarnessOwnerWitness) { await writeHarnessFile(this.lifecyclePath, { ownerId: witness.ownerId, identity: witness.identity, dirty: false }); }
  async journals(): Promise<HarnessCloseIntent[]> {
    let files: string[];
    try {
      const stat = await fs.lstat(this.journalDir); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('journal_invalid');
      files = await fs.readdir(this.journalDir);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const result: HarnessCloseIntent[] = [];
    for (const name of files) {
      if (/^[a-f0-9-]{36}\.json\.[a-f0-9-]{36}\.tmp$/.test(name)) {
        await fs.unlink(join(this.journalDir, name)).catch(() => {});
        continue;
      }
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) throw new Error('journal_invalid');
      const path = join(this.journalDir, name); await present(path);
      const contents = await fs.readFile(path, 'utf8');
      let value: HarnessCloseIntent;
      try { value = JSON.parse(contents) as HarnessCloseIntent; }
      catch { throw new Error('journal_invalid'); }
      if (`${value.operationId}.json` !== name || !['all', 'research'].includes(value.scope) || typeof value.disable !== 'boolean'
        || !Number.isSafeInteger(value.ownerEpoch) || value.ownerEpoch < 1
        || !Array.isArray(value.knownSends) || value.knownSends.some(id => typeof id !== 'string')) throw new Error('journal_invalid');
      result.push(value);
    }
    return result;
  }
  async writeJournal(intent: HarnessCloseIntent) {
    await fs.mkdir(this.journalDir, { mode: 0o700, recursive: true });
    const stat = await fs.lstat(this.journalDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('journal_invalid');
    await syncDirectory(this.lock.root);
    const path = join(this.journalDir, `${intent.operationId}.json`);
    try { await writeHarnessFile(path, intent, true); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // Only the same root-held, main-issued operation reaches this retry path.
      await present(path);
      const contents = await fs.readFile(path, 'utf8');
      try { if (JSON.stringify(JSON.parse(contents)) === JSON.stringify(intent)) return; }
      catch { /* Replace a malformed journal atomically as well. */ }
      await writeHarnessFile(path, intent);
    }
  }
  async clearJournal(operationId: string) {
    await fs.unlink(join(this.journalDir, `${operationId}.json`)); await syncDirectory(this.journalDir);
  }
}
