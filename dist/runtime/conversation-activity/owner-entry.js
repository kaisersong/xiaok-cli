import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveConversationActivityOwner } from './owner-runtime.js';
// Imported to ensure Desktop's compiler emits the standalone entry, but only
// a dedicated Node invocation may start it. Main/CLI imports have no effect.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const config = process.argv[2];
    if (!config)
        throw new Error('activity_owner_config_required');
    void serveConversationActivityOwner(config).catch((error) => {
        const code = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : error?.code ?? 'unclassified';
        process.stderr.write(`activity_owner_start_failed:${code}\n`);
        process.exitCode = 1;
    });
}
