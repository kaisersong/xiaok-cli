import { startInstalledVerificationReceiver } from './installed-receiver.js';
async function main() {
    if (process.argv.length !== 2)
        throw Error('receiver_entry_arguments');
    const receiver = await startInstalledVerificationReceiver();
    let stopping = false;
    const stop = () => { if (stopping)
        return; stopping = true; void receiver.close().catch(() => { process.stderr.write('verification_receiver_shutdown_unresolved\n'); process.exitCode = 1; }); };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
}
void main().catch(() => { process.stderr.write('verification_receiver_start_rejected\n'); process.exitCode = 1; });
