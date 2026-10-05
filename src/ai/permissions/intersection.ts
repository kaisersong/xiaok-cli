import { PermissionManager, type PermissionDecision, type PermissionMode } from './manager.js';
/** A task may narrow, never replace, the source registry permission authority. */
export class IntersectedPermissionManager extends PermissionManager {
  constructor(private readonly parent: PermissionManager, mode: PermissionMode) { super({ mode }); }
  override getRevision(): number { return super.getRevision() + this.parent.getRevision(); }
  override onRevisionChanged(listener: (revision: number) => void): () => void {
    const report = () => listener(this.getRevision());
    const local = super.onRevisionChanged(report), parent = this.parent.onRevisionChanged(report);
    return () => { local(); parent(); };
  }
  override async check(name: string, input: Record<string, unknown>): Promise<PermissionDecision> {
    const parent = await this.parent.check(name, input);
    const local = await super.check(name, input);
    return parent === 'deny' || local === 'deny' ? 'deny' : parent === 'prompt' || local === 'prompt' ? 'prompt' : 'allow';
  }
}
