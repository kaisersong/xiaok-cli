import { startInstalledVerificationController, isInstalledControllerShutdownUnresolved } from './installed-controller.js';
let unresolvedHold;
function retainUnresolvedLifetime() {
    if (unresolvedHold)
        return;
    // Deliberately referenced: pending/unknown drain must not restart under KeepAlive.
    unresolvedHold = setInterval(() => { }, 30000);
    process.on('SIGTERM', () => { });
    process.on('SIGINT', () => { });
}
/** Fixed installed service entry. No CLI flags, environment-selected identity,
 * configuration path or fallback ordinary controller. */
async function main() {
    if (process.argv.length !== 2)
        throw Error('controller_entry_arguments');
    const controller = await startInstalledVerificationController();
    let shuttingDown = false;
    const failed = () => { process.exitCode = 1; process.stderr.write('verification_controller_shutdown_unresolved\n'); };
    const stop = () => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        retainUnresolvedLifetime();
        try {
            void controller.close().then(() => { clearInterval(unresolvedHold); unresolvedHold = undefined; }, failed);
        }
        catch {
            failed();
        }
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
}
void main().catch(error => { if (isInstalledControllerShutdownUnresolved(error))
    retainUnresolvedLifetime(); process.exitCode = 1; process.stderr.write('verification_controller_start_rejected\n'); });
