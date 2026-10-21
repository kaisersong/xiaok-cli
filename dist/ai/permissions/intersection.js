import { PermissionManager } from './manager.js';
/** A task may narrow, never replace, the source registry permission authority. */
export class IntersectedPermissionManager extends PermissionManager {
    parent;
    constructor(parent, mode) {
        super({ mode });
        this.parent = parent;
    }
    getRevision() { return super.getRevision() + this.parent.getRevision(); }
    onRevisionChanged(listener) {
        const report = () => listener(this.getRevision());
        const local = super.onRevisionChanged(report), parent = this.parent.onRevisionChanged(report);
        return () => { local(); parent(); };
    }
    async check(name, input) {
        const parent = await this.parent.check(name, input);
        const local = await super.check(name, input);
        return parent === 'deny' || local === 'deny' ? 'deny' : parent === 'prompt' || local === 'prompt' ? 'prompt' : 'allow';
    }
}
