import { startInstalledMacRootBroker } from './root-broker.js';
/** Fixed root LaunchDaemon entry. Ordinary clients never select its socket,
 * package, UID policy, key or native helper locations. */
async function main() {
    if (process.argv.length !== 2)
        throw Error('broker_arguments');
    const broker = await startInstalledMacRootBroker();
    let closing;
    const stop = () => { if (!closing)
        closing = broker.close().catch(() => { process.exitCode = 1; }); };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
}
void main().catch(() => { process.stderr.write('verification_root_broker_failed\n'); process.exitCode = 1; });
