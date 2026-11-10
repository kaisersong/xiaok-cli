import { join, relative, sep } from 'node:path';
import { DecisionModelFiles } from './decision-model-files.js';
import { parseDecisionData, ownDecisionData } from './decision-model-data.js';
import type { DecisionModelManifest,DecisionModelView } from '../shared/decision-model-types.js';
const own = ownDecisionData, OWN = 'xiaok-decision-model-v1';
/** Metadata projection only. All IO and fates remain the same original files
 * owner; no resource, authority, gateway or lifetime is created here. */
export class DecisionModelMetadata {
    selected: string | null = null;
    constructor(private readonly files: DecisionModelFiles, private readonly models: readonly DecisionModelManifest[]) { }
    private model(id: string): DecisionModelManifest { const model = this.models.find(m => m.id === id); if (!model)
        throw Error('selection_invalid'); return model; }
    directory(m: DecisionModelManifest, create = false): string | undefined {
        if (!this.files.exists(this.files.root)) {
            if (!create)
                return;
            this.files.ensureRoot();
        }
        const path = join(this.files.root, m.id);
        if (!this.files.exists(path)) {
            if (!create)
                return;
            this.files.mkdir(path);
            this.files.exclusiveText(join(path, '.owned.json'), { owner: OWN, id: m.id, revision: m.revision });
        }
        const marker = parseDecisionData(this.files.readText(join(path, '.owned.json')));
        if (own(marker, 'owner') !== OWN || own(marker, 'id') !== m.id || own(marker, 'revision') !== m.revision)
            throw Error('ownership');
        this.tree(m, path);
        return path;
    }
    private tree(m: DecisionModelManifest, path: string): void {
        const allowed = new Set(['.owned.json', '.verified.json', '.trusted.json', ...m.files.flatMap(f => [f.name, f.name + '.part'])]);
        const walk = (dir: string) => {
            for (const item of this.files.entries(dir)) {
                const file = join(dir, item);
                this.files.safe(file);
                const name = relative(path, file).split(sep).join('/');
                if (allowed.has(name))
                    continue;
                if ([...allowed].some(x => x.startsWith(name + '/')))
                    walk(file);
                else
                    throw Error('foreign_file');
            }
        };
        walk(path);
    }
    loadSelection(): void {
        const path = join(this.files.root, 'selection.json');
        if (this.files.exists(this.files.root) && this.files.exists(path)) {
            const raw = parseDecisionData(this.files.readText(path));
            if (own(raw, 'version') !== 1)
                throw Error('selection_invalid');
            const id = own(raw, 'modelId'), revision = own(raw, 'revision');
            if (id !== null) {
                if (typeof id !== 'string' || this.model(id).revision !== revision)
                    throw Error('selection_invalid');
                this.selected = id;
            }
            return;
        }
        const legacy = join(this.files.base, 'memory-jev-settings.json');
        if (!this.files.exists(legacy))
            return;
        const raw = parseDecisionData(this.files.readText(legacy));
        if (own(raw, 'version') !== 1 || typeof own(raw, 'enabled') !== 'boolean')
            throw Error('selection_invalid');
        const decision = own(raw, 'decision');
        if (own(decision, 'provider') === 'local-systemone') {
            const id = own(decision, 'managedModelId');
            if (typeof id === 'string') {
                this.model(id);
                this.selected = id;
            }
        }
        // Legacy enabled is intentionally not consumed: no trial/hook is imported.
    }
    initializeModel(m:DecisionModelManifest,view:DecisionModelView):void {
        const path = this.directory(m);
        if (!path)
          return;
        view.state = 'interrupted';
        const receipt = join(path, '.verified.json');
        if (!this.files.exists(receipt))
          return;
        const record = parseDecisionData(this.files.readText(receipt, 16384));
        if (own(record, 'revision') !== m.revision)
          return;
        const stored = own(record, 'files');
        if (!Array.isArray(stored) || stored.length !== m.files.length)
          return;
        let valid = true;
        for (const file of m.files) {
          const location = join(path, ...file.name.split('/'));
          if (!this.files.exists(location)) {
            valid = false;
            break;
          }
          const stat = this.files.stamp(location), entry = stored.find(x => own(x, 'name') === file.name);
          if (!entry || own(entry, 'hash') !== file.hash || own(entry, 'mtimeNs') !== String(stat.mtimeNs) || stat.size !== BigInt(file.size))
            valid = false;
        }
        if (valid) {
          view.verified = true;
          view.state = 'installed';
          view.downloadedBytes = m.sizeBytes;
        }
    }
    recordVerified(m: DecisionModelManifest, path: string): void {
        const records = m.files.map(file => ({ name: file.name, hash: file.hash, mtimeNs: String(this.files.stamp(join(path, ...file.name.split('/'))).mtimeNs) }));
        this.files.atomic(join(path, '.verified.json'), { revision: m.revision, files: records });
    }
}

export function decisionModelView(m: DecisionModelManifest): DecisionModelView {
    return { id: m.id, source: m.source, revision: m.revision, sizeBytes: m.sizeBytes, sizeLabel: `${(m.sizeBytes / 1073741824).toFixed(2)} GiB`, supported: m.platforms.includes(`${process.platform}-${process.arch}`), verified: false, state: 'not_installed', reason: null, downloadedBytes: 0, currentFile: null, availableDiskBytes: null, codeHash: m.codeHash, runtime: m.runtime, endpoint: null, runtimeSource: m.runtimePackage?.source, runtimeVersion: m.runtimePackage?.version, runtimePid: null, selected: false, automaticMemoryRerank: 'not-qualified-r12' };
}
