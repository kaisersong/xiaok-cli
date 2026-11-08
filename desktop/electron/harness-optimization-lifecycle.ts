import {assertOrdinarySourceWriterRoute} from '../../src/runtime/verification/ordinary-source-writer-observation.js';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import type { HarnessOwnerLock } from './harness-optimization-owner-lock.js';
import { readOptionalOriginalHarnessOwnerLock } from './harness-optimization-owner-lock.js';
import { types as lifecycleTypes } from 'node:util';
export interface HarnessOwnerWitness {
  schemaVersion: 1; ownerId: string; initOperationId: string; canonicalRoot: string; identity: string;
  initialized: boolean; initPhase: 'owner_created' | 'ready';
}
export interface HarnessCloseIntent {
  ownerId: string; operationId: string; scope: 'all' | 'research'; manifestId?: string;
  disable: boolean; knownSends: string[];
  ownerEpoch: number;
}
interface OriginalLifecycleBirth {
  readonly lock: HarnessOwnerLock;
  readonly witnessPath: string; readonly dbPath: string; readonly lifecyclePath: string; readonly journalDir: string;
  readonly root: string; readonly identity: string; readonly assertLock: () => void;
}
export interface OriginalHarnessBudgetWorkerBirth {
  readonly ownerId: string; readonly initOperationId: string; readonly root: string; readonly identity: string;
  readonly initializing: boolean; readonly previousDirty: boolean; readonly assertLocal: () => void;
}
const originalLifecycles = new WeakMap<object, OriginalLifecycleBirth>();
const originalPreparedBirths = new WeakMap<object, OriginalHarnessBudgetWorkerBirth>();
const lifecycleGet = WeakMap.prototype.get, lifecycleSet = WeakMap.prototype.set, lifecycleApply = Reflect.apply;
const lifecycleDescriptor = Object.getOwnPropertyDescriptor;
const lifecycleHasOwn = Object.hasOwn, lifecycleKeys = Object.keys, lifecycleFreeze = Object.freeze, lifecycleIsProxy = lifecycleTypes.isProxy;
function originalLifecycle(candidate: object): OriginalLifecycleBirth | undefined {
  return lifecycleApply(lifecycleGet, originalLifecycles, [candidate]) as OriginalLifecycleBirth | undefined;
}
function exactData(object: object, key: string, expected: unknown): void {
  const descriptor = lifecycleDescriptor(object, key);
  if (!descriptor || !lifecycleHasOwn(descriptor, 'value') || descriptor.value !== expected)
    throw new Error('original_budget_worker_birth_changed');
}
function assertLifecycle(candidate: object, row: OriginalLifecycleBirth): void {
  row.assertLock();
  exactData(candidate, 'lock', row.lock);
  const fields = ['witnessPath', 'dbPath', 'lifecyclePath', 'journalDir'] as const;
  for (let index = 0; index < fields.length; index++) {
    const key = fields[index]!; exactData(candidate, key, row[key]);
  }
}
export function assertOriginalHarnessBudgetLifecycle(candidate:unknown):asserts candidate is HarnessOptimizationLifecycle{
  const row=candidate!==null&&(typeof candidate==='object'||typeof candidate==='function')?originalLifecycle(candidate):undefined;
  if(!row)throw new Error('original_budget_lifecycle_required');assertLifecycle(candidate as object,row);
}
/** Original successful prepare only. Data is not a Worker/Core/SQL permission. */
export function readOriginalHarnessBudgetWorkerBirth(candidate: unknown): OriginalHarnessBudgetWorkerBirth {
  const row = candidate !== null && (typeof candidate === 'object' || typeof candidate === 'function')
    ? lifecycleApply(lifecycleGet, originalPreparedBirths, [candidate]) as OriginalHarnessBudgetWorkerBirth | undefined
    : undefined;
  if (!row) throw new Error('original_budget_worker_birth_required');
  row.assertLocal(); return row;
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
    const owned = readOptionalOriginalHarnessOwnerLock(lock);
    const root = owned ? owned.root : lock.root;
    this.witnessPath = join(root, 'harness-optimization-owner.json');
    this.dbPath = join(root, 'harness-optimization.sqlite');
    this.lifecyclePath = join(root, 'harness-optimization-lifecycle.json');
    this.journalDir = join(root, 'harness-optimization-journal');
    // Existing ordinary callers keep their ABI. Only the original native lock
    // acquisition can produce a protected Worker birth, never a mock lock DTO.
    if (owned) {
      lifecycleApply(lifecycleSet, originalLifecycles, [this, lifecycleFreeze({ lock, root: owned.root, identity: owned.identity,
        witnessPath: this.witnessPath, dbPath: this.dbPath, lifecyclePath: this.lifecyclePath,
        journalDir: this.journalDir, assertLock: owned.assertLocal })]);
    }
  }
  async prepare(): Promise<{ witness: HarnessOwnerWitness; initializing: boolean; previousDirty: boolean }> {
    assertOrdinarySourceWriterRoute();
    return this.prepareStorage(false);
  }
  /** Preparation metadata only. Core validates its private lease before using
   * this path; no Worker/DB permission is produced by choosing storage here. */
  async prepareProtectedStorage(): Promise<{ witness: HarnessOwnerWitness; initializing: boolean; previousDirty: boolean }> {
    assertOriginalHarnessBudgetLifecycle(this);
    return this.prepareStorage(true);
  }
  private async prepareStorage(protectedStorage:boolean): Promise<{ witness: HarnessOwnerWitness; initializing: boolean; previousDirty: boolean }> {
    const original = originalLifecycle(this);
    if (original) assertLifecycle(this, original);
    if (!this.lock.held()) throw new Error('owner_lock_lost');
    const hasWitness = await present(this.witnessPath), hasDb = await present(this.dbPath);
    if(protectedStorage&&hasDb)throw new Error('protected_budget_legacy_database_unconfirmed');
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
    if (!initializing && !hasDb && !protectedStorage) throw new Error('owner_database_missing');
    let previousDirty = false;
    if (initializing) {
      if (await present(this.lifecyclePath) || (await this.journals()).length) throw new Error('initialization_has_activity');
    } else {
      try {
        if (!(await present(this.lifecyclePath))) previousDirty = true;
        else { const previous = JSON.parse(await fs.readFile(this.lifecyclePath, 'utf8')); previousDirty = previous.dirty !== false || previous.ownerId !== witness.ownerId || previous.identity !== witness.identity; }
      } catch { previousDirty = true; }
    }
    const prepared = { witness, initializing, previousDirty };
    if (original) {
      if (lifecycleIsProxy(witness)) throw new Error('original_budget_worker_birth_changed');
      const snapshot = lifecycleFreeze({ ...witness });
      let changed = false;
      const row = lifecycleFreeze({ ownerId: witness.ownerId, initOperationId: witness.initOperationId,
        root: original.root, identity: original.identity, initializing, previousDirty,
        assertLocal: () => {
          if (changed) throw new Error('original_budget_worker_birth_changed');
          try {
            assertLifecycle(this, original);
            exactData(prepared, 'witness', witness); exactData(prepared, 'initializing', initializing);
            exactData(prepared, 'previousDirty', previousDirty);
            const fields = lifecycleKeys(snapshot) as (keyof HarnessOwnerWitness)[];
            for (let index = 0; index < fields.length; index++) {
              const key = fields[index]!; exactData(witness, key, snapshot[key]);
            }
          } catch (raw) { changed = true; throw raw; }
        } });
      lifecycleApply(lifecycleSet, originalPreparedBirths, [prepared, row]);
      row.assertLocal();
    }
    return prepared;
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
